import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../core/services/admin.service';
import { AdminScopeService } from '../../core/services/admin-scope.service';
import type { ProfileConverterId, ProfileField, ProfileFieldType } from '../../core/models/firestore.models';
import { PROFILE_CONVERTERS } from '../../core/utils/profile-converters';
import { PROFILE_FIELD_TYPE_LABELS } from '../../core/utils/profile-fields';
import { toErrorMessage } from '../../core/utils/errors';

/** 編集中の項目(選択肢はテキストエリアで1行1つ)。 */
interface DraftField extends ProfileField {
  optionsText: string;
  /** まだ保存していない、追加したばかりの項目。 */
  isNew: boolean;
}

const FIELD_LIMIT = 30;

function newFieldId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return 'f' + Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/**
 * 管理画面のプロフィール項目(/admin/:scope/profile-fields)。会員が入力するプロフィールの項目を設定する。
 * ルートコミュニティはテナントの項目、連携コミュニティはその独自の項目(ルートの項目に加えて使う。非公開にはできない)。
 * 名前・プロフィール画像は全テナント共通の固定項目で、ここでは変えられない。
 * 項目ID(値の保存キー)は自動で決まり、変えられない(項目名は変えてよい)。
 */
@Component({
  selector: 'app-admin-profile-fields',
  imports: [FormsModule],
  templateUrl: './admin-profile-fields.html',
  styleUrl: './admin-profile-fields.scss',
})
export class AdminProfileFields {
  private readonly adminService = inject(AdminService);
  readonly scopes = inject(AdminScopeService);

  readonly typeLabels = PROFILE_FIELD_TYPE_LABELS;
  readonly types = Object.keys(PROFILE_FIELD_TYPE_LABELS) as ProfileFieldType[];
  readonly converters = Object.values(PROFILE_CONVERTERS);
  readonly limit = FIELD_LIMIT;

  readonly drafts = signal<DraftField[] | null>(null);
  private savedJson = '';

  readonly saving = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly dirty = computed(() => {
    const drafts = this.drafts();
    return !!drafts && JSON.stringify(this.toFields(drafts)) !== this.savedJson;
  });

  constructor() {
    // 対象を切り替えたら、編集中の内容を捨てて読み込み直す。
    effect(() => {
      this.scopes.key();
      this.drafts.set(null);
      this.errorMessage.set('');
      this.successMessage.set('');
    });
    // 対象の設定が届いた最初の1回だけ、編集用にコピーする(保存前の編集を上書きしないため)。
    effect(() => {
      const fields = this.scopes.profileFields();
      if (fields && this.drafts() === null) {
        this.reset(fields);
      }
    });
  }

  private reset(fields: ProfileField[]): void {
    this.drafts.set(fields.map((f) => ({ ...f, optionsText: (f.options ?? []).join('\n'), isNew: false })));
    this.savedJson = JSON.stringify(this.toFields(this.drafts()!));
  }

  private toFields(drafts: DraftField[]): ProfileField[] {
    return drafts.map((d) => ({
      id: d.id,
      label: d.label.trim(),
      type: d.type,
      ...(d.type === 'select'
        ? { options: d.optionsText.split('\n').map((o) => o.trim()).filter(Boolean) }
        : {}),
      ...(d.type === 'derived'
        ? { derive: { converter: d.derive?.converter ?? 'ageGroup', source: d.derive?.source ?? '' } }
        : {}),
      ...(d.required && d.type !== 'derived' ? { required: true } : {}),
      ...(d.private && d.type !== 'derived' && !this.scopes.isCommunity() ? { private: true } : {}),
      ...(d.searchable && !d.private && d.type !== 'yearMonth' ? { searchable: true } : {}),
      ...(d.hidden ? { hidden: true } : {}),
    }));
  }

  update(index: number, patch: Partial<DraftField>): void {
    this.successMessage.set('');
    this.drafts.update((list) => list!.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  /** 自動計算の変換元にできる項目(コンバーターが受け付ける入力方法の項目)。 */
  sourceCandidates(converterId: ProfileConverterId | undefined, selfId: string): DraftField[] {
    const converter = PROFILE_CONVERTERS[converterId ?? 'ageGroup'];
    return (this.drafts() ?? []).filter((d) => d.id !== selfId && converter.sourceTypes.includes(d.type));
  }

  setDerive(index: number, patch: { converter?: ProfileConverterId; source?: string }): void {
    const current = this.drafts()![index].derive ?? { converter: 'ageGroup' as ProfileConverterId, source: '' };
    this.update(index, { derive: { ...current, ...patch } });
  }

  add(): void {
    this.successMessage.set('');
    this.drafts.update((list) => [
      ...list!,
      { id: newFieldId(), label: '', type: 'text', optionsText: '', isNew: true, searchable: false },
    ]);
  }

  move(index: number, delta: number): void {
    this.drafts.update((list) => {
      const next = [...list!];
      const target = index + delta;
      if (target < 0 || target >= next.length) {
        return next;
      }
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  remove(index: number): void {
    const draft = this.drafts()![index];
    if (!draft.isNew) {
      const message =
        `「${draft.label || '（名前なし）'}」を削除します。\n\n` +
        '会員が入力済みの値は残りますが、表示されなくなります。一時的に使わないだけなら「使わない（非表示）」にしてください。\n' +
        '（保存するまで確定しません）\n\nよろしいですか？';
      if (!window.confirm(message)) {
        return;
      }
    }
    this.drafts.update((list) => list!.filter((_, i) => i !== index));
  }

  discard(): void {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.reset(this.scopes.profileFields() ?? []);
  }

  async save(): Promise<void> {
    const drafts = this.drafts();
    if (!drafts) {
      return;
    }
    this.errorMessage.set('');
    this.successMessage.set('');
    this.saving.set(true);
    try {
      const fields = this.toFields(drafts);
      await this.adminService.updateProfileFields(this.scopes.scope(), fields);
      this.reset(fields);
      this.successMessage.set('プロフィール項目を保存しました。会員のマイページ・登録画面・会員検索に反映されます。');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}

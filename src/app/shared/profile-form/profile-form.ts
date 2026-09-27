import { Component, input, model } from '@angular/core';
import type { ProfileField, ProfileValues } from '../../core/models/firestore.models';
import { previewDerivedValue } from '../../core/utils/profile-fields';
import { parseYearMonth } from '../../core/utils/profile-converters';

/**
 * テナントのプロフィール項目の入力欄(名前・プロフィール画像は呼び出し側で出す)。
 * 候補者の登録申請(/join、ログイン前)とマイページの編集で使うため、Firestore には依存させない
 * (入力候補は呼び出し側が options で渡す)。
 */
@Component({
  selector: 'app-profile-form',
  templateUrl: './profile-form.html',
  styleUrl: './profile-form.scss',
})
export class ProfileForm {
  /** 入力する項目(非表示の項目は除いて渡す)。 */
  readonly fields = input.required<ProfileField[]>();
  /** 自由入力・複数入力の入力候補(項目ID → 候補)。 */
  readonly options = input<Partial<Record<string, string[]>>>({});
  readonly values = model<ProfileValues>({});
  /** フォーム内で id が重ならないように付ける接頭辞。 */
  readonly idPrefix = input('profile');

  /** 年月の項目で選べる年(新しい順。今年から100年前まで)。 */
  readonly years = Array.from({ length: 101 }, (_, i) => new Date().getFullYear() - i);
  readonly months = Array.from({ length: 12 }, (_, i) => i + 1);

  yearOf(fieldId: string): number | null {
    return parseYearMonth(this.values()[fieldId])?.year ?? this.partialYear.get(fieldId) ?? null;
  }

  monthOf(fieldId: string): number | null {
    return parseYearMonth(this.values()[fieldId])?.month ?? this.partialMonth.get(fieldId) ?? null;
  }

  /** 年だけ・月だけを選んだ途中の状態(両方そろったら "YYYY-MM" にする)。 */
  private readonly partialYear = new Map<string, number>();
  private readonly partialMonth = new Map<string, number>();

  setYearMonth(fieldId: string, part: 'year' | 'month', raw: string): void {
    const value = raw ? Number(raw) : null;
    const year = part === 'year' ? value : this.yearOf(fieldId);
    const month = part === 'month' ? value : this.monthOf(fieldId);
    if (part === 'year') {
      value ? this.partialYear.set(fieldId, value) : this.partialYear.delete(fieldId);
    } else {
      value ? this.partialMonth.set(fieldId, value) : this.partialMonth.delete(fieldId);
    }
    this.setText(fieldId, year && month ? `${year}-${String(month).padStart(2, '0')}` : '');
  }

  /** 自動計算の項目の、入力中の値から計算した結果(保存する値はサーバーが決める)。 */
  derived(field: ProfileField): string {
    return previewDerivedValue(field, this.fields(), this.values(), this.values()[field.id]);
  }

  sourceLabel(field: ProfileField): string {
    return this.fields().find((f) => f.id === field.derive?.source)?.label ?? '';
  }

  text(fieldId: string): string {
    const value = this.values()[fieldId];
    return typeof value === 'string' ? value : '';
  }

  tags(fieldId: string): string[] {
    const value = this.values()[fieldId];
    return Array.isArray(value) ? value : [];
  }

  setText(fieldId: string, value: string): void {
    this.values.update((values) => ({ ...values, [fieldId]: value }));
  }

  /** 複数入力に追加する(Enter・読点・カンマで区切って入れられる)。 */
  addTags(fieldId: string, input: HTMLInputElement): void {
    const added = input.value
      .split(/[,、，]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    input.value = '';
    if (added.length === 0) {
      return;
    }
    this.values.update((values) => ({
      ...values,
      [fieldId]: [...new Set([...this.tags(fieldId), ...added])].slice(0, 10),
    }));
  }

  removeTag(fieldId: string, tag: string): void {
    this.values.update((values) => ({ ...values, [fieldId]: this.tags(fieldId).filter((t) => t !== tag) }));
  }
}

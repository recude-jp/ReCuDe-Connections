import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService } from '../../core/services/admin.service';
import {
  CommunityStampPackRow,
  communityStampImageUrl,
  sortedStamps,
} from '../../core/services/community-stamp.service';
import { PreparedStamp, prepareStampImage } from '../../core/utils/image';
import { toErrorMessage } from '../../core/utils/errors';

interface DraftStamp {
  id: string;
  text: string;
  hidden: boolean;
  url: string;
}

/** 1パックに登録できるスタンプの数(functions/src/stampPacks.ts の STAMPS_PER_PACK_LIMIT と揃える)。 */
const STAMPS_PER_PACK_LIMIT = 40;

/**
 * 管理 > スタンプ の1パック分の編集(名前・公開状態、スタンプの追加・並び順・文言・非表示)。
 * スタンプは消さずに非表示にする(送信済みのメッセージはスタンプのIDで画像を探すため)。
 */
@Component({
  selector: 'app-admin-stamp-pack',
  imports: [FormsModule],
  templateUrl: './admin-stamp-pack.html',
  styleUrl: './admin-stamp-pack.scss',
})
export class AdminStampPack {
  private readonly adminService = inject(AdminService);

  readonly pack = input.required<CommunityStampPackRow>();
  readonly tenantId = input.required<string>();

  readonly name = signal('');
  readonly hidden = signal(true);
  readonly stamps = signal<DraftStamp[]>([]);
  /** 保存していない変更があるか。 */
  readonly dirty = signal(false);

  readonly newText = signal('');
  readonly prepared = signal<PreparedStamp | null>(null);
  readonly previewUrl = signal<string | null>(null);

  readonly processing = signal(false);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  readonly isFull = computed(() => this.stamps().length >= STAMPS_PER_PACK_LIMIT);
  readonly visibleCount = computed(() => this.stamps().filter((s) => !s.hidden).length);
  readonly limit = STAMPS_PER_PACK_LIMIT;

  constructor() {
    // 保存した変更・追加したスタンプが届いたら、下書きに反映する(保存していない変更は残し、新しいスタンプだけ足す)。
    effect(() => {
      const pack = this.pack();
      const tenantId = this.tenantId();
      untracked(() => {
        const latest = sortedStamps(pack).map((stamp) => ({
          id: stamp.id,
          text: stamp.text,
          hidden: stamp.hidden === true,
          url: communityStampImageUrl(tenantId, pack.id, stamp.id),
        }));
        if (!this.dirty()) {
          this.name.set(pack.name);
          this.hidden.set(pack.hidden);
          this.stamps.set(latest);
          return;
        }
        const known = new Set(this.stamps().map((s) => s.id));
        this.stamps.update((draft) => [...draft, ...latest.filter((s) => !known.has(s.id))]);
      });
    });
  }

  markDirty(): void {
    this.dirty.set(true);
    this.successMessage.set('');
  }

  setName(name: string): void {
    this.name.set(name);
    this.markDirty();
  }

  setHidden(hidden: boolean): void {
    this.hidden.set(hidden);
    this.markDirty();
  }

  updateStamp(index: number, changes: Partial<DraftStamp>): void {
    this.stamps.update((list) => list.map((stamp, i) => (i === index ? { ...stamp, ...changes } : stamp)));
    this.markDirty();
  }

  move(index: number, delta: -1 | 1): void {
    const target = index + delta;
    this.stamps.update((list) => {
      if (target < 0 || target >= list.length) {
        return list;
      }
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    this.markDirty();
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.errorMessage.set('');
    try {
      const prepared = await prepareStampImage(file);
      this.prepared.set(prepared);
      this.previewUrl.set(URL.createObjectURL(prepared.blob));
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    }
  }

  cancelNew(): void {
    this.prepared.set(null);
    this.previewUrl.set(null);
    this.newText.set('');
  }

  async addStamp(): Promise<void> {
    const prepared = this.prepared();
    if (!prepared || this.isFull()) {
      return;
    }
    this.errorMessage.set('');
    this.processing.set(true);
    try {
      await this.adminService.addCommunityStamp(this.tenantId(), this.pack().id, prepared, this.newText().trim());
      this.cancelNew();
      this.successMessage.set('スタンプを追加しました。');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.processing.set(false);
    }
  }

  async save(): Promise<void> {
    this.errorMessage.set('');
    this.successMessage.set('');
    this.processing.set(true);
    try {
      await this.adminService.updateStampPack(this.pack().id, {
        name: this.name().trim(),
        hidden: this.hidden(),
        stamps: this.stamps().map(({ id, text, hidden }) => ({ id, text: text.trim(), hidden })),
      });
      this.dirty.set(false);
      this.successMessage.set('保存しました。');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.processing.set(false);
    }
  }

  /** 保存していない変更を取り消す。 */
  discard(): void {
    this.dirty.set(false);
    const pack = this.pack();
    this.name.set(pack.name);
    this.hidden.set(pack.hidden);
    this.stamps.set(
      sortedStamps(pack).map((stamp) => ({
        id: stamp.id,
        text: stamp.text,
        hidden: stamp.hidden === true,
        url: communityStampImageUrl(this.tenantId(), pack.id, stamp.id),
      })),
    );
  }
}

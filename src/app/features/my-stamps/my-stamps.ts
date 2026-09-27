import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { AuthService, MemberSession } from '../../core/services/auth.service';
import { MY_STAMP_LIMIT, MyStampService } from '../../core/services/my-stamp.service';
import { CUSTOM_STAMP_PACK_ID } from '../../core/models/firestore.models';
import { PreparedStamp, prepareStampImage } from '../../core/utils/image';
import { toErrorMessage } from '../../core/utils/errors';
import { StampImage } from '../../shared/stamp-image/stamp-image';

/**
 * マイスタンプ(/mypage/stamps)。自分専用のスタンプを登録・削除する。
 * 登録したスタンプは、トークのスタンプパネルの「マイスタンプ」から自分だけが送れる(他の会員はメッセージの中で見る)。
 */
@Component({
  selector: 'app-my-stamps',
  imports: [FormsModule, StampImage],
  templateUrl: './my-stamps.html',
  styleUrl: './my-stamps.scss',
})
export class MyStamps {
  private readonly auth = inject(AuthService);
  private readonly myStampService = inject(MyStampService);

  readonly limit = MY_STAMP_LIMIT;
  readonly customPackId = CUSTOM_STAMP_PACK_ID;

  readonly session = toSignal(this.auth.session$, { initialValue: undefined });
  readonly memberSession = computed(() => {
    const session = this.session();
    return session?.kind === 'member' ? (session as MemberSession) : null;
  });

  readonly stamps = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member' ? this.myStampService.listMine(session.tenantId, session.memberId) : of(undefined),
      ),
    ),
    { initialValue: undefined },
  );

  readonly isFull = computed(() => (this.stamps()?.length ?? 0) >= MY_STAMP_LIMIT);

  /** 登録前の、変換済みの画像とプレビュー。 */
  readonly prepared = signal<PreparedStamp | null>(null);
  readonly previewUrl = signal<string | null>(null);
  readonly text = signal('');
  readonly saving = signal(false);
  readonly removingId = signal<string | null>(null);
  readonly errorMessage = signal('');
  readonly successMessage = signal('');

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }
    this.errorMessage.set('');
    this.successMessage.set('');
    try {
      const prepared = await prepareStampImage(file);
      this.clearPreview();
      this.prepared.set(prepared);
      this.previewUrl.set(URL.createObjectURL(prepared.blob));
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    }
  }

  async add(): Promise<void> {
    const session = this.memberSession();
    const prepared = this.prepared();
    if (!session || !prepared || this.isFull()) {
      return;
    }
    this.errorMessage.set('');
    this.successMessage.set('');
    this.saving.set(true);
    try {
      await this.myStampService.add(session.tenantId, session.memberId, prepared, this.text().trim());
      this.clearPreview();
      this.text.set('');
      this.successMessage.set('マイスタンプを登録しました。トークのスタンプパネルの「マイスタンプ」から送れます。');
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  cancel(): void {
    this.clearPreview();
    this.text.set('');
  }

  async remove(stampId: string, text: string): Promise<void> {
    const session = this.memberSession();
    if (!session) {
      return;
    }
    const name = text ? `「${text}」` : 'このスタンプ';
    if (!window.confirm(`${name}を削除します。\nこれまでに送ったメッセージでも「削除されたスタンプ」と表示されます。\n\nよろしいですか？`)) {
      return;
    }
    this.errorMessage.set('');
    this.successMessage.set('');
    this.removingId.set(stampId);
    try {
      await this.myStampService.remove(session.tenantId, session.memberId, stampId);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.removingId.set(null);
    }
  }

  private clearPreview(): void {
    const url = this.previewUrl();
    if (url) {
      URL.revokeObjectURL(url);
    }
    this.previewUrl.set(null);
    this.prepared.set(null);
  }
}

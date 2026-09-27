import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

export interface PinDeviceSummary {
  deviceId: string;
  deviceLabel: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export type PinKind = 'member' | 'admin';

const LOCAL_DEVICE_ID_KEY_PREFIX = 'recude-match:pin-device:';

@Injectable({ providedIn: 'root' })
export class PinService {
  private readonly functions = inject(Functions);

  /**
   * この端末でPINログインをセットアップ済みか(＝ログイン画面にPINボタンを出してよいか)。
   * deviceIdはPINと組み合わさって初めて認証情報になる準機密値のため、
   * ログ・エラーメッセージ・UI表示には使わず、存在確認のみに使う。
   */
  isLocalPinConfigured(kind: PinKind): boolean {
    return this.getLocalDeviceId(kind) !== null;
  }

  private getLocalDeviceId(kind: PinKind): string | null {
    return localStorage.getItem(LOCAL_DEVICE_ID_KEY_PREFIX + kind);
  }

  private setLocalDeviceId(kind: PinKind, deviceId: string): void {
    localStorage.setItem(LOCAL_DEVICE_ID_KEY_PREFIX + kind, deviceId);
  }

  private clearLocalDeviceId(kind: PinKind): void {
    localStorage.removeItem(LOCAL_DEVICE_ID_KEY_PREFIX + kind);
  }

  /**
   * 既存ログイン中に呼ぶ。この端末用のPINをセットアップする。
   * 同じ端末で既にPINが設定済みの場合、古い端末登録を残さないよう先に削除してから置き換える。
   */
  async setup(kind: PinKind, pin: string, deviceLabel?: string): Promise<void> {
    const previousDeviceId = this.getLocalDeviceId(kind);

    const fn = httpsCallable<{ pin: string; deviceLabel?: string }, { deviceId: string }>(
      this.functions,
      'setupPin',
    );
    const { data } = await fn({ pin, deviceLabel });

    if (previousDeviceId) {
      await this.remove(previousDeviceId).catch(() => undefined);
    }
    this.setLocalDeviceId(kind, data.deviceId);
  }

  /** ログイン画面から呼ぶ。PINでの認証に成功したらFirebase Authのカスタムトークンを返す。 */
  async login(kind: PinKind, pin: string): Promise<string> {
    const deviceId = this.getLocalDeviceId(kind);
    if (!deviceId) {
      throw new Error('この端末にはPINが設定されていません。');
    }

    const fn = httpsCallable<{ deviceId: string; pin: string }, { customToken: string }>(
      this.functions,
      'pinSignIn',
    );
    const { data } = await fn({ deviceId, pin });
    return data.customToken;
  }

  async list(): Promise<PinDeviceSummary[]> {
    const fn = httpsCallable<Record<string, never>, { devices: PinDeviceSummary[] }>(
      this.functions,
      'listPinDevices',
    );
    const { data } = await fn({});
    return data.devices;
  }

  async remove(deviceId: string): Promise<void> {
    const fn = httpsCallable<{ deviceId: string }, { deleted: boolean }>(this.functions, 'removePinDevice');
    await fn({ deviceId });

    // 削除したのがこの端末に保存中のdeviceIdなら、ローカルの記録も消す。
    (['member', 'admin'] as const).forEach((kind) => {
      if (this.getLocalDeviceId(kind) === deviceId) {
        this.clearLocalDeviceId(kind);
      }
    });
  }
}

import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export interface PasskeyCredentialSummary {
  credentialId: string;
  deviceLabel: string;
  backedUp: boolean;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export type PasskeyKind = 'member' | 'admin';

const LOCAL_HINT_KEY_PREFIX = 'recude-match:has-passkey:';
const LOCAL_CREDENTIAL_ID_KEY_PREFIX = 'recude-match:passkey-credential-id:';
const LOCAL_LOGIN_IDS_KEY = 'recude-match:passkey-login-ids';

/** ログイン画面で入力したIDを、端末の記録と比べられる形にする(サーバーと同じく小文字に揃える)。 */
export function normalizeLoginIdentifier(identifier: string): string {
  return identifier.normalize('NFKC').trim().toLowerCase();
}

@Injectable({ providedIn: 'root' })
export class PasskeyService {
  private readonly functions = inject(Functions);

  isSupported(): boolean {
    return browserSupportsWebAuthn();
  }

  /**
   * このブラウザで過去に登録/ログインが成功したパスキーがあるかの簡易な記録(localStorage)。
   * WebAuthnは仕様上「この端末に対象RPの資格情報があるか」を事前に問い合わせられないため、
   * ログイン画面のボタン表示可否はこのローカルな記録を目安にする(正確な状態はサーバー側の一覧が真実)。
   */
  hasLocalPasskeyHint(kind: PasskeyKind): boolean {
    return localStorage.getItem(LOCAL_HINT_KEY_PREFIX + kind) === '1';
  }

  markLocalPasskeyHint(kind: PasskeyKind, hasPasskey: boolean): void {
    if (hasPasskey) {
      localStorage.setItem(LOCAL_HINT_KEY_PREFIX + kind, '1');
    } else {
      localStorage.removeItem(LOCAL_HINT_KEY_PREFIX + kind);
    }
  }

  /**
   * この端末でパスキーを使ってログインした(または登録した)ログインIDの記録。ログイン画面で、
   * 入力したIDのパスキーを試すかどうかの目安にする。記録が無くても、IDごとの記録を入れる前に
   * パスキーを登録した端末(hasLocalPasskeyHint)なら試す。
   */
  shouldTryPasskeyFor(identifier: string): boolean {
    if (!this.isSupported()) {
      return false;
    }
    const ids = this.readLocalLoginIds();
    return ids.length > 0
      ? ids.includes(normalizeLoginIdentifier(identifier))
      : this.hasLocalPasskeyHint('member');
  }

  rememberPasskeyFor(identifiers: (string | null | undefined)[]): void {
    const ids = new Set(this.readLocalLoginIds());
    identifiers.forEach((id) => id && ids.add(normalizeLoginIdentifier(id)));
    try {
      localStorage.setItem(LOCAL_LOGIN_IDS_KEY, JSON.stringify([...ids]));
    } catch {
      // 保存できない環境(プライベートブラウズなど)では、記録なしで動かす。
    }
  }

  private readLocalLoginIds(): string[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(LOCAL_LOGIN_IDS_KEY) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
    } catch {
      return [];
    }
  }

  /**
   * このブラウザが最後に登録/ログインに使ったパスキーのcredentialId。
   * パスキー設定画面で「一覧のどれが本端末のものか」「本端末は登録済みか」の判定に使う。
   */
  getLocalCredentialId(kind: PasskeyKind): string | null {
    return localStorage.getItem(LOCAL_CREDENTIAL_ID_KEY_PREFIX + kind);
  }

  markLocalCredentialId(kind: PasskeyKind, credentialId: string): void {
    localStorage.setItem(LOCAL_CREDENTIAL_ID_KEY_PREFIX + kind, credentialId);
  }

  clearLocalCredentialId(kind: PasskeyKind): void {
    localStorage.removeItem(LOCAL_CREDENTIAL_ID_KEY_PREFIX + kind);
  }

  /** 既存ログイン中に呼ぶ。新しいパスキーを登録する。登録したcredentialIdを返す。 */
  async register(kind: PasskeyKind, deviceLabel?: string): Promise<string> {
    const start = httpsCallable<
      Record<string, never>,
      { requestId: string; options: PublicKeyCredentialCreationOptionsJSON }
    >(this.functions, 'startPasskeyRegistration');
    const { data } = await start({});

    const attestationResponse = await startRegistration({ optionsJSON: data.options });

    const complete = httpsCallable<
      { requestId: string; credential: RegistrationResponseJSON; deviceLabel?: string },
      { credentialId: string; deviceLabel: string }
    >(this.functions, 'completePasskeyRegistration');
    const { data: result } = await complete({ requestId: data.requestId, credential: attestationResponse, deviceLabel });
    this.markLocalCredentialId(kind, result.credentialId);
    return result.credentialId;
  }

  /**
   * ログイン画面から呼ぶ。パスキーでの認証に成功したらFirebase Authのカスタムトークンを返す。
   * Firebase Authへのサインイン自体はAuthServiceの責務。
   * identifier(入力したログインID)を渡すと、パスキーがそのIDの会員のものかをサーバーで確かめる。
   */
  async login(identifier?: string): Promise<{ customToken: string; credentialId: string }> {
    const start = httpsCallable<
      Record<string, never>,
      { requestId: string; options: PublicKeyCredentialRequestOptionsJSON }
    >(this.functions, 'startPasskeyAuthentication');
    const { data } = await start({});

    const assertionResponse = await startAuthentication({ optionsJSON: data.options });

    const complete = httpsCallable<
      { requestId: string; credential: AuthenticationResponseJSON; identifier?: string },
      { customToken: string; credentialId: string }
    >(this.functions, 'completePasskeyAuthentication');
    const { data: result } = await complete({
      requestId: data.requestId,
      credential: assertionResponse,
      ...(identifier ? { identifier } : {}),
    });
    return result;
  }

  async list(): Promise<PasskeyCredentialSummary[]> {
    const fn = httpsCallable<Record<string, never>, { credentials: PasskeyCredentialSummary[] }>(
      this.functions,
      'listPasskeyCredentials',
    );
    const { data } = await fn({});
    return data.credentials;
  }

  async remove(credentialId: string): Promise<void> {
    const fn = httpsCallable<{ credentialId: string }, { deleted: boolean }>(
      this.functions,
      'deletePasskeyCredential',
    );
    await fn({ credentialId });

    // 削除したのがこの端末に保存中のcredentialIdなら、ローカルの記録も消す。
    (['member', 'admin'] as const).forEach((kind) => {
      if (this.getLocalCredentialId(kind) === credentialId) {
        this.clearLocalCredentialId(kind);
      }
    });
  }
}

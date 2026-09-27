import { Injectable, inject } from '@angular/core';
import {
  Auth,
  authState,
  signInWithCustomToken,
  signInWithPhoneNumber,
  RecaptchaVerifier,
  ConfirmationResult,
  signOut as firebaseSignOut,
  getIdTokenResult,
  User,
} from '@angular/fire/auth';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { BehaviorSubject, Observable } from 'rxjs';
import type { MembershipStatus } from '../models/firestore.models';

export interface MemberSession {
  kind: 'member';
  uid: string;
  tenantId: string;
  memberId: string;
  displayName: string;
  isRecommender: boolean;
  /** 管理者ロール(会員＋管理者ロール)。管理画面(/admin)に入れる。 */
  isAdmin: boolean;
  /**
   * ゲスト(招待されて参加し、まだ正規の会員でない人)。トーク・出会いを探す・イベントの参照だけができる。
   * 連携コミュニティだけのメンバーも、ルートコミュニティの中ではゲストと同じ扱い(true)。
   */
  isGuest: boolean;
  /** 会員の区分(guest: ゲスト、community: 連携コミュニティだけのメンバー、member: 正規の会員)。 */
  membership: MembershipStatus;
  /** 所属する連携コミュニティのID(SPEC 9章)。 */
  communityIds: string[];
  /** 管理者になっている連携コミュニティのID(管理画面に入れる)。 */
  adminCommunityIds: string[];
}

/** カスタムクレームの文字列の配列(無い・形が違うときは空)。 */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

/** 管理画面に入れるか(ルートコミュニティの管理者か、連携コミュニティの管理者)。 */
export function canUseAdmin(session: AppSessionState): boolean {
  return session?.kind === 'member' && (session.isAdmin || session.adminCommunityIds.length > 0);
}

/** 招待できるか。ルートコミュニティへは正規の会員が、連携コミュニティへはそのメンバーが招待できる。 */
export function canInvite(session: AppSessionState): boolean {
  return session?.kind === 'member' && (!session.isGuest || session.communityIds.length > 0);
}

export type AppSession = MemberSession | null;

interface ResolveMemberSessionResult {
  tenantId: string;
  memberId: string;
  displayName: string;
}

/** undefined = 初回のFirebase Auth状態確認がまだ完了していない（ガードはこの間待機する）。 */
export type AppSessionState = AppSession | undefined;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly functions = inject(Functions);

  private readonly sessionSubject = new BehaviorSubject<AppSessionState>(undefined);
  /** 初回の認証状態確認が完了するまでは undefined を発行する。 */
  readonly session$: Observable<AppSessionState> = this.sessionSubject.asObservable();

  private recaptchaVerifier?: RecaptchaVerifier;
  private confirmationResult?: ConfirmationResult;

  constructor() {
    authState(this.auth).subscribe((user) => {
      void this.handleAuthStateChange(user);
    });
  }

  get currentSession(): AppSessionState {
    return this.sessionSubject.value;
  }

  /** ログインフォームの reCAPTCHA (invisible) を初期化する。 */
  initRecaptcha(containerId: string): void {
    this.recaptchaVerifier = new RecaptchaVerifier(this.auth, containerId, {
      size: 'invisible',
    });
  }

  /** 電話番号にOTPを送信する。会員ログイン(/login)・候補者登録(/join)の両方で使う共通処理。 */
  async sendOtp(phoneNumber: string): Promise<void> {
    if (!this.recaptchaVerifier) {
      throw new Error('reCAPTCHAが初期化されていません。');
    }
    this.confirmationResult = await signInWithPhoneNumber(this.auth, phoneNumber, this.recaptchaVerifier);
  }

  /** OTPを確認してFirebase Authへのサインインを完了する。カスタムクレームの解決は呼び出し側の責務。 */
  async confirmOtp(code: string): Promise<void> {
    if (!this.confirmationResult) {
      throw new Error('先に認証コードを送信してください。');
    }
    await this.confirmationResult.confirm(code);
  }

  /**
   * 電話番号ログイン(/login)専用。resolveMemberSession Functionsを呼び、
   * 既存会員としてのカスタムクレームをIDトークンへ反映する。
   * 未登録の電話番号の場合はFunctions側でnot-foundがthrowされる。
   */
  async resolveMemberSession(): Promise<void> {
    const resolveSession = httpsCallable<unknown, ResolveMemberSessionResult>(
      this.functions,
      'resolveMemberSession',
    );
    await resolveSession();

    const user = this.auth.currentUser;
    if (!user) {
      throw new Error('ログインに失敗しました。');
    }
    await user.getIdToken(true);
    await this.handleAuthStateChange(user);
  }

  /**
   * パスキー/PINログイン(completePasskeyAuthentication・pinSignIn)が発行した
   * カスタムトークンでサインインする。カスタムクレームはFirebase Authユーザーに
   * 既に永続化されているため、resolveMemberSessionのような別途のクレーム設定呼び出しは不要。
   */
  async signInWithToken(customToken: string): Promise<void> {
    const { user } = await signInWithCustomToken(this.auth, customToken);
    await user.getIdToken(true);
    await this.handleAuthStateChange(user);
  }

  /** 自分のロール変更など、カスタムクレームの更新をすぐにセッションへ反映する(IDトークンを再取得する)。 */
  async refreshSession(): Promise<void> {
    const user = this.auth.currentUser;
    if (!user) {
      return;
    }
    await user.getIdToken(true);
    await this.handleAuthStateChange(user);
  }

  async signOut(): Promise<void> {
    await firebaseSignOut(this.auth);
    this.sessionSubject.next(null);
  }

  private async handleAuthStateChange(user: User | null): Promise<void> {
    if (!user) {
      this.sessionSubject.next(null);
      return;
    }

    const tokenResult = await getIdTokenResult(user);
    const claims = tokenResult.claims;

    if (typeof claims['tenantId'] === 'string' && typeof claims['memberId'] === 'string') {
      this.sessionSubject.next({
        kind: 'member',
        uid: user.uid,
        tenantId: claims['tenantId'],
        memberId: claims['memberId'],
        displayName: user.displayName ?? '',
        isRecommender: claims['isRecommender'] === true,
        isAdmin: claims['isAdmin'] === true,
        isGuest: claims['isGuest'] === true,
        membership:
          claims['membership'] === 'guest' || claims['membership'] === 'community'
            ? claims['membership']
            : claims['isGuest'] === true
              ? 'guest'
              : 'member',
        communityIds: stringList(claims['communityIds']),
        adminCommunityIds: stringList(claims['adminCommunityIds']),
      });
      return;
    }

    // ログイン済みだがカスタムクレーム未設定(会員の電話番号認証直後で resolveMemberSession 未実行など)、
    // または旧方式の事務局アカウント(メール＋パスワード)。
    this.sessionSubject.next(null);
  }
}

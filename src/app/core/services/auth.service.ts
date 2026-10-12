import { Injectable, inject } from '@angular/core';
import {
  Auth,
  authState,
  signInWithCustomToken,
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

  constructor() {
    authState(this.auth).subscribe((user) => {
      void this.handleAuthStateChange(user);
    });
  }

  get currentSession(): AppSessionState {
    return this.sessionSubject.value;
  }

  /**
   * 参加の画面(/join)で、電話番号に認証コードをSMSで送る(ログインと同じくTwilioで送る)。
   * 使える招待(招待リンクのコード、またはその電話番号あての招待)があるときだけ送られる。
   */
  async sendJoinCode(phoneNumber: string, inviteCode: string | null): Promise<void> {
    const send = httpsCallable<{ phoneNumber: string; code?: string }, { sent: boolean }>(this.functions, 'sendJoinCode');
    await send({ phoneNumber, ...(inviteCode ? { code: inviteCode } : {}) });
  }

  /** 参加の認証コードを確かめて、その電話番号のアカウントでサインインする。カスタムクレームの解決は呼び出し側の責務。 */
  async verifyJoinCode(phoneNumber: string, code: string): Promise<void> {
    const verify = httpsCallable<{ phoneNumber: string; code: string }, { customToken: string }>(
      this.functions,
      'verifyJoinCode',
    );
    const { data } = await verify({ phoneNumber, code });
    await signInWithCustomToken(this.auth, data.customToken);
  }

  /**
   * 参加の画面(/join)で、参加したあとに呼ぶ。resolveMemberSession Functionsを呼び、
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

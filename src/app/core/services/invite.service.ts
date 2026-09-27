import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import type { InviteTarget, MembershipTermsFormat } from '../models/firestore.models';

export interface InvitePreview {
  tenantName: string;
  serviceName: string;
  inviterName: string;
  /** 招待の送付で入力された名前(参加するときの名前の初期値)。 */
  name: string;
  /** ログイン中の電話番号で、すでに参加しているか(ログイン前は false)。 */
  alreadyJoined: boolean;
  /** すでにこの招待先に参加しているか。 */
  alreadyInTarget: boolean;
  /** 連携コミュニティへの参加の申請が審査待ちか。 */
  pendingApproval: boolean;
  /** 連携コミュニティへの招待のとき、招待先の名称・ロゴ・説明・参加の条件・承認が必要か。ルートへの招待は null。 */
  community: {
    name: string;
    logoUrl: string | null;
    /** ロゴが無いときの文字(未設定は空)。 */
    logoText: string;
    description: string;
    terms: { format: MembershipTermsFormat; body: string; requireAgreement: boolean } | null;
    requireApproval: boolean;
  } | null;
}

export interface InviteQr {
  code: string;
  /** QRコードにする招待リンク(/join?code=...)。 */
  url: string;
}

export interface JoinResult {
  alreadyJoined: boolean;
  /** 連携コミュニティに参加したとき、その名称。 */
  joinedCommunity: string | null;
  /** 参加に管理者の承認が必要で、審査待ちになったか。 */
  pendingApproval: boolean;
}

/** ルートコミュニティへの招待。 */
export const ROOT_TARGET: InviteTarget = { type: 'root' };

/**
 * 招待まわりのCloud Functions呼び出し。招待リンクを開いた人(ログイン前・ゲストになる前)の画面(/join)でも使うため、
 * Firestore SDKには依存させない。招待先(target)は、ルートコミュニティか連携コミュニティ(SPEC 9章)。
 */
@Injectable({ providedIn: 'root' })
export class InviteService {
  private readonly functions = inject(Functions);

  /** 招待先ごとの自分のQRコード(招待リンク)。無ければ作られる。 */
  async getMyInviteQr(target: InviteTarget = ROOT_TARGET): Promise<InviteQr> {
    const fn = httpsCallable<{ target: InviteTarget }, InviteQr>(this.functions, 'getMyInviteQr');
    return (await fn({ target })).data;
  }

  /** QRコードを作り直す(その招待先のこれまでのQRコードは使えなくなる)。 */
  async regenerateInviteQr(target: InviteTarget = ROOT_TARGET): Promise<InviteQr> {
    const fn = httpsCallable<{ target: InviteTarget }, InviteQr>(this.functions, 'regenerateInviteQr');
    return (await fn({ target })).data;
  }

  /** 招待の送付(名前と、電話番号かメールアドレス)。 */
  async createInvite(input: {
    name: string;
    phoneNumber?: string;
    email?: string;
    target?: InviteTarget;
  }): Promise<{ inviteId: string }> {
    const fn = httpsCallable<typeof input, { inviteId: string }>(this.functions, 'createInvite');
    return (await fn(input)).data;
  }

  /** 招待リンクを開いたときの案内(組織名・招待した人など)。code が無いときは、ログイン中の電話番号あての招待を探す。 */
  async getInvitePreview(code: string | null): Promise<InvitePreview> {
    const fn = httpsCallable<{ code?: string }, InvitePreview>(this.functions, 'getInvitePreview');
    return (await fn(code ? { code } : {})).data;
  }

  /**
   * 電話番号でログインしたあと、参加する(ルートコミュニティへの招待はゲスト、連携コミュニティへの招待はそのメンバーになる)。
   * 既に参加している人は、連携コミュニティへの招待ならその所属が加わり、そうでなければそのまま返る。
   */
  async joinAsGuest(code: string | null, displayName: string, agreedToTerms = false): Promise<JoinResult> {
    const fn = httpsCallable<{ code?: string; displayName: string; agreedToTerms: boolean }, JoinResult>(
      this.functions,
      'joinAsGuest',
    );
    return (await fn({ ...(code ? { code } : {}), displayName, agreedToTerms })).data;
  }
}

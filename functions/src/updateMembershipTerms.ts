import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { requireScopeAdmin } from './adminScope';
import type { MembershipTermsFormat } from './models';

/** 会員条件の本文の上限(文字数)。 */
const BODY_MAX = 20000;
const FORMATS: MembershipTermsFormat[] = ['text', 'html'];

/**
 * 管理者が会員条件(会員になるための条件、年会費などの説明)を設定する。本文が空なら会員条件を外す。
 * 対象(scope)が連携コミュニティなら、その連携コミュニティの参加の条件(参加の画面に出す)と、
 * 参加に管理者の承認を必要とするか(requireApproval)を設定する。
 * HTMLは保存時には手を加えず、表示するときにクライアント(Angularのサニタイズ)で危険なタグ・属性を取り除く。
 */
export const updateMembershipTerms = onCall(async (request) => {
  const { format, body, requireAgreement, requireApproval, scope } = (request.data ?? {}) as {
    format?: unknown;
    body?: unknown;
    requireAgreement?: unknown;
    requireApproval?: unknown;
    scope?: unknown;
  };
  const { identity, communityRef } = await requireScopeAdmin(request.auth, scope);
  if (!FORMATS.includes(format as MembershipTermsFormat)) {
    throw new HttpsError('invalid-argument', '形式はテキストかHTMLを選んでください。');
  }
  const text = typeof body === 'string' ? body.replace(/\r\n/g, '\n').trim() : '';
  if (text.length > BODY_MAX) {
    throw new HttpsError('invalid-argument', `会員条件は${BODY_MAX}文字以内で入力してください。`);
  }

  const targetRef = communityRef ?? admin.firestore().doc(`tenants/${identity.tenantId}`);
  const approval = communityRef ? { requireApproval: requireApproval === true } : {};
  if (!text) {
    await targetRef.update({ membershipTerms: FieldValue.delete(), ...approval });
    return { cleared: true };
  }
  await targetRef.update({
    ...approval,
    membershipTerms: {
      format,
      body: text,
      requireAgreement: requireAgreement !== false,
      updatedAt: FieldValue.serverTimestamp(),
    },
  });
  return { cleared: false };
});

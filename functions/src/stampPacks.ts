import { onCall, HttpsError } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { requireScopeAdmin } from './adminScope';
import { COMMUNITY_STAMP_PACK_PREFIX } from './models';
import type { CommunityStamp, CommunityStampPack } from './models';

/**
 * コミュニティのスタンプ(管理 A2・SPEC 5-4)。ルートコミュニティと連携コミュニティごとに、そのコミュニティの管理者が
 * スタンプのパックを登録する(連携コミュニティのパックは、ルートコミュニティの管理者も登録できる)。
 * ルートのパックはルートコミュニティの正規の会員が、連携コミュニティのパックはそのメンバーが送れる(firestore.rules で確かめる)。
 * パック・スタンプは消さずに非表示にする(送信済みのメッセージはスタンプのIDで画像を探すため)。
 */

const db = () => admin.firestore();

export const STAMP_PACK_NAME_MAX_LENGTH = 20;
export const STAMP_TEXT_MAX_LENGTH = 20;
/** 1パックのスタンプの数の上限(パックのドキュメントに入れるため)。 */
export const STAMPS_PER_PACK_LIMIT = 40;
/** テナントのパックの数の上限。 */
export const STAMP_PACK_LIMIT = 100;

const STAMP_ID_PATTERN = /^[A-Za-z0-9]{20}$/;

function packPath(tenantId: string, packId: string): string {
  return `tenants/${tenantId}/stampPacks/${packId}`;
}

export function stampStoragePath(tenantId: string, packId: string, stampId: string): string {
  return `tenants/${tenantId}/stampPacks/${packId}/${stampId}`;
}

function sanitizeName(raw: unknown): string {
  const name = typeof raw === 'string' ? raw.trim() : '';
  if (!name) {
    throw new HttpsError('invalid-argument', 'パックの名前を入力してください。');
  }
  if (name.length > STAMP_PACK_NAME_MAX_LENGTH) {
    throw new HttpsError('invalid-argument', `パックの名前は${STAMP_PACK_NAME_MAX_LENGTH}文字以内にしてください。`);
  }
  return name;
}

function sanitizeText(raw: unknown): string {
  const text = typeof raw === 'string' ? raw.trim() : '';
  if (text.length > STAMP_TEXT_MAX_LENGTH) {
    throw new HttpsError('invalid-argument', `スタンプの文言は${STAMP_TEXT_MAX_LENGTH}文字以内にしてください。`);
  }
  return text;
}

/**
 * パックを読み、そのパックを使える範囲のコミュニティの管理者からの呼び出しであることを確かめる。
 * (テナントは呼び出した人のカスタムクレームから決めるため、別のテナントのパックは読めない。)
 */
async function getPackAsAdmin(
  auth: Parameters<typeof requireScopeAdmin>[0],
  packId: unknown,
): Promise<{ tenantId: string; ref: FirebaseFirestore.DocumentReference; pack: CommunityStampPack }> {
  const tenantId = auth?.token['tenantId'];
  if (typeof packId !== 'string' || !packId.startsWith(COMMUNITY_STAMP_PACK_PREFIX) || typeof tenantId !== 'string') {
    throw new HttpsError('invalid-argument', 'パックを指定してください。');
  }
  const ref = db().doc(packPath(tenantId, packId));
  const pack = (await ref.get()).data() as CommunityStampPack | undefined;
  if (!pack) {
    throw new HttpsError('not-found', 'スタンプのパックが見つかりません。');
  }
  await requireScopeAdmin(auth, pack.scope);
  return { tenantId, ref, pack };
}

/** パックを作る(使える範囲はあとから変えない。送信済みのスタンプの見え方が変わらないように)。 */
export const createStampPack = onCall(async (request) => {
  const { name: rawName, scope: rawScope } = (request.data ?? {}) as { name?: unknown; scope?: unknown };
  // パックを使える範囲は、管理の対象のコミュニティと同じ(その管理者が作れる)。
  const { identity, scope } = await requireScopeAdmin(request.auth, rawScope);
  const name = sanitizeName(rawName);

  const collection = db().collection(`tenants/${identity.tenantId}/stampPacks`);
  if ((await collection.count().get()).data().count >= STAMP_PACK_LIMIT) {
    throw new HttpsError('resource-exhausted', `スタンプのパックは${STAMP_PACK_LIMIT}個までです。`);
  }
  const packId = `${COMMUNITY_STAMP_PACK_PREFIX}${randomBytes(8).toString('hex')}`;
  const pack: CommunityStampPack = {
    name,
    scope,
    // スタンプを登録してから公開できるよう、最初は非表示にしておく。
    hidden: true,
    stamps: {},
    createdBy: identity.memberId,
    createdAt: FieldValue.serverTimestamp(),
  };
  await collection.doc(packId).create(pack);
  return { packId };
});

/**
 * スタンプを加える。画像は先にクライアントが Storage(tenants/[tenantId]/stampPacks/[packId]/[stampId])へ上げておく
 * (storage.rules で管理者・形式・大きさを確かめる)。ここでは画像があることを確かめてから一覧に入れる。
 */
export const addCommunityStamp = onCall(async (request) => {
  const { packId, stampId, text: rawText } = (request.data ?? {}) as { packId?: unknown; stampId?: unknown; text?: unknown };
  const { tenantId, ref, pack } = await getPackAsAdmin(request.auth, packId);
  if (typeof stampId !== 'string' || !STAMP_ID_PATTERN.test(stampId)) {
    throw new HttpsError('invalid-argument', 'スタンプのIDが正しくありません。');
  }
  if (pack.stamps[stampId]) {
    throw new HttpsError('already-exists', 'このスタンプはすでに登録されています。');
  }
  const text = sanitizeText(rawText);
  const stamps = Object.values(pack.stamps);
  if (stamps.length >= STAMPS_PER_PACK_LIMIT) {
    throw new HttpsError('resource-exhausted', `1つのパックに登録できるスタンプは${STAMPS_PER_PACK_LIMIT}個までです。`);
  }

  const file = admin.storage().bucket().file(stampStoragePath(tenantId, packId as string, stampId));
  const [exists] = await file.exists();
  if (!exists) {
    throw new HttpsError('failed-precondition', 'スタンプの画像が見つかりません。もう一度登録してください。');
  }
  const [metadata] = await file.getMetadata();
  const contentType = metadata.contentType === 'image/png' ? 'image/png' : 'image/webp';

  const stamp: CommunityStamp = {
    text,
    contentType,
    order: stamps.reduce((max, s) => Math.max(max, s.order), -1) + 1,
    createdAt: FieldValue.serverTimestamp(),
  };
  await ref.update({ [`stamps.${stampId}`]: stamp, updatedAt: FieldValue.serverTimestamp() });
  return { stampId };
});

/**
 * パックの名前・公開状態と、スタンプの並び順・文言・公開状態を変える。
 * stamps はパックのスタンプを並べたい順に全部並べる(消すことはできない。使わないスタンプは非表示にする)。
 */
export const updateStampPack = onCall(async (request) => {
  const data = (request.data ?? {}) as { packId?: unknown; name?: unknown; hidden?: unknown; stamps?: unknown };
  const { ref, pack } = await getPackAsAdmin(request.auth, data.packId);
  const name = sanitizeName(data.name);
  if (typeof data.hidden !== 'boolean') {
    throw new HttpsError('invalid-argument', '公開状態を指定してください。');
  }

  const input = Array.isArray(data.stamps) ? (data.stamps as { id?: unknown; text?: unknown; hidden?: unknown }[]) : null;
  const ids = input?.map((s) => s?.id);
  const existing = Object.keys(pack.stamps);
  if (
    !input ||
    ids!.length !== existing.length ||
    new Set(ids).size !== ids!.length ||
    ids!.some((id) => typeof id !== 'string' || !pack.stamps[id])
  ) {
    throw new HttpsError('invalid-argument', 'スタンプの一覧が正しくありません。画面を読み込み直してください。');
  }
  if (!data.hidden && !input.some((s) => s.hidden !== true)) {
    throw new HttpsError('failed-precondition', '表示するスタンプが1つもないパックは公開できません。');
  }

  const updates: Record<string, unknown> = { name, hidden: data.hidden, updatedAt: FieldValue.serverTimestamp() };
  input.forEach((s, order) => {
    const id = s.id as string;
    updates[`stamps.${id}.order`] = order;
    updates[`stamps.${id}.text`] = sanitizeText(s.text);
    updates[`stamps.${id}.hidden`] = s.hidden === true;
  });
  await ref.update(updates);
  return { packId: data.packId };
});

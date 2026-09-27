/**
 * オリジナルスタンプ(SPEC 5-4)と、メッセージに付けるリアクション。
 *
 * スタンプは全テナント共通のパック。素材はリポジトリ直下の stamps/ に置き、`npm run stamps:sync` で
 * 配信用の画像(public/stamps/)と一覧(stamp-packs.generated.ts)を作る(手順は docs/stamps.md)。
 * 画像のファイル名にバージョンを含めて長期キャッシュさせ、差し替え時はバージョンを上げて別のファイル名にする。
 * メッセージにはスタンプのIDだけ({packId, stampId})を保存する。
 * テナントごとのスタンプパック(Firestore の stampPacks・Storage)は管理 A2 で追加する。
 */
import { STAMP_PACK_DATA } from './stamp-packs.generated';

export interface Stamp {
  id: string;
  /** スタンプの文言(代替テキストに使う)。 */
  text: string;
  /** true のスタンプはスタンプパネルに出さない(送信済みのメッセージでは表示する)。 */
  hidden?: boolean;
}

export interface StampPack {
  packId: string;
  /** タブに出す短い名前。 */
  name: string;
  version: number;
  /** true のパックはスタンプパネルに出さない(送信済みのメッセージでは表示する)。 */
  hidden?: boolean;
  stamps: Stamp[];
}

/** すべてのパック(非表示のものを含む。送信済みのメッセージの表示に使う)。 */
export const STAMP_PACKS: StampPack[] = STAMP_PACK_DATA;

/** スタンプパネルに出すパックとスタンプ(非表示のものを除く)。 */
export const VISIBLE_STAMP_PACKS: StampPack[] = STAMP_PACK_DATA.filter((pack) => !pack.hidden)
  .map((pack) => ({ ...pack, stamps: pack.stamps.filter((stamp) => !stamp.hidden) }))
  .filter((pack) => pack.stamps.length > 0);

export interface StampRef {
  packId: string;
  stampId: string;
}

/** スタンプ画像のURL。見つからないスタンプ(削除されたパックなど)は null。 */
export function stampImageUrl(ref: StampRef): string | null {
  const pack = STAMP_PACKS.find((p) => p.packId === ref.packId);
  if (!pack || !pack.stamps.some((s) => s.id === ref.stampId)) {
    return null;
  }
  return `stamps/${pack.packId}/${ref.stampId}_v${pack.version}.webp`;
}

export function stampText(ref: StampRef): string {
  const pack = STAMP_PACKS.find((p) => p.packId === ref.packId);
  return pack?.stamps.find((s) => s.id === ref.stampId)?.text ?? 'スタンプ';
}

/**
 * メッセージに付けられるリアクション(1人1つ。同じものを押すと取り消し、別のものを押すと付け替え)。
 * firestore.rules の許可リストと揃えること。
 */
export const REACTIONS: string[] = ['👍', '😊', '🙏', '🎉', '✨', '😄'];

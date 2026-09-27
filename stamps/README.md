# 共通スタンプの素材

全テナント共通のオリジナルスタンプの素材（一次情報）。アプリへの取り込みは `npm run stamps:sync` で行う。

- **追加・差し替え・修正・廃止の手順**: [`docs/stamps.md`](../docs/stamps.md)
- `packs.json` … パックの一覧（スタンプパネルのタブの並び順・タブ名）
- `{packId}/pack.json` … スタンプのIDと文言、バージョン（バージョンは `stamps:sync` が自動で上げる）
- `{packId}/webp/` … 配信する画像（320×320・透過WebP・100KBまで）。ファイル名はスタンプID
- `{packId}/svg/`・`png/`・`gen_*.py` … 原稿と生成スクリプト（アプリは使わない）

`public/stamps/` と `src/app/core/utils/stamp-packs.generated.ts` は、ここから自動で作られる。手で編集しないこと。

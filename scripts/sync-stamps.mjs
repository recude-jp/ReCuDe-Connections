#!/usr/bin/env node
/**
 * 全テナント共通スタンプの取り込み(手順は docs/stamps.md)。
 *
 * stamps/(素材)を一次情報として、次を行う。
 *   1. 検査: packs.json・各パックの pack.json の書式、スタンプIDの形式、WebP画像(320×320・100KBまで)の有無と中身
 *   2. バージョン: 画像が変わったパック(または public/stamps/ に無いバージョン)は、version を上げて pack.json に書き戻す
 *   3. 配信用の画像: public/stamps/{packId}/{stampId}_v{version}.webp にコピーし、古いバージョンのファイルを消す
 *   4. アプリの一覧: src/app/core/utils/stamp-packs.generated.ts を生成する
 *
 * 使い方:
 *   npm run stamps:sync               取り込む(変更があるときだけファイルを書き換える)
 *   npm run stamps:check              書き換えずに確認だけする(取り込み漏れがあれば終了コード1。デプロイ前に自動で実行)
 *   npm run stamps:sync -- --allow-remove   スタンプIDやパックを消すことを許可する(通常は hidden を使う)
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_DIR = join(ROOT, 'stamps');
const PUBLIC_DIR = join(ROOT, 'public', 'stamps');
const GENERATED_FILE = join(ROOT, 'src', 'app', 'core', 'utils', 'stamp-packs.generated.ts');

const STAMP_EDGE = 320;
const MAX_BYTES = 100 * 1024;
const WARN_BYTES = 60 * 1024;
const ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
/** マイスタンプ用に予約している packId(src/app/core/models/firestore.models.ts の CUSTOM_STAMP_PACK_ID)。 */
const RESERVED_PACK_IDS = new Set(['custom']);

const checkOnly = process.argv.includes('--check');
const allowRemove = process.argv.includes('--allow-remove');

const errors = [];
const warnings = [];
const changes = [];

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    errors.push(`${relative(path)} を読めません: ${err.message}`);
    return null;
  }
}

function relative(path) {
  return path.slice(ROOT.length + 1);
}

/** WebP のヘッダーから画像の大きさを読む(VP8X / VP8L / VP8)。WebP でなければ null。 */
function webpSize(buf) {
  if (buf.length < 30 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const chunk = buf.toString('ascii', 12, 16);
  if (chunk === 'VP8X') {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (chunk === 'VP8L') {
    const [b0, b1, b2, b3] = [buf[21], buf[22], buf[23], buf[24]];
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  if (chunk === 'VP8 ') {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

/** 前回生成した一覧(スタンプやパックが消えていないかの確認に使う)。 */
function readPreviousManifest() {
  if (!existsSync(GENERATED_FILE)) {
    return [];
  }
  const match = readFileSync(GENERATED_FILE, 'utf8').match(/\/\* BEGIN DATA \*\/([\s\S]*)\/\* END DATA \*\//);
  return match ? JSON.parse(match[1]) : [];
}

function main() {
  const index = readJson(join(SOURCE_DIR, 'packs.json'));
  if (!index) {
    return report();
  }
  const packs = [];
  const seenPackIds = new Set();
  /** pack.json に書かれているスタンプID(画像の検査に失敗したものも含む。消えたかどうかの判定に使う)。 */
  const declaredStampIds = new Map();

  for (const entry of index.packs ?? []) {
    const { packId, tabName, hidden = false } = entry;
    // tp- で始まるIDは、管理画面で登録するコミュニティのスタンプ(Firestore の stampPacks)に予約している。
    if (!ID_PATTERN.test(packId ?? '') || RESERVED_PACK_IDS.has(packId) || packId.startsWith('tp-')) {
      errors.push(`packs.json: packId "${packId}" は使えません(英小文字・数字・-・_ の40文字以内。custom と tp- で始まるIDは予約済み)。`);
      continue;
    }
    if (seenPackIds.has(packId)) {
      errors.push(`packs.json: packId "${packId}" が重複しています。`);
      continue;
    }
    seenPackIds.add(packId);
    if (!tabName) {
      errors.push(`packs.json: ${packId} に tabName(タブに出す名前)がありません。`);
    }

    const packDir = join(SOURCE_DIR, packId);
    const packFile = join(packDir, 'pack.json');
    const pack = readJson(packFile);
    if (!pack) {
      continue;
    }
    if (pack.packId !== packId) {
      errors.push(`${relative(packFile)}: packId が "${pack.packId}" になっています("${packId}" にしてください)。`);
      continue;
    }
    if (!Number.isInteger(pack.version) || pack.version < 1) {
      errors.push(`${relative(packFile)}: version は1以上の整数にしてください。`);
      continue;
    }

    const stamps = [];
    const seenStampIds = new Set();
    declaredStampIds.set(packId, new Set((pack.stamps ?? []).map((s) => s.id)));
    for (const stamp of pack.stamps ?? []) {
      const where = `${relative(packFile)} の ${stamp.id}`;
      if (!ID_PATTERN.test(stamp.id ?? '')) {
        errors.push(`${where}: スタンプIDは英小文字・数字・-・_ の40文字以内にしてください。`);
        continue;
      }
      if (seenStampIds.has(stamp.id)) {
        errors.push(`${where}: スタンプIDが重複しています。`);
        continue;
      }
      seenStampIds.add(stamp.id);
      if (!stamp.text || typeof stamp.text !== 'string') {
        errors.push(`${where}: text(スタンプの文言)がありません。`);
      }
      const imagePath = join(packDir, 'webp', `${stamp.id}.webp`);
      if (!existsSync(imagePath)) {
        errors.push(`${where}: 画像 ${relative(imagePath)} がありません。`);
        continue;
      }
      const buf = readFileSync(imagePath);
      const size = webpSize(buf);
      if (!size) {
        errors.push(`${relative(imagePath)}: WebP画像ではありません。`);
        continue;
      }
      if (size.width !== STAMP_EDGE || size.height !== STAMP_EDGE) {
        errors.push(`${relative(imagePath)}: ${size.width}×${size.height} です(${STAMP_EDGE}×${STAMP_EDGE} にしてください)。`);
      }
      if (buf.length > MAX_BYTES) {
        errors.push(`${relative(imagePath)}: ${Math.round(buf.length / 1024)}KB です(100KBまで)。`);
      } else if (buf.length > WARN_BYTES) {
        warnings.push(`${relative(imagePath)}: ${Math.round(buf.length / 1024)}KB と大きめです(60KB以下が目安)。`);
      }
      stamps.push({ id: stamp.id, text: stamp.text, hidden: stamp.hidden === true, buf, imagePath });
    }
    if (stamps.length === 0) {
      errors.push(`${relative(packFile)}: スタンプが1つもありません。`);
      continue;
    }
    packs.push({ packId, tabName, hidden: hidden === true, pack, packFile, stamps });
  }

  // 消えたパック・スタンプの確認(過去のメッセージが「削除されたスタンプ」になるため、通常は hidden で隠す)。
  const previous = readPreviousManifest();
  for (const prevPack of previous) {
    const packStillListed = seenPackIds.has(prevPack.packId);
    const declared = declaredStampIds.get(prevPack.packId);
    const removedIds = packStillListed
      ? prevPack.stamps.map((s) => s.id).filter((id) => declared && !declared.has(id))
      : prevPack.stamps.map((s) => s.id);
    if (!packStillListed || removedIds.length > 0) {
      const what = packStillListed ? `${prevPack.packId} のスタンプ ${removedIds.join(', ')}` : `パック ${prevPack.packId}`;
      const message = `${what} が消えています。送信済みのメッセージでは「削除されたスタンプ」と表示されます。使えなくするだけなら hidden: true を使ってください。`;
      if (allowRemove) {
        warnings.push(message);
      } else {
        errors.push(`${message}(本当に消す場合は --allow-remove を付けて実行)`);
      }
    }
  }

  if (errors.length > 0) {
    return report();
  }

  // バージョンの判定と、配信用の画像のコピー。
  const manifest = [];
  for (const p of packs) {
    const publicPackDir = join(PUBLIC_DIR, p.packId);
    const existing = existsSync(publicPackDir) ? readdirSync(publicPackDir) : [];
    let version = p.pack.version;
    const publishedAtVersion = existing.filter((f) => f.endsWith(`_v${version}.webp`));
    if (publishedAtVersion.length > 0) {
      // 同じバージョンで配信済みのファイルと中身・並びが違えば、バージョンを上げる(キャッシュに古い画像が残らないように)。
      const same =
        publishedAtVersion.length === p.stamps.length &&
        p.stamps.every((s) => {
          const file = join(publicPackDir, `${s.id}_v${version}.webp`);
          return existsSync(file) && sha(readFileSync(file)) === sha(s.buf);
        });
      if (!same) {
        version += 1;
        changes.push(`${p.packId}: 画像の変更・スタンプの追加があったため version を ${p.pack.version} → ${version} に上げます。`);
      }
    } else {
      changes.push(`${p.packId}: version ${version} の画像を配信用にコピーします。`);
    }

    const wanted = new Set(p.stamps.map((s) => `${s.id}_v${version}.webp`));
    const stale = existing.filter((f) => !wanted.has(f));
    const missing = [...wanted].filter((f) => !existing.includes(f));
    if (stale.length > 0 && version === p.pack.version && missing.length === 0) {
      changes.push(`${p.packId}: 使っていない配信用の画像を消します(${stale.join(', ')})。`);
    }

    if (!checkOnly) {
      mkdirSync(publicPackDir, { recursive: true });
      for (const s of p.stamps) {
        const target = join(publicPackDir, `${s.id}_v${version}.webp`);
        if (!existsSync(target) || sha(readFileSync(target)) !== sha(s.buf)) {
          writeFileSync(target, s.buf);
        }
      }
      for (const f of stale) {
        rmSync(join(publicPackDir, f));
      }
      if (version !== p.pack.version) {
        p.pack.version = version;
        for (const s of p.pack.stamps) {
          s.path = `stamps/${p.packId}/${s.id}_v${version}.webp`;
        }
        writeFileSync(p.packFile, `${JSON.stringify(p.pack, null, 2)}\n`);
      }
    }

    manifest.push({
      packId: p.packId,
      name: p.tabName,
      version,
      ...(p.hidden ? { hidden: true } : {}),
      stamps: p.stamps.map((s) => ({ id: s.id, text: s.text, ...(s.hidden ? { hidden: true } : {}) })),
    });
  }

  // パックごと消した場合は、配信用のフォルダも消す。
  const publishedPacks = existsSync(PUBLIC_DIR) ? readdirSync(PUBLIC_DIR) : [];
  for (const dir of publishedPacks.filter((d) => !packs.some((p) => p.packId === d))) {
    changes.push(`public/stamps/${dir}: 一覧に無いパックの配信用の画像を消します。`);
    if (!checkOnly) {
      rmSync(join(PUBLIC_DIR, dir), { recursive: true, force: true });
    }
  }

  const generated = `// このファイルは scripts/sync-stamps.mjs が stamps/ から生成する。直接編集しないこと(手順は docs/stamps.md)。
import type { StampPack } from './stamps';

export const STAMP_PACK_DATA: StampPack[] = /* BEGIN DATA */ ${JSON.stringify(manifest, null, 2)} /* END DATA */;
`;
  const current = existsSync(GENERATED_FILE) ? readFileSync(GENERATED_FILE, 'utf8') : '';
  if (current !== generated) {
    changes.push(`${relative(GENERATED_FILE)} を更新します。`);
    if (!checkOnly) {
      writeFileSync(GENERATED_FILE, generated);
    }
  }

  return report();
}

function report() {
  for (const w of warnings) {
    console.warn(`注意: ${w}`);
  }
  if (errors.length > 0) {
    for (const e of errors) {
      console.error(`エラー: ${e}`);
    }
    console.error(`\nスタンプの取り込みを中止しました(${errors.length}件のエラー)。`);
    process.exit(1);
  }
  if (changes.length === 0) {
    console.log('スタンプは取り込み済みです(変更なし)。');
    return;
  }
  for (const c of changes) {
    console.log(`${checkOnly ? '未反映' : '反映'}: ${c}`);
  }
  if (checkOnly) {
    console.error('\nstamps/ の変更がアプリに取り込まれていません。npm run stamps:sync を実行してください(docs/stamps.md)。');
    process.exit(1);
  }
  console.log('\nスタンプを取り込みました。git diff で変更を確認し、画面で表示を確かめてからコミットしてください。');
}

main();

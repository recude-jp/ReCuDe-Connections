/**
 * トークに送る画像の下準備(SPEC 5-5)。端末で縮小してJPEGに再エンコードする。
 * 再エンコードで位置情報などのEXIFが落ちる(自宅の場所などが漏れないようにするため)。
 * 向き(EXIFのOrientation)は createImageBitmap の imageOrientation で画素に反映してから描き直す。
 */

/** 送信する画像の長辺(px)。 */
const ORIGINAL_MAX_EDGE = 2048;
/** 一覧に出すサムネイルの長辺(px)。 */
const THUMB_MAX_EDGE = 480;
const JPEG_QUALITY = 0.8;
/** 選べる元画像のサイズ上限(縮小前)。 */
export const IMAGE_INPUT_MAX_BYTES = 30 * 1024 * 1024;

export interface PreparedImage {
  original: Blob;
  thumb: Blob;
  width: number;
  height: number;
}

async function encode(bitmap: ImageBitmap, maxEdge: number): Promise<{ blob: Blob; width: number; height: number }> {
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('画像を処理できませんでした。');
  }
  // 透過PNGの背景が黒くならないよう白で塗ってから描く(JPEGは透過を持てない)。
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) {
    throw new Error('画像を処理できませんでした。');
  }
  return { blob, width, height };
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith('image/')) {
    throw new Error('画像ファイルを選んでください。');
  }
  if (file.size > IMAGE_INPUT_MAX_BYTES) {
    throw new Error('画像が大きすぎます（30MBまで）。');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('この形式の画像は送れません。JPEG・PNGなどの画像を選んでください。');
  }
  try {
    const original = await encode(bitmap, ORIGINAL_MAX_EDGE);
    const thumb = await encode(bitmap, THUMB_MAX_EDGE);
    return { original: original.blob, thumb: thumb.blob, width: original.width, height: original.height };
  } finally {
    bitmap.close();
  }
}

/** マイスタンプの画像の一辺(px)。組み込みのスタンプと同じ大きさにそろえる。 */
const STAMP_EDGE = 320;

export interface PreparedStamp {
  blob: Blob;
  contentType: 'image/webp' | 'image/png';
}

/**
 * マイスタンプの画像を作る。320×320の透明な正方形の中央に、縦横比を保って収める(透過はそのまま残す)。
 * WebPで書き出す。WebPに書き出せないブラウザ(Safari)ではPNGにする。
 */
export async function prepareStampImage(file: File): Promise<PreparedStamp> {
  if (!file.type.startsWith('image/')) {
    throw new Error('画像ファイルを選んでください。');
  }
  if (file.size > IMAGE_INPUT_MAX_BYTES) {
    throw new Error('画像が大きすぎます（30MBまで）。');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('この形式の画像は使えません。PNG・JPEGなどの画像を選んでください。');
  }
  try {
    const scale = Math.min(STAMP_EDGE / bitmap.width, STAMP_EDGE / bitmap.height);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = STAMP_EDGE;
    canvas.height = STAMP_EDGE;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('画像を処理できませんでした。');
    }
    context.drawImage(bitmap, (STAMP_EDGE - width) / 2, (STAMP_EDGE - height) / 2, width, height);

    const toBlob = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.9));
    const webp = await toBlob('image/webp');
    if (webp && webp.type === 'image/webp') {
      return { blob: webp, contentType: 'image/webp' };
    }
    const png = await toBlob('image/png');
    if (!png) {
      throw new Error('画像を処理できませんでした。');
    }
    return { blob: png, contentType: 'image/png' };
  } finally {
    bitmap.close();
  }
}

/** プロフィール画像の一辺(px)。 */
const AVATAR_EDGE = 256;

/** プロフィール画像を作る。中央を正方形に切り抜き、256×256のJPEGにする(EXIFは落ちる)。 */
export async function prepareAvatarImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) {
    throw new Error('画像ファイルを選んでください。');
  }
  if (file.size > IMAGE_INPUT_MAX_BYTES) {
    throw new Error('画像が大きすぎます（30MBまで）。');
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('この形式の画像は使えません。JPEG・PNGなどの画像を選んでください。');
  }
  try {
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = AVATAR_EDGE;
    canvas.height = AVATAR_EDGE;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('画像を処理できませんでした。');
    }
    context.fillStyle = '#fff';
    context.fillRect(0, 0, AVATAR_EDGE, AVATAR_EDGE);
    context.drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      AVATAR_EDGE,
      AVATAR_EDGE,
    );
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!blob) {
      throw new Error('画像を処理できませんでした。');
    }
    return blob;
  } finally {
    bitmap.close();
  }
}

/** ファビコン・ホーム画面アイコン用の画像の一辺(px)。 */
const FAVICON_EDGE = 192;

/**
 * テナントのアイコン(ロゴ画像)からファビコンを作る。192×192の透明な正方形の中央に、縦横比を保って収める
 * (横長のロゴでも潰れないように)。PNGで書き出す。
 */
export async function prepareFaviconImage(file: File): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('この形式の画像は使えません。PNG・JPEGなどの画像を選んでください。');
  }
  try {
    const scale = Math.min(FAVICON_EDGE / bitmap.width, FAVICON_EDGE / bitmap.height);
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = FAVICON_EDGE;
    canvas.height = FAVICON_EDGE;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('画像を処理できませんでした。');
    }
    context.drawImage(bitmap, (FAVICON_EDGE - width) / 2, (FAVICON_EDGE - height) / 2, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) {
      throw new Error('画像を処理できませんでした。');
    }
    return blob;
  } finally {
    bitmap.close();
  }
}

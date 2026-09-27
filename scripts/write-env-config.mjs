#!/usr/bin/env node
/**
 * deploy-init.sh から呼び出す補助スクリプト。
 * `firebase apps:sdkconfig` の出力（apiKey/authDomain/...の6値）と tenantId を
 * src/environments/environment.ts のプレースホルダー('REPLACE_ME'系)に書き込む。
 *
 * 使い方: node scripts/write-env-config.mjs <apiKey> <authDomain> <projectId> <storageBucket> <messagingSenderId> <appId> <tenantId>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(scriptDir, '..', 'src', 'environments', 'environment.ts');

const [apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId, tenantId] = process.argv.slice(2);

const requiredFields = { apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId };

for (const [key, value] of Object.entries(requiredFields)) {
  if (!value) {
    console.error(`エラー: ${key} の値を取得できませんでした。firebase apps:sdkconfig の出力を確認してください。`);
    process.exit(1);
  }
}

const fields = { ...requiredFields, ...(tenantId ? { tenantId } : {}) };

let content = readFileSync(envPath, 'utf8');

for (const [key, value] of Object.entries(fields)) {
  const pattern = new RegExp(`(${key}:\\s*)'[^']*'`);
  if (!pattern.test(content)) {
    console.error(`エラー: environment.ts 内に ${key} フィールドが見つかりませんでした。`);
    process.exit(1);
  }
  content = content.replace(pattern, `$1'${value}'`);
}

writeFileSync(envPath, content);
console.log('src/environments/environment.ts を実際のFirebase設定値で更新しました。');

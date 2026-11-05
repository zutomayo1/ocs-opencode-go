// 测试用的配置加载器：优先用本地的 config.local.json（含真实 key、不进 git），
// 没有就退回仓库里那份占位符版 config.json。

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const rootDir = join(here, '..');

const localPath = join(rootDir, 'config.local.json');
export const usingLocal = existsSync(localPath);
export const wrapper = JSON.parse(readFileSync(usingLocal ? localPath : join(rootDir, 'config.json'), 'utf8'))[0];

/** 从环境变量或配置里取 key，取不到就返回 undefined */
export function resolveKey() {
  const fromEnv = (process.env.OC_API_KEY || '').trim();
  if (fromEnv) return fromEnv;
  const match = /^Bearer (\S+)$/.exec(wrapper.headers.Authorization || '');
  const key = match && match[1];
  return key && !key.includes('REPLACE_ME') ? key : undefined;
}

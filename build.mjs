// 把 src/*.js 里的 handler 源码组装成可以直接粘进 OCS 的题库配置。
// handler 是「字符串里的 JS」，手写 JSON 转义必翻车，所以统一从这里生成。
//
// 产物：
//   config.json        —— 永远只有占位符 key，可以安全提交
//   config.local.json  —— 只有设置了 OC_API_KEY 时才生成，含真实密钥，已在 .gitignore 里
//
// 用法：
//   node build.mjs                              # 只生成 config.json（占位符）
//   $env:OC_API_KEY = "oc_sk_..."; node build.mjs   # 额外生成 config.local.json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8').trim();

const PLACEHOLDER = 'oc_sk_REPLACE_ME';

const CONFIG = {
  // Go 套餐里可换的模型见 README「换模型」一节
  model: 'deepseek-v4.1-flash',
  // Go 要求每个请求都带稳定的会话 id；headers 不支持函数，所以只能写死
  sessionId: 'ses_ocsgo_7f3c1a9d2b4e',
  // 客户端软件用 fetch；油猴/脚本猫请改成 GM_xmlhttpRequest
  requestType: 'fetch',
  maxTokens: 512
};

const build = (apiKey) => [
  {
    name: 'OpenCode Go · ' + CONFIG.model,
    homepage: 'https://opencode.ai/v2/docs/console/go',
    url: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
    method: 'post',
    contentType: 'json',
    type: CONFIG.requestType,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
      'x-opencode-session': CONFIG.sessionId
    },
    data: {
      model: CONFIG.model,
      stream: false,
      max_tokens: CONFIG.maxTokens,
      messages: { handler: read('src/handler.messages.js') }
    },
    handler: read('src/handler.response.js')
  }
];

function write(file, config) {
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
  // 立刻自检：JSON 合法、两个 handler 都能被 Function() 编译成函数
  const parsed = JSON.parse(readFileSync(file, 'utf8'))[0];
  if (typeof Function(parsed.handler)() !== 'function') throw new Error('handler 编译失败：' + file);
  if (typeof Function(parsed.data.messages.handler)() !== 'function') throw new Error('messages.handler 编译失败：' + file);
  console.log('已生成并自检通过：' + file);
}

write(join(here, 'config.json'), build(PLACEHOLDER));

const apiKey = (process.env.OC_API_KEY || '').trim();
if (apiKey) {
  if (!/^oc_sk_/.test(apiKey)) console.warn('⚠ 环境变量 OC_API_KEY 看起来不像 OpenCode 的 key（应以 oc_sk_ 开头）');
  write(join(here, 'config.local.json'), build(apiKey));
} else {
  console.log('（没有设置 OC_API_KEY，只生成了带占位符的 config.json）');
}

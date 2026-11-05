// 联网冒烟测试：真打一次 OpenCode Go，看 key / 模型 / 地区设置是否通，顺带测一次端到端耗时。
// 需要 OCS 里那个 60 秒硬超时留够余量，所以这里会把耗时打出来。
//
// 用法：
//   $env:OC_API_KEY = "oc_sk_xxx"
//   node test/live.mjs
//   node test/live.mjs glm-5.3-flash   # 临时换模型试

import { resolveSingle } from './ocs-match.mjs';
import { wrapper, resolveKey } from './load-config.mjs';

const messagesFn = Function(wrapper.data.messages.handler)();
const responseFn = Function(wrapper.handler)();

const key = resolveKey();
if (!key) {
  console.error('没有可用的 key：先 $env:OC_API_KEY = "oc_sk_..."，或生成本地 config.local.json（node build.mjs）');
  process.exit(2);
}

const model = process.argv[2] || wrapper.data.model;
const env = {
  title: '光合作用的产物是什么？',
  type: 'single',
  options: 'A. 有机物和氧气\nB. 二氧化碳和水\nC. 只有氧气\nD. 只有有机物'
};

console.log('model = ' + model);
const started = Date.now();
const res = await fetch(wrapper.url, {
  method: 'POST',
  headers: { ...wrapper.headers, Authorization: 'Bearer ' + key, 'User-Agent': 'ocs-answerer-live-test/1.0' },
  body: JSON.stringify({ model, stream: false, max_tokens: 512, messages: messagesFn(env) })
});
const elapsed = Date.now() - started;
const json = await res.json().catch(() => ({}));

console.log('HTTP ' + res.status + '，耗时 ' + elapsed + 'ms');
if (json.error) {
  console.error('接口报错：' + JSON.stringify(json.error));
  console.error('对照 README「常见报错」一节排查（401=key 不对，403=模型不在清单/地区/免费模型，400=缺 session 头）。');
  process.exit(1);
}

console.log('模型原始输出：' + JSON.stringify(json.choices?.[0]?.message?.content));

const out = responseFn(json);
if (!out) {
  console.error('handler 没有给出答案（低置信度或被丢弃），看上面的 console.warn。');
  process.exit(1);
}

const picked = resolveSingle([out[1]], env.options.split('\n'));
console.log('handler 输出：' + JSON.stringify(out));
console.log('OCS 会选中：' + (picked.finish ? picked.option : '（没匹配上）'));
console.log(elapsed > 20000 ? '\n⚠ 耗时偏高，OCS 60 秒硬超时下风险较大，建议换更快的模型' : '\n耗时 OK（OCS 上限 60 秒）');
if (!picked.finish || picked.option !== env.options.split('\n')[0]) process.exit(1);

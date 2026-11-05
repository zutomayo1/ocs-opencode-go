// 联网矩阵测试：把单选/多选/判断/填空各跑一遍真模型，看 handler 输出 +
// OCS 实际会点中什么，顺便统计单题耗时（OCS 上限 60 秒）。
//
// 用法：
//   $env:OC_API_KEY = "oc_sk_xxx"
//   node test/live-matrix.mjs                 # 用 config.json 里的模型
//   node test/live-matrix.mjs glm-5.3-flash

import { resolveSingle, resolveMultiple, resolveJudgement, resolveCompletion } from './ocs-match.mjs';
import { wrapper, resolveKey } from './load-config.mjs';

const messagesFn = Function(wrapper.data.messages.handler)();
const responseFn = Function(wrapper.handler)();

const key = resolveKey();
if (!key) {
  console.error('没有可用的 key：先 $env:OC_API_KEY = "oc_sk_..."，或生成本地 config.local.json（node build.mjs）');
  process.exit(2);
}
const model = process.argv[2] || wrapper.data.model;

const CASES = [
  {
    name: '单选·常识',
    type: 'single',
    title: '光合作用的产物是什么？',
    options: 'A. 有机物和氧气\nB. 二氧化碳和水\nC. 只有氧气\nD. 只有有机物'
  },
  {
    name: '单选·毛概',
    type: 'single',
    title: '中国特色社会主义最本质的特征是',
    options: 'A. 共同富裕\nB. 中国共产党领导\nC. 人民当家作主\nD. 依法治国'
  },
  {
    name: '多选',
    type: 'multiple',
    title: '下列属于我国基本政治制度的有',
    options: 'A. 人民代表大会制度\nB. 中国共产党领导的多党合作和政治协商制度\nC. 民族区域自治制度\nD. 基层群众自治制度'
  },
  {
    name: '判断·对错',
    type: 'judgement',
    title: '地球是太阳系中距离太阳第三近的行星。',
    options: 'A. 对\nB. 错'
  },
  {
    name: '判断·正确/错误（选 B）',
    type: 'judgement',
    title: '声音在真空中可以传播。',
    options: 'A. 正确\nB. 错误'
  },
  {
    name: '填空·单空',
    type: 'completion',
    title: '水的化学式是____。'
  },
  {
    name: '填空·双空',
    type: 'completion',
    title: '光合作用发生在____中，产生的气体是____。'
  },
  {
    name: '不会的题（测置信度门控）',
    type: 'single',
    title: '《噬星者编年史》第 37 页第 4 段提到的第七个角色叫什么名字？',
    options: 'A. 阿尔法\nB. 贝塔\nC. 伽马\nD. 德尔塔'
  }
];

const picked = (r) =>
  !r || !r.finish ? [] : r.answers ?? r.options ?? r.plainOptions ?? (r.option ? [r.option] : []);

console.log('model = ' + model + '\n');
let totalMs = 0;
let problems = 0;

for (const c of CASES) {
  const env = { title: c.title, type: c.type, options: c.options || '' };
  const started = Date.now();
  let json;
  try {
    const res = await fetch(wrapper.url, {
      method: 'POST',
      headers: { ...wrapper.headers, Authorization: 'Bearer ' + key, 'User-Agent': 'ocs-answerer-live-test/1.0' },
      body: JSON.stringify({ model, stream: false, max_tokens: 512, messages: messagesFn(env) })
    });
    json = await res.json();
    if (json.error) {
      console.log(c.name + '  ✗ HTTP ' + res.status + ' ' + JSON.stringify(json.error));
      problems++;
      continue;
    }
  } catch (e) {
    console.log(c.name + '  ✗ 请求失败：' + e.message);
    problems++;
    continue;
  }
  const ms = Date.now() - started;
  totalMs += ms;

  const raw = json.choices?.[0]?.message?.content;
  const out = responseFn(json);
  const answer = out ? out[1] : undefined;
  const optionTexts = (c.options || '').split('\n').filter(Boolean);

  let verdict;
  if (c.type === 'single') verdict = answer ? resolveSingle([answer], optionTexts) : { finish: false };
  else if (c.type === 'multiple') verdict = answer ? resolveMultiple([answer], optionTexts) : { finish: false };
  else if (c.type === 'judgement') verdict = answer ? resolveJudgement([answer], optionTexts) : { finish: false };
  else verdict = answer ? resolveCompletion([answer], (c.title.match(/____/g) || []).length || 1) : { finish: false };

  const hit = picked(verdict);
  const ok = c.name.includes('不会的题') ? out === undefined || hit.length === 0 : verdict.finish;
  if (!ok) problems++;

  console.log(
    (ok ? '  ✓ ' : '  ✗ ') +
      c.name.padEnd(24, ' ') +
      String(ms).padStart(5) +
      'ms  答案=' +
      JSON.stringify(answer ?? null).padEnd(18, ' ') +
      (hit.length ? '选中=' + JSON.stringify(hit) : '未命中（OCS 记为未找到）')
  );
  if (!ok) console.log('      模型原文：' + JSON.stringify(raw));
}

console.log(
  '\n合计 ' + CASES.length + ' 题，平均 ' + Math.round(totalMs / Math.max(1, CASES.length - problems)) + 'ms，问题 ' + problems + ' 个'
);
process.exit(problems ? 1 : 0);

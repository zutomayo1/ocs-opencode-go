// 离线自检：不起网络，用假的 API 响应跑一遍 handler，再把吐出来的答案丢给
// 从 OCS 源码搬过来的匹配算法，确认 OCS 真的会点中那个选项。
//
// 用法：node test/validate.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  resolveSingle,
  resolveMultiple,
  resolveJudgement,
  resolveCompletion,
  isJudgementOptions
} from './ocs-match.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wrapper = JSON.parse(readFileSync(join(here, '..', 'config.json'), 'utf8'))[0];

const messagesFn = Function(wrapper.data.messages.handler)();
const responseFn = Function(wrapper.handler)();

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  ok   ' + name);
  } else {
    failures.push(name);
    console.log('  FAIL ' + name + (detail === undefined ? '' : '  → ' + JSON.stringify(detail)));
  }
}

const api = (content) => ({ choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }] });

// 与 question.resolver.ts 取结果的方式保持一致：result.options ?? result.plainOptions
const picked = (r) => (!r || !r.finish ? [] : r.options ?? r.plainOptions ?? (r.option ? [r.option] : []));

console.log('\n[1] 配置静态结构');
check('url 指向 Go 的 chat/completions', wrapper.url === 'https://opencode.ai/inference/go/openai/v1/chat/completions', wrapper.url);
check('method = post', wrapper.method === 'post');
check('contentType = json', wrapper.contentType === 'json');
check('type = fetch（客户端软件）', wrapper.type === 'fetch', wrapper.type);
check('三个 header 齐全', ['Content-Type', 'Authorization', 'x-opencode-session'].every((k) => wrapper.headers[k]), Object.keys(wrapper.headers));
check('Authorization 带 Bearer 前缀', /^Bearer \S+$/.test(wrapper.headers.Authorization));
check(
  'data.messages 是 { handler: string } 形式（OCS 只解析第一层）',
  Object.keys(wrapper.data.messages).length === 1 && typeof wrapper.data.messages.handler === 'string' && wrapper.data.messages.handler.length > 0
);
check('model 在 data 里', typeof wrapper.data.model === 'string' && wrapper.data.model.length > 0, wrapper.data.model);

console.log('\n[2] messages handler');
const singleEnv = { title: '光合作用的产物是什么？', type: 'single', options: 'A. 有机物和氧气\nB. 二氧化碳和水\nC. 只有氧气\nD. 只有有机物' };
const msgs = messagesFn(singleEnv);
check('返回 system + user 两条消息', msgs.length === 2 && msgs[0].role === 'system' && msgs[1].role === 'user');
check('system 约束只输出 JSON', /只输出一个 JSON/.test(msgs[0].content));
check('user 里带题型', msgs[1].content.includes('单选题'), msgs[1].content.split('\n')[0]);
check('user 里带题目原文', msgs[1].content.includes('光合作用的产物是什么？'));
check('user 里带全部选项', msgs[1].content.includes('A. 有机物和氧气') && msgs[1].content.includes('D. 只有有机物'));
const judgeMsgs = messagesFn({ title: '地球是圆的。', type: 'judgement', options: 'A. 对\nB. 错' });
check('判断题被标注为判断题', judgeMsgs[1].content.includes('判断题'));
check('判断题要求照抄选项原文', judgeMsgs[1].content.includes('原样照抄'));
const emptyMsgs = messagesFn({ title: '1+2=?', type: 'completion' });
check('无选项时不炸', emptyMsgs[1].content.includes('填空题') && emptyMsgs[1].content.includes('1+2=?'));

console.log('\n[3] 单选题：handler → OCS 匹配');
const singleOptions = ['A. 有机物和氧气', 'B. 二氧化碳和水', 'C. 只有氧气', 'D. 只有有机物'];
const r1 = responseFn(api({ kind: 'choice', answer: 'A', confidence: 0.95 }));
check('返回 [undefined, "A"]', Array.isArray(r1) && r1[0] === undefined && r1[1] === 'A', r1);
const m1 = resolveSingle([r1[1]], singleOptions);
check('OCS 选中 A. 有机物和氧气', m1.finish && m1.option === singleOptions[0], m1);

console.log('\n[4] 多选题：乱序字母要能收敛成升序');
const multiOptions = ['A. 甲', 'B. 乙', 'C. 丙', 'D. 丁'];
const r2 = responseFn(api({ kind: 'choice', answer: 'C, A', confidence: 0.8 }));
check('"C, A" → "AC"', r2 && r2[1] === 'AC', r2);
const m2 = resolveMultiple([r2[1]], multiOptions);
const m2picked = picked(m2);
check(
  'OCS 选中 A 和 C',
  m2.finish && m2picked.length === 2 && m2picked.includes(multiOptions[0]) && m2picked.includes(multiOptions[2]),
  m2
);
const r2b = responseFn(api({ kind: 'choice', answer: 'aa', confidence: 0.9 }));
check('重复字母去重', r2b && r2b[1] === 'A', r2b);

console.log('\n[5] 判断题：必须回选项原文，不能回字母');
const judgeOptions1 = ['A. 对', 'B. 错'];
const r3 = responseFn(api({ kind: 'text', answer: '对', confidence: 0.99 }));
check('"对" 原样透传', r3 && r3[1] === '对', r3);
const m3 = resolveJudgement([r3[1]], judgeOptions1);
check('OCS 选中 A. 对', m3.finish && m3.option === judgeOptions1[0], m3);
const judgeOptions2 = ['A. 正确', 'B. 错误'];
const r4 = responseFn(api({ kind: 'text', answer: '正确', confidence: 0.9 }));
const m4 = resolveJudgement([r4[1]], judgeOptions2);
check('选项是"正确/错误"时也能命中', m4.finish && m4.option === judgeOptions2[0], m4);
const r5 = responseFn(api({ kind: 'text', answer: '错误', confidence: 0.9 }));
const m5 = resolveJudgement([r5[1]], judgeOptions2);
check('选"错误"时命中 B', m5.finish && m5.option === judgeOptions2[1], m5);
check('判断题选项能被识别', isJudgementOptions(judgeOptions1) && isJudgementOptions(judgeOptions2));

console.log('\n[6] 填空题：多个空用 # 分隔');
const r6 = responseFn(api({ kind: 'text', answer: '光合作用#叶绿体', confidence: 0.9 }));
check('多空答案保留 #', r6 && r6[1] === '光合作用#叶绿体', r6);
const m6 = resolveCompletion([r6[1]], 2);
check('OCS 拆成两个空', m6.finish && m6.answers.length === 2 && m6.answers[1] === '叶绿体', m6);
const r6b = responseFn(api({ kind: 'text', answer: 'HTML', confidence: 0.9 }));
check('kind=text 时纯字母答案不被排序', r6b && r6b[1] === 'HTML', r6b);

console.log('\n[7] 低置信度 / 报错：必须什么都不返回');
const r7 = responseFn(api({ kind: 'choice', answer: 'B', confidence: 0.2 }));
check('confidence 0.2 被丢弃', r7 === undefined, r7);
const r8 = responseFn({ error: { type: 'server_error', message: 'Invalid credential' } });
check('API error 被丢弃', r8 === undefined, r8);
const r9 = responseFn(api('我不知道'));
check('无法解析的输出被丢弃', r9 === undefined, r9);
const r10 = responseFn(undefined);
check('空响应被丢弃', r10 === undefined, r10);
check('任何情况下都不返回 [x, undefined]', [r7, r8, r9, r10].every((r) => !(Array.isArray(r) && r[1] === undefined)));

console.log('\n[8] 脏输出容错');
const r11 = responseFn(api('```json\n{"kind":"choice","answer":"B","confidence":0.9}\n```'));
check('剥掉 ```json 围栏', r11 && r11[1] === 'B', r11);
const r12 = responseFn(api({ kind: 'choice', answer: '答案：C', confidence: 0.9 }));
check('剥掉"答案："前缀', r12 && r12[1] === 'C', r12);
const r13 = responseFn(api('我觉得选 {"kind":"choice","answer":"d","confidence":0.7} 吧'));
check('前后有废话时仍能抠出 JSON', r13 && r13[1] === 'D', r13);
const r14 = responseFn(api({ answer: 'B', confidence: 0.9 }));
check('缺 kind 时按形状猜成选择题', r14 && r14[1] === 'B', r14);

console.log('\n' + (failures.length ? 'FAILED' : 'ALL PASSED') + '：' + pass + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.error('失败用例：\n - ' + failures.join('\n - '));
  process.exit(1);
}

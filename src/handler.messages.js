return (env) => {
  var title = String(env.title || '').trim();
  var options = String(env.options || '').trim();
  var typeNames = { single: '单选题', multiple: '多选题', judgement: '判断题', completion: '填空题' };
  var typeName = typeNames[env.type] || '选择题';

  var system = '你是网课自动答题引擎，只输出答案数据。你只输出一个 JSON 对象，不要 Markdown 代码块，不要解释、不要前后缀。';

  var user = [
    '题型：' + typeName,
    '题目：' + title,
    options ? '选项（每行一个）：\n' + options : '选项：无，这是填空题，直接给出答案原文。',
    '',
    '作答规则：',
    '1. 单选题：kind 填 "choice"，answer 只写一个选项字母，例如 "B"。',
    '2. 多选题：kind 填 "choice"，answer 只写选中的字母并按字母升序拼接，例如 "AC"，不要逗号、空格或 #。',
    '3. 判断题：kind 填 "text"，answer 原样照抄正确选项的文字（去掉开头 "A." 这类字母标号），例如 "对"、"正确"、"是"，不要改写措辞。',
    '4. 填空题：kind 填 "text"，answer 写答案原文；有多个空时按顺序用 # 连接。',
    '5. confidence 是 0 到 1 的小数，表示你的把握；没把握就给低分，不要硬编。',
    '',
    '只输出一行 JSON，形如 {"kind":"choice","answer":"A","confidence":0.9}'
  ].join('\n');

  return [
    { role: 'system', content: system },
    { role: 'user', content: user }
  ];
};

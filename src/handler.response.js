return (res) => {
  // 置信度阈值：模型给出低于该值的答案时直接放弃，让 OCS 显示"未搜索到"，而不是乱选一个。
  var MIN_CONFIDENCE = 0.5;
  var TAG = '[OCS/OpenCode]';

  if (!res) {
    console.warn(TAG, '空响应');
    return undefined;
  }

  if (res.error) {
    console.error(TAG, '接口报错：', (res.error && (res.error.message || res.error.type)) || res.error);
    return undefined;
  }

  var content = res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content;
  if (!content) {
    console.warn(TAG, '响应里没有 choices[0].message.content：', res);
    return undefined;
  }

  // 模型偶尔会套一层 ```json 围栏
  var text = String(content).replace(/```[a-zA-Z]*/g, '').trim();

  var data = null;
  try {
    data = JSON.parse(text);
  } catch (e) {
    data = null;
  }

  // 兜底：JSON 没解析出来，就从文本里硬抠 answer
  if (!data || typeof data !== 'object') {
    var hit = text.match(/"answer"\s*:\s*"([^"]*)"/i) || text.match(/answer\s*[:：]\s*([A-Ja-j]{1,8})/i);
    if (!hit) {
      console.warn(TAG, '无法解析模型输出：', text);
      return undefined;
    }
    data = { kind: 'choice', answer: hit[1], confidence: 1 };
  }

  var answer = String(data.answer == null ? '' : data.answer)
    .replace(/^(答案|选项|answer)\s*[:：]\s*/i, '')
    .trim();
  if (!answer) {
    console.warn(TAG, '答案为空：', text);
    return undefined;
  }

  var confidence = Number(data.confidence);
  if (!isFinite(confidence)) confidence = 1;
  if (confidence < MIN_CONFIDENCE) {
    console.warn(TAG, '置信度 ' + confidence + ' 低于阈值 ' + MIN_CONFIDENCE + '，放弃作答：', answer);
    return undefined;
  }

  var kind = String(data.kind || '').toLowerCase();
  var letters = answer.replace(/[^A-Ja-j]/g, '');
  // kind 缺失时按形状猜：只由 A-J 和常见分隔符组成、且字母不超过 8 个，就当选择题答案
  var looksLikeChoice =
    kind === 'choice' ||
    (kind !== 'text' && letters.length > 0 && letters.length <= 8 && /^[A-Ja-j\s,，、.．;；#\-]+$/.test(answer));

  if (looksLikeChoice) {
    if (!letters) {
      console.warn(TAG, '选择题答案里没有选项字母：', answer);
      return undefined;
    }
    answer = letters
      .toUpperCase()
      .split('')
      .filter(function (c, i, arr) {
        return arr.indexOf(c) === i;
      })
      .sort()
      .join('');
  }

  // 题目传 undefined，OCS 会自动显示它搜索到的那道题
  return [undefined, answer];
};

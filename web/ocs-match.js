/* 由 test/ocs-match.mjs 自动生成，勿手改 */
(function () {
// 把 OCS 4.0 的答案匹配算法搬过来（packages/core/src/core/worker/{utils,resolvers/*}.ts 与 utils/string.ts）。
// 目的：离线验证"我们吐出去的答案，OCS 真的会选中那个选项"，而不是只验证 JSON 长得对。
// 只搬了与本题相关的纯函数，未改动逻辑。

/** 与 string-similarity 的 compareTwoStrings 等价 */
function compareTwoStrings(a, b) {
  a = String(a).replace(/\s+/g, '');
  b = String(b).replace(/\s+/g, '');
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const map = new Map();
  for (let i = 0; i < a.length - 1; i++) {
    const bg = a.substring(i, i + 2);
    map.set(bg, (map.get(bg) || 0) + 1);
  }
  let hit = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const bg = b.substring(i, i + 2);
    const c = map.get(bg) || 0;
    if (c > 0) {
      map.set(bg, c - 1);
      hit++;
    }
  }
  return (2 * hit) / (a.length + b.length - 2);
}

function findBestMatch(main, targets) {
  let best = { rating: 0, target: '' };
  for (const t of targets) {
    const rating = compareTwoStrings(main, t);
    if (rating > best.rating) best = { rating, target: t };
  }
  return best;
}

function clearString(str, ...exclude) {
  exclude.push(...['①②③④⑤⑥⑦⑧⑨']);
  return String(str)
    .trim()
    .toLocaleLowerCase()
    .replace(RegExp(`[^\\u2E80-\\u9FFFA-Za-z0-9${exclude.join('')}]*`, 'g'), '');
}

function normalizeString(str) {
  return clearString(
    String(str)
      .replace(/[，。！？；：""''、（）【】《》\s]/g, '')
      .replace(/[,.\-!?;:'"()[\]<>]/g, '')
      .replace(/[ａ-ｚＡ-Ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/％/g, '%')
  );
}

function removeRedundant(str) {
  return (
    String(str == null ? '' : str)
      .trim()
      .replace(/^[A-Z]{1}[^A-Za-z0-9⺀-鿿]+([A-Za-z0-9⺀-鿿]+)/, '$1')
      .replace(/^[A-Z]{1}([⺀-鿿][A-Za-z0-9⺀-鿿]*)/, '$1') || ''
  );
}

function isPlainAnswer(answer) {
  answer = String(answer).trim();
  if (answer.length > 8 || !/[A-Z]/.test(answer)) return false;
  const counter = {};
  let min = 0;
  for (let i = 0; i < answer.length; i++) {
    if (answer.charCodeAt(i) < min) return false;
    min = answer.charCodeAt(i);
    counter[min] = (counter[min] || 0) + 1;
  }
  for (const key in counter) if (counter[key] !== 1) return false;
  return true;
}

function resolvePlainAnswer(answer) {
  const resolve = String(answer)
    .trim()
    .replace(/[,，.。．、 #]/g, '')
    .trim();
  if (isPlainAnswer(resolve)) return resolve;
  return undefined;
}

function splitAnswer(answer, separators = ['===', '#', '---', '###', '|', ';', '；']) {
  answer = String(answer).trim();
  if (answer.length === 0) return [];
  separators = separators.filter((el) => el.trim().length > 0);
  try {
    const json = JSON.parse(answer);
    if (Array.isArray(json)) {
      return json.map(String).map((el) => el.trim()).filter((el) => el.length > 0);
    }
  } catch {
    for (const sep of separators) {
      if (answer.split(sep).length > 1) {
        return answer.split(sep).map((el) => el.trim()).filter((el) => el.length > 0);
      }
    }
  }
  return [answer];
}

function answerNormalizedMatch(answers, options) {
  const _answers = answers.map(removeRedundant).map(normalizeString);
  const _options = options.map(removeRedundant).map(normalizeString);
  return _answers.length !== 0
    ? _options
        .map((opt, i) => {
          let level = 0;
          if (opt) {
            for (const ans of _answers) {
              if (ans === opt) {
                level = 2;
                break;
              } else if (ans.includes(opt)) {
                level = 1;
              }
            }
          }
          return { opt, original: options[i], level };
        })
        .filter(({ level }) => level > 0)
        .sort((a, b) => b.level - a.level)
        .map(({ original }) => original)
    : [];
}

function resolveSingle(answers, options, separators) {
  const allAnswer = answers.map((a) => splitAnswer(a, separators)).flat();
  const optionStrings = options.map(removeRedundant);

  const normalizedResult = answerNormalizedMatch(allAnswer, optionStrings);
  if (normalizedResult.length) {
    const index = optionStrings.findIndex((opt) => opt === normalizedResult[0]);
    if (index !== -1) return { finish: true, option: options[index] };
  }

  const ratings = optionStrings.map((opt) => (opt.trim() === '' ? { rating: 0 } : findBestMatch(opt, allAnswer.map((a) => clearString(removeRedundant(a))))));
  let bestIndex = -1;
  let bestRating = 0;
  ratings.forEach((r, i) => {
    if (r.rating > bestRating) {
      bestRating = r.rating;
      bestIndex = i;
    }
  });
  if (bestIndex !== -1 && bestRating > 0.6) return { finish: true, option: options[bestIndex], rating: bestRating };

  for (const answer of allAnswer) {
    const ans = resolvePlainAnswer(answer);
    if (ans && ans.length === 1) {
      const index = ans.charCodeAt(0) - 65;
      if (optionStrings[index] !== undefined) return { finish: true, option: options[index], via: 'plain' };
    }
  }

  if (allAnswer.length > 1) {
    const r = resolveSingle([allAnswer.join('')], options, separators);
    if (r.finish) return r;
  }

  return { finish: false, allAnswer, options: optionStrings };
}

function resolveMultiple(resultAnswers, options) {
  const optionStrings = options.map(removeRedundant);
  const groups = [];

  for (const raw of resultAnswers) {
    const answers = splitAnswer(String(raw).trim());
    const picked = [];
    const normalizedOptions = answerNormalizedMatch(answers, optionStrings);
    for (const opt of normalizedOptions) {
      const idx = optionStrings.indexOf(opt);
      if (idx === -1) continue;
      const matchedAns = answers.find((a) => normalizeString(removeRedundant(a)) === normalizeString(removeRedundant(opt)) || normalizeString(removeRedundant(a)).includes(normalizeString(removeRedundant(opt))));
      if (!matchedAns) continue;
      picked.push(options[idx]);
    }
    if (picked.length) groups.push(picked);

    const similar = [];
    const ratings = optionStrings.map((o) => (o.trim() === '' ? { rating: 0 } : findBestMatch(o, answers.map((a) => clearString(removeRedundant(a))))));
    ratings.forEach((r, j) => {
      if (r.rating > 0.6) similar.push(options[j]);
    });
    if (similar.length && similar.length >= (groups[groups.length - 1] || []).length) groups.push(similar);
  }

  const best = groups.sort((a, b) => b.length - a.length)[0];
  if (best) return { finish: true, options: best };

  const plainOptions = [];
  for (const answer of resultAnswers) {
    const ans = String(answer).trim();
    if (resolvePlainAnswer(ans)) {
      for (const char of ans) {
        const index = char.charCodeAt(0) - 65;
        if (options[index] !== undefined) plainOptions.push(options[index]);
      }
    }
  }
  if (plainOptions.length) return { finish: true, plainOptions: [...new Set(plainOptions)], via: 'plain' };

  return { finish: false };
}

const CORRECT_WORDS = ['是', '对', '正确', '确定', '√', '对的', '是的', '正确的', 'true', 'True', 'T', 'yes', '1'];
const INCORRECT_WORDS = ['非', '否', '错', '错误', '×', 'X', '错的', '不对', '不正确的', '不正确', '不是', '不是的', 'false', 'False', 'F', 'no', '0'];

function judgeMatch(target, words) {
  return words.some((word) => clearString(removeRedundant(word), '√', '×') === clearString(removeRedundant(target), '√', '×'));
}

function isJudgementOptions(options) {
  if (options.length !== 2) return false;
  return options.some((o) => judgeMatch(o, CORRECT_WORDS)) && options.some((o) => judgeMatch(o, INCORRECT_WORDS));
}

function resolveJudgement(answers, options) {
  const answerShowCorrect = answers.find((a) => judgeMatch(a, CORRECT_WORDS));
  const answerShowIncorrect = answers.find((a) => judgeMatch(a, INCORRECT_WORDS));
  if (!answerShowCorrect && !answerShowIncorrect) return { finish: false };
  for (const option of options) {
    if (answerShowCorrect && judgeMatch(option, CORRECT_WORDS)) return { finish: true, option };
    if (answerShowIncorrect && judgeMatch(option, INCORRECT_WORDS)) return { finish: true, option };
  }
  return { finish: false };
}

function resolveCompletion(answers, blankCount, separators) {
  for (const a of answers) {
    let ans = [a].filter((x) => x);
    if (ans.length === 1) ans = splitAnswer(ans[0], separators);
    if (ans.length !== 0 && (ans.length === blankCount || blankCount === 1)) {
      if (ans.length === blankCount) return { finish: true, answers: ans };
      if (blankCount === 1) return { finish: true, answers: [ans.join(' ')] };
    }
  }
  return { finish: false };
}

window.OCSMatch = { resolveSingle, resolveMultiple, resolveJudgement, resolveCompletion, isJudgementOptions, splitAnswer, removeRedundant, resolvePlainAnswer };
})();

/** 分词分隔符：字母、结合标记、数字视为同一词内字符，避免纯数字名/查询被整段当作分隔符 */
let RE_NOT_WORD_RUN: RegExp = /[^\p{L}\p{M}\p{N}]+/ui;

export default function searchWords(haystack: string, needle: string | string[]) {
  if (!haystack || !needle) {
    return false;
  }

  const rawNeedleWords = typeof needle === 'string' ? needle.toLowerCase().split(RE_NOT_WORD_RUN) : needle;
  const needleWords = rawNeedleWords.filter(Boolean);
  if (!needleWords.length) {
    return false;
  }

  const haystackLower = haystack.toLowerCase();

  // @optimization
  if (needleWords.length === 1 && !haystackLower.includes(needleWords[0])) {
    return false;
  }

  let haystackWords: string[];

  return needleWords.every((needleWord) => {
    if (!haystackLower.includes(needleWord)) {
      return false;
    }

    if (!haystackWords) {
      haystackWords = haystackLower.split(RE_NOT_WORD_RUN);
    }

    return haystackWords.some((haystackWord) => haystackWord.startsWith(needleWord));
  });
}

export function prepareSearchWordsForNeedle(needle: string) {
  const needleWords = needle.toLowerCase().split(RE_NOT_WORD_RUN).filter(Boolean);

  return (haystack: string) => searchWords(haystack, needleWords);
}

/**
 * 按完整姓名字符串模糊匹配：每个搜索片段只需在全名（小写）中连续出现即可，
 * 不要求落在分词边界或词前缀（与 searchWords 行为互补，便于 @ 提及筛人）。
 * 同时支持去掉空格后的子串匹配（如 "lizhang" 对 "Li Zhang"）。
 */
export function matchesFullNameFuzzy(fullName: string, needle: string): boolean {
  if (!fullName || !needle) {
    return false;
  }

  const needleWords = needle.toLowerCase().split(RE_NOT_WORD_RUN).filter(Boolean);
  if (!needleWords.length) {
    return false;
  }

  const fullLower = fullName.toLowerCase();
  const collapsed = fullLower.replace(/\s+/g, '');

  return needleWords.every((w) => {
    if (!w) {
      return true;
    }
    if (fullLower.includes(w)) {
      return true;
    }
    const wCollapsed = w.replace(/\s+/g, '');
    return wCollapsed.length > 0 && collapsed.includes(wCollapsed);
  });
}

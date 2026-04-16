/**
 * @提及弹层诊断：默认关闭，避免污染正式环境日志。
 *
 * 开启方式（任选其一）：
 * - 控制台：localStorage.setItem('tt-mention-debug', '1'); location.reload();
 * - 或：window.__TT_MENTION_DEBUG__ = true（当前标签页立即生效，无需刷新）
 *
 * 查看快照：window.__TT_MENTION_LAST_DIAG__
 * 打印说明：window.__ttMentionDebugHelp()
 */

const DEBUG_PREFIX = `${String.fromCodePoint(0x1f41b)} [mention-debug]`;

type MentionDiagGlobal = Window & {
  __TT_MENTION_DEBUG__?: boolean;
  __TT_MENTION_LAST_DIAG__?: Record<string, unknown>;
  __ttMentionDebugHelp?: () => void;
  __ttMentionDebugDump?: () => Record<string, unknown> | undefined;
};

export function isMentionDebugOn(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  try {
    const w = window as MentionDiagGlobal;
    if (w.__TT_MENTION_DEBUG__) {
      return true;
    }
    return localStorage.getItem('tt-mention-debug') === '1';
  } catch {
    return false;
  }
}

export function mentionDebugLog(tag: string, payload?: unknown): void {
  if (!isMentionDebugOn()) {
    return;
  }
  console.log(`${DEBUG_PREFIX}:${tag}`, payload ?? '');
}

export function mergeMentionDebugSnapshot(section: string, data: Record<string, unknown>): void {
  if (!isMentionDebugOn() || typeof window === 'undefined') {
    return;
  }
  const w = window as MentionDiagGlobal;
  const prev = (w.__TT_MENTION_LAST_DIAG__ && typeof w.__TT_MENTION_LAST_DIAG__ === 'object')
    ? w.__TT_MENTION_LAST_DIAG__
    : {};
  w.__TT_MENTION_LAST_DIAG__ = {
    ...prev,
    updatedAt: Date.now(),
    [section]: data,
  };
}

function printHelp(): void {
  console.log(`
@提及诊断（telegram-tt）

开启（持久）：
  localStorage.setItem('tt-mention-debug', '1');
  location.reload();

开启（当前页，不刷新）：
  window.__TT_MENTION_DEBUG__ = true;

在目标群输入 @ 后，在控制台执行：
  window.__TT_MENTION_LAST_DIAG__

关闭（持久）：
  localStorage.removeItem('tt-mention-debug');
  location.reload();
`);
}

if (typeof window !== 'undefined') {
  const w = window as MentionDiagGlobal;
  w.__ttMentionDebugHelp = printHelp;
  w.__ttMentionDebugDump = () => {
    const diag = w.__TT_MENTION_LAST_DIAG__;
    try {
      console.log(`${DEBUG_PREFIX}:dump`, JSON.stringify(diag, null, 2));
    } catch {
      console.log(`${DEBUG_PREFIX}:dump`, diag);
    }
    return diag;
  };
}

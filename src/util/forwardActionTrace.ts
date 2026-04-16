/**
 * 调试包（TT_DEBUG_DIST）下挂到 window.__TT_FORWARD_TRACE__，
 * 用于在控制台记录转发/切会话相关 action 与 Long Task，便于排查卡顿。
 */
import { getActions, getGlobal } from '../global';
import { selectCurrentMessageList, selectTabState } from '../global/selectors';
import { getCurrentTabId } from './establishMultitabRole';

const ACTION_NAMES = [
  'openForwardMenu',
  'openForwardMenuForSelectedMessages',
  'setForwardChatOrTopic',
  'forwardMessages',
  'forwardToSavedMessages',
  'forwardStory',
  'exitForwardMode',
  'changeRecipient',
  'setForwardNoAuthors',
  'setForwardNoCaptions',
  'processOpenChatOrThread',
  'openChat',
  'openThread',
  'openChatWithDraft',
  'openChatOrTopicWithReplyInDraft',
  'resetDraftReplyInfo',
  'sendMessage',
] as const;

type TraceRecord = {
  iso: string;
  msSinceLast: number;
  action: string;
  payload: unknown;
  before: ReturnType<typeof snapshotForwardContext>;
  after?: ReturnType<typeof snapshotForwardContext>;
  durationMs: number;
  error?: string;
};

const log: TraceRecord[] = [];
const originals = new Map<string, (...args: any[]) => any>();
let running = false;
let lastMark = performance.now();
let longTaskObs: PerformanceObserver | null = null;

function snapshotForwardContext(payload?: { tabId?: number }) {
  try {
    const g = getGlobal();
    const tabId = payload?.tabId ?? getCurrentTabId();
    const tab = selectTabState(g, tabId);
    return {
      tabId,
      forwardMessages: tab.forwardMessages ? { ...tab.forwardMessages } : {},
      isShareMessageModalShown: tab.isShareMessageModalShown,
      currentMessageList: selectCurrentMessageList(g, tabId),
    };
  } catch (e) {
    return { error: String(e) };
  }
}

function safePayload(p: unknown, depth = 0): unknown {
  if (depth > 4) return '[MaxDepth]';
  if (p == null || typeof p !== 'object') return p;
  if (Array.isArray(p)) {
    return p.slice(0, 80).map((x) => safePayload(x, depth + 1));
  }
  const out: Record<string, unknown> = {};
  const keys = Object.keys(p as object).slice(0, 50);
  for (const k of keys) {
    try {
      const v = (p as Record<string, unknown>)[k];
      if (typeof v === 'function') out[k] = '[Function]';
      else if (v != null && typeof v === 'object') out[k] = safePayload(v, depth + 1);
      else out[k] = v;
    } catch {
      out[k] = '[Err]';
    }
  }
  return out;
}

function shouldLogSendMessage(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return Boolean(p.isForwarding);
}

export function startForwardActionTrace() {
  if (running) {
    console.warn('[TT-ForwardTrace] 已在运行，先 stop() 再 start()');
    return;
  }
  const actions = getActions() as Record<string, (...args: any[]) => any>;
  running = true;
  lastMark = performance.now();

  for (const name of ACTION_NAMES) {
    const orig = actions[name];
    if (typeof orig !== 'function' || originals.has(name)) continue;
    originals.set(name, orig);
    actions[name] = function ttForwardTraceWrapped(this: unknown, ...args: any[]) {
      if (name === 'sendMessage' && !shouldLogSendMessage(args[0])) {
        return orig.apply(this, args);
      }
      const t0 = performance.now();
      const msSinceLast = Math.round(t0 - lastMark);
      lastMark = t0;
      const before = snapshotForwardContext(args[0]);
      const rec: TraceRecord = {
        iso: new Date().toISOString(),
        msSinceLast,
        action: name,
        payload: safePayload(args[0]),
        before,
        durationMs: 0,
      };
      let err: unknown;
      let ret: unknown;
      try {
        ret = orig.apply(this, args);
      } catch (e) {
        err = e;
      }
      rec.after = snapshotForwardContext(args[0]);
      rec.durationMs = Math.round(performance.now() - t0);
      if (err) rec.error = String(err);
      log.push(rec);
      const style = rec.error ? 'color:#c00' : 'color:#080';
      console.log(
        '%c[TT-ForwardTrace] ' + name + ' +' + rec.durationMs + 'ms (距上条 ' + msSinceLast + 'ms)',
        style,
        rec,
      );
      if (err) throw err;

      if (ret && typeof (ret as Promise<unknown>).then === 'function') {
        (ret as Promise<unknown>).then(
          () => {
            console.log(
              '%c[TT-ForwardTrace] ' + name + ' Promise resolved +' + Math.round(performance.now() - t0) + 'ms',
              'color:#06c',
              snapshotForwardContext(args[0]),
            );
          },
          (e: unknown) => {
            console.warn('%c[TT-ForwardTrace] ' + name + ' Promise rejected', 'color:#c00', e);
          },
        );
      }
      return ret;
    };
  }

  try {
    longTaskObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration >= 50) {
          console.warn(
            '[TT-ForwardTrace] Long task ' + Math.round(e.duration) + 'ms',
            e.name,
            snapshotForwardContext(),
          );
        }
      }
    });
    longTaskObs.observe({ entryTypes: ['longtask'] });
  } catch {
    // 部分环境无 longtask
  }

  console.log('[TT-ForwardTrace] 已开始（含 Long Task >=50ms）。结束请 __TT_FORWARD_TRACE__.stop()');
}

export function stopForwardActionTrace() {
  if (!running) return;
  const actions = getActions() as Record<string, (...args: any[]) => any>;
  for (const [name, orig] of originals) {
    if (typeof actions[name] === 'function') {
      actions[name] = orig;
    }
  }
  originals.clear();
  longTaskObs?.disconnect();
  longTaskObs = null;
  running = false;
  console.log('[TT-ForwardTrace] 已停止并恢复 action');
}

export function clearForwardTraceLog() {
  log.length = 0;
  console.log('[TT-ForwardTrace] 日志已清空');
}

export function dumpForwardTraceLog() {
  console.table(
    log.map((r) => ({
      time: r.iso,
      gapMs: r.msSinceLast,
      action: r.action,
      durMs: r.durationMs,
      toChatId: (r.before as { forwardMessages?: { toChatId?: string } }).forwardMessages?.toChatId,
      fromChatId: (r.before as { forwardMessages?: { fromChatId?: string } }).forwardMessages?.fromChatId,
      err: r.error || '',
    })),
  );
  return log;
}

export function exportForwardTraceLogJson(): string {
  return JSON.stringify(log, null, 2);
}

export function registerForwardTraceGlobalApi() {
  (window as unknown as { __TT_FORWARD_TRACE__?: object }).__TT_FORWARD_TRACE__ = {
    start: startForwardActionTrace,
    stop: stopForwardActionTrace,
    clear: clearForwardTraceLog,
    dump: dumpForwardTraceLog,
    exportJson: exportForwardTraceLogJson,
    getLog: () => log,
  };
  // eslint-disable-next-line no-console
  console.log(
    '%c[TT-ForwardTrace] 调试 API 已挂载：__TT_FORWARD_TRACE__.start() 开始记录',
    'color:#06c;font-weight:bold',
  );
}

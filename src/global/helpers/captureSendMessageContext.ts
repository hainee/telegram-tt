import type { MessageList } from '../../types';
import type { SendMessageCapture } from '../types/actions';
import type { GlobalState } from '../types/globalState';
import { MAIN_THREAD_ID } from '../../api/types';

import { getCurrentTabId } from '../../util/establishMultitabRole';
import { getActions } from '../index';
import { selectDraft } from '../selectors/messages';
import { selectCurrentViewedStory } from '../selectors/stories';
import { selectTabState } from '../selectors/tabs';

/**
 * Captures draft reply / suggested post and forward picker state at the moment the user sends,
 * so action handlers and embedders (e.g. Electron shells) do not rely on global draft timing.
 */
export function buildSendMessageCapture(
  global: GlobalState,
  messageList: MessageList | undefined,
  tabId: number = getCurrentTabId(),
): SendMessageCapture {
  const forwardInfo = { ...selectTabState(global, tabId).forwardMessages };
  const isForwarding = Boolean(forwardInfo.messageIds?.length);

  const { storyId, peerId: storyPeerId } = selectCurrentViewedStory(global, tabId);
  const isStoryReply = Boolean(storyId && storyPeerId);

  let chatId: string | undefined;
  let threadId: MessageList['threadId'] | undefined;

  if (messageList) {
    ({ chatId, threadId } = messageList);
  } else if (isStoryReply) {
    chatId = storyPeerId;
    threadId = MAIN_THREAD_ID;
  }

  if (chatId === undefined || threadId === undefined) {
    return { forwardInfo };
  }

  const draft = selectDraft(global, chatId, threadId);
  return {
    replyInfo: !isForwarding && !isStoryReply ? draft?.replyInfo : undefined,
    suggestedPostInfo: !isForwarding && !isStoryReply ? draft?.suggestedPostInfo : undefined,
    forwardInfo,
  };
}

/**
 * After building {@link SendMessageCapture}, close reply / forward / suggested composer UI immediately so the user
 * can start a new reply or forward while a hooked async send (e.g. translation) is still in flight.
 */
export function dismissSendMessageCaptureUi(
  capture: SendMessageCapture,
  messageList: MessageList | undefined,
  tabId: number = getCurrentTabId(),
): void {
  const actions = getActions();
  if (capture.forwardInfo?.messageIds?.length) {
    actions.exitForwardMode({ tabId });
  }
  if (!messageList) {
    return;
  }
  if (capture.replyInfo !== undefined) {
    actions.resetDraftReplyInfo({ tabId });
  }
  if (capture.suggestedPostInfo !== undefined) {
    actions.resetDraftSuggestedPostStrip({ tabId });
  }
}

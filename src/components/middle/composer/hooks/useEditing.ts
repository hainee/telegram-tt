import { useEffect, useState } from '../../../../lib/teact/teact';
import { getActions } from '../../../../global';

import type { ApiDraft, ApiFormattedText, ApiMessage } from '../../../../api/types';
import type { MessageListType, ThreadId } from '../../../../types';
import type { Signal } from '../../../../util/signals';
import { ApiMessageEntityTypes } from '../../../../api/types';

import { EDITABLE_INPUT_CSS_SELECTOR } from '../../../../config';
import { requestMeasure, requestNextMutation } from '../../../../lib/fasterdom/fasterdom';
import { hasMessageMedia } from '../../../../global/helpers';
import { getCurrentTabId } from '../../../../util/establishMultitabRole';
import focusEditableElement from '../../../../util/focusEditableElement';
import parseHtmlAsFormattedText from '../../../../util/parseHtmlAsFormattedText';
import { getTextWithEntitiesAsHtml } from '../../../common/helpers/renderTextWithEntities';

import { useDebouncedResolver } from '../../../../hooks/useAsyncResolvers';
import useDerivedSignal from '../../../../hooks/useDerivedSignal';
import useEffectWithPrevDeps from '../../../../hooks/useEffectWithPrevDeps';
import useLastCallback from '../../../../hooks/useLastCallback';
import useBackgroundMode from '../../../../hooks/window/useBackgroundMode';
import useBeforeUnload from '../../../../hooks/window/useBeforeUnload';

const URL_ENTITIES = new Set<string>([ApiMessageEntityTypes.TextUrl, ApiMessageEntityTypes.Url]);
const DEBOUNCE_MS = 300;

const useEditing = (
  getHtml: Signal<string>,
  setHtml: (html: string) => void,
  editedMessage: ApiMessage | undefined,
  resetComposer: (shouldPreserveInput?: boolean) => void,
  chatId: string,
  threadId: ThreadId,
  type: MessageListType,
  draft?: ApiDraft,
  editingDraft?: ApiFormattedText,
): [VoidFunction, VoidFunction, boolean] => {
  const {
    editMessage, setEditingDraft, toggleMessageWebPage, setEditingId, finishEditing,
  } = getActions();
  const [shouldForceShowEditing, setShouldForceShowEditing] = useState(false);

  const replyingToId = draft?.replyInfo?.replyToMsgId;

  useEffectWithPrevDeps(([prevEditedMessage, prevReplyingToId]) => {
    if (!editedMessage) {
      return;
    }

    if (replyingToId && prevReplyingToId !== replyingToId) {
      setHtml('');
      setShouldForceShowEditing(false);
      return;
    }

    if (prevEditedMessage?.id === editedMessage.id && replyingToId === prevReplyingToId) {
      return;
    }

    // setEditingId 若传入 text 会写入 editingDraft；此处 editingDraft 有定义则优先于消息原文（含空字符串）
    const text = editingDraft !== undefined
      ? editingDraft
      : editedMessage.content.text;
    const html = getTextWithEntitiesAsHtml(text);

    setHtml(html);
    setShouldForceShowEditing(true);

    requestNextMutation(() => {
      const messageInput = document.querySelector<HTMLDivElement>(EDITABLE_INPUT_CSS_SELECTOR);
      if (messageInput) {
        focusEditableElement(messageInput, true);
      }
    });
  }, [editedMessage, replyingToId, editingDraft, setHtml]);

  useEffect(() => {
    if (!editedMessage) {
      return;
    }

    const shouldSetNoWebPage = !('webPage' in editedMessage.content)
      && editedMessage.content.text?.entities?.some((entity) => URL_ENTITIES.has(entity.type));

    toggleMessageWebPage({
      chatId,
      threadId,
      noWebPage: shouldSetNoWebPage,
    });
  }, [chatId, threadId, editedMessage]);

  useEffect(() => {
    if (!editedMessage) return undefined;
    return () => {
      const edited = parseHtmlAsFormattedText(getHtml());
      const update = edited.text.length ? edited : undefined;

      setEditingDraft({
        chatId, threadId, type, text: update,
      });
    };
  }, [chatId, editedMessage, getHtml, setEditingDraft, threadId, type]);

  const detectLinkDebounced = useDebouncedResolver(() => {
    if (!editedMessage) return false;

    const edited = parseHtmlAsFormattedText(getHtml());
    return !('webPage' in editedMessage.content)
      && editedMessage.content.text?.entities?.some((entity) => URL_ENTITIES.has(entity.type))
      && !(edited.entities?.some((entity) => URL_ENTITIES.has(entity.type)));
  }, [editedMessage, getHtml], DEBOUNCE_MS, true);

  const getShouldResetNoWebPageDebounced = useDerivedSignal(detectLinkDebounced, [detectLinkDebounced, getHtml], true);

  useEffectWithPrevDeps(([prevEditedMessage]) => {
    if (!editedMessage || prevEditedMessage?.id !== editedMessage.id) {
      return;
    }

    if (getShouldResetNoWebPageDebounced()) {
      toggleMessageWebPage({
        chatId,
        threadId,
        noWebPage: false,
      });
    }
  }, [editedMessage, chatId, getHtml, threadId, getShouldResetNoWebPageDebounced]);

  const restoreNewDraftAfterEditing = useLastCallback(() => {
    if (!draft) return;

    // Run one frame after editing draft reset
    requestMeasure(() => {
      setHtml(getTextWithEntitiesAsHtml(draft.text));

      // Wait one more frame until new HTML is rendered
      requestNextMutation(() => {
        const messageInput = document.querySelector<HTMLDivElement>(EDITABLE_INPUT_CSS_SELECTOR);
        if (messageInput) {
          focusEditableElement(messageInput, true);
        }
      });
    });
  });

  const handleEditCancel = useLastCallback(() => {
    setEditingId({ messageId: undefined });
    resetComposer();
    restoreNewDraftAfterEditing();
  });

  const handleEditComplete = useLastCallback(() => {
    const { text, entities } = parseHtmlAsFormattedText(getHtml());

    if (!editedMessage) {
      return;
    }

    if (!text && !hasMessageMedia(editedMessage)) {
      handleEditCancel();
      return;
    }

    const messageSnapshot = editedMessage;
    finishEditing({ tabId: getCurrentTabId() });
    editMessage({
      messageList: { chatId, threadId, type },
      text,
      entities,
      message: messageSnapshot,
    });

    resetComposer();
    restoreNewDraftAfterEditing();
  });

  const handleBlur = useLastCallback(() => {
    if (!editedMessage) return;
    const edited = parseHtmlAsFormattedText(getHtml());
    const update = edited.text.length ? edited : undefined;

    setEditingDraft({
      chatId, threadId, type, text: update,
    });
  });

  useBackgroundMode(handleBlur);
  useBeforeUnload(handleBlur);

  return [handleEditComplete, handleEditCancel, shouldForceShowEditing];
};

export default useEditing;

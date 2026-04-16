import type { ElementRef } from '../../../../lib/teact/teact';
import { useEffect, useState } from '../../../../lib/teact/teact';
import { getGlobal } from '../../../../global';

import type { ApiChatMember, ApiPeer, ApiUser } from '../../../../api/types';
import type { Signal } from '../../../../util/signals';
import { ApiMessageEntityTypes } from '../../../../api/types';

import { requestNextMutation } from '../../../../lib/fasterdom/fasterdom';
import { getMainUsername } from '../../../../global/helpers';
import { filterPeersByQuery, getPeerTitle } from '../../../../global/helpers/peers';
import focusEditableElement from '../../../../util/focusEditableElement';
import { pickTruthy, unique } from '../../../../util/iteratees';
import {
  getCaretPosition, getHtmlBeforeSelection, getPlainTextBeforeCaret, setCaretPosition,
} from '../../../../util/selection';
import { prepareForRegExp } from '../helpers/prepareForRegExp';

import { useThrottledResolver } from '../../../../hooks/useAsyncResolvers';
import useDerivedSignal from '../../../../hooks/useDerivedSignal';
import useFlag from '../../../../hooks/useFlag';
import useLang from '../../../../hooks/useLang';
import useLastCallback from '../../../../hooks/useLastCallback';
import { mergeMentionDebugSnapshot } from '../../../../util/mentionDebug';

const THROTTLE = 300;

let RE_USERNAME_SEARCH: RegExp;
try {
  RE_USERNAME_SEARCH = /(^|\s)@[-_\p{L}\p{M}\p{N}]*$/gui;
} catch (e) {
  // Support for older versions of Firefox
  RE_USERNAME_SEARCH = /(^|\s)@[-_\d\wа-яёґєії]*$/gi;
}

export default function useMentionTooltip(
  isEnabled: boolean,
  getHtml: Signal<string>,
  setHtml: (html: string) => void,
  getSelectionRange: Signal<Range | undefined>,
  inputRef: ElementRef<HTMLDivElement>,
  groupChatMembers?: ApiChatMember[],
  topInlineBotIds?: string[],
  currentUserId?: string,
) {
  const lang = useLang();
  const [filteredUsers, setFilteredUsers] = useState<ApiUser[] | undefined>();
  const [isManuallyClosed, markManuallyClosed, unmarkManuallyClosed] = useFlag(false);

  const extractUsernameTagThrottled = useThrottledResolver(() => {
    const html = getHtml();
    if (!isEnabled || !getSelectionRange()?.collapsed || !html.includes('@')) return undefined;

    const inputEl = inputRef.current;
    if (!inputEl) return undefined;

    const plainBefore = getPlainTextBeforeCaret(inputEl);
    const htmlBefore = getHtmlBeforeSelection(inputEl);
    let sourceForTag = plainBefore.length > 0 ? plainBefore : prepareForRegExp(htmlBefore);
    if (!sourceForTag && html.includes('@')) {
      const pos = getCaretPosition(inputEl);
      const text = (inputEl.innerText || '').replace(/\u00A0/g, ' ');
      sourceForTag = text.slice(0, pos);
    }
    const match = sourceForTag.match(RE_USERNAME_SEARCH);
    const tag = match?.[0]?.trim();
    mergeMentionDebugSnapshot('parseAtTag', {
      isEnabled,
      htmlLen: html.length,
      htmlHasAt: html.includes('@'),
      selectionCollapsed: getSelectionRange()?.collapsed ?? null,
      plainBeforeLen: plainBefore.length,
      htmlBeforeLen: htmlBefore.length,
      sourceForTagLen: sourceForTag.length,
      sourceForTagTail: sourceForTag.slice(Math.max(0, sourceForTag.length - 40)),
      parsedUsernameTag: tag ?? null,
    });
    return tag;
  }, [isEnabled, getHtml, getSelectionRange, inputRef], THROTTLE);

  const getUsernameTag = useDerivedSignal(
    extractUsernameTagThrottled, [extractUsernameTagThrottled, getHtml, getSelectionRange], true,
  );

  const getWithInlineBots = useDerivedSignal(() => {
    return isEnabled && getHtml().startsWith('@');
  }, [getHtml, isEnabled]);

  useEffect(() => {
    const usernameTag = getUsernameTag();

    if (!usernameTag || !(groupChatMembers || topInlineBotIds)) {
      mergeMentionDebugSnapshot('filterUsers', {
        earlyExit: true,
        reason: !usernameTag ? 'noUsernameTag' : 'noMembersAndNoInlineBots',
        usernameTag: usernameTag ?? null,
        groupChatMembersCount: groupChatMembers?.length ?? 0,
        topInlineBotIdsCount: topInlineBotIds?.length ?? 0,
      });
      setFilteredUsers(undefined);
      return;
    }

    // No need for expensive global updates on users, so we avoid them
    const usersById = getGlobal().users.byId;
    if (!usersById) {
      mergeMentionDebugSnapshot('filterUsers', { earlyExit: true, reason: 'noUsersById' });
      setFilteredUsers(undefined);
      return;
    }

    const memberIds = groupChatMembers?.reduce((acc: string[], member) => {
      if (member.userId !== currentUserId) {
        acc.push(member.userId);
      }

      return acc;
    }, []);

    const filter = usernameTag.substring(1);
    const candidateIds = unique([
      ...((getWithInlineBots() && topInlineBotIds) || []),
      ...(memberIds || []),
    ]);
    const filteredIds = filterPeersByQuery({
      ids: candidateIds,
      query: filter,
      type: 'user',
      chatMembers: groupChatMembers,
    });
    const picked = pickTruthy(usersById, filteredIds);
    const usersOut = Object.values(picked);

    const sampleMemberId = memberIds?.[0];
    const sampleResolved = sampleMemberId ? Boolean(usersById[sampleMemberId]) : null;
    const missingUserCount = filteredIds.filter((id) => !usersById[id]).length;

    mergeMentionDebugSnapshot('filterUsers', {
      earlyExit: false,
      filterQuery: filter,
      withInlineBotsPrefix: getWithInlineBots(),
      candidateIdsCount: candidateIds.length,
      filteredIdsCount: filteredIds.length,
      resolvedUsersCount: usersOut.length,
      missingUserInByIdAfterFilterCount: missingUserCount,
      sampleMemberId: sampleMemberId ?? null,
      sampleMemberResolvedInById: sampleResolved,
    });

    setFilteredUsers(usersOut);
  }, [currentUserId, groupChatMembers, topInlineBotIds, getUsernameTag, getWithInlineBots]);

  const insertMention = useLastCallback((
    peer: ApiPeer,
    forceFocus = false,
    insertAtEnd = false,
  ) => {
    if (!peer.hasUsername && !getPeerTitle(lang, peer)) {
      return;
    }

    const mainUsername = getMainUsername(peer);
    const userFirstOrLastName = getPeerTitle(lang, peer) || '';
    const htmlToInsert = mainUsername
      ? `@${mainUsername}`
      : `<a
          class="text-entity-link"
          data-entity-type="${ApiMessageEntityTypes.MentionName}"
          data-user-id="${peer.id}"
          contenteditable="false"
          dir="auto"
        >${userFirstOrLastName}</a>`;

    const inputEl = inputRef.current!;
    const htmlBeforeSelection = getHtmlBeforeSelection(inputEl);
    const fixedHtmlBeforeSelection = cleanWebkitNewLines(htmlBeforeSelection);
    const atIndex = insertAtEnd ? fixedHtmlBeforeSelection.length
      : fixedHtmlBeforeSelection.lastIndexOf('@');
    const shiftCaretPosition = (mainUsername ? mainUsername.length + 1 : userFirstOrLastName.length)
      - (fixedHtmlBeforeSelection.length - atIndex);

    if (atIndex !== -1) {
      const newHtml = `${fixedHtmlBeforeSelection.substr(0, atIndex)}${htmlToInsert}&nbsp;`;
      const htmlAfterSelection = cleanWebkitNewLines(inputEl.innerHTML).substring(fixedHtmlBeforeSelection.length);
      const caretPosition = getCaretPosition(inputEl);
      setHtml(`${newHtml}${htmlAfterSelection}`);

      requestNextMutation(() => {
        const newCaretPosition = caretPosition + shiftCaretPosition + 1;
        focusEditableElement(inputEl, forceFocus);
        if (newCaretPosition >= 0) {
          setCaretPosition(inputEl, newCaretPosition);
        }
      });
    }

    setFilteredUsers(undefined);
  });

  useEffect(unmarkManuallyClosed, [unmarkManuallyClosed, getHtml]);

  useEffect(() => {
    mergeMentionDebugSnapshot('tooltipUi', {
      filteredUsersCount: filteredUsers?.length ?? 0,
      isManuallyClosed,
      isMentionTooltipOpen: Boolean(filteredUsers?.length && !isManuallyClosed),
    });
  }, [filteredUsers, isManuallyClosed]);

  return {
    isMentionTooltipOpen: Boolean(filteredUsers?.length && !isManuallyClosed),
    closeMentionTooltip: markManuallyClosed,
    insertMention,
    mentionFilteredUsers: filteredUsers,
  };
}

// Webkit replaces the line break with the `<div><br /></div>` or `<div></div>` code.
// It is necessary to clean the html to a single form before processing.
function cleanWebkitNewLines(html: string) {
  return html.replace(/<div>(<br>|<br\s?\/>)?<\/div>/gi, '<br>');
}

import type { ApiChat, ApiChatMember, ApiPeer, ApiUser } from '../../api/types';
import type { OldLangFn } from '../../hooks/useOldLang';
import type { CustomPeer } from '../../types';

import { SERVICE_NOTIFICATIONS_USER_ID } from '../../config';
import { buildCollectionByKey } from '../../util/iteratees';
import { isUserId } from '../../util/entities/ids';
import { getTranslationFn, type LangFn } from '../../util/localization';
import { matchesFullNameFuzzy, prepareSearchWordsForNeedle } from '../../util/searchWords';
import { selectChat, selectPeer, selectUser } from '../selectors';
import { getGlobal } from '..';
import { getChatTitle } from './chats';
import { getUserFirstOrLastName, getUserFullName } from './users';

export function isApiPeerChat(peer: ApiPeer): peer is ApiChat {
  return 'title' in peer;
}

export function isApiPeerUser(peer: ApiPeer): peer is ApiUser {
  return !isApiPeerChat(peer);
}

function matchTextField(
  value: string | undefined,
  searchWords: (haystack: string) => boolean,
  query: string,
): boolean {
  if (!value) {
    return false;
  }
  return searchWords(value) || matchesFullNameFuzzy(value, query);
}

/** 按号码数字串匹配（忽略空格、+、横线等），仅当查询中含数字时参与匹配 */
function matchesPhoneNumberQuery(phoneNumber: string | undefined, query: string): boolean {
  if (!phoneNumber || !query) {
    return false;
  }
  const digitsPhone = phoneNumber.replace(/\D/g, '');
  const digitsQuery = query.replace(/\D/g, '');
  if (!digitsPhone || !digitsQuery) {
    return false;
  }
  return digitsPhone.includes(digitsQuery);
}

export function filterPeersByQuery({
  ids,
  query,
  type = 'peer',
  chatMembers,
}: {
  ids: string[];
  query: string | undefined;
  type?: 'chat' | 'user' | 'peer';
  /** 群成员时可传，用于按群内职务标题 customTitle 筛选 */
  chatMembers?: ApiChatMember[];
}) {
  if (!query) {
    return ids;
  }
  const global = getGlobal();
  const lang = getTranslationFn();

  const searchWords = prepareSearchWordsForNeedle(query);

  const selectorFn = type === 'chat' ? selectChat : type === 'user' ? selectUser : selectPeer;

  const memberByUserId = chatMembers?.length
    ? buildCollectionByKey(chatMembers, 'userId')
    : undefined;

  return ids.filter((id) => {
    const peer = selectorFn(global, id);
    if (!peer) {
      return false;
    }

    const localizedTitle = isApiPeerChat(peer)
      ? getChatTitle(lang, peer)
      : id === global.currentUserId ? lang('SavedMessages') : undefined;
    const isFoundInLocalized = localizedTitle ? searchWords(localizedTitle) : undefined;

    const name = getPeerFullTitle(lang, peer);
    const fullNameForUser = isApiPeerUser(peer) ? getUserFullName(peer) : undefined;
    const matchesFullName = fullNameForUser && query ? matchesFullNameFuzzy(fullNameForUser, query) : false;

    const user = isApiPeerUser(peer) ? peer : undefined;
    const customTitle = memberByUserId?.[id]?.customTitle;
    const collectibleEmojiTitle = user?.emojiStatus?.type === 'collectible'
      ? user.emojiStatus.title
      : undefined;

    const matchesUserNameFields = user && (
      matchTextField(user.firstName, searchWords, query)
      || matchTextField(user.lastName, searchWords, query)
    );
    const matchesUserTitleFields = user && (
      matchTextField(customTitle, searchWords, query)
      || matchTextField(user.botPlaceholder, searchWords, query)
      || matchTextField(collectibleEmojiTitle, searchWords, query)
    );

    const matchesChatTitleFuzzy = isApiPeerChat(peer) && peer.title && matchesFullNameFuzzy(peer.title, query);

    const matchesUsernameEntries = Boolean(peer.usernames?.find(({ username }) => (
      searchWords(username) || matchesFullNameFuzzy(username, query)
    )));

    return isFoundInLocalized
      || (name && searchWords(name))
      || matchesFullName
      || matchesUserNameFields
      || matchesUserTitleFields
      || matchesChatTitleFuzzy
      || (user && matchesPhoneNumberQuery(user.phoneNumber, query))
      || matchesUsernameEntries;
  });
}

export function getPeerTypeKey(peer: ApiPeer) {
  if (isApiPeerChat(peer)) {
    if (peer.type === 'chatTypeBasicGroup' || peer.type === 'chatTypeSuperGroup') {
      return 'ChatList.PeerTypeGroup';
    }

    if (peer.type === 'chatTypeChannel') {
      return 'ChatList.PeerTypeChannel';
    }

    if (peer.type === 'chatTypePrivate') {
      return 'ChatList.PeerTypeNonContact';
    }

    return undefined;
  }

  if (peer.id === SERVICE_NOTIFICATIONS_USER_ID) {
    return 'ServiceNotifications';
  }

  if (peer.isSupport) {
    return 'SupportStatus';
  }

  if (peer.type && peer.type === 'userTypeBot') {
    return 'ChatList.PeerTypeBot';
  }

  if (peer.isContact) {
    return 'ChatList.PeerTypeContact';
  }

  return 'ChatList.PeerTypeNonContactUser';
}

export function getPeerTitle(lang: OldLangFn | LangFn, peer: ApiPeer | CustomPeer) {
  if (!peer) return undefined;
  if ('isCustomPeer' in peer) {
    // TODO: Remove any after full migration to new lang
    return peer.titleKey ? lang(peer.titleKey as any) : peer.title;
  }
  return isApiPeerUser(peer) ? getUserFirstOrLastName(peer) : getChatTitle(lang, peer);
}

export function getPeerFullTitle(lang: OldLangFn | LangFn, peer: ApiPeer | CustomPeer) {
  if (!peer) return undefined;
  if ('isCustomPeer' in peer) {
    // TODO: Remove any after full migration to new lang
    return peer.titleKey ? lang(peer.titleKey as any) : peer.title;
  }
  return isApiPeerUser(peer) ? getUserFullName(peer) : getChatTitle(lang, peer);
}

export function getMessageSenderName(lang: LangFn, chatId: string, sender: ApiPeer) {
  // Hide sender name for private chats
  if (isUserId(chatId)) return undefined;

  if (isApiPeerChat(sender)) {
    if (chatId === sender.id) return undefined;

    return sender.title;
  }

  if (sender.isSelf) {
    return lang('FromYou');
  }

  return getPeerTitle(lang, sender);
}

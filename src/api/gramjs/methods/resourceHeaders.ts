import { Api as GramJs } from '../../../lib/gramjs';

import { toJSNumber } from '../../../util/numbers';
import localDb from '../localDb';

import { parseMediaUrl, type EntityType } from './media';

const JPEG_SIZE_TYPES = new Set(['s', 'm', 'x', 'y', 'w', 'a', 'b', 'c', 'd']);
const MP4_SIZES_TYPES = new Set(['u', 'v']);
const MEDIA_ENTITY_TYPES = new Set<EntityType>([
  'sticker', 'wallpaper', 'photo', 'webDocument', 'document',
]);

function headersFromResponse(res: Response): Record<string, string> {
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return headers;
}

async function fetchHttpResponseHeaders(url: string): Promise<Record<string, string> | undefined> {
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    if (res.ok) {
      return headersFromResponse(res);
    }
  } catch {
    /* CORS, network, or HEAD unsupported */
  }

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' },
      redirect: 'follow',
    });
    if (res.ok || res.status === 206) {
      return headersFromResponse(res);
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function buildHeadersFromTelegramMediaKey(mediaKey: string): Record<string, string> | undefined {
  const parsed = parseMediaUrl(mediaKey);
  if (!parsed) {
    return undefined;
  }

  if (parsed.mediaMatchType === 'staticMap') {
    return { 'content-type': 'image/png' };
  }

  const { entityType, entityId, sizeType } = parsed;

  let entity: (
    GramJs.User | GramJs.Chat | GramJs.Channel | GramJs.Photo |
    GramJs.Document | GramJs.StickerSet | GramJs.TypeWebDocument | undefined
  );

  switch (entityType) {
    case 'channel':
    case 'chat':
      entity = localDb.chats[entityId];
      break;
    case 'user':
      entity = localDb.users[entityId];
      break;
    case 'sticker':
    case 'wallpaper':
    case 'document':
      entity = localDb.documents[entityId];
      break;
    case 'photo':
      entity = localDb.photos[entityId];
      break;
    case 'stickerSet':
      entity = localDb.stickerSets[entityId];
      break;
    case 'webDocument':
      entity = localDb.webDocuments[entityId];
      break;
    default:
      entity = undefined;
  }

  if (!entity) {
    return undefined;
  }

  if (MEDIA_ENTITY_TYPES.has(entityType)) {
    let mimeType: string | undefined;
    let fullSize: number | undefined;

    if (sizeType && JPEG_SIZE_TYPES.has(sizeType)) {
      mimeType = 'image/jpeg';
    } else if (sizeType && MP4_SIZES_TYPES.has(sizeType)) {
      mimeType = 'video/mp4';
    } else if (entity instanceof GramJs.Photo) {
      mimeType = 'image/jpeg';
    } else if (entity instanceof GramJs.WebDocument || entity instanceof GramJs.WebDocumentNoProxy) {
      mimeType = entity.mimeType;
      fullSize = entity.size;
    } else if (entity instanceof GramJs.Document) {
      mimeType = entity.mimeType;
      fullSize = toJSNumber(entity.size);
    }

    if (mimeType) {
      mimeType = mimeType.replace(/html/gi, '');
    }

    const headers: Record<string, string> = {};
    if (mimeType) {
      headers['content-type'] = mimeType;
    }
    if (fullSize !== undefined) {
      headers['content-length'] = String(fullSize);
    }
    return Object.keys(headers).length ? headers : undefined;
  }

  if (entityType === 'stickerSet') {
    return { 'content-type': 'image/webp' };
  }

  if (entityType === 'channel' || entityType === 'chat' || entityType === 'user') {
    const peer = entity as GramJs.User | GramJs.Chat | GramJs.Channel;
    if (peer.photo instanceof GramJs.UserProfilePhoto || peer.photo instanceof GramJs.ChatPhoto) {
      return { 'content-type': 'image/jpeg' };
    }
  }

  return undefined;
}

export type FetchResourceHeadersResult =
  | { source: 'http'; url: string; headers: Record<string, string> }
  | { source: 'local'; mediaKey: string; headers: Record<string, string> };

/**
 * 根据 URL 或 Telegram Web A 内部媒体 key（与 mediaLoader / downloadMedia 相同格式）获取资源头信息。
 * - http(s)：对远端执行 HEAD，失败时再尝试 Range GET。
 * - 内部 key：仅从 localDb 元数据构造 content-type / content-length（不发起 MTProto 下载）。
 */
export async function fetchResourceHeaders(urlOrMediaKey: string): Promise<FetchResourceHeadersResult | undefined> {
  const trimmed = urlOrMediaKey.trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    const headers = await fetchHttpResponseHeaders(trimmed);
    if (!headers || !Object.keys(headers).length) {
      return undefined;
    }
    return { source: 'http', url: trimmed, headers };
  }

  const localHeaders = buildHeadersFromTelegramMediaKey(trimmed);
  if (!localHeaders || !Object.keys(localHeaders).length) {
    return undefined;
  }

  return { source: 'local', mediaKey: trimmed, headers: localHeaders };
}

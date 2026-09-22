export function encodeWorldStateChatKeyPart(value) {
  return encodeURIComponent(String(value ?? '').trim());
}

export function characterOwnerId(ctx = {}) {
  const characterId = ctx?.characterId;
  if (characterId === undefined || characterId === null) return '';
  const avatar = ctx?.characters?.[characterId]?.avatar;
  if (typeof avatar === 'string' && avatar.trim()) return avatar.trim();
  const fallback = ctx?.character?.avatar;
  return typeof fallback === 'string' ? fallback.trim() : '';
}

export function buildWorldStateChatKey(kind, ownerId, chatId) {
  const prefix = kind === 'group' ? 'group' : (kind === 'chat' ? 'chat' : '');
  const owner = String(ownerId ?? '').trim();
  const chat = String(chatId ?? '').replace(/\.jsonl$/i, '').trim();
  if (!prefix || !owner || !chat) return '';
  return `${prefix}:${encodeWorldStateChatKeyPart(owner)}:${encodeWorldStateChatKeyPart(chat)}`;
}

export function parseWorldStateChatKey(key) {
  const raw = String(key || '');
  const first = raw.indexOf(':');
  const second = first >= 0 ? raw.indexOf(':', first + 1) : -1;
  if (first <= 0 || second <= first + 1) return null;
  const kind = raw.slice(0, first);
  if (kind !== 'chat' && kind !== 'group') return null;
  try {
    const ownerId = decodeURIComponent(raw.slice(first + 1, second));
    const chatId = decodeURIComponent(raw.slice(second + 1));
    if (!ownerId || !chatId) return null;
    return { key: raw, kind, ownerId, chatId };
  } catch {
    return null;
  }
}

export function getWorldStateChatIdentity(ctx = {}) {
  const rawChatId = ctx?.chatId || ctx?.getCurrentChatId?.() || '';
  const chatId = String(rawChatId || '').replace(/\.jsonl$/i, '').trim();
  const hasGroup = ctx?.groupId !== undefined && ctx?.groupId !== null && String(ctx.groupId).trim() !== '';

  if (hasGroup) {
    const ownerId = String(ctx.groupId).trim();
    if (!chatId) return { key: 'no-chat', kind: 'group', ownerId, chatId: '', ready: false };
    return {
      key: buildWorldStateChatKey('group', ownerId, chatId),
      kind: 'group',
      ownerId,
      chatId,
      ready: true,
    };
  }

  const ownerId = characterOwnerId(ctx);
  if (!chatId || !ownerId) {
    return {
      key: 'no-chat',
      kind: 'chat',
      ownerId,
      chatId,
      ready: false,
    };
  }

  return {
    key: buildWorldStateChatKey('chat', ownerId, chatId),
    kind: 'chat',
    ownerId,
    chatId,
    ready: true,
  };
}

export function getWorldStateChatKey(ctx = {}) {
  return getWorldStateChatIdentity(ctx).key;
}

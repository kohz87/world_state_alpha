const NON_CANONICAL_ASSISTANT_BLOCKS = Object.freeze([
  'writer_state',
  'NPC_Inner_Chatter',
  'CYOA',
  'Skill_Mastery',
  'Inventory',
  'Planted_Seeds',
  'Consequence_Timers',
  'Arc_Phase',
  'Scene_Phase',
]);

function stripTaggedBlock(text, tagName) {
  const escaped = String(tagName).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const pattern = new RegExp(
    '<' + escaped + '(?:\\s+[^>]*)?>[\\s\\S]*?(?:<\\/' + escaped + '>|$)',
    'gi',
  );
  return text.replace(pattern, '');
}

export function sanitizeAssistantNarration(text) {
  if (typeof text !== 'string') return '';
  let sanitized = text;
  for (const tagName of NON_CANONICAL_ASSISTANT_BLOCKS) {
    sanitized = stripTaggedBlock(sanitized, tagName);
  }
  sanitized = sanitized.replace(/<!--\s*INVENTORY_BLOCK[\s\S]*?(?:-->|$)/gi, '');
  return sanitized.trim();
}

export function sanitizeExchangeMessage(message) {
  if (!message || typeof message !== 'object') return message;
  const role = message.role === 'user' || message.is_user === true ? 'user' : 'assistant';
  if (role === 'user') return message;

  const rawContent = typeof message.content === 'string'
    ? message.content
    : (typeof message.mes === 'string' ? message.mes : (typeof message.text === 'string' ? message.text : ''));

  const sanitized = sanitizeAssistantNarration(rawContent);

  return {
    ...message,
    content: sanitized,
    ...(typeof message.mes === 'string' ? { mes: sanitized } : {}),
  };
}

export function containsWriterState(text) {
  if (typeof text !== 'string') return false;
  return /<writer_state(?:\s+[^>]*)?>[\s\S]*?(?:<\/writer_state>|$)/i.test(text);
}

export function extractWriterStateBlocks(text) {
  if (typeof text !== 'string') return [];
  const matches = text.match(/<writer_state(?:\s+[^>]*)?>[\s\S]*?(?:<\/writer_state>|$)/gi);
  return matches || [];
}

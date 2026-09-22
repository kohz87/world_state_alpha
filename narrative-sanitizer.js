export function sanitizeAssistantNarration(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/<writer_state(?:\s+[^>]*)?>[\s\S]*?(?:<\/writer_state>|$)/gi, '').trim();
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

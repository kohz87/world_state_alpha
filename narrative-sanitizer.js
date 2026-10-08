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
  // Model reasoning is never narration.
  'think',
  'thinking',
  'reasoning',
]);

// Planning sections of a World_State block (seeds, timers, phases, options, inner chatter, inventory and
// skills) are never evidence; its Off-Screen and Unresolved entries stay (capture may read them as hints).
const WORLD_STATE_PLANNING_SECTION = /^[^\p{L}\p{N}]*(?:planted[ _]seeds?|consequence[ _]timers?|arc[ _]phase|scene[ _]phase|cyoa|npc[ _]inner[ _]chatter|inner[ _]chatter|skill[ _]mastery|inventory)\b[^:\n]{0,40}:/iu;
const WORLD_STATE_SECTION = /^\s*(?:[-*•+]\s+\*\*[^*\n]{1,80}?:\s*\*\*|[^-*•+\s][^:\n]{1,80}:)/u;

function stripTaggedBlock(text, tagName) {
  const escaped = String(tagName).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  // A self-closing tag (<writer_state mode="x" />) has no block: remove the tag alone, or the opening-tag
  // pattern below would read it as a block left open and strip the whole reply after it.
  text = text.replace(new RegExp('<' + escaped + '(?:\\s[^>]*)?\\/>', 'gi'), '');
  // A closing tag may carry spaces before its '>' (</writer_state >).
  const pattern = new RegExp(
    '<' + escaped + '(?:\\s+[^>]*)?>[\\s\\S]*?(?:<\\/' + escaped + '\\s*>|$)',
    'gi',
  );
  return text.replace(pattern, '');
}

function stripWorldStatePlanning(text) {
  return text.replace(/(<World_State(?:\s+[^>]*)?>)([\s\S]*?)(<\/World_State\s*>|$)/gi, (_, open, body, close) => {
    let planning = false;
    const kept = [];
    for (const line of body.split(/(?<=\n)/u)) {
      const bare = line.replace(/\*\*/gu, '');
      if (WORLD_STATE_PLANNING_SECTION.test(bare)) {
        planning = true;
        continue;
      }
      if (planning && (/^\s*---+\s*$/u.test(line) || WORLD_STATE_SECTION.test(line))) planning = false;
      if (!planning) kept.push(line);
    }
    return open + kept.join('') + close;
  });
}

export function sanitizeAssistantNarration(text) {
  if (typeof text !== 'string') return '';
  let sanitized = text;
  for (const tagName of NON_CANONICAL_ASSISTANT_BLOCKS) {
    sanitized = stripTaggedBlock(sanitized, tagName);
  }
  // Reasoning whose opening tag was in the prompt prefill ends at a lone closing tag.
  sanitized = sanitized.replace(/^[\s\S]*<\/(?:think|thinking|reasoning)\s*>/i, '');
  sanitized = sanitized.replace(/<!--\s*INVENTORY_BLOCK[\s\S]*?(?:-->|$)/gi, '');
  sanitized = stripWorldStatePlanning(sanitized);
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
  return /<writer_state(?:\s+[^>]*)?>[\s\S]*?(?:<\/writer_state\s*>|$)/i.test(text);
}

export function extractWriterStateBlocks(text) {
  if (typeof text !== 'string') return [];
  const matches = text.match(/<writer_state(?:\s+[^>]*)?>[\s\S]*?(?:<\/writer_state\s*>|$)/gi);
  return matches || [];
}

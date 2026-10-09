import { hostMessageText } from './common.js';

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
// A section heading: a bold bullet label, or a non-entry line ending its label with a colon. Numbered lines
// ("1. Duke: ...") are entries like bullets.
// Every bullet style the checklist reader accepts (- * + • ‣ ◦ ▪ ●) is an entry, never a heading.
const WORLD_STATE_SECTION = /^\s*(?:[-*•+‣◦▪●]\s+\*\*[^*\n]{1,80}?:\s*\*\*|(?![-*•+‣◦▪●]|\d+[.)]\s)[^\s][^:\n]{1,80}:)/u;

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
      // A bold heading ("**Off-Screen:**") ends the section like a plain one.
      if (planning && (/^\s*---+\s*$/u.test(line) || WORLD_STATE_SECTION.test(line) || WORLD_STATE_SECTION.test(bare))) planning = false;
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
  // Reasoning whose opening tag was in the prompt prefill ends at a lone closing tag: the last one that
  // narration follows, so a stray closing tag after the narration is dropped on its own. A reply that ends at
  // its only closing tag is reasoning with no narration (planning never becomes evidence).
  const lone = /<\/(?:think|thinking|reasoning)\s*>/gi;
  const closings = [...sanitized.matchAll(lone)];
  if (closings.length) {
    const end = [...closings].reverse().find(match => sanitized.slice(match.index + match[0].length).replace(lone, '').trim())
      || closings[closings.length - 1];
    sanitized = sanitized.slice(end.index + end[0].length).replace(lone, '');
  }
  sanitized = sanitized.replace(/<!--\s*INVENTORY_BLOCK[\s\S]*?(?:-->|$)/gi, '');
  sanitized = stripWorldStatePlanning(sanitized);
  return sanitized.trim();
}

export function sanitizeExchangeMessage(message) {
  if (!message || typeof message !== 'object') return message;
  const role = message.role === 'user' || message.is_user === true ? 'user' : 'assistant';
  if (role === 'user') return message;

  // A host row's `mes` first, as lineage reads it; a normalized row has only `content`.
  const rawContent = hostMessageText(message);

  const sanitized = sanitizeAssistantNarration(rawContent);

  return {
    ...message,
    content: sanitized,
    ...(typeof message.mes === 'string' ? { mes: sanitized } : {}),
  };
}

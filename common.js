import { withoutSplitSurrogate } from './hash.js';

// Small helpers shared by the runtime modules. Each lives here once so separate copies cannot drift apart.

export function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

// Idempotent: a value cut right after a space, or between the halves of an astral character, is tidied, so
// bounding it again (each normalization does) changes nothing.
export function boundedText(value, max) {
  return typeof value === 'string' ? withoutSplitSurrogate(value.trim().slice(0, max)).trim() : '';
}

// Distinct non-empty bounded strings, in order. `bound` bounds each item (boundedText unless a module needs
// its own rule).
export function uniqueStrings(value, maxItems, maxChars = 120, bound = boundedText) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const text = bound(item, maxChars);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

// Code-unit order: the same on every device (localeCompare depends on the device's locale and ICU data).
export function compareText(left, right) {
  const a = String(left ?? '');
  const b = String(right ?? '');
  return a < b ? -1 : a > b ? 1 : 0;
}

// The text of a chat row: a normalized row's `content`, a host message's `mes`, or `text`.
export function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.mes === 'string') return message.mes;
  if (typeof message?.text === 'string') return message.text;
  return '';
}

// The text of a SillyTavern host message: its `mes` first (a stale `content` another extension left behind is
// never read before it), then `content` or `text`.
export function hostMessageText(message) {
  if (typeof message?.mes === 'string') return message.mes;
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.text === 'string') return message.text;
  return '';
}

// The conversational role of a chat row. A row that is neither user nor assistant is system.
export function messageRole(message) {
  if (message?.role === 'user' || message?.is_user === true) return 'user';
  if (message?.role === 'assistant' || (message?.is_user === false && message?.is_system !== true)) return 'assistant';
  return 'system';
}

// Keeps a long text's start and end around a marker, within `max` characters. A limit too small for the
// marker keeps a plain prefix.
export function clipMiddle(value, max, headShare = 0.55) {
  const text = String(value ?? '').trim();
  if (!(max > 0)) return '';
  if (text.length <= max) return text;
  if (max < 80) return text.slice(0, max);
  const head = Math.floor(max * headShare);
  const tail = max - head - 24;
  return `${text.slice(0, head)}\n...[bounded]...\n${text.slice(-tail)}`;
}

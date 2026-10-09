import { stableStringify, withoutSplitSurrogate } from './hash.js';

// Small helpers shared by the runtime modules. Each lives here once so separate copies cannot drift apart.

export function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

// The entry a plain-object map holds under `key` itself, never one inherited from Object.prototype
// ("constructor", "toString"): evidence maps are plain objects keyed by ids that come from saved data.
export function ownEntry(map, key) {
  return map && typeof map === 'object' && Object.hasOwn(map, key) ? map[key] : undefined;
}

// An id that cannot key a plain-object map: assigning "__proto__" changes the map's prototype instead of
// storing an entry.
export function reservedMapKey(id) {
  return id === '__proto__';
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

// An integer within [min, max], or `fallback` when the value is not a number.
export function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

// One line of text: every run of whitespace is one space.
export function singleLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

// A token budget: an unset value (null, undefined, '') , a non-number or a value below one token is
// `fallback` (never Number(null) = 0 or 1 token, which would turn injection off); otherwise an integer up to
// 2400.
export function tokenBudget(value, fallback) {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return fallback;
  return Math.min(2400, Math.trunc(number));
}

// Inverted-index postings: key -> Set of ids (an empty set is removed).
export function addPosting(map, key, id) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(id);
}

export function deletePosting(map, key, id) {
  const posting = map.get(key);
  if (!posting) return;
  posting.delete(id);
  if (!posting.size) map.delete(key);
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

// The role of a SillyTavern host row as the conversation shows it: a hidden row carries is_system even when
// is_user is true, and counts as system; any other row that is not the user's is a reply (a row an import or
// another extension left without is_user included).
export function visibleRole(message) {
  if (message?.is_system || message?.role === 'system') return 'system';
  if (message?.is_user || message?.role === 'user') return 'user';
  return 'assistant';
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

// Keyed undo of a list of entries with ids (records, evidence, links, places, relations, routes), shared by
// the Reality and Places cores.
function keyedBy(items) {
  return new Map(items.map(item => [item.id, item]));
}

// A removed entry also records where it stood (`at`), so undoing the removal puts it back in place: list
// order is part of the state a checkpoint is compared with.
export function keyedUndo(beforeItems, afterItems) {
  const before = keyedBy(beforeItems);
  const after = keyedBy(afterItems);
  const positions = new Map(beforeItems.map((item, index) => [item.id, index]));
  const ids = new Set([...before.keys(), ...after.keys()]);
  const out = [];
  for (const id of ids) {
    const left = before.get(id) ?? null;
    const right = after.get(id) ?? null;
    if (left && !right) {
      out.push({ id, before: clone(left), at: positions.get(id) });
      continue;
    }
    // An entry shared by both sides (frozen history, an untouched pass) is unchanged without serializing it.
    if (left !== right && stableStringify(left) !== stableStringify(right)) out.push({ id, before: left ? clone(left) : null });
  }
  return out;
}

export function restoreKeyed(items, changes) {
  const map = keyedBy(items);
  const reinserted = [];
  for (const change of changes || []) {
    if (change.before === null) map.delete(change.id);
    else if (!map.has(change.id) && Number.isInteger(change.at)) reinserted.push(change);
    else map.set(change.id, clone(change.before));
  }
  const out = [...map.values()];
  // Ascending, so each lands where it stood before the removal (older patches without `at` append).
  for (const change of reinserted.sort((left, right) => left.at - right.at)) {
    out.splice(Math.min(change.at, out.length), 0, clone(change.before));
  }
  return out;
}

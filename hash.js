// The one text canonicalization shared by grounding, duplicates, relevance and Places: NFKC, lower case,
// every run of non-letters/digits a single space.
export function canonicalText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    // Locale-independent: under a Turkish locale toLocaleLowerCase turns 'I' into a dotless 'ı', so the same
    // text would match differently on different devices.
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Scripts written without spaces between words (Chinese, Japanese, Thai, ...): one canonical "word" there is
// a whole phrase, so word overlap is measured on adjacent character pairs instead.
export const SPACELESS_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
const SPACELESS_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}ー]{2,}/gu;

export function spacelessBigrams(value) {
  const out = new Set();
  for (const [run] of canonicalText(value).matchAll(SPACELESS_RUN)) {
    const chars = [...run];
    for (let index = 0; index + 1 < chars.length; index += 1) out.add(chars[index] + chars[index + 1]);
  }
  return out;
}

// Shared character pairs of two spaceless-script texts, at least one with an ideograph or katakana (kana-only
// pairs are mostly particles and endings).
export function sharedSpacelessBigrams(left, right) {
  const a = spacelessBigrams(left);
  if (!a.size) return 0;
  const b = spacelessBigrams(right);
  let shared = 0;
  let content = false;
  for (const pair of a) {
    if (!b.has(pair)) continue;
    shared += 1;
    if (/[\p{Script=Han}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u.test(pair)) content = true;
  }
  return content ? shared : 0;
}

// An excerpt longer than `max` is cut at the last word boundary inside it, never mid-word: excerpts are
// matched on word boundaries, so a cut word would no longer be found in its source.
export function boundedExcerpt(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length <= max) return text;
  const cut = withoutSplitSurrogate(text.slice(0, max));
  const next = text.slice(cut.length).match(/^[\s\S]/u)?.[0] || '';
  if (!/[\p{L}\p{N}]/u.test(next) || !/[\p{L}\p{N}]$/u.test(cut)) return cut.trim();
  const space = cut.search(/\s\S*$/u);
  return (space > max / 2 ? cut.slice(0, space) : cut).trim();
}

// A cut that ends between the two halves of an astral character (an emoji, a rare ideograph) drops the half:
// a lone surrogate is not text, and an excerpt ending in one never matches its source.
export function withoutSplitSurrogate(text) {
  const last = text.charCodeAt(text.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? text.slice(0, -1) : text;
}

function fnv1a32(text, seed) {
  let hash = seed >>> 0;
  const source = String(text ?? '');
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export function hashText(value) {
  const text = String(value ?? '');
  const a = fnv1a32(text, 0x811c9dc5).toString(16).padStart(8, '0');
  const b = fnv1a32(text, 0x9e3779b9).toString(16).padStart(8, '0');
  return `${a}${b}`;
}

// Like JSON.stringify with sorted keys, including its handling of values JSON cannot hold: an undefined (or
// function) member is left out of an object and written as null in an array. A checksum taken here must
// still match after the text has been through JSON.
function jsonOmits(value) {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (typeof value.toJSON === 'function') return stableStringify(value.toJSON());
  if (Array.isArray(value)) return `[${value.map(item => (jsonOmits(item) ? 'null' : stableStringify(item))).join(',')}]`;
  const keys = Object.keys(value).filter(key => !jsonOmits(value[key])).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function deterministicId(prefix, parts) {
  return `${prefix}_${hashText(parts.map(part => String(part ?? '')).join('|'))}`;
}

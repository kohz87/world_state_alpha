// The one text canonicalization shared by grounding, duplicates, relevance and Places: NFKC, lower case,
// every run of non-letters/digits a single space.
export function canonicalText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
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
  const cut = text.slice(0, max);
  if (!/[\p{L}\p{N}]/u.test(text[max]) || !/[\p{L}\p{N}]$/u.test(cut)) return cut.trim();
  const space = cut.search(/\s\S*$/u);
  return (space > max / 2 ? cut.slice(0, space) : cut).trim();
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

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function deterministicId(prefix, parts) {
  return `${prefix}_${hashText(parts.map(part => String(part ?? '')).join('|'))}`;
}

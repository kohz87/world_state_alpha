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

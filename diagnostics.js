import { hashText } from './hash.js';

const DEFAULT_LIMIT = 80;

function clean(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function int(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function sanitizeCaptureDiagnostic(raw = {}) {
  return {
    operationId: clean(raw.operationId, 120),
    label: clean(raw.label, 48),
    at: int(raw.at, Date.now()),
    sourceMessageId: Number.isInteger(raw.sourceMessageId) ? raw.sourceMessageId : null,
    outcome: clean(raw.outcome, 48),
    code: clean(raw.code, 80),
    detail: clean(raw.detail, 320),
    route: clean(raw.route, 24),
    profileId: clean(raw.profileId, 120),
    providerCalls: int(raw.providerCalls),
    proposed: int(raw.proposed),
    accepted: int(raw.accepted),
    applied: int(raw.applied),
    rejected: int(raw.rejected),
    aliasRepairs: int(raw.aliasRepairs),
    completenessHints: int(raw.completenessHints),
    processedBoundaries: int(raw.processedBoundaries),
    totalBoundaries: int(raw.totalBoundaries),
    hiddenMessagesIncluded: int(raw.hiddenMessagesIncluded),
    hiddenAssistantBoundaries: int(raw.hiddenAssistantBoundaries),
    candidateRecords: int(raw.candidateRecords),
    promptChars: int(raw.promptChars),
    responseChars: int(raw.responseChars),
    durationMs: int(raw.durationMs),
    responseJson: clean(raw.responseJson, 16000),
    rejectionsJson: clean(raw.rejectionsJson, 12000),
  };
}

function operationKey(row) {
  return [row.at, row.operationId, row.label, row.outcome, row.code, row.sourceMessageId].join('|');
}

// Merge sanitized operation rows (for example a persisted log and this
// session's rows) into one chronological, de-duplicated, bounded list.
export function mergeOperationRows(left = [], right = [], limit = DEFAULT_LIMIT) {
  const byKey = new Map();
  for (const raw of [...(Array.isArray(left) ? left : []), ...(Array.isArray(right) ? right : [])]) {
    if (!raw || typeof raw !== 'object') continue;
    const row = sanitizeCaptureDiagnostic(raw);
    byKey.set(operationKey(row), row);
  }
  const rows = [...byKey.values()].sort((a, b) => a.at - b.at);
  const max = Math.max(1, int(limit, DEFAULT_LIMIT));
  return rows.slice(-max);
}

export function createDiagnosticStore({ limit = DEFAULT_LIMIT, now = () => Date.now(), onRecord = null } = {}) {
  const max = Math.max(8, Math.min(128, int(limit, DEFAULT_LIMIT)));
  const byChat = new Map();

  function record(chatKey, raw = {}) {
    const key = clean(chatKey, 500);
    if (!key) return null;
    const rows = byChat.get(key) || [];
    const value = sanitizeCaptureDiagnostic({ ...raw, at: raw.at ?? now() });
    rows.push(value);
    if (rows.length > max) rows.splice(0, rows.length - max);
    byChat.set(key, rows);
    if (typeof onRecord === 'function') {
      try { onRecord(key); } catch { /* persistence hooks never break telemetry */ }
    }
    return clone(value);
  }

  // Adds rows restored from a persisted log without re-triggering onRecord.
  function merge(chatKey, restored = []) {
    const key = clean(chatKey, 500);
    if (!key) return 0;
    const rows = mergeOperationRows(restored, byChat.get(key) || [], max);
    byChat.set(key, rows);
    return rows.length;
  }

  function records(chatKey, requested = max) {
    const rows = byChat.get(clean(chatKey, 500)) || [];
    return clone(rows.slice(-Math.max(1, Math.min(max, int(requested, max)))));
  }

  function clear(chatKey) {
    const key = clean(chatKey, 500);
    const count = byChat.get(key)?.length || 0;
    byChat.delete(key);
    return count;
  }

  function bundle(chatKey, applicationVersion = '') {
    const key = clean(chatKey, 500);
    return {
      diagnosticVersion: 1,
      applicationVersion: clean(applicationVersion, 40),
      chatIdentityHash: hashText(key),
      privacy: 'Allowlisted ephemeral operation telemetry plus bounded model response JSON only; no prompts, headers, reasoning content, credentials, or canonical authority.',
      operations: records(key),
    };
  }

  return Object.freeze({ record, records, merge, clear, bundle });
}

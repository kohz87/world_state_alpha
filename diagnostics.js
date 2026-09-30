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
    lineageKey: clean(raw.lineageKey, 80),
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
  return trimOperationRows(rows, Math.max(1, int(limit, DEFAULT_LIMIT)));
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
    byChat.set(key, rows.length > max ? trimOperationRows(rows, max) : rows);
    if (typeof onRecord === 'function') {
      try { onRecord(key, recoveryView(value)); } catch { /* persistence hooks never break telemetry */ }
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

  // The few fields missed-capture detection reads, without copying response JSON.
  function recoveryRows(chatKey) {
    return (byChat.get(clean(chatKey, 500)) || []).map(recoveryView);
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

  return Object.freeze({ record, records, recoveryRows, merge, clear, bundle });
}

// A rebuild operation id is `rebuild:<sourceMessageId>:<epoch>:<startMessageId>[:resume-…]`.
export function rebuildStartFromOperationId(operationId) {
  const match = /^rebuild:\d+:\d+:(\d+)(?::|$)/.exec(String(operationId || ''));
  return match ? Number(match[1]) : null;
}

const CAPTURE_SETTLED = new Set(['applied', 'no-change']);
const CAPTURE_NOT_ATTEMPTED = new Set(['stale', 'skipped']);
const PINNED_FAILURES = 40;

function recoveryView(row) {
  return {
    label: row?.label || '',
    outcome: row?.outcome || '',
    at: int(row?.at),
    sourceMessageId: Number.isInteger(row?.sourceMessageId) ? row.sourceMessageId : null,
    lineageKey: row?.lineageKey || '',
    operationId: row?.operationId || '',
  };
}

function isCaptureFailure(row) {
  return row.label === 'capture' && Number.isInteger(row.sourceMessageId)
    && !CAPTURE_SETTLED.has(row.outcome) && !CAPTURE_NOT_ATTEMPTED.has(row.outcome);
}

function isCaptureRecovery(row) {
  return (row.label === 'capture' && Number.isInteger(row.sourceMessageId) && CAPTURE_SETTLED.has(row.outcome))
    || (row.label === 'rebuild' && row.outcome === 'rebuild-completed')
    || ((row.label === 'import' || row.label === 'reset') && row.outcome === 'applied');
}

// Rows that change what unrecoveredCaptureFailures reports. The host saves a
// failure at once, and a recovery at once only while a failure is listed, so a
// reload cannot lose either without adding a write to every ordinary turn.
export function affectsCaptureRecovery(row, { failuresListed = false } = {}) {
  if (!row || typeof row !== 'object') return false;
  if (isCaptureFailure(row)) return true;
  return failuresListed && isCaptureRecovery(row);
}

// Walks the log in time order. A failure is identified by message and the
// message's lineage key (so another swipe's capture does not clear it), and is
// cleared by a later successful capture of the same message and lineage, a
// completed rebuild whose start covers it (a rebuild also drops parked
// branches), or an import/reset that replaced the state. Returns the latest
// row of each unrecovered failure.
function unrecoveredFailureRows(rows = []) {
  const failed = new Map();
  const ordered = (Array.isArray(rows) ? rows : [])
    .filter(row => row && typeof row === 'object')
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (int(a.row.at) - int(b.row.at)) || (a.index - b.index))
    .map(item => item.row);
  for (const row of ordered) {
    if (isCaptureFailure(row)) {
      failed.set(row.sourceMessageId + '\u0001' + (row.lineageKey || ''), row);
    } else if (row.label === 'capture' && Number.isInteger(row.sourceMessageId) && CAPTURE_SETTLED.has(row.outcome)) {
      for (const [key, failure] of [...failed]) {
        if (failure.sourceMessageId !== row.sourceMessageId) continue;
        // Rows from before lineage was recorded match any lineage.
        if (!failure.lineageKey || !row.lineageKey || failure.lineageKey === row.lineageKey) failed.delete(key);
      }
    } else if (row.label === 'rebuild' && row.outcome === 'rebuild-completed') {
      const start = rebuildStartFromOperationId(row.operationId);
      if (start === null) continue;
      for (const [key, failure] of [...failed]) if (failure.sourceMessageId >= start) failed.delete(key);
    } else if ((row.label === 'import' || row.label === 'reset') && row.outcome === 'applied') {
      failed.clear();
    }
  }
  return [...failed.values()];
}

// Failed live captures nothing has recovered: [{ messageId, lineageKey }], by message.
// Derived only from the non-canonical Operations log; it never changes World State.
export function unrecoveredCaptureFailures(rows = []) {
  return unrecoveredFailureRows(rows)
    .map(row => ({ messageId: row.sourceMessageId, lineageKey: row.lineageKey || '' }))
    .sort((a, b) => (a.messageId - b.messageId) || (a.lineageKey < b.lineageKey ? -1 : a.lineageKey > b.lineageKey ? 1 : 0));
}

// Bounds the log to `max` rows, oldest first out, but never drops the row that
// records a still-unrecovered capture failure (up to PINNED_FAILURES of them),
// so a long rebuild or a busy session cannot silently erase a missed capture.
export function trimOperationRows(rows = [], max = DEFAULT_LIMIT) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length <= max) return list.slice();
  const pinned = new Set(unrecoveredFailureRows(list)
    .sort((a, b) => int(b.at) - int(a.at))
    .slice(0, Math.min(PINNED_FAILURES, Math.max(0, max - 1))));
  let drop = list.length - max;
  return list.filter(row => {
    if (drop > 0 && !pinned.has(row)) {
      drop -= 1;
      return false;
    }
    return true;
  });
}

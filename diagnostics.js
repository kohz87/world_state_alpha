import { clone } from './common.js';
import { hashText } from './hash.js';

const DEFAULT_LIMIT = 80;

function clean(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function int(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : fallback;
}

export function sanitizeCaptureDiagnostic(raw = {}) {
  return {
    operationId: clean(raw.operationId, 120),
    label: clean(raw.label, 48),
    at: int(raw.at, Date.now()),
    sourceMessageId: Number.isInteger(raw.sourceMessageId) ? raw.sourceMessageId : null,
    lineageKey: clean(raw.lineageKey, 80),
    contentLineageKey: clean(raw.contentLineageKey, 80),
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
    // When a host rewrite moved the row to new message keys: that version wins every later merge.
    ...(int(raw.relinkedAt) > 0 ? { relinkedAt: int(raw.relinkedAt) } : {}),
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
    const key = operationKey(row);
    // A row moved to new message keys (a rename) is never put back by another session's older copy.
    if ((byKey.get(key)?.relinkedAt || 0) > (row.relinkedAt || 0)) continue;
    byKey.set(key, row);
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
    // Whether a failure was listed before this row, judged before the trim below can drop the failure it
    // clears: the host saves such a recovery at once.
    const failuresListed = typeof onRecord === 'function' && isCaptureRecovery(value)
      ? unrecoveredFailureLists(rows.map(recoveryView)).length > 0
      : false;
    rows.push(value);
    byChat.set(key, rows.length > max ? trimOperationRows(rows, max) : rows);
    if (typeof onRecord === 'function') {
      try { onRecord(key, recoveryView(value), { failuresListed }); } catch { /* persistence hooks never break telemetry */ }
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

  // The newest rows, for display.
  function records(chatKey, requested = max) {
    const rows = byChat.get(clean(chatKey, 500)) || [];
    return clone(rows.slice(-Math.max(1, Math.min(max, int(requested, max)))));
  }

  // Every kept row, the pinned unrecovered failures beyond the display limit included: what is saved.
  function allRecords(chatKey) {
    return clone(byChat.get(clean(chatKey, 500)) || []);
  }

  // The kept rows as they are now, without copying them: rows are never edited in place (recording appends,
  // relinking and trimming replace a row), and whoever saves them sanitizes a copy.
  function rowsSnapshot(chatKey) {
    return (byChat.get(clean(chatKey, 500)) || []).slice();
  }

  // The few fields missed-capture detection reads, without copying response JSON.
  function recoveryRows(chatKey) {
    return (byChat.get(clean(chatKey, 500)) || []).map(recoveryView);
  }

  // Rows keyed to message versions a host rewrite renamed (a character rename rewrites message names) move to
  // the new keys, so a missed capture stays listed and clearable. Returns how many rows changed.
  function relink(chatKey, keyMap) {
    const rows = byChat.get(clean(chatKey, 500));
    if (!rows || !(keyMap instanceof Map) || !keyMap.size) return 0;
    let changed = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const lineageKey = row.lineageKey && keyMap.get(row.lineageKey);
      const contentKey = row.contentLineageKey && keyMap.get(row.contentLineageKey);
      if (!lineageKey && !contentKey) continue;
      rows[index] = { ...row, ...(lineageKey ? { lineageKey } : {}), ...(contentKey ? { contentLineageKey: contentKey } : {}), relinkedAt: now() };
      changed += 1;
    }
    return changed;
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

  return Object.freeze({ record, records, allRecords, rowsSnapshot, recoveryRows, merge, relink, clear, bundle });
}

// A rebuild operation id is `rebuild:<sourceMessageId>:<epoch>:<startMessageId>[:resume-…]`.
export function rebuildStartFromOperationId(operationId) {
  const match = /^rebuild:\d+:\d+:(\d+)(?::|$)/.exec(String(operationId || ''));
  return match ? Number(match[1]) : null;
}

const CAPTURE_SETTLED = new Set(['applied', 'no-change']);
// 'superseded': the host saw this attempt's own message swiped, edited or
// deleted before it finished. It settles that attempt (same operation id)
// only, never an earlier failure of the same version.
const CAPTURE_SUPERSEDED = 'superseded';
// A 'stale' capture was abandoned (chat switch, setting change, edit): it is a
// missed capture unless its message's lineage changed, which the host checks.
const CAPTURE_NOT_ATTEMPTED = new Set(['skipped', CAPTURE_SUPERSEDED]);
// 'forfeited': the operator gave up a missed capture of that message version without recovering it. It
// clears the failures of that version like a successful capture, and changes no World State.
export const CAPTURE_FORFEITED = 'forfeited';
// Outcomes that clear the failures of their message version.
const CAPTURE_CLEARS = new Set([...CAPTURE_SETTLED, CAPTURE_FORFEITED]);
const PINNED_FAILURES = 40;

function recoveryView(row) {
  return {
    label: row?.label || '',
    outcome: row?.outcome || '',
    at: int(row?.at),
    sourceMessageId: Number.isInteger(row?.sourceMessageId) ? row.sourceMessageId : null,
    lineageKey: row?.lineageKey || '',
    contentLineageKey: row?.contentLineageKey || '',
    operationId: row?.operationId || '',
  };
}

function isCaptureFailure(row) {
  // A 'stale' row from before lineage was recorded (alpha.33-40) cannot be
  // tied to a version, and those releases treated it as never attempted.
  if (row.outcome === 'stale' && !row.lineageKey) return false;
  return row.label === 'capture' && Number.isInteger(row.sourceMessageId)
    && !CAPTURE_CLEARS.has(row.outcome) && !CAPTURE_NOT_ATTEMPTED.has(row.outcome);
}

function isCaptureRecovery(row) {
  return (row.label === 'capture' && Number.isInteger(row.sourceMessageId)
    && (CAPTURE_CLEARS.has(row.outcome) || row.outcome === CAPTURE_SUPERSEDED))
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

// Rows from before lineage was recorded match any lineage. Otherwise the
// lineage keys must match, or the hide-insensitive keys when both rows carry
// one (hiding or unhiding an earlier message changes only the lineage key).
function sameCaptureLineage(failure, row) {
  if (!failure.lineageKey || !row.lineageKey || failure.lineageKey === row.lineageKey) return true;
  return Boolean(failure.contentLineageKey && failure.contentLineageKey === row.contentLineageKey);
}

// Walks the log in time order. A failure is identified by message and the
// message's lineage key (so another swipe's capture does not clear it), and is
// cleared by a later successful or forfeited capture of the same message and lineage, a
// completed rebuild whose range covers it (a rebuild also drops parked
// branches), or an import/reset that replaced the state. Returns each
// unrecovered version's failure rows, oldest first.
// `clearing` (optional Set) collects the recovery rows that cleared at least one failure row of the walk.
function unrecoveredFailureLists(rows = [], clearing = null) {
  // Per message version: its unrecovered failure rows, oldest first. A
  // 'superseded' row removes only its own attempt, so an earlier failure of
  // the same version stays listed.
  const failed = new Map();
  const ordered = (Array.isArray(rows) ? rows : [])
    .filter(row => row && typeof row === 'object')
    .map((row, index) => ({ row, index }))
    .sort((a, b) => (int(a.row.at) - int(b.row.at)) || (a.index - b.index))
    .map(item => item.row);
  const drop = (row, matches) => {
    for (const [key, list] of [...failed]) {
      if (list[0].sourceMessageId !== row.sourceMessageId) continue;
      const kept = list.filter(failure => !matches(failure));
      if (kept.length !== list.length) clearing?.add(row);
      if (kept.length) failed.set(key, kept);
      else failed.delete(key);
    }
  };
  const clearWhere = (row, test) => {
    for (const [key, list] of [...failed]) {
      if (!test(list[0].sourceMessageId)) continue;
      clearing?.add(row);
      failed.delete(key);
    }
  };
  for (const row of ordered) {
    if (isCaptureFailure(row)) {
      // The same story message under another lineage (a hide or unhide since) is the same version.
      let carried = [];
      for (const [key, list] of [...failed]) {
        const failure = list.at(-1);
        if (failure.sourceMessageId === row.sourceMessageId && failure.lineageKey && row.lineageKey
          && failure.lineageKey !== row.lineageKey && sameCaptureLineage(failure, row)) {
          carried = carried.concat(list);
          failed.delete(key);
        }
      }
      const key = row.sourceMessageId + '\u0001' + (row.lineageKey || '');
      failed.set(key, [...carried, ...(failed.get(key) || []), row]);
    } else if (row.label === 'capture' && Number.isInteger(row.sourceMessageId) && CAPTURE_CLEARS.has(row.outcome)) {
      drop(row, failure => sameCaptureLineage(failure, row));
    } else if (row.label === 'capture' && Number.isInteger(row.sourceMessageId) && row.outcome === CAPTURE_SUPERSEDED) {
      drop(row, failure => Boolean(failure.operationId) && failure.operationId === row.operationId);
    } else if (row.label === 'rebuild' && row.outcome === 'rebuild-completed') {
      // A rebuild recovered the messages of its own range only: from its start to the last message it read
      // (the row's message). A reply added and missed while it ran stays listed.
      const start = rebuildStartFromOperationId(row.operationId);
      if (start === null) continue;
      const end = Number.isInteger(row.sourceMessageId) ? row.sourceMessageId : Infinity;
      clearWhere(row, messageId => messageId >= start && messageId <= end);
    } else if ((row.label === 'import' || row.label === 'reset') && row.outcome === 'applied') {
      clearWhere(row, () => true);
    }
  }
  return [...failed.values()];
}

function unrecoveredFailureRows(rows = []) {
  return unrecoveredFailureLists(rows).map(list => list.at(-1));
}

// Failed live captures nothing has recovered: [{ messageId, lineageKey, contentLineageKey }], by message.
// Derived only from the non-canonical Operations log; it never changes World State.
export function unrecoveredCaptureFailures(rows = []) {
  return unrecoveredFailureRows(rows)
    .map(row => ({ messageId: row.sourceMessageId, lineageKey: row.lineageKey || '', contentLineageKey: row.contentLineageKey || '' }))
    .sort((a, b) => (a.messageId - b.messageId) || (a.lineageKey < b.lineageKey ? -1 : a.lineageKey > b.lineageKey ? 1 : 0));
}

// Bounds the log to `max` rows, oldest first out, but never drops a row that
// records a still-unrecovered capture failure (a long rebuild or a busy session
// cannot silently erase a missed capture); ordinary rows give way first. Pinned
// rows beyond the newest PINNED_FAILURES drop their stored model answer so the
// log stays small. In a pathological run of more than MAX_PINNED_FAILURE_ROWS
// failures the rows of the earliest failed messages are kept, because Recapture
// starts at the earliest one and re-reads everything after it.
const MAX_PINNED_FAILURE_ROWS = 400;

export function trimOperationRows(rows = [], max = DEFAULT_LIMIT) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length <= max) return list.slice();
  // A row that clears a failure still in the list is kept with the unrecovered failures: dropped together
  // with that failure, the server's copy of the failure would come back on the next save with nothing to
  // clear it. (Once the failure itself is gone from the list and the saved log, the row may go.)
  const clearing = new Set();
  const unrecovered = unrecoveredFailureLists(list, clearing).flat();
  const pinned = new Set([...unrecovered]
    .sort((a, b) => (a.sourceMessageId - b.sourceMessageId) || (int(a.at) - int(b.at)))
    .slice(0, MAX_PINNED_FAILURE_ROWS));
  // Stored answers are kept for the newest pinned failures; a clearing row is only kept, its answer as is.
  const keepAnswers = new Set([...pinned].sort((a, b) => int(b.at) - int(a.at)).slice(0, PINNED_FAILURES));
  const kept = new Set([...pinned, ...clearing]);
  let drop = list.length - max;
  return list.filter(row => {
    if (drop > 0 && !kept.has(row)) {
      drop -= 1;
      return false;
    }
    return true;
  }).map(row => (pinned.has(row) && !keepAnswers.has(row) && (row.responseJson || row.rejectionsJson)
    ? { ...row, responseJson: '', rejectionsJson: '' }
    : row));
}

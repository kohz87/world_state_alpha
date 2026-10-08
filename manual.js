import { chatLineage, commitMutationBoundary, firstLineageDivergence } from './branch.js';
import { consolidateCreateCandidate } from './duplicate.js';
import { clone, cloneState, normalizeState, reduceMutations } from './state-core.js';
import { exportBundle, importBundle, resetState } from './transfer.js';
import { canonicalText as normalizeText } from './hash.js';

export const MANUAL_LIMITS = Object.freeze({
  queryResults: 100,
  noteChars: 500,
  bulkRecords: 100,
});

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function boundedLimit(value, fallback = 30) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(1, Math.min(MANUAL_LIMITS.queryResults, Math.trunc(number)));
}

function normalizedSet(values) {
  return new Set((Array.isArray(values) ? values : [])
    .map(value => clean(value, 40))
    .filter(Boolean));
}

function recordSearchText(record) {
  return normalizeText([
    record?.summary || '',
    ...(Array.isArray(record?.anchors) ? record.anchors : []),
  ].join(' '));
}

function queryMatches(record, needle) {
  if (!needle) return true;
  const tokens = normalizeText(needle).split(' ').filter(Boolean);
  if (!tokens.length) return true;
  const haystack = recordSearchText(record);
  return tokens.every(token => haystack.includes(token));
}

function sortRecords(left, right) {
  const rightChanged = Number.isInteger(right?.lastChangedMessage) ? right.lastChangedMessage : -1;
  const leftChanged = Number.isInteger(left?.lastChangedMessage) ? left.lastChangedMessage : -1;
  if (rightChanged !== leftChanged) return rightChanged - leftChanged;
  const a = String(left?.id || '');
  const b = String(right?.id || '');
  return a < b ? -1 : a > b ? 1 : 0;
}

export function queryWorldState(state, {
  text = '',
  statuses = [],
  kinds = [],
  limit = 30,
} = {}) {
  const normalized = normalizeState(state);
  const statusFilter = normalizedSet(statuses);
  const kindFilter = normalizedSet(kinds);
  // Filtered once: the rows and the total come from the same matches.
  const matched = normalized.records.filter(record => (!statusFilter.size || statusFilter.has(record.status))
    && (!kindFilter.size || kindFilter.has(record.kind))
    && queryMatches(record, text));
  const rows = matched
    .sort(sortRecords)
    .slice(0, boundedLimit(limit))
    .map(record => clone(record));

  return {
    records: rows,
    totalMatched: matched.length,
    filters: {
      text: clean(text),
      statuses: [...statusFilter],
      kinds: [...kindFilter],
    },
  };
}

export function inspectWorldStateRecord(state, recordId) {
  const normalized = normalizeState(state);
  const id = clean(recordId, 120);
  const record = normalized.records.find(item => item.id === id);
  if (!record) return null;

  const evidence = (record.evidenceIds || [])
    .map(evidenceId => normalized.evidence[evidenceId])
    .filter(Boolean)
    .map(item => clone(item));

  const links = normalized.links
    .filter(link => link.from === id || link.to === id)
    .map(item => clone(item));

  return {
    record: clone(record),
    evidence,
    links,
  };
}

function exactBoundary(chat, messageId, state = null) {
  if (!Array.isArray(chat)) throw new Error('chat is required');
  if (!Number.isInteger(messageId) || messageId < 0 || messageId >= chat.length) {
    const error = new Error('manual mutation requires an existing raw-message boundary');
    error.code = 'WORLD_STATE_MANUAL_BOUNDARY_REQUIRED';
    throw error;
  }
  if (messageId !== chat.length - 1) {
    const error = new Error('manual mutation must be anchored to the current raw-message head');
    error.code = 'WORLD_STATE_MANUAL_HEAD_REQUIRED';
    throw error;
  }
  const lineage = chatLineage(chat);
  const previous = Array.isArray(state?.lineage) ? state.lineage : [];
  if (previous.length) {
    const divergence = firstLineageDivergence(previous, lineage);
    if (divergence >= 0 && divergence < previous.length) {
      const error = new Error('manual mutation state lineage does not match the current chat branch');
      error.code = 'WORLD_STATE_MANUAL_BRANCH_MISMATCH';
      throw error;
    }
  }
  const boundary = lineage[messageId];
  if (!boundary?.lineageKey) {
    const error = new Error('manual mutation boundary has no lineage key');
    error.code = 'WORLD_STATE_MANUAL_BOUNDARY_REQUIRED';
    throw error;
  }
  // The chat is fingerprinted once: the commit reuses this lineage.
  return { boundary, lineage };
}

function manualProposal(mutation, note, boundary) {
  if (!mutation || typeof mutation !== 'object' || Array.isArray(mutation)) {
    throw new Error('manual mutation must be an object');
  }
  const claim = clean(note, MANUAL_LIMITS.noteChars);
  if (!claim) {
    const error = new Error('manual mutation requires a concise operator note');
    error.code = 'WORLD_STATE_MANUAL_NOTE_REQUIRED';
    throw error;
  }
  return {
    ...clone(mutation),
    evidence: [{
      sourceMessageId: boundary.messageId,
      lineageKey: boundary.lineageKey,
      sourceClass: 'manual',
      claim,
    }],
  };
}

export function applyManualMutation({
  state,
  chat,
  chatKey,
  messageId,
  mutation,
  note,
} = {}) {
  const before = normalizeState(state, { chatKey });
  const owner = String(chatKey || before.chatKey || '');
  if (!owner) throw new Error('chatKey is required');
  if (before.chatKey && before.chatKey !== owner) throw new Error('manual mutation chatKey does not match state owner');

  const { boundary, lineage } = exactBoundary(chat, messageId, before);
  let proposal = manualProposal(mutation, note, boundary);

  if (proposal.action === 'create') {
    const consolidated = consolidateCreateCandidate(proposal, before.records);
    if (!consolidated.ok) {
      return {
        outcome: 'rejected',
        state: cloneState(before),
        applied: [],
        rejected: [{
          stage: 'duplicate-gate',
          reason: consolidated.reason,
          duplicateRecordId: consolidated.duplicate?.record?.id || '',
        }],
      };
    }
    proposal = consolidated.mutation;
  }

  const reduced = reduceMutations(before, {
    chatKey: owner,
    messageId,
    lineageKey: boundary.lineageKey,
    operation: 'manual',
    mutations: [proposal],
  });

  if (reduced.rejected.length || !reduced.applied.some(item => item.action !== 'noop')) {
    return {
      outcome: 'rejected',
      state: cloneState(before),
      applied: reduced.applied,
      rejected: reduced.rejected.map(item => ({ stage: 'reducer', reason: item.reason })),
    };
  }

  const committed = commitMutationBoundary(
    before,
    reduced.state,
    chat.slice(0, messageId + 1),
    messageId,
    'manual',
    { lineage },
  );

  return {
    outcome: 'applied',
    state: committed,
    applied: reduced.applied,
    rejected: [],
  };
}

export function applyManualLifecycleBatch({
  state,
  chat,
  chatKey,
  messageId,
  action,
  recordIds,
  note,
} = {}) {
  if (!['resolve', 'supersede'].includes(action)) {
    throw new Error('bulk lifecycle action must be resolve or supersede');
  }
  const ids = [...new Set((Array.isArray(recordIds) ? recordIds : []).map(id => clean(id, 120)).filter(Boolean))];
  if (!ids.length) throw new Error('bulk lifecycle action needs at least one record');
  if (ids.length > MANUAL_LIMITS.bulkRecords) {
    throw new Error('bulk lifecycle action is limited to ' + MANUAL_LIMITS.bulkRecords + ' records');
  }

  const before = normalizeState(state, { chatKey });
  const owner = String(chatKey || before.chatKey || '');
  if (!owner) throw new Error('chatKey is required');
  if (before.chatKey && before.chatKey !== owner) throw new Error('manual mutation chatKey does not match state owner');

  const { boundary, lineage } = exactBoundary(chat, messageId, before);
  const proposals = ids.map(recordId => manualProposal({ action, recordId }, note, boundary));

  const inactive = ids.filter(recordId => before.records.find(record => record.id === recordId)?.status !== 'active');
  if (inactive.length) {
    return {
      outcome: 'rejected',
      state: cloneState(before),
      applied: [],
      rejected: inactive.map(recordId => ({
        stage: 'reducer',
        reason: 'target record is not an active record',
        recordId,
      })),
    };
  }

  const reduced = reduceMutations(before, {
    chatKey: owner,
    messageId,
    lineageKey: boundary.lineageKey,
    operation: 'manual',
    mutations: proposals,
  });

  const changed = reduced.applied.filter(item => item.action !== 'noop').length;
  if (reduced.rejected.length || changed !== ids.length) {
    return {
      outcome: 'rejected',
      state: cloneState(before),
      applied: reduced.applied,
      rejected: reduced.rejected.length
        ? reduced.rejected.map(item => ({ stage: 'reducer', reason: item.reason }))
        : [{ stage: 'reducer', reason: 'not every selected record could be changed' }],
    };
  }

  return {
    outcome: 'applied',
    state: commitMutationBoundary(before, reduced.state, chat.slice(0, messageId + 1), messageId, 'manual', { lineage }),
    applied: reduced.applied,
    rejected: [],
  };
}

function stateSummary(state) {
  const normalized = normalizeState(state);
  return {
    records: normalized.records.length,
    active: normalized.records.filter(record => record.status === 'active').length,
    resolved: normalized.records.filter(record => record.status === 'resolved').length,
    superseded: normalized.records.filter(record => record.status === 'superseded').length,
    evidence: Object.keys(normalized.evidence).length,
    links: normalized.links.length,
  };
}

export function prepareWorldStateExport(state, options = {}) {
  const normalized = normalizeState(state, { strictSchema: true });
  return {
    kind: 'world_state_alpha_export',
    text: exportBundle(normalized, options),
    summary: stateSummary(normalized),
  };
}

export function previewWorldStateImport(text, {
  targetChatKey,
  preserveSameChatMessageProvenance = false,
} = {}) {
  const candidate = importBundle(text, {
    targetChatKey,
    preserveChronology: preserveSameChatMessageProvenance === true,
  });

  return {
    kind: 'world_state_alpha_import_preview',
    targetChatKey: String(targetChatKey || ''),
    candidate,
    summary: stateSummary(candidate),
    branchChronologyCleared: candidate.lineage.length === 0
      && candidate.rollbackJournal.length === 0
      && candidate.rollbackHead === null,
    messageProvenanceCleared: candidate.records.every(record =>
      record.createdAtMessage === null
      && record.lastChangedMessage === null
      && record.lastEvaluatedMessage === null)
      && Object.values(candidate.evidence).every(item => item.sourceMessageId === null && item.lineageKey === ''),
  };
}

export function applyWorldStateImport(preview, { confirmed = false } = {}) {
  if (!preview || preview.kind !== 'world_state_alpha_import_preview' || !preview.candidate) {
    throw new Error('valid import preview is required');
  }
  if (confirmed !== true) {
    const error = new Error('import requires explicit confirmation');
    error.code = 'WORLD_STATE_IMPORT_CONFIRMATION_REQUIRED';
    throw error;
  }
  return normalizeState(cloneState(preview.candidate), { strictSchema: true });
}

export function previewWorldStateReset(state, { chatKey = '' } = {}) {
  const normalized = normalizeState(state);
  const owner = String(chatKey || normalized.chatKey || '');
  if (!owner) throw new Error('chatKey is required');
  return {
    kind: 'world_state_alpha_reset_preview',
    chatKey: owner,
    current: stateSummary(normalized),
    candidate: resetState(owner),
  };
}

export function applyWorldStateReset(preview, { confirmed = false } = {}) {
  if (!preview || preview.kind !== 'world_state_alpha_reset_preview' || !preview.candidate) {
    throw new Error('valid reset preview is required');
  }
  if (confirmed !== true) {
    const error = new Error('reset requires explicit confirmation');
    error.code = 'WORLD_STATE_RESET_CONFIRMATION_REQUIRED';
    throw error;
  }
  return normalizeState(cloneState(preview.candidate), { strictSchema: true });
}

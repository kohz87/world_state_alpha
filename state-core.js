import {
  EVIDENCE_SOURCE_CLASSES,
  LIMITS,
  MUTATION_ACTIONS,
  RECORD_KINDS,
  RECORD_STATUSES,
  RECORD_TRENDS,
  ROLLBACK_JOURNAL_VERSION,
  SCHEMA_VERSION,
} from './constants.js';
import { boundedText, clone, keyedUndo, ownEntry, reservedMapKey, restoreKeyed, uniqueStrings } from './common.js';
import { deterministicId, stableStringify } from './hash.js';
import {
  applySpatialUndoPatch,
  buildSpatialUndoPatch,
  createSpatialState,
  normalizeSpatialState,
} from './spatial-core.js';

export const HISTORY_FIELDS = Object.freeze(['lineage', 'rollbackJournal', 'checkpoints']);

// Shared history entries are frozen (with their snapshot/undo), so an in-place edit fails loudly instead of
// silently changing every state copy that holds the entry.
function frozenEntry(entry) {
  if (!entry || typeof entry !== 'object' || Object.isFrozen(entry)) return entry;
  if (entry.snapshot && typeof entry.snapshot === 'object') Object.freeze(entry.snapshot);
  if (entry.undo && typeof entry.undo === 'object') Object.freeze(entry.undo);
  return Object.freeze(entry);
}

// Freezes the history entries a caller added to its private state copy (a new journal entry or checkpoint),
// as normalization would, without copying the state again.
export function freezeHistory(state) {
  for (const key of HISTORY_FIELDS) if (Array.isArray(state?.[key])) state[key] = state[key].map(frozenEntry);
  return state;
}

// True for a state that already has the normalized shape (the cache, a reducer or branch result), which a
// read-only caller can use as it is instead of normalizing a copy.
export function hasNormalizedShape(state) {
  return Boolean(state && typeof state === 'object' && !Array.isArray(state)
    && state.schemaVersion === SCHEMA_VERSION
    && Array.isArray(state.records) && Array.isArray(state.links)
    && state.evidence && typeof state.evidence === 'object' && !Array.isArray(state.evidence)
    && HISTORY_FIELDS.every(key => Array.isArray(state[key]))
    && state.spatial && typeof state.spatial === 'object' && Array.isArray(state.spatial.locations));
}

// A state to read: the caller's own when it is already normalized (and owned), otherwise a normalized copy.
// Never modify the result.
export function readableState(state, { chatKey = '' } = {}) {
  return hasNormalizedShape(state) && state.chatKey ? state : normalizeState(state, { chatKey });
}

// A private copy of a state for mutation. The canonical domain and small fields are deep-copied; the
// append-only history (lineage, rollback journal, checkpoints) gets its own arrays but shares their entries,
// which are never edited in place (a changed entry is replaced). Copying 48 checkpoint snapshots and 256
// undo patches on every capture was most of a capture's cost.
export function cloneState(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return clone(state);
  const rest = {};
  for (const [key, value] of Object.entries(state)) if (!HISTORY_FIELDS.includes(key)) rest[key] = value;
  const out = clone(rest);
  for (const key of HISTORY_FIELDS) if (key in state) out[key] = Array.isArray(state[key]) ? [...state[key]] : clone(state[key]);
  return out;
}

function messageId(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function boundedEvidenceRefs(items) {
  const refs = uniqueStrings(items, Number.MAX_SAFE_INTEGER, 120);
  if (refs.length <= LIMITS.evidenceRefsPerRecord) return refs;
  return [refs[0], ...refs.slice(-(LIMITS.evidenceRefsPerRecord - 1))];
}

export function createState(chatKey = '') {
  return {
    schemaVersion: SCHEMA_VERSION,
    chatKey: String(chatKey || ''),
    records: [],
    evidence: {},
    links: [],
    lineage: [],
    rollbackJournalVersion: ROLLBACK_JOURNAL_VERSION,
    rollbackJournalSequence: 0,
    rollbackJournalFloorMessageId: -1,
    rollbackJournal: [],
    rollbackHead: null,
    checkpoints: [],
    lastCaptureMessage: null,
    recoveryRequired: null,
    spatial: createSpatialState(),
  };
}

export function normalizeRecord(raw, { strict = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('record must be an object');
  const id = boundedText(raw.id, 120);
  if (!id) throw new Error('record id is required');
  if (!RECORD_KINDS.includes(raw.kind)) throw new Error('record kind must be fact or development');
  const summary = boundedText(raw.summary, LIMITS.summaryChars);
  if (!summary) throw new Error('record summary is required');
  if (strict && raw.status !== undefined && raw.status !== null && !RECORD_STATUSES.includes(raw.status)) {
    throw new Error(`invalid record status: ${raw.status}`);
  }
  if (strict && raw.kind === 'development' && raw.trend !== null && raw.trend !== undefined && !RECORD_TRENDS.includes(raw.trend)) {
    throw new Error(`invalid development trend: ${raw.trend}`);
  }
  if (strict && raw.kind === 'fact' && raw.trend !== null && raw.trend !== undefined) {
    throw new Error('fact record trend must be null');
  }
  const status = RECORD_STATUSES.includes(raw.status) ? raw.status : 'active';
  const trend = raw.kind === 'development' && RECORD_TRENDS.includes(raw.trend) ? raw.trend : null;
  return {
    id,
    kind: raw.kind,
    summary,
    status,
    trend,
    anchors: uniqueStrings(raw.anchors, LIMITS.anchorsPerRecord, LIMITS.anchorChars),
    createdAtMessage: messageId(raw.createdAtMessage),
    lastChangedMessage: messageId(raw.lastChangedMessage),
    lastEvaluatedMessage: messageId(raw.lastEvaluatedMessage),
    timeAnchor: boundedText(raw.timeAnchor, 160),
    evidenceIds: boundedEvidenceRefs(raw.evidenceIds),
    causedBy: uniqueStrings(raw.causedBy, LIMITS.linksPerRecord, 120),
    affects: uniqueStrings(raw.affects, LIMITS.linksPerRecord, 120),
  };
}

export function normalizeEvidence(raw, { strict = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('evidence must be an object');
  const id = boundedText(raw.id, 140);
  if (!id) throw new Error('evidence id is required');
  if (reservedMapKey(id)) throw new Error(`evidence id is reserved: ${id}`);
  if (strict && raw.sourceClass !== undefined && raw.sourceClass !== null && !EVIDENCE_SOURCE_CLASSES.includes(raw.sourceClass)) {
    throw new Error(`invalid evidence sourceClass: ${raw.sourceClass}`);
  }
  const sourceClass = EVIDENCE_SOURCE_CLASSES.includes(raw.sourceClass) ? raw.sourceClass : 'assistant_narration';
  return {
    id,
    sourceMessageId: messageId(raw.sourceMessageId),
    lineageKey: boundedText(raw.lineageKey, 80),
    sourceClass,
    claim: boundedText(raw.claim, LIMITS.claimChars),
    timeAnchor: boundedText(raw.timeAnchor, 160),
    recordIds: uniqueStrings(raw.recordIds, 16, 120),
  };
}

export function normalizeLink(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('link must be an object');
  const id = boundedText(raw.id, 140);
  const from = boundedText(raw.from, 120);
  const to = boundedText(raw.to, 120);
  if (!id || !from || !to) throw new Error('link id/from/to are required');
  return {
    id,
    from,
    to,
    type: boundedText(raw.type, 40) || 'related',
    sourceMessageId: messageId(raw.sourceMessageId),
  };
}

export function normalizeState(raw, { strictSchema = false, chatKey = '' } = {}) {
  if (!raw || typeof raw !== 'object') {
    if (strictSchema) throw new Error('state payload is not an object');
    return createState(chatKey);
  }
  if (strictSchema && raw.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`unsupported state schema version: ${raw.schemaVersion}`);
  }
  const state = createState(raw.chatKey || chatKey);
  const recordIds = new Set();
  for (const item of Array.isArray(raw.records) ? raw.records : []) {
    try {
      const record = normalizeRecord(item, { strict: strictSchema });
      if (recordIds.has(record.id)) {
        if (strictSchema) throw new Error(`duplicate record id: ${record.id}`);
        continue;
      }
      recordIds.add(record.id);
      state.records.push(record);
    } catch (error) {
      if (strictSchema) throw error;
    }
  }
  if (raw.evidence && typeof raw.evidence === 'object' && !Array.isArray(raw.evidence)) {
    const evidenceIds = new Set();
    for (const [key, item] of Object.entries(raw.evidence)) {
      try {
        const evidence = normalizeEvidence(item, { strict: strictSchema });
        if (strictSchema && key !== evidence.id) {
          throw new Error(`evidence map key/id mismatch: ${key} != ${evidence.id}`);
        }
        if (evidenceIds.has(evidence.id)) {
          if (strictSchema) throw new Error(`duplicate evidence id: ${evidence.id}`);
          continue;
        }
        evidenceIds.add(evidence.id);
        state.evidence[evidence.id] = evidence;
      } catch (error) {
        if (strictSchema) throw error;
      }
    }
  }
  const linkIds = new Set();
  for (const item of Array.isArray(raw.links) ? raw.links : []) {
    try {
      const link = normalizeLink(item);
      if (linkIds.has(link.id)) {
        if (strictSchema) throw new Error(`duplicate link id: ${link.id}`);
        continue;
      }
      linkIds.add(link.id);
      state.links.push(link);
    } catch (error) {
      if (strictSchema) throw error;
    }
  }
  // History entries are shared, never edited in place (see cloneState).
  state.lineage = Array.isArray(raw.lineage) ? raw.lineage.map(frozenEntry) : [];
  state.rollbackJournalVersion = ROLLBACK_JOURNAL_VERSION;
  state.rollbackJournalSequence = Math.max(0, Number(raw.rollbackJournalSequence) || 0);
  state.rollbackJournalFloorMessageId = Number.isInteger(raw.rollbackJournalFloorMessageId)
    ? raw.rollbackJournalFloorMessageId
    : -1;
  state.rollbackJournal = Array.isArray(raw.rollbackJournal) ? raw.rollbackJournal.map(frozenEntry) : [];
  state.rollbackHead = raw.rollbackHead && typeof raw.rollbackHead === 'object' ? clone(raw.rollbackHead) : null;
  state.checkpoints = Array.isArray(raw.checkpoints) ? raw.checkpoints.map(frozenEntry) : [];
  state.lastCaptureMessage = messageId(raw.lastCaptureMessage);
  state.recoveryRequired = raw.recoveryRequired && typeof raw.recoveryRequired === 'object'
    ? clone(raw.recoveryRequired)
    : null;
  state.spatial = normalizeSpatialState(raw.spatial, { strict: strictSchema });

  if (strictSchema) {
    for (const record of state.records) {
      for (const evidenceId of record.evidenceIds || []) {
        if (!ownEntry(state.evidence, evidenceId)) {
          throw new Error(`record ${record.id} references missing evidence: ${evidenceId}`);
        }
      }
      for (const relatedId of [...(record.causedBy || []), ...(record.affects || [])]) {
        if (!recordIds.has(relatedId)) {
          throw new Error(`record ${record.id} references missing causal record: ${relatedId}`);
        }
      }
    }
    for (const evidence of Object.values(state.evidence)) {
      for (const referencedRecordId of evidence.recordIds || []) {
        if (!recordIds.has(referencedRecordId)) {
          throw new Error(`evidence ${evidence.id} references missing record: ${referencedRecordId}`);
        }
      }
    }
    for (const link of state.links) {
      if (!recordIds.has(link.from) || !recordIds.has(link.to)) {
        throw new Error(`link ${link.id} references a missing record endpoint`);
      }
    }
  }

  return state;
}

// Read-only views of both sides: the patch copies only the entries that changed (and the Spatial patch
// normalizes its own inputs), so the whole domain is not copied twice per commit.
function domainSnapshot(state) {
  return {
    records: state.records || [],
    evidence: state.evidence || {},
    links: state.links || [],
    lastCaptureMessage: state.lastCaptureMessage,
    spatial: state.spatial || createSpatialState(),
  };
}

export function buildUndoPatch(beforeState, afterState) {
  const before = domainSnapshot(beforeState);
  const after = domainSnapshot(afterState);
  const evidenceBefore = Object.values(before.evidence);
  const evidenceAfter = Object.values(after.evidence);
  const spatialUndo = buildSpatialUndoPatch(before.spatial, after.spatial);
  const patch = {
    records: keyedUndo(before.records, after.records),
    evidence: keyedUndo(evidenceBefore, evidenceAfter),
    links: keyedUndo(before.links, after.links),
    lastCaptureMessageBefore: before.lastCaptureMessage,
    spatial: spatialUndo,
  };
  const changed = patch.records.length || patch.evidence.length || patch.links.length
    || before.lastCaptureMessage !== after.lastCaptureMessage
    || Boolean(spatialUndo);
  return changed ? patch : null;
}

export function applyUndoPatch(inputState, patch) {
  const state = normalizeState(inputState);
  if (!patch) return state;
  state.records = restoreKeyed(state.records, patch.records);
  const evidenceItems = restoreKeyed(Object.values(state.evidence), patch.evidence);
  state.evidence = Object.fromEntries(evidenceItems.map(item => [item.id, item]));
  state.links = restoreKeyed(state.links, patch.links);
  state.lastCaptureMessage = messageId(patch.lastCaptureMessageBefore);
  if (patch.spatial) {
    state.spatial = applySpatialUndoPatch(state.spatial, patch.spatial);
  }
  return state;
}

function recordIdFor(state, context, ordinal) {
  return deterministicId('wsr', [
    state.chatKey || context.chatKey || '',
    context.messageId,
    context.lineageKey,
    ordinal,
  ]);
}

function evidenceIdFor(state, recordId, context, ordinal, claim) {
  return deterministicId('wse', [
    state.chatKey || context.chatKey || '',
    recordId,
    context.messageId,
    context.lineageKey,
    ordinal,
    boundedText(claim, LIMITS.claimChars),
  ]);
}

function linkIdFor(state, from, to, type, context) {
  return deterministicId('wsl', [
    state.chatKey || context.chatKey || '',
    from,
    to,
    type,
    context.messageId,
    context.lineageKey,
  ]);
}

function addEvidence(state, record, mutation, context, counter) {
  const added = [];
  for (const raw of Array.isArray(mutation.evidence) ? mutation.evidence : []) {
    if (!raw || typeof raw !== 'object' || !boundedText(raw.claim, LIMITS.claimChars)) continue;
    const ordinal = counter.value++;
    const id = evidenceIdFor(state, record.id, context, ordinal, raw.claim);
    const evidence = normalizeEvidence({
      ...raw,
      id,
      sourceMessageId: messageId(raw.sourceMessageId) ?? context.messageId,
      lineageKey: boundedText(raw.lineageKey, 80) || context.lineageKey,
      recordIds: [record.id],
    });
    const existing = ownEntry(state.evidence, id);
    if (existing && stableStringify(existing) !== stableStringify(evidence)) {
      throw new Error(`deterministic evidence id collision: ${id}`);
    }
    if (!existing) state.evidence[id] = evidence;
    if (evidence.sourceClass === 'elapsed_hint' && Number.isInteger(evidence.sourceMessageId)) {
      counter.elapsedBoundary = Math.max(counter.elapsedBoundary ?? -1, evidence.sourceMessageId);
    }
    added.push(id);
  }
  record.evidenceIds = boundedEvidenceRefs([...record.evidenceIds, ...added]);
}

function addRelatedLinks(state, record, mutation, context, appendedLinks = null) {
  for (const relatedId of uniqueStrings(mutation.relatedRecordIds, LIMITS.linksPerRecord, 120)) {
    if (relatedId === record.id || !state.records.some(item => item.id === relatedId)) continue;
    const id = linkIdFor(state, relatedId, record.id, 'related', context);
    if (!state.links.some(link => link.id === id)) {
      const link = normalizeLink({
        id,
        from: relatedId,
        to: record.id,
        type: 'related',
        sourceMessageId: context.messageId,
      });
      state.links.push(link);
      if (appendedLinks) appendedLinks.push(link);
    }
  }
}

export function compactEvidence(state) {
  const referenced = new Set();
  for (const record of state.records || []) {
    for (const id of record.evidenceIds || []) {
      referenced.add(id);
    }
  }
  if (state.evidence && typeof state.evidence === 'object') {
    for (const key of Object.keys(state.evidence)) {
      if (!referenced.has(key)) {
        delete state.evidence[key];
      }
    }
  }
  return state;
}

// Normalization builds a fresh canonical domain (only frozen history entries are shared), so it is the one
// private copy the reducer needs. The journal's undo patch is built at the commit boundary, not here.
export function reduceMutations(inputState, batch) {
  const state = normalizeState(inputState);
  const context = {
    chatKey: String(batch?.chatKey || state.chatKey || ''),
    messageId: messageId(batch?.messageId),
    lineageKey: boundedText(batch?.lineageKey, 80),
    operation: boundedText(batch?.operation, 24) || 'capture',
  };
  const proposals = Array.isArray(batch?.mutations) ? batch.mutations : [];
  const applied = [];
  const rejected = [];
  const upsertedRecords = [];
  const appendedLinks = [];
  const evidenceCounter = { value: 0 };
  const endedInBatch = new Set();

  if (proposals.some(item => item?.action && item.action !== 'noop')
    && (context.messageId === null || !context.lineageKey)) {
    return {
      state,
      applied,
      rejected: proposals.map(mutation => ({
        mutation,
        reason: 'canonical mutation requires messageId and lineageKey',
      })),
      indexDelta: { upsertedRecords: [], appendedLinks: [], corpusRecords: state.records.length },
    };
  }

  for (let index = 0; index < proposals.length; index += 1) {
    const mutation = proposals[index];
    const action = mutation?.action;
    if (!MUTATION_ACTIONS.includes(action)) {
      rejected.push({ mutation, reason: 'unsupported mutation action' });
      continue;
    }
    if (action === 'noop') {
      applied.push({ action: 'noop' });
      continue;
    }

    if (action === 'create') {
      if (!RECORD_KINDS.includes(mutation.kind) || !boundedText(mutation.summary, LIMITS.summaryChars)) {
        rejected.push({ mutation, reason: 'create requires valid kind and summary' });
        continue;
      }
      const id = boundedText(mutation.recordId, 120) || recordIdFor(state, context, index);
      if (state.records.some(record => record.id === id)) {
        rejected.push({ mutation, reason: 'record id already exists' });
        continue;
      }
      const record = normalizeRecord({
        id,
        kind: mutation.kind,
        summary: mutation.summary,
        status: RECORD_STATUSES.includes(mutation.status) ? mutation.status : 'active',
        trend: mutation.trend,
        anchors: mutation.anchors,
        createdAtMessage: context.messageId,
        lastChangedMessage: context.messageId,
        lastEvaluatedMessage: context.messageId,
        timeAnchor: mutation.timeAnchor,
        evidenceIds: [],
        causedBy: mutation.causedBy,
        affects: mutation.affects,
      });
      state.records.push(record);
      addEvidence(state, record, mutation, context, evidenceCounter);
      addRelatedLinks(state, record, mutation, context, appendedLinks);
      applied.push({ action, recordId: id });
      upsertedRecords.push(clone(record));
      continue;
    }

    const record = state.records.find(item => item.id === boundedText(mutation.recordId, 120));
    if (!record) {
      rejected.push({ mutation, reason: 'target record does not exist' });
      continue;
    }
    // Once an earlier mutation in this batch has resolved or superseded the record, a later one in the same
    // batch must not rewrite that ended history (for example resolve, then 'still holds firm' update).
    if (endedInBatch.has(record.id)) {
      rejected.push({ mutation, reason: 'target record was already ended earlier in this batch' });
      continue;
    }
    const priorDomain = stableStringify({
      summary: record.summary,
      status: record.status,
      trend: record.trend,
      anchors: record.anchors,
      timeAnchor: record.timeAnchor,
      causedBy: record.causedBy,
      affects: record.affects,
    });

    if (action === 'update') {
      if (Object.hasOwn(mutation, 'status') && mutation.status !== record.status) {
        rejected.push({ mutation, reason: 'update cannot change lifecycle status; use resolve or supersede' });
        continue;
      }
      if (Object.hasOwn(mutation, 'summary') && boundedText(mutation.summary, LIMITS.summaryChars)) {
        record.summary = boundedText(mutation.summary, LIMITS.summaryChars);
      }
      if (record.kind === 'development' && Object.hasOwn(mutation, 'trend')) {
        record.trend = RECORD_TRENDS.includes(mutation.trend) ? mutation.trend : null;
      }
      if (Object.hasOwn(mutation, 'anchors')) {
        record.anchors = uniqueStrings(mutation.anchors, LIMITS.anchorsPerRecord, LIMITS.anchorChars);
      }
      if (Object.hasOwn(mutation, 'causedBy')) record.causedBy = uniqueStrings(mutation.causedBy, LIMITS.linksPerRecord, 120);
      if (Object.hasOwn(mutation, 'affects')) record.affects = uniqueStrings(mutation.affects, LIMITS.linksPerRecord, 120);
    } else if (action === 'resolve') {
      endedInBatch.add(record.id);
      record.status = 'resolved';
      if (boundedText(mutation.summary, LIMITS.summaryChars)) record.summary = boundedText(mutation.summary, LIMITS.summaryChars);
    } else if (action === 'supersede') {
      endedInBatch.add(record.id);
      record.status = 'superseded';
      if (boundedText(mutation.summary, LIMITS.summaryChars)) record.summary = boundedText(mutation.summary, LIMITS.summaryChars);
    }

    if (Object.hasOwn(mutation, 'timeAnchor')) {
      record.timeAnchor = boundedText(mutation.timeAnchor, 160);
    }

    addEvidence(state, record, mutation, context, evidenceCounter);
    addRelatedLinks(state, record, mutation, context, appendedLinks);
    record.lastEvaluatedMessage = context.messageId;
    const nextDomain = stableStringify({
      summary: record.summary,
      status: record.status,
      trend: record.trend,
      anchors: record.anchors,
      timeAnchor: record.timeAnchor,
      causedBy: record.causedBy,
      affects: record.affects,
    });
    if (priorDomain !== nextDomain) record.lastChangedMessage = context.messageId;
    applied.push({ action, recordId: record.id });
    upsertedRecords.push(clone(record));
  }

  compactEvidence(state);

  if (context.operation === 'capture' && applied.some(item => item.action !== 'noop')) {
    state.lastCaptureMessage = context.messageId;
  }
  return {
    state,
    applied,
    rejected,
    indexDelta: {
      upsertedRecords,
      appendedLinks,
      corpusRecords: state.records.length,
      elapsedEvidenceBoundary: Number.isInteger(evidenceCounter.elapsedBoundary) ? evidenceCounter.elapsedBoundary : null,
    },
  };
}

// normalizeState already returns a fresh domain, so it is not copied a second time.
export function canonicalDomain(state) {
  const normalized = normalizeState(state);
  return {
    records: normalized.records,
    evidence: normalized.evidence,
    links: normalized.links,
    lastCaptureMessage: normalized.lastCaptureMessage,
    spatial: normalized.spatial,
  };
}

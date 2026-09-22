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
import { deterministicId, stableStringify } from './hash.js';
import {
  applySpatialUndoPatch,
  buildSpatialUndoPatch,
  createSpatialState,
  normalizeSpatialState,
} from './spatial-core.js';

export function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function boundedText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function messageId(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function uniqueStrings(value, maxItems, maxChars) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const text = boundedText(item, maxChars);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
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

export function normalizeRecord(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('record must be an object');
  const id = boundedText(raw.id, 120);
  if (!id) throw new Error('record id is required');
  if (!RECORD_KINDS.includes(raw.kind)) throw new Error('record kind must be fact or development');
  const summary = boundedText(raw.summary, LIMITS.summaryChars);
  if (!summary) throw new Error('record summary is required');
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

export function normalizeEvidence(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('evidence must be an object');
  const id = boundedText(raw.id, 140);
  if (!id) throw new Error('evidence id is required');
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
  if (strictSchema && raw.schemaVersion !== 1 && raw.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`unsupported state schema version: ${raw.schemaVersion}`);
  }
  const state = createState(raw.chatKey || chatKey);
  const recordIds = new Set();
  for (const item of Array.isArray(raw.records) ? raw.records : []) {
    try {
      const record = normalizeRecord(item);
      if (!recordIds.has(record.id)) {
        recordIds.add(record.id);
        state.records.push(record);
      }
    } catch (error) {
      if (strictSchema) throw error;
    }
  }
  if (raw.evidence && typeof raw.evidence === 'object' && !Array.isArray(raw.evidence)) {
    for (const item of Object.values(raw.evidence)) {
      try {
        const evidence = normalizeEvidence(item);
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
      if (!linkIds.has(link.id)) {
        linkIds.add(link.id);
        state.links.push(link);
      }
    } catch (error) {
      if (strictSchema) throw error;
    }
  }
  state.lineage = Array.isArray(raw.lineage) ? clone(raw.lineage) : [];
  state.rollbackJournalVersion = ROLLBACK_JOURNAL_VERSION;
  state.rollbackJournalSequence = Math.max(0, Number(raw.rollbackJournalSequence) || 0);
  state.rollbackJournalFloorMessageId = Number.isInteger(raw.rollbackJournalFloorMessageId)
    ? raw.rollbackJournalFloorMessageId
    : -1;
  state.rollbackJournal = Array.isArray(raw.rollbackJournal) ? clone(raw.rollbackJournal) : [];
  state.rollbackHead = raw.rollbackHead && typeof raw.rollbackHead === 'object' ? clone(raw.rollbackHead) : null;
  state.checkpoints = Array.isArray(raw.checkpoints) ? clone(raw.checkpoints) : [];
  state.lastCaptureMessage = messageId(raw.lastCaptureMessage);
  state.recoveryRequired = raw.recoveryRequired && typeof raw.recoveryRequired === 'object'
    ? clone(raw.recoveryRequired)
    : null;
  state.spatial = normalizeSpatialState(raw.spatial, { strict: strictSchema });
  return state;
}

function domainSnapshot(state) {
  return {
    records: clone(state.records),
    evidence: clone(state.evidence),
    links: clone(state.links),
    lastCaptureMessage: state.lastCaptureMessage,
    spatial: state.spatial ? clone(state.spatial) : createSpatialState(),
  };
}

function keyedBy(items) {
  return new Map(items.map(item => [item.id, item]));
}

function keyedUndo(beforeItems, afterItems) {
  const before = keyedBy(beforeItems);
  const after = keyedBy(afterItems);
  const ids = new Set([...before.keys(), ...after.keys()]);
  const out = [];
  for (const id of ids) {
    const left = before.get(id) ?? null;
    const right = after.get(id) ?? null;
    if (stableStringify(left) !== stableStringify(right)) out.push({ id, before: left ? clone(left) : null });
  }
  return out;
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

function restoreKeyed(items, changes) {
  const map = keyedBy(items);
  for (const change of changes || []) {
    if (change.before === null) map.delete(change.id);
    else map.set(change.id, clone(change.before));
  }
  return [...map.values()];
}

export function applyUndoPatch(inputState, patch) {
  const state = normalizeState(clone(inputState));
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
    const existing = state.evidence[id];
    if (existing && stableStringify(existing) !== stableStringify(evidence)) {
      throw new Error(`deterministic evidence id collision: ${id}`);
    }
    if (!existing) state.evidence[id] = evidence;
    added.push(id);
  }
  record.evidenceIds = boundedEvidenceRefs([...record.evidenceIds, ...added]);
}

function addRelatedLinks(state, record, mutation, context, counter, appendedLinks = null) {
  for (const relatedId of uniqueStrings(mutation.relatedRecordIds, LIMITS.linksPerRecord, 120)) {
    if (relatedId === record.id || !state.records.some(item => item.id === relatedId)) continue;
    counter.value += 1;
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

export function reduceMutations(inputState, batch) {
  const state = normalizeState(clone(inputState));
  const before = normalizeState(clone(inputState));
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
  const linkCounter = { value: 0 };

  if (proposals.some(item => item?.action && item.action !== 'noop')
    && (context.messageId === null || !context.lineageKey)) {
    return {
      state,
      undo: null,
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
      addRelatedLinks(state, record, mutation, context, linkCounter, appendedLinks);
      applied.push({ action, recordId: id });
      upsertedRecords.push(clone(record));
      continue;
    }

    const record = state.records.find(item => item.id === boundedText(mutation.recordId, 120));
    if (!record) {
      rejected.push({ mutation, reason: 'target record does not exist' });
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
      record.status = 'resolved';
      if (boundedText(mutation.summary, LIMITS.summaryChars)) record.summary = boundedText(mutation.summary, LIMITS.summaryChars);
    } else if (action === 'supersede') {
      record.status = 'superseded';
      if (boundedText(mutation.summary, LIMITS.summaryChars)) record.summary = boundedText(mutation.summary, LIMITS.summaryChars);
    }

    if (Object.hasOwn(mutation, 'timeAnchor')) {
      record.timeAnchor = boundedText(mutation.timeAnchor, 160);
    }

    addEvidence(state, record, mutation, context, evidenceCounter);
    addRelatedLinks(state, record, mutation, context, linkCounter, appendedLinks);
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
    undo: buildUndoPatch(before, state),
    applied,
    rejected,
    indexDelta: {
      upsertedRecords,
      appendedLinks,
      corpusRecords: state.records.length,
    },
  };
}

export function canonicalDomain(state) {
  const normalized = normalizeState(state);
  return {
    records: clone(normalized.records),
    evidence: clone(normalized.evidence),
    links: clone(normalized.links),
    lastCaptureMessage: normalized.lastCaptureMessage,
    spatial: clone(normalized.spatial),
  };
}

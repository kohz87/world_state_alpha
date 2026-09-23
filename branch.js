import { LIMITS, ROLLBACK_JOURNAL_VERSION } from './constants.js';
import { deterministicId, hashText, stableStringify } from './hash.js';
import {
  applyUndoPatch,
  buildUndoPatch,
  canonicalDomain,
  clone,
  normalizeState,
} from './state-core.js';
import { createSpatialState } from './spatial-core.js';
import { sanitizeAssistantNarration } from './narrative-sanitizer.js';

function messageContent(message) {
  if (!message || typeof message !== 'object') return '';
  if (typeof message.mes === 'string') return message.mes;
  if (typeof message.content === 'string') return message.content;
  if (typeof message.text === 'string') return message.text;
  return '';
}

export function fingerprintMessage(message) {
  return hashText(stableStringify({
    role: message?.role || '',
    name: message?.name || '',
    is_user: Boolean(message?.is_user),
    is_system: Boolean(message?.is_system),
    content: messageContent(message),
  }));
}

export function fingerprintAssistantNarration(message) {
  return hashText(sanitizeAssistantNarration(messageContent(message)));
}

function lineageRole(message) {
  if (message?.role === 'user' || message?.is_user === true) return 'user';
  if (message?.role === 'assistant' || (message?.is_user === false && message?.is_system !== true)) return 'assistant';
  return 'system';
}

function lineageEntry(message, messageId, parentLineageKey) {
  const fingerprint = fingerprintMessage(message);
  const lineageKey = deterministicId('ln', [parentLineageKey, fingerprint]);
  const role = lineageRole(message);
  return {
    messageId,
    fingerprint,
    lineageKey,
    parentLineageKey,
    role,
    narrationFingerprint: role === 'user' ? '' : fingerprintAssistantNarration(message),
  };
}

export function chatLineage(chat = []) {
  const out = [];
  let parentLineageKey = 'root';
  for (let messageId = 0; messageId < chat.length; messageId += 1) {
    const entry = lineageEntry(chat[messageId], messageId, parentLineageKey);
    out.push(entry);
    parentLineageKey = entry.lineageKey;
  }
  return out;
}

function rewriteOwnedLineageMetadata(value, previousLineage, nextLineage) {
  if (Array.isArray(value)) {
    return value.map(item => rewriteOwnedLineageMetadata(item, previousLineage, nextLineage));
  }
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = rewriteOwnedLineageMetadata(item, previousLineage, nextLineage);
  }

  const sourceMessageId = Number.isInteger(out.sourceMessageId) ? out.sourceMessageId : null;
  const messageId = sourceMessageId ?? (Number.isInteger(out.messageId) ? out.messageId : null);
  if (messageId !== null && messageId >= 0 && messageId < previousLineage.length) {
    const previous = previousLineage[messageId];
    const next = nextLineage[messageId];
    if (previous && next && out.lineageKey === previous.lineageKey) {
      out.lineageKey = next.lineageKey;
    }
    if (previous && next && out.parentLineageKey === previous.parentLineageKey) {
      out.parentLineageKey = next.parentLineageKey;
    }
  }
  return out;
}

export function rebaseLineageMetadata(state, previousLineage, nextLineage) {
  const previous = Array.isArray(previousLineage) ? previousLineage : [];
  const next = Array.isArray(nextLineage) ? nextLineage : [];
  if (previous.length !== next.length) throw new Error('lineage rebase requires equal message counts');

  const normalized = normalizeState(clone(state));
  const stored = Array.isArray(normalized.lineage) ? normalized.lineage : [];
  if (stored.length !== previous.length
    || stored.some((entry, index) => entry?.lineageKey !== previous[index]?.lineageKey)) {
    throw new Error('lineage rebase source does not match stored branch');
  }

  const rebased = rewriteOwnedLineageMetadata(normalized, previous, next);
  rebased.lineage = clone(next);
  return normalizeState(rebased);
}

export function extendChatLineage(previous = [], chat = []) {
  const prior = Array.isArray(previous) ? previous : [];
  const rows = Array.isArray(chat) ? chat : [];
  if (prior.length > rows.length) return null;
  if (prior.length) {
    const tail = prior[prior.length - 1];
    if (!rows[prior.length - 1] || fingerprintMessage(rows[prior.length - 1]) !== tail?.fingerprint) return null;
  }

  let parentLineageKey = prior.length ? prior[prior.length - 1]?.lineageKey : 'root';
  if (!parentLineageKey) return null;

  const appended = [];
  for (let messageId = prior.length; messageId < rows.length; messageId += 1) {
    const entry = lineageEntry(rows[messageId], messageId, parentLineageKey);
    appended.push(entry);
    parentLineageKey = entry.lineageKey;
  }
  return appended;
}

export function firstLineageDivergence(previous = [], current = []) {
  const limit = Math.min(previous.length, current.length);
  for (let i = 0; i < limit; i += 1) {
    if (previous[i]?.lineageKey !== current[i]?.lineageKey) return i;
  }
  return previous.length === current.length ? -1 : limit;
}

function checkpointSnapshot(state) {
  return canonicalDomain(state);
}

function restoreCheckpoint(state, snapshot) {
  const restored = normalizeState(clone(state));
  restored.records = clone(snapshot.records || []);
  restored.evidence = clone(snapshot.evidence || {});
  restored.links = clone(snapshot.links || []);
  restored.lastCaptureMessage = Number.isInteger(snapshot.lastCaptureMessage) ? snapshot.lastCaptureMessage : null;
  if (snapshot.spatial) {
    restored.spatial = clone(snapshot.spatial);
  } else {
    restored.spatial = createSpatialState();
  }
  return normalizeState(restored);
}

function trimJournal(state, maxEntries) {
  const cap = Math.max(1, Number(maxEntries) || LIMITS.rollbackEntries);
  if (state.rollbackJournal.length <= cap) {
    const first = state.rollbackJournal[0];
    state.rollbackJournalFloorMessageId = first ? Math.max(-1, first.beforeMessageId) : state.rollbackHead?.messageId ?? -1;
    return;
  }
  state.rollbackJournal = state.rollbackJournal.slice(-cap);
  const first = state.rollbackJournal[0];
  if (first) first.prevSeq = 0;
  state.rollbackJournalFloorMessageId = first ? Math.max(-1, first.beforeMessageId) : -1;
}

function trimCheckpoints(state, maxCheckpoints) {
  const cap = Math.max(1, Number(maxCheckpoints) || LIMITS.checkpoints);
  if (state.checkpoints.length > cap) state.checkpoints = state.checkpoints.slice(-cap);
}

export function commitMutationBoundary(beforeState, afterState, chat, messageId, reason = 'mutation', options = {}) {
  const suppliedLineage = Array.isArray(options.lineage) ? options.lineage : null;
  const lineage = suppliedLineage || chatLineage(chat);
  if (!Number.isInteger(messageId) || messageId < 0 || messageId >= lineage.length) {
    throw new Error('commit boundary must reference an existing raw message');
  }
  const before = normalizeState(clone(beforeState));
  const next = normalizeState(clone(afterState));
  const boundary = lineage[messageId];
  const undo = buildUndoPatch(before, next);

  next.lineage = lineage;
  next.rollbackJournalVersion = ROLLBACK_JOURNAL_VERSION;
  next.recoveryRequired = null;

  if (undo) {
    const head = next.rollbackHead || before.rollbackHead;
    const currentJournal = clone(before.rollbackJournal || []);
    const currentSequence = Math.max(
      Number(before.rollbackJournalSequence) || 0,
      ...currentJournal.map(entry => Number(entry.seq) || 0),
      0,
    );
    const sameBoundary = head
      && head.messageId === messageId
      && head.lineageKey === boundary.lineageKey
      && head.seq > 0;
    let seq;
    let journal = currentJournal;
    let nextHead = null;

    if (sameBoundary) {
      const index = journal.findIndex(entry => entry.seq === head.seq);
      const existing = index >= 0 ? journal[index] : null;
      if (!existing) throw new Error('rollback head references a missing journal entry');
      const earliest = applyUndoPatch(before, existing.undo);
      const combinedUndo = buildUndoPatch(earliest, next);
      if (combinedUndo) {
        journal[index] = {
          ...existing,
          reason: String(reason || existing.reason || 'mutation'),
          undo: combinedUndo,
        };
        seq = existing.seq;
        nextHead = { seq, messageId, lineageKey: boundary.lineageKey };
      } else {
        journal.splice(index, 1);
        seq = existing.prevSeq;
        const predecessor = journal.find(entry => entry.seq === seq) || null;
        if (predecessor) {
          nextHead = {
            seq: predecessor.seq,
            messageId: predecessor.messageId,
            lineageKey: predecessor.lineageKey,
          };
        } else if (existing.beforeMessageId >= 0) {
          nextHead = {
            seq: 0,
            messageId: existing.beforeMessageId,
            lineageKey: lineage[existing.beforeMessageId]?.lineageKey || '',
          };
        }
      }
    } else {
      seq = currentSequence + 1;
      journal.push({
        seq,
        prevSeq: Math.max(0, Number(head?.seq) || 0),
        messageId,
        beforeMessageId: Number.isInteger(head?.messageId) ? head.messageId : messageId - 1,
        lineageKey: boundary.lineageKey,
        parentLineageKey: boundary.parentLineageKey,
        reason: String(reason || 'mutation'),
        undo,
      });
      nextHead = { seq, messageId, lineageKey: boundary.lineageKey };
    }

    next.rollbackJournal = journal;
    next.rollbackJournalSequence = Math.max(currentSequence, seq || 0);
    next.rollbackHead = nextHead;
  } else {
    next.rollbackJournal = clone(before.rollbackJournal || []);
    next.rollbackJournalSequence = Number(before.rollbackJournalSequence) || 0;
    next.rollbackHead = before.rollbackHead ? clone(before.rollbackHead) : null;
  }

  const existingCheckpoint = next.checkpoints.findIndex(item => item.messageId === messageId && item.lineageKey === boundary.lineageKey);
  const checkpoint = {
    messageId,
    lineageKey: boundary.lineageKey,
    rollbackSeq: Math.max(0, Number(next.rollbackHead?.seq) || 0),
    snapshot: checkpointSnapshot(next),
  };
  if (existingCheckpoint >= 0) next.checkpoints[existingCheckpoint] = checkpoint;
  else next.checkpoints.push(checkpoint);

  trimJournal(next, options.maxJournalEntries);
  trimCheckpoints(next, options.maxCheckpoints);
  return normalizeState(next);
}

function exactCheckpoint(state, currentLineage, targetMessageId) {
  if (targetMessageId < 0) return state.checkpoints.find(item => item.messageId === -1) || null;
  const key = currentLineage[targetMessageId]?.lineageKey;
  if (!key) return null;
  return [...state.checkpoints]
    .reverse()
    .find(item => item.messageId === targetMessageId && item.lineageKey === key) || null;
}

function restoreByJournal(state, previousLineage, divergence) {
  const targetMessageId = divergence - 1;
  const floor = Number.isInteger(state.rollbackJournalFloorMessageId) ? state.rollbackJournalFloorMessageId : -1;
  if (targetMessageId < floor) return null;

  const bySeq = new Map(state.rollbackJournal.map(entry => [entry.seq, entry]));
  let working = normalizeState(clone(state));
  let seq = Math.max(0, Number(state.rollbackHead?.seq) || 0);
  let headMessageId = Number.isInteger(state.rollbackHead?.messageId)
    ? state.rollbackHead.messageId
    : previousLineage.length - 1;

  while (headMessageId >= divergence && seq > 0) {
    const entry = bySeq.get(seq);
    if (!entry) return null;
    if (entry.messageId >= previousLineage.length || previousLineage[entry.messageId]?.lineageKey !== entry.lineageKey) return null;
    working = applyUndoPatch(working, entry.undo);
    seq = entry.prevSeq;
    headMessageId = entry.beforeMessageId;
  }
  if (headMessageId >= divergence) return null;
  return { state: working, headSeq: seq, targetMessageId };
}

function enrichLineageMetadata(previousLineage, currentLineage) {
  const next = clone(previousLineage);
  let upgraded = false;
  const limit = Math.min(next.length, currentLineage.length);

  for (let index = 0; index < limit; index += 1) {
    const previous = next[index];
    const current = currentLineage[index];
    if (!previous || !current || previous.fingerprint !== current.fingerprint) continue;

    if (!previous.role && current.role) {
      previous.role = current.role;
      upgraded = true;
    }
    if (previous.narrationFingerprint === undefined && current.narrationFingerprint !== undefined) {
      previous.narrationFingerprint = current.narrationFingerprint;
      upgraded = true;
    }
  }

  return { lineage: next, upgraded };
}

function semanticRewritePlan(
  state,
  previousLineage,
  currentLineage,
  options = {},
) {
  if (currentLineage.length < previousLineage.length) {
    return { kind: 'destructive', changedMessageIds: [] };
  }

  const changedMessageIds = [];
  let ambiguousLegacy = false;
  let semanticChange = false;
  let usedLegacyCandidate = false;

  for (let index = 0; index < previousLineage.length; index += 1) {
    const previous = previousLineage[index];
    const current = currentLineage[index];
    if (previous?.fingerprint === current?.fingerprint) continue;
    changedMessageIds.push(index);

    const legacyCandidate = index === options.passiveCaptureMessageId
      && state.lastCaptureMessage === index
      && String(options.passiveCaptureNarrationFingerprint || '')
      ? String(options.passiveCaptureNarrationFingerprint)
      : '';
    const previousRole = String(previous?.role || (legacyCandidate ? 'assistant' : ''));
    const previousNarration = String(previous?.narrationFingerprint || legacyCandidate || '');
    const currentRole = String(current?.role || '');
    const currentNarration = String(current?.narrationFingerprint || '');

    if (previousRole !== 'user'
      && currentRole !== 'user'
      && previousNarration
      && previousNarration === currentNarration) {
      if (!previous?.narrationFingerprint && legacyCandidate) usedLegacyCandidate = true;
      continue;
    }

    if (!previousRole || previous.narrationFingerprint === undefined) {
      if (currentRole !== 'user') ambiguousLegacy = true;
      else semanticChange = true;
      continue;
    }

    semanticChange = true;
  }

  if (!changedMessageIds.length) return { kind: 'none', changedMessageIds };
  if (semanticChange) return { kind: 'destructive', changedMessageIds };
  if (ambiguousLegacy) return { kind: 'ambiguous-legacy', changedMessageIds };
  return {
    kind: 'semantic-rebase',
    changedMessageIds,
    usedLegacyCandidate,
  };
}

export function reconcileBranch(inputState, chat, options = {}) {
  const state = normalizeState(clone(inputState));
  const currentLineage = chatLineage(chat);
  const storedLineage = Array.isArray(state.lineage) ? state.lineage : [];
  const enriched = enrichLineageMetadata(storedLineage, currentLineage);
  const previousLineage = enriched.lineage;
  state.lineage = previousLineage;
  const divergence = firstLineageDivergence(previousLineage, currentLineage);

  if (divergence === -1 || (divergence === previousLineage.length && currentLineage.length >= previousLineage.length)) {
    state.lineage = currentLineage;
    state.recoveryRequired = null;
    return {
      state,
      divergence: divergence === -1 ? -1 : divergence,
      action: divergence === -1 ? 'same' : 'forward-extension',
      exactRestored: true,
      failClosed: false,
      lineageMetadataUpgraded: enriched.upgraded,
    };
  }

  const semanticPlan = semanticRewritePlan(state, previousLineage, currentLineage, options);
  if (semanticPlan.kind === 'semantic-rebase') {
    const rebasedPrefix = rebaseLineageMetadata(
      state,
      previousLineage,
      currentLineage.slice(0, previousLineage.length),
    );
    rebasedPrefix.lineage = currentLineage;
    rebasedPrefix.recoveryRequired = null;
    return {
      state: normalizeState(rebasedPrefix),
      divergence,
      action: semanticPlan.changedMessageIds.length === 1
        && semanticPlan.changedMessageIds[0] === options.passiveCaptureMessageId
        && state.lastCaptureMessage === options.passiveCaptureMessageId
        ? 'passive-capture-rebase'
        : 'semantic-lineage-rebase',
      rebasedMessageIds: semanticPlan.changedMessageIds,
      exactRestored: true,
      failClosed: false,
      lineageMetadataUpgraded: enriched.upgraded,
    };
  }

  const targetMessageId = divergence - 1;
  if (semanticPlan.kind === 'ambiguous-legacy') {
    state.recoveryRequired = {
      reason: 'legacy-lineage-semantic-proof-unavailable',
      divergence,
      targetMessageId,
    };
    return {
      state,
      divergence,
      action: 'fail-closed',
      exactRestored: false,
      failClosed: true,
      lineageMetadataUpgraded: enriched.upgraded,
      ambiguousMessageIds: semanticPlan.changedMessageIds,
    };
  }
  const journalRestore = restoreByJournal(state, previousLineage, divergence);
  let restored = null;
  let action = '';

  if (journalRestore) {
    restored = journalRestore.state;
    action = 'rollback-journal';
  } else {
    const checkpoint = exactCheckpoint(state, currentLineage, targetMessageId);
    if (checkpoint) {
      restored = restoreCheckpoint(state, checkpoint.snapshot);
      action = 'exact-checkpoint';
    }
  }

  if (!restored) {
    state.recoveryRequired = {
      reason: 'exact-boundary-unavailable',
      divergence,
      targetMessageId,
    };
    return {
      state,
      divergence,
      action: 'fail-closed',
      exactRestored: false,
      failClosed: true,
    };
  }

  restored.rollbackJournal = state.rollbackJournal.filter(entry => entry.messageId < divergence);
  const retainedSeqs = new Set(restored.rollbackJournal.map(entry => entry.seq));
  const lastEntry = restored.rollbackJournal.at(-1) || null;
  restored.rollbackHead = lastEntry
    ? { seq: lastEntry.seq, messageId: lastEntry.messageId, lineageKey: lastEntry.lineageKey }
    : null;
  if (restored.rollbackHead && !retainedSeqs.has(restored.rollbackHead.seq)) restored.rollbackHead = null;
  restored.checkpoints = state.checkpoints.filter(item => item.messageId < divergence);
  restored.lineage = currentLineage;
  restored.recoveryRequired = null;
  trimJournal(restored, options.maxJournalEntries);
  trimCheckpoints(restored, options.maxCheckpoints);

  return {
    state: normalizeState(restored),
    divergence,
    action,
    exactRestored: true,
    failClosed: false,
  };
}

export function seedRootCheckpoint(inputState) {
  const state = normalizeState(clone(inputState));
  const existing = state.checkpoints.findIndex(item => item.messageId === -1);
  const checkpoint = {
    messageId: -1,
    lineageKey: 'root',
    rollbackSeq: 0,
    snapshot: checkpointSnapshot(state),
  };
  if (existing >= 0) state.checkpoints[existing] = checkpoint;
  else state.checkpoints.unshift(checkpoint);
  return state;
}

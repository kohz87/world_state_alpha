import { LIMITS, ROLLBACK_JOURNAL_VERSION } from './constants.js';
import { deterministicId, hashText, stableStringify } from './hash.js';
import {
  applyUndoPatch,
  buildUndoPatch,
  canonicalDomain,
  clone,
  cloneState,
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

// Lineage keys with every message's hidden flag ignored, so hiding or
// unhiding a message (is_system only) does not change them while any swipe,
// edit or delete still does. Used only to match Operations-log rows (missed
// captures) across hide/unhide; never for branch ownership. One pass up to the
// highest requested message. With `expectedLineage`, every message must still
// be the one that lineage recorded (its hidden flag aside), else no key is
// returned for it or any later message: an in-place edit since then never
// borrows the old row's identity.
export function contentLineageKeys(chat = [], messageIds = [], expectedLineage = null) {
  const rows = Array.isArray(chat) ? chat : [];
  const wanted = new Set((Array.isArray(messageIds) ? messageIds : [])
    .filter(id => Number.isInteger(id) && id >= 0 && id < rows.length));
  const out = new Map();
  if (!wanted.size) return out;
  const last = Math.max(...wanted);
  let parent = 'root';
  for (let index = 0; index <= last; index += 1) {
    const message = rows[index] && typeof rows[index] === 'object' ? rows[index] : {};
    const shown = { ...message, is_system: false };
    const shownFingerprint = fingerprintMessage(shown);
    if (Array.isArray(expectedLineage)) {
      const expected = expectedLineage[index]?.fingerprint;
      if (!expected || (expected !== shownFingerprint && expected !== fingerprintMessage({ ...message, is_system: true }))) break;
    }
    parent = deterministicId('cl', [parent, shownFingerprint]);
    if (wanted.has(index)) out.set(index, parent);
  }
  return out;
}

export function contentLineageKey(chat = [], messageId, expectedLineage = null) {
  return contentLineageKeys(chat, [messageId], expectedLineage).get(messageId) || '';
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

  const normalized = normalizeState(cloneState(state));
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

function domainHash(state) {
  return hashText(stableStringify(canonicalDomain(state)));
}

// Hash of the canonical domain a checkpoint snapshot restores, without cloning
// the whole state (its journal and every other checkpoint) to find out.
function snapshotDomainHash(state, snapshot = {}) {
  return domainHash({
    chatKey: state?.chatKey || '',
    records: snapshot?.records || [],
    evidence: snapshot?.evidence || {},
    links: snapshot?.links || [],
    lastCaptureMessage: Number.isInteger(snapshot?.lastCaptureMessage) ? snapshot.lastCaptureMessage : null,
    spatial: snapshot?.spatial || createSpatialState(),
  });
}

function checkpointSnapshot(state) {
  return canonicalDomain(state);
}

function restoreCheckpoint(state, snapshot) {
  const restored = normalizeState(cloneState(state));
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

// Earliest boundary <= maxMessageId at which an on-branch checkpoint holds
// exactly the current canonical state, or null. Only meaningful when nothing
// is journaled: then the state provably held from that boundary onward.
function unjournaledStateSince(state, lineage, maxMessageId) {
  const rows = Array.isArray(lineage) ? lineage : [];
  const candidates = (state.checkpoints || [])
    .filter(item => Number.isInteger(item?.messageId) && item.messageId <= maxMessageId
      && (item.messageId < 0 ? item.lineageKey === 'root' : rows[item.messageId]?.lineageKey === item.lineageKey))
    .sort((a, b) => a.messageId - b.messageId);
  if (!candidates.length) return null;
  const current = domainHash(state);
  const match = candidates.find(item => snapshotDomainHash(state, item.snapshot) === current);
  return match ? match.messageId : null;
}

function trimJournal(state, maxEntries) {
  const cap = Math.max(1, Number(maxEntries) || LIMITS.rollbackEntries);
  if (state.rollbackJournal.length <= cap) {
    const first = state.rollbackJournal[0];
    // An emptied journal keeps the floor it had: the remaining state is exact
    // only from there, and older trimmed history must not be advertised.
    const keptFloor = Number.isInteger(state.rollbackJournalFloorMessageId) ? Math.max(-1, state.rollbackJournalFloorMessageId) : -1;
    state.rollbackJournalFloorMessageId = first ? Math.max(-1, first.beforeMessageId) : state.rollbackHead?.messageId ?? keptFloor;
    return;
  }
  state.rollbackJournal = state.rollbackJournal.slice(-cap);
  // Journal entries are shared between state copies: replace, never edit in place.
  if (state.rollbackJournal[0]) state.rollbackJournal[0] = { ...state.rollbackJournal[0], prevSeq: 0 };
  const first = state.rollbackJournal[0];
  state.rollbackJournalFloorMessageId = first ? Math.max(-1, first.beforeMessageId) : -1;
}

function trimCheckpoints(state, maxCheckpoints) {
  const cap = Math.max(1, Number(maxCheckpoints) || LIMITS.checkpoints);
  if (state.checkpoints.length <= cap) return;

  const root = state.checkpoints.find(item => item?.messageId === -1 && item?.lineageKey === 'root') || null;
  if (!root) {
    state.checkpoints = state.checkpoints.slice(-cap);
    return;
  }

  const nonRoot = state.checkpoints.filter(item => item !== root);
  state.checkpoints = cap === 1
    ? [root]
    : [root, ...nonRoot.slice(-(cap - 1))];
}

export function commitMutationBoundary(beforeState, afterState, chat, messageId, reason = 'mutation', options = {}) {
  const suppliedLineage = Array.isArray(options.lineage) ? options.lineage : null;
  const lineage = suppliedLineage || chatLineage(chat);
  if (!Number.isInteger(messageId) || messageId < 0 || messageId >= lineage.length) {
    throw new Error('commit boundary must reference an existing raw message');
  }
  // Each normalization is a fresh private copy of the domain (history entries are shared and frozen).
  const before = normalizeState(beforeState);
  const next = normalizeState(afterState);
  const boundary = lineage[messageId];
  const undo = buildUndoPatch(before, next);

  next.lineage = lineage;
  next.rollbackJournalVersion = ROLLBACK_JOURNAL_VERSION;
  next.recoveryRequired = null;

  if (undo) {
    const head = next.rollbackHead || before.rollbackHead;
    const currentJournal = [...(before.rollbackJournal || [])];
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
      // With no head and no entries, undoing this first entry restores a
      // state that may be provably exact further back than messageId - 1: from
      // the earliest checkpoint on this branch whose snapshot it equals.
      const provenBase = head || journal.length ? null : unjournaledStateSince(before, lineage, messageId - 1);
      // Otherwise the state is only known exact from the journal floor. After a rollback lands on the floor,
      // the state already holds that message's own changes, so undoing this entry cannot reach messageId - 1:
      // never claim a base below the floor (rolling that message back must fail closed, not keep its changes).
      const floor = Number.isInteger(before.rollbackJournalFloorMessageId) ? before.rollbackJournalFloorMessageId : -1;
      journal.push({
        seq,
        prevSeq: Math.max(0, Number(head?.seq) || 0),
        messageId,
        beforeMessageId: Number.isInteger(head?.messageId) ? head.messageId : (provenBase ?? Math.max(messageId - 1, floor)),
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
    next.rollbackJournal = [...(before.rollbackJournal || [])];
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
  let working = normalizeState(cloneState(state));
  let seq = Math.max(0, Number(state.rollbackHead?.seq) || 0);
  // No head and no entries: the current state is exact at the target only if
  // a checkpoint at or before it on this branch holds the very same state.
  if (!state.rollbackHead && !state.rollbackJournal.length) {
    const provenBase = unjournaledStateSince(state, previousLineage, targetMessageId);
    return provenBase === null ? null : { state: normalizeState(cloneState(state)), headSeq: 0, targetMessageId };
  }
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

// SillyTavern's hide/unhide flips only `is_system`. The message still happened
// in the story (rebuild includes hidden roleplay), so a row whose stored
// fingerprint is reproduced by flipping that flag back is not a semantic change.
function visibilityToggleOnly(previous, message) {
  if (!message || typeof message !== 'object' || !previous?.fingerprint) return false;
  return fingerprintMessage({ ...message, is_system: !message.is_system }) === previous.fingerprint;
}

// Classifies a lineage change. `firstSemantic` is the first row whose story
// content really changed (or where the chat got shorter); rows before it that
// differ only by narration-equivalent rewrites or hide/unhide can be rebased.
function semanticRewritePlan(previousLineage, currentLineage, chat = []) {
  const shared = Math.min(previousLineage.length, currentLineage.length);
  const changedMessageIds = [];
  let firstSemantic = null;

  for (let index = 0; index < shared; index += 1) {
    const previous = previousLineage[index];
    const current = currentLineage[index];
    if (previous?.fingerprint === current?.fingerprint) continue;
    changedMessageIds.push(index);
    if (visibilityToggleOnly(previous, chat[index])) continue;

    const previousRole = String(previous?.role || '');
    const previousNarration = String(previous?.narrationFingerprint || '');
    const currentRole = String(current?.role || '');
    const currentNarration = String(current?.narrationFingerprint || '');

    if (previousRole
      && previousRole !== 'user'
      && currentRole !== 'user'
      && previousNarration
      && previousNarration === currentNarration) {
      continue;
    }

    firstSemantic = index;
    break;
  }

  if (firstSemantic === null && currentLineage.length < previousLineage.length) firstSemantic = currentLineage.length;
  if (firstSemantic !== null) return { kind: 'destructive', changedMessageIds, firstSemantic };
  if (!changedMessageIds.length) return { kind: 'none', changedMessageIds };
  return { kind: 'semantic-rebase', changedMessageIds };
}

// The first message whose story really changed since `previousLineage` was
// recorded (hide/unhide and narration-equivalent rewrites are not changes),
// or `previousLineage.length` when none did.
export function firstStoryChange(previousLineage, chat) {
  const previous = Array.isArray(previousLineage) ? previousLineage : [];
  const rows = Array.isArray(chat) ? chat : [];
  const plan = semanticRewritePlan(previous, chatLineage(rows), rows);
  return plan.kind === 'destructive' ? plan.firstSemantic : previous.length;
}

export function reconcileBranch(inputState, chat, options = {}) {
  const state = normalizeState(cloneState(inputState));
  const currentLineage = chatLineage(chat);
  const previousLineage = Array.isArray(state.lineage) ? state.lineage : [];
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
    };
  }

  const semanticPlan = semanticRewritePlan(previousLineage, currentLineage, Array.isArray(chat) ? chat : []);
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
    };
  }

  // Roll back only from the first real change. Visibility-only or
  // narration-equivalent rows before it keep their state and are rebased.
  const cut = Math.max(divergence, Number.isInteger(semanticPlan.firstSemantic) ? semanticPlan.firstSemantic : divergence);
  const targetMessageId = cut - 1;
  const journalRestore = restoreByJournal(state, previousLineage, cut);
  let restored = null;
  let action = '';

  if (journalRestore) {
    restored = journalRestore.state;
    action = 'rollback-journal';
  } else {
    const checkpoint = exactCheckpoint(state, previousLineage, targetMessageId);
    if (checkpoint) {
      restored = restoreCheckpoint(state, checkpoint.snapshot);
      action = 'exact-checkpoint';
    }
  }

  if (!restored) {
    state.recoveryRequired = {
      reason: 'exact-boundary-unavailable',
      divergence: cut,
      targetMessageId,
    };
    return {
      state,
      divergence: cut,
      action: 'fail-closed',
      exactRestored: false,
      failClosed: true,
    };
  }

  restored.rollbackJournal = state.rollbackJournal.filter(entry => entry.messageId < cut);
  const retainedSeqs = new Set(restored.rollbackJournal.map(entry => entry.seq));
  const lastEntry = restored.rollbackJournal.at(-1) || null;
  restored.rollbackHead = lastEntry
    ? { seq: lastEntry.seq, messageId: lastEntry.messageId, lineageKey: lastEntry.lineageKey }
    : null;
  if (restored.rollbackHead && !retainedSeqs.has(restored.rollbackHead.seq)) restored.rollbackHead = null;
  restored.checkpoints = state.checkpoints.filter(item => item.messageId < cut);
  // A checkpoint restore with no retained entries is exact from its own boundary.
  if (action === 'exact-checkpoint' && !restored.rollbackJournal.length) {
    restored.rollbackJournalFloorMessageId = targetMessageId;
  }
  if (cut > divergence) {
    restored.lineage = previousLineage.slice(0, cut);
    restored = rebaseLineageMetadata(restored, previousLineage.slice(0, cut), currentLineage.slice(0, cut));
  }
  restored.lineage = currentLineage;
  restored.recoveryRequired = null;
  trimJournal(restored, options.maxJournalEntries);
  trimCheckpoints(restored, options.maxCheckpoints);

  return {
    state: normalizeState(restored),
    divergence: cut,
    action,
    exactRestored: true,
    failClosed: false,
  };
}

// First message a partial rebuild can start from: the journal proves every
// boundary at or after its floor (it keeps the most recent entries only).
// Earlier starts need Full chat.
export function earliestPartialRebuildStart(inputState) {
  const floor = Number.isInteger(inputState?.rollbackJournalFloorMessageId) ? inputState.rollbackJournalFloorMessageId : -1;
  return Math.max(1, floor + 1);
}

export function seedRootCheckpoint(inputState) {
  const state = normalizeState(cloneState(inputState));
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

// Parked branches: when a rollback abandons a suffix (swipe, delete,
// regenerate), the pre-rollback state is kept in memory so that returning to
// exactly the same messages restores what those messages had established,
// without another capture. Resume is exact-only: the current state must be
// byte-identical to the base the branch was abandoned from, and the returning
// messages must reproduce the parked lineage keys (same parent chain + content).

// Journal entries and checkpoints at or before the base are the same ones the
// current branch keeps, so a parked branch holds only its own; resume merges
// the live ones back.
function compactParkedState(state, baseMessageId) {
  const parked = normalizeState(cloneState(state));
  parked.checkpoints = parked.checkpoints.filter(item => item.messageId > baseMessageId);
  parked.rollbackJournal = parked.rollbackJournal.filter(entry => entry.messageId > baseMessageId);
  parked.recoveryRequired = null;
  return parked;
}

// Re-derive lineage keys after the live prefix changed (for example rows
// before the cut were hidden and rebased): each later key chains from the new
// parent with the row's own unchanged fingerprint.
function relinkLineage(previous, prefix) {
  const out = [];
  let parent = 'root';
  for (let index = 0; index < previous.length; index += 1) {
    if (index < prefix.length) {
      out.push(clone(prefix[index]));
      parent = prefix[index].lineageKey;
      continue;
    }
    const entry = previous[index];
    const lineageKey = deterministicId('ln', [parent, entry.fingerprint]);
    out.push({ ...clone(entry), parentLineageKey: parent, lineageKey });
    parent = lineageKey;
  }
  return out;
}

// A parked branch's base is compared by content, ignoring lineage keys: a
// later hide/unhide or narration-equivalent rewrite in the shared prefix
// rewrites those keys in evidence without changing what the state says.
const LINEAGE_KEY_FIELDS = /"(?:parentLineageKey|lineageKey)":"[^"]*",?/g;

function parkContentHash(state) {
  return hashText(stableStringify(canonicalDomain(state)).replace(LINEAGE_KEY_FIELDS, ''));
}

// After a proven prefix rebase (rows before `provenLength` changed only by
// hide/unhide or narration-equivalent rewrites), parked branches whose base
// lies in that prefix are relinked onto the new lineage keys, so swiping back
// to an identical parked reply still resumes it.
export function relinkParkedBranches(parks = [], previousLineage = [], currentLineage = [], provenLength = 0) {
  const previous = Array.isArray(previousLineage) ? previousLineage : [];
  const current = Array.isArray(currentLineage) ? currentLineage : [];
  const proven = Math.min(Number(provenLength) || 0, previous.length, current.length);
  return (Array.isArray(parks) ? parks : []).map(park => {
    const base = Number(park?.baseMessageId);
    if (!Number.isInteger(base) || base < 0 || base >= proven) return park;
    if (previous[base]?.lineageKey !== park.baseLineageKey || current[base]?.lineageKey === park.baseLineageKey) return park;
    try {
      const lineage = park.state.lineage || [];
      const relinked = relinkLineage(lineage, current.slice(0, base + 1));
      const state = rebaseLineageMetadata(park.state, lineage, relinked);
      return { ...park, baseLineageKey: current[base].lineageKey, firstLineageKey: state.lineage[base + 1]?.lineageKey || park.firstLineageKey, state };
    } catch {
      return park;
    }
  });
}

export function parkAbandonedBranch(beforeState, result) {
  if (!result || result.failClosed || !['rollback-journal', 'exact-checkpoint'].includes(result.action)) return null;
  const before = normalizeState(beforeState);
  const baseMessageId = Number(result.divergence) - 1;
  const abandoned = before.lineage?.[baseMessageId + 1];
  if (!Number.isInteger(baseMessageId) || baseMessageId < -1 || !abandoned?.lineageKey) return null;
  const baseDomainHash = parkContentHash(result.state);
  if (parkContentHash(before) === baseDomainHash) return null;

  let source = before;
  const livePrefix = (result.state.lineage || []).slice(0, baseMessageId + 1);
  if (livePrefix.some((entry, index) => entry?.lineageKey !== before.lineage[index]?.lineageKey)) {
    try {
      source = rebaseLineageMetadata(before, before.lineage, relinkLineage(before.lineage, livePrefix));
    } catch {
      return null;
    }
  }
  return {
    baseMessageId,
    baseLineageKey: baseMessageId < 0 ? 'root' : String(livePrefix[baseMessageId]?.lineageKey || ''),
    baseDomainHash,
    firstLineageKey: source.lineage[baseMessageId + 1].lineageKey,
    state: compactParkedState(source, baseMessageId),
  };
}

export function resumeParkedBranch(inputState, chat, parks = [], options = {}) {
  const state = normalizeState(inputState);
  const lineage = Array.isArray(state.lineage) ? state.lineage : [];
  if (!Array.isArray(parks) || !parks.length || state.recoveryRequired) return null;
  let currentHash = null;
  const journalTop = state.rollbackJournal.reduce((max, entry) => Math.max(max, Number(entry?.messageId)), -1);

  for (let index = parks.length - 1; index >= 0; index -= 1) {
    const park = parks[index];
    const base = Number(park?.baseMessageId);
    if (!Number.isInteger(base) || base + 1 >= lineage.length) continue;
    if (base >= 0 && lineage[base]?.lineageKey !== park.baseLineageKey) continue;
    if (lineage[base + 1]?.lineageKey !== park.firstLineageKey) continue;
    if (journalTop > base) continue;
    currentHash ??= parkContentHash(state);
    if (park.baseDomainHash !== currentHash) continue;

    const resumed = reconcileBranch(park.state, chat, options);
    if (resumed.failClosed || !resumed.exactRestored) continue;
    const next = normalizeState(resumed.state);
    next.checkpoints = [
      ...state.checkpoints.filter(item => item.messageId <= base),
      ...next.checkpoints.filter(item => item.messageId > base),
    ];
    next.rollbackJournal = [
      ...state.rollbackJournal.filter(entry => entry.messageId <= base),
      ...next.rollbackJournal.filter(entry => entry.messageId > base),
    ].sort((a, b) => a.seq - b.seq);
    next.rollbackJournalFloorMessageId = state.rollbackJournalFloorMessageId;
    trimJournal(next, options.maxJournalEntries);
    trimCheckpoints(next, options.maxCheckpoints);
    next.rollbackJournalSequence = Math.max(
      Number(next.rollbackJournalSequence) || 0,
      Number(state.rollbackJournalSequence) || 0,
    );
    return { state: next, parkIndex: index, divergence: resumed.divergence };
  }
  return null;
}

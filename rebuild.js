import { chatLineage, commitMutationBoundary, earliestPartialRebuildStart, firstStoryChange, reconcileBranch, seedRootCheckpoint } from './branch.js';
import { CAPTURE_LIMITS, captureDue, hiddenConversationRole, normalizeCaptureExchange, roleOf, runCaptureOperation } from './capture.js';
import { hashText, stableStringify } from './hash.js';
import { extractContextTerms, normalizeAnchor, selectRelevantRecords } from './relevance.js';
import { selectRelevantLocations } from './spatial-relevance.js';
import { applySpatialUndoPatch } from './spatial-core.js';
import { canonicalDomain, clone, createState, normalizeState } from './state-core.js';

export const REBUILD_LIMITS = Object.freeze({
  maxBoundaries: 1024,
  maxVisibleRecords: 8,
  resolvedVisibleRecords: 2,
  lifecycleVisibleRecords: 2,
  lifecycleRecentMessages: 12,
});


function rebuildRoleOf(message, includeHiddenMessages) {
  if (message?.is_system === true) {
    return includeHiddenMessages ? hiddenConversationRole(message) : 'system';
  }
  return roleOf(message);
}

function virtualizeRebuildMessage(message, role) {
  const copy = clone(message);
  if (role === 'user') {
    copy.role = 'user';
    copy.is_user = true;
    copy.is_system = false;
  } else if (role === 'assistant') {
    copy.role = 'assistant';
    copy.is_user = false;
    copy.is_system = false;
  }
  return copy;
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function exchangeText(exchange) {
  return normalizeCaptureExchange(exchange)
    .map(message => message.content)
    .filter(Boolean)
    .join('\n');
}

export function planChronologicalRebuild(chat = [], {
  maxBoundaries = REBUILD_LIMITS.maxBoundaries,
  startMessageId = 0,
  includeHiddenMessages = true,
} = {}) {
  const rows = Array.isArray(chat) ? chat : [];
  const lineage = chatLineage(rows);
  const limit = boundedInt(maxBoundaries, REBUILD_LIMITS.maxBoundaries, 1, 4096);
  const start = boundedInt(startMessageId, 0, 0, Math.max(0, rows.length));
  const windows = [];
  let hiddenMessagesIncluded = 0;
  let hiddenAssistantBoundaries = 0;
  let previousAssistant = -1;
  for (let messageId = start - 1; messageId >= 0; messageId -= 1) {
    if (rebuildRoleOf(rows[messageId], includeHiddenMessages) === 'assistant') {
      previousAssistant = messageId;
      break;
    }
  }

  for (let messageId = start; messageId < rows.length; messageId += 1) {
    const boundaryRole = rebuildRoleOf(rows[messageId], includeHiddenMessages);
    if (boundaryRole !== 'assistant') continue;
    if (rows[messageId]?.is_system === true) hiddenAssistantBoundaries += 1;

    const raw = rows.slice(previousAssistant + 1, messageId + 1);
    const exchange = raw.map((message, offset) => {
      const sourceMessageId = previousAssistant + 1 + offset;
      const role = rebuildRoleOf(message, includeHiddenMessages);
      // A row that stays out of the conversation (genuine system rows, or hidden rows when hidden messages
      // are excluded) is marked as system so capture never reads a hidden user turn as current evidence.
      const virtual = role === 'system'
        ? { ...clone(message), role: 'system', is_user: false, is_system: true }
        : virtualizeRebuildMessage(message, role);
      if (message?.is_system === true && role !== 'system') hiddenMessagesIncluded += 1;
      return {
        ...virtual,
        messageId: sourceMessageId,
        lineageKey: lineage[sourceMessageId]?.lineageKey || '',
      };
    });
    windows.push({
      messageId,
      lineageKey: lineage[messageId]?.lineageKey || '',
      exchange,
    });
    previousAssistant = messageId;
  }

  if (windows.length > limit) {
    const error = new Error(`rebuild requires ${windows.length} assistant boundaries, exceeding configured limit ${limit}`);
    error.code = 'WORLD_STATE_REBUILD_BOUNDARY_LIMIT';
    error.boundaries = windows.length;
    error.limit = limit;
    throw error;
  }

  return {
    lineage,
    windows,
    metrics: {
      chatMessages: rows.length,
      assistantBoundaries: windows.length,
      maxBoundaries: limit,
      startMessageId: start,
      includeHiddenMessages: Boolean(includeHiddenMessages),
      hiddenMessagesIncluded,
      hiddenAssistantBoundaries,
    },
  };
}

function rebuildMatchContext(recentText) {
  return {
    haystack: normalizeAnchor(recentText),
    terms: new Set(extractContextTerms(recentText)),
  };
}

function historicalRelevant(record, context) {
  const anchorHit = (record?.anchors || []).some(anchor => {
    const normalized = normalizeAnchor(anchor);
    if (!normalized) return false;
    const anchorTerms = normalized.split(' ').filter(Boolean);
    return anchorTerms.length > 1
      ? context.haystack.includes(normalized)
      : context.terms.has(normalized);
  });
  if (anchorHit) return true;

  const summaryTerms = extractContextTerms(record?.summary || '');
  let overlap = 0;
  for (const term of summaryTerms) if (context.terms.has(term)) overlap += 1;
  return overlap >= 2;
}

const REBUILD_DIRECT_STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'onto', 'over', 'under', 'after', 'before',
  'while', 'where', 'when', 'then', 'than', 'they', 'them', 'their', 'there', 'here', 'have', 'has',
  'had', 'was', 'were', 'are', 'is', 'been', 'being', 'will', 'would', 'could', 'should', 'about',
  'among', 'through', 'around', 'still', 'current', 'currently', 'now', 'near', 'behind', 'outside',
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'first', 'second',
  'third', 'last', 'remain', 'remains', 'active',
]);

function rebuildDirectTerms(value) {
  return normalizeAnchor(value)
    .split(' ')
    .filter(token => token.length >= 3 && !REBUILD_DIRECT_STOPWORDS.has(token))
    .map(token => {
      if (token.length > 5 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
      if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
      return token;
    });
}

function rebuildDirectlyAddresses(record, recentText) {
  const haystack = normalizeAnchor(recentText);
  if (!haystack) return false;

  const anchors = (Array.isArray(record?.anchors) ? record.anchors : [])
    .map(normalizeAnchor)
    .filter(Boolean);
  if (anchors.some(anchor => anchor.includes(' ') && ` ${haystack} `.includes(` ${anchor} `))) return true;
  if (anchors.length === 1 && anchors[0].length >= 5 && ` ${haystack} `.includes(` ${anchors[0]} `)) return true;

  const left = new Set(rebuildDirectTerms(record?.summary || ''));
  const right = new Set(rebuildDirectTerms(recentText));
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared >= 2;
}

function rebuildLifecycleAndHistoryCandidates(state, recentText, boundaryMessageId) {
  const lifecycle = [];
  const historical = [];
  const context = rebuildMatchContext(recentText);

  for (const record of state.records || []) {
    const lastChanged = Number.isInteger(record?.lastChangedMessage) ? record.lastChangedMessage : -1;
    const overlapsExchange = historicalRelevant(record, context);
    const directlyAddressed = record?.kind === 'development' && record?.status === 'active'
      ? rebuildDirectlyAddresses(record, recentText)
      : false;

    if (record?.kind === 'development' && record?.status === 'active') {
      const recentlyChanged = Number.isInteger(boundaryMessageId)
        && lastChanged >= 0
        && boundaryMessageId > lastChanged
        && (boundaryMessageId - lastChanged) <= REBUILD_LIMITS.lifecycleRecentMessages;
      if (overlapsExchange || recentlyChanged) {
        lifecycle.push({ record, overlapsExchange, directlyAddressed, lastChanged });
      }
      continue;
    }

    if (['resolved', 'superseded'].includes(record?.status) && overlapsExchange) {
      historical.push({ record, lastChanged });
    }
  }

  lifecycle.sort((left, right) => {
    if (left.overlapsExchange !== right.overlapsExchange) return left.overlapsExchange ? -1 : 1;
    if (right.lastChanged !== left.lastChanged) return right.lastChanged - left.lastChanged;
    return String(left.record?.id || '').localeCompare(String(right.record?.id || ''));
  });
  historical.sort((left, right) => {
    if (right.lastChanged !== left.lastChanged) return right.lastChanged - left.lastChanged;
    return String(left.record?.id || '').localeCompare(String(right.record?.id || ''));
  });

  const selectedLifecycle = lifecycle.slice(0, REBUILD_LIMITS.lifecycleVisibleRecords);
  return {
    lifecycle: selectedLifecycle.map(item => item.record),
    lifecycleContextRecordIds: selectedLifecycle.length === 1 && !selectedLifecycle[0].directlyAddressed
      ? [selectedLifecycle[0].record?.id].filter(Boolean)
      : [],
    historical: historical.slice(0, REBUILD_LIMITS.resolvedVisibleRecords).map(item => item.record),
  };
}

function visibleForRebuild(state, exchange, boundaryMessageId) {
  const recentText = exchangeText(exchange);
  const reserved = rebuildLifecycleAndHistoryCandidates(state, recentText, boundaryMessageId);
  const lifecycle = reserved.lifecycle;
  const historical = reserved.historical;

  const active = selectRelevantRecords(state, {
    recentText,
    currentMessageId: boundaryMessageId,
    maxRecords: REBUILD_LIMITS.maxVisibleRecords,
  }).selected.map(entry => entry.record);

  const byId = new Map();
  for (const record of lifecycle) {
    if (record?.id && !byId.has(record.id)) byId.set(record.id, record);
  }
  for (const record of historical) {
    if (byId.size >= REBUILD_LIMITS.maxVisibleRecords) break;
    if (record?.id && !byId.has(record.id)) byId.set(record.id, record);
  }
  for (const record of active) {
    if (byId.size >= REBUILD_LIMITS.maxVisibleRecords) break;
    if (record?.id && !byId.has(record.id)) byId.set(record.id, record);
  }
  const records = [...byId.values()].slice(0, CAPTURE_LIMITS.visibleRecords);
  const recordIds = new Set(records.map(record => record?.id).filter(Boolean));
  return {
    records,
    lifecycleContextRecordIds: reserved.lifecycleContextRecordIds.filter(id => recordIds.has(id)),
  };
}

export function rebuildSnapshotToken({ state, chat }) {
  const normalized = normalizeState(state);
  return hashText(stableStringify({
    domain: canonicalDomain(normalized),
    rollbackJournalSequence: normalized.rollbackJournalSequence,
    lineage: chatLineage(Array.isArray(chat) ? chat : []),
  }));
}

function semanticSnapshot(state) {
  const normalized = normalizeState(state);
  return {
    records: normalized.records
      .map(record => ({
        id: record.id,
        kind: record.kind,
        summary: record.summary,
        status: record.status,
        trend: record.trend,
        anchors: [...(record.anchors || [])],
        timeAnchor: record.timeAnchor,
        causedBy: [...(record.causedBy || [])],
        affects: [...(record.affects || [])],
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    links: normalized.links
      .map(link => ({
        id: link.id,
        from: link.from,
        to: link.to,
        type: link.type,
      }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id))),
    lastCaptureMessage: normalized.lastCaptureMessage,
  };
}

export function compareWorldStateSemantics(left, right) {
  const leftSnapshot = semanticSnapshot(left);
  const rightSnapshot = semanticSnapshot(right);
  const leftText = stableStringify(leftSnapshot);
  const rightText = stableStringify(rightSnapshot);
  return {
    equivalent: leftText === rightText,
    left: leftSnapshot,
    right: rightSnapshot,
  };
}

function spatialHasContent(spatial) {
  return Boolean(spatial?.locations?.length || spatial?.relations?.length || spatial?.routes?.length);
}

// With Spatial extraction off a rebuild still owns Spatial rollback. The
// original journal says when each Spatial change happened, so the rebuild
// replays it at the boundary where it happened (the first boundary at or after
// the change) and rollback undoes places with the records of that reply.
// Changes made after the chat's first real story change since the state was
// saved are not replayed (hide/unhide is not a change). When the chat changed
// at or below the journal floor while places existed, which places belong to
// the current story cannot be told apart: the rebuild still runs (Reality must
// stay recoverable) and keeps the places held at the floor, but says so.
function disabledSpatialTimeline(original, chat) {
  const journal = Array.isArray(original.rollbackJournal) ? original.rollbackJournal : [];
  const floor = Number.isInteger(original.rollbackJournalFloorMessageId) ? original.rollbackJournalFloorMessageId : -1;
  // Only Spatial patches are replayed; with none, Places stayed as they were since the floor.
  if (!journal.some(entry => entry?.undo?.spatial)) {
    const heldBeforeFloor = floor >= 0 && spatialHasContent(original.spatial);
    return {
      base: clone(original.spatial),
      unprovableBelow: heldBeforeFloor ? floor : -1,
      unverified: heldBeforeFloor && firstStoryChange(original.lineage, chat) <= floor,
      at: () => clone(original.spatial),
    };
  }
  const divergence = firstStoryChange(original.lineage, chat);
  const bySeq = new Map(journal.map(entry => [entry.seq, entry]));
  const steps = [];
  let spatial = clone(original.spatial);
  let seq = Math.max(0, Number(original.rollbackHead?.seq) || 0);
  while (seq > 0) {
    const entry = bySeq.get(seq);
    if (!entry) break;
    if (entry.undo?.spatial) {
      if (entry.messageId < divergence) steps.push({ messageId: entry.messageId, spatial });
      spatial = applySpatialUndoPatch(spatial, entry.undo.spatial);
    }
    seq = entry.prevSeq;
  }
  steps.reverse();
  const base = spatial;
  const heldBeforeFloor = floor >= 0 && spatialHasContent(base);
  return {
    base: clone(base),
    // Below this boundary the Spatial history is unknown (nothing proves when those places appeared).
    unprovableBelow: heldBeforeFloor ? floor : -1,
    unverified: heldBeforeFloor && divergence <= floor,
    at(messageId, last = false) {
      let current = base;
      for (const step of steps) if (last || step.messageId <= messageId) current = step.spatial;
      return clone(current);
    },
  };
}

export async function runManualRebuild({
  ctx,
  state,
  chat,
  chatKey,
  route = undefined,
  operationId = '',
  timeoutMs = undefined,
  signal = undefined,
  isCurrent = undefined,
  dispatcher = undefined,
  diagnostics = undefined,
  loreResolver = undefined,
  onProgress = undefined,
  maxBoundaries = REBUILD_LIMITS.maxBoundaries,
  startMessageId = 0,
  includeHiddenMessages = true,
  spatialEnabled = false,
  baseMap = null,
  spatialProfile = null,
  resume = null,
} = {}) {
  const original = normalizeState(state, { chatKey });
  const owner = String(chatKey || original.chatKey || '');
  if (!owner) throw new Error('chatKey is required');
  if (original.chatKey && original.chatKey !== owner) throw new Error('rebuild chatKey does not match state owner');

  const plan = planChronologicalRebuild(chat, {
    maxBoundaries,
    startMessageId,
    includeHiddenMessages,
  });
  if (plan.windows.length && typeof isCurrent !== 'function') {
    const error = new Error('manual rebuild requires an isCurrent(snapshotToken) guard');
    error.code = 'WORLD_STATE_REBUILD_CURRENT_GUARD_REQUIRED';
    throw error;
  }

  const snapshotToken = rebuildSnapshotToken({ state: original, chat });
  const current = () => typeof isCurrent !== 'function' || isCurrent(snapshotToken);

  if (!current()) {
    return {
      outcome: 'stale',
      state: clone(original),
      providerCalls: 0,
      processedBoundaries: 0,
      plan: plan.metrics,
      snapshotToken,
      failedBoundary: null,
    };
  }

  const spatialTimeline = spatialEnabled ? null : disabledSpatialTimeline(original, chat);
  const warnings = spatialTimeline?.unverified
    ? [{
      code: 'WORLD_STATE_REBUILD_SPATIAL_HISTORY_UNVERIFIED',
      message: 'Places were kept as they were before the oldest saved change, but the chat changed before that point, so some places may belong to an abandoned branch. Review Places, or rebuild with Places extraction on.',
    }]
    : [];
  const lastWindowMessageId = plan.windows.length ? plan.windows[plan.windows.length - 1].messageId : null;
  // The candidate's Spatial after boundary `messageId` when extraction is off.
  const withDisabledSpatial = (state, messageId) => (spatialTimeline
    ? { ...state, spatial: spatialTimeline.at(messageId, messageId === lastWindowMessageId) }
    : state);

  // An operator-initiated resume continues a failed rebuild from its failed
  // boundary with the candidate accepted up to there. It is only valid while
  // the canonical state and exact chat lineage are unchanged since the failure.
  const planKey = stableStringify({
    startMessageId: plan.metrics.startMessageId,
    maxBoundaries: plan.metrics.maxBoundaries,
    includeHiddenMessages: plan.metrics.includeHiddenMessages,
    windows: plan.windows.map(window => [window.messageId, window.lineageKey]),
  });
  let resumeFromMessageId = null;
  let resumedWindowIndex = -1;
  let candidate;
  if (resume) {
    resumedWindowIndex = Number.isInteger(resume.fromMessageId)
      ? plan.windows.findIndex(window => window.messageId === resume.fromMessageId)
      : -1;
    if (resume.snapshotToken !== snapshotToken || resume.planKey !== planKey || !resume.candidate || resumedWindowIndex < 0) {
      return {
        outcome: 'failure',
        state: clone(original),
        providerCalls: 0,
        processedBoundaries: 0,
        plan: plan.metrics,
        snapshotToken,
        failedBoundary: null,
        receipts: [],
        errorCode: 'WORLD_STATE_REBUILD_RESUME_STALE',
        errorMessage: 'The chat or World State changed since the rebuild failed, so it cannot resume. Start a new rebuild.',
      };
    }
    resumeFromMessageId = resume.fromMessageId;
    candidate = normalizeState(resume.candidate, { strictSchema: true, chatKey: owner });
  } else if (plan.metrics.startMessageId > 0) {
    const prefix = (Array.isArray(chat) ? chat : []).slice(0, plan.metrics.startMessageId);
    const currentLineage = chatLineage(Array.isArray(chat) ? chat : []);
    const priorLineage = Array.isArray(original.lineage) ? original.lineage : [];
    const prefixProven = priorLineage.length >= plan.metrics.startMessageId
      && priorLineage.slice(0, plan.metrics.startMessageId)
        .every((item, index) => item?.lineageKey && item.lineageKey === currentLineage[index]?.lineageKey);
    if (!prefixProven) {
      return {
        outcome: 'failure',
        state: clone(original),
        providerCalls: 0,
        processedBoundaries: 0,
        plan: plan.metrics,
        snapshotToken,
        failedBoundary: plan.metrics.startMessageId,
        receipts: [],
        errorCode: 'WORLD_STATE_REBUILD_RANGE_BASE_UNAVAILABLE',
        errorMessage: 'Partial rebuild requires exact canonical history before the selected start message. Stored lineage does not match the live prefix; reconcile the branch or use Full chat.',
      };
    }
    const restored = reconcileBranch(original, prefix);
    if (restored.failClosed || !restored.exactRestored) {
      return {
        outcome: 'failure',
        state: clone(original),
        providerCalls: 0,
        processedBoundaries: 0,
        plan: plan.metrics,
        snapshotToken,
        failedBoundary: plan.metrics.startMessageId,
        receipts: [],
        errorCode: 'WORLD_STATE_REBUILD_RANGE_BASE_UNAVAILABLE',
        errorMessage: plan.metrics.startMessageId < earliestPartialRebuildStart(original)
          ? 'The exact World State before message ' + plan.metrics.startMessageId
            + ' is no longer stored (only the most recent changes are kept). Start from message '
            + earliestPartialRebuildStart(original) + ' or later, or use Full chat.'
          : 'The exact World State before message ' + plan.metrics.startMessageId
            + ' cannot be proven from the saved history. Use Full chat.',
      };
    }
    candidate = normalizeState(restored.state, { strictSchema: true, chatKey: owner });
  } else {
    // Assemble the clean root first and only then snapshot it, so the root checkpoint carries the
    // Spatial profile/base map (or the preserved disabled Spatial state) that a later rollback restores.
    const root = createState(owner);
    if (spatialEnabled) {
      root.spatial.profile = spatialProfile || original.spatial?.profile || null;
      root.spatial.baseMapRef = original.spatial?.baseMapRef || null;
    } else {
      // Reality-only rebuild keeps the disabled sibling subsystem: its state before the first replayed change.
      root.spatial = spatialTimeline.base;
    }
    candidate = seedRootCheckpoint(root);
  }
  let providerCalls = 0;
  // Derived from the plan, never trusted from the resume point.
  let processedBoundaries = resume ? resumedWindowIndex : 0;
  const receipts = [];

  // Everything needed to resume from a failed boundary; kept by the host in
  // memory only and never persisted.
  const resumePoint = (failedMessageId, acceptedCandidate) => ({
    candidate: clone(acceptedCandidate),
    fromMessageId: failedMessageId,
    snapshotToken,
    planKey,
    processedBoundaries,
  });

  const cancelledResult = failedBoundary => ({
    outcome: 'cancelled',
    state: clone(original),
    providerCalls,
    processedBoundaries,
    plan: plan.metrics,
    snapshotToken,
    failedBoundary,
    receipts,
    errorCode: 'WORLD_STATE_ROUTE_CANCELLED',
    errorMessage: 'Rebuild was cancelled before canonical state replacement.',
  });

  const reportProgress = async (messageId, boundary) => {
    if (typeof onProgress !== 'function') return;
    try {
      await onProgress({
        operationId,
        messageId,
        processedBoundaries,
        totalBoundaries: plan.metrics.assistantBoundaries,
        providerCalls,
        ...boundary,
        currentRecords: (candidate.records || []).filter(record => record?.status === 'active').length,
        places: (candidate.spatial?.locations || []).filter(location => location?.status !== 'archived').length,
      });
    } catch {
      // Progress reporting is presentation-only and must never fail an atomic rebuild.
    }
  };

  for (const window of plan.windows) {
    if (resumeFromMessageId !== null && window.messageId < resumeFromMessageId) continue;
    if (signal?.aborted) return cancelledResult(window.messageId);
    if (!current()) {
      return {
        outcome: 'stale',
        state: clone(original),
        providerCalls,
        processedBoundaries,
        plan: plan.metrics,
        snapshotToken,
        failedBoundary: window.messageId,
        receipts,
      };
    }

    // A boundary whose assistant reply has no narration left after sanitization (an empty or image-only
    // reply, or only <writer_state>/tracker blocks) has nothing to capture. Live capture skips it with the
    // same captureDue rule, so the rebuild advances past it without a provider call instead of failing.
    if (!captureDue({ exchange: window.exchange, sourceMessageId: window.messageId })) {
      candidate = commitMutationBoundary(candidate, withDisabledSpatial(candidate, window.messageId), chat.slice(0, window.messageId + 1), window.messageId, 'rebuild', { lineage: plan.lineage.slice(0, window.messageId + 1) });
      receipts.push({ messageId: window.messageId, outcome: 'empty-boundary', providerCalls: 0, applied: 0, rejected: 0, aliasRepairs: 0, completenessHints: 0, rejections: [] });
      processedBoundaries += 1;
      await reportProgress(window.messageId, { boundaryApplied: 0, boundaryRejected: 0, aliasRepairs: 0, completenessHints: 0 });
      continue;
    }

    let loreText = '';
    if (typeof loreResolver === 'function') {
      try {
        loreText = String(await loreResolver({
          messageId: window.messageId,
          exchange: clone(window.exchange),
          state: clone(candidate),
        }) || '');
      } catch (error) {
        return {
          outcome: 'failure',
          state: clone(original),
          providerCalls,
          processedBoundaries,
          plan: plan.metrics,
          snapshotToken,
          failedBoundary: window.messageId,
          receipts,
          errorCode: error?.code || 'WORLD_STATE_REBUILD_LORE_FAILURE',
          errorMessage: String(error?.message || error),
          resume: resumePoint(window.messageId, candidate),
        };
      }
    }

    const visibleSelection = visibleForRebuild(candidate, window.exchange, window.messageId);
    const visibleRecords = visibleSelection.records;
    const lifecycleContextRecordIds = visibleSelection.lifecycleContextRecordIds;
    let visibleLocations = [];
    if (spatialEnabled) {
      const spatialRel = selectRelevantLocations(candidate.spatial, {
        baseMap,
        recentText: exchangeText(window.exchange),
        loreText,
        maxLocations: 6,
      });
      visibleLocations = spatialRel.selected.map(item => item.location);
    }
    const beforeStep = candidate;
    const result = await runCaptureOperation({
      ctx,
      state: beforeStep,
      exchange: window.exchange,
      visibleRecords,
      lifecycleContextRecordIds,
      loreText,
      chatKey: owner,
      sourceMessageId: window.messageId,
      sourceLineageKey: window.lineageKey,
      route,
      operationId: operationId ? `${operationId}:${window.messageId}` : `rebuild:${window.messageId}`,
      timeoutMs,
      signal,
      isCurrent: () => current(),
      ...(dispatcher ? { dispatcher } : {}),
      diagnostics,
      operation: 'rebuild',
      evidenceSourceClass: 'rebuild',
      label: 'rebuild',
      spatialEnabled,
      visibleLocations,
      baseMap,
      spatialProfile: candidate.spatial.profile,
    });

    providerCalls += result.providerCalls || 0;
    const realityRejected = Array.isArray(result.rejected) ? result.rejected : [];
    const spatialRejected = Array.isArray(result.spatial?.rejected) ? result.spatial.rejected : [];
    const allRejected = [...realityRejected, ...spatialRejected];
    const boundaryApplied = (Array.isArray(result.applied) ? result.applied.length : 0)
      + (Array.isArray(result.spatial?.applied) ? result.spatial.applied.length : 0);
    receipts.push({
      messageId: window.messageId,
      outcome: result.outcome,
      providerCalls: result.providerCalls || 0,
      applied: boundaryApplied,
      rejected: allRejected.length,
      aliasRepairs: Number(result.aliasRepairs) || 0,
      completenessHints: Number(result.completenessHints) || 0,
      rejections: allRejected.slice(0, 8).map(item => ({
        stage: String(item?.stage || '').slice(0, 40),
        code: String(item?.code || '').slice(0, 80),
        reason: String(item?.reason || '').slice(0, 240),
        duplicateRecordId: String(item?.duplicateRecordId || '').slice(0, 120),
      })),
    });

    const successfulBoundary = result.outcome === 'applied' || result.outcome === 'no-change';
    if (!successfulBoundary) {
      if (result.outcome === 'cancelled' || result.errorCode === 'WORLD_STATE_ROUTE_CANCELLED' || signal?.aborted) {
        return cancelledResult(window.messageId);
      }
      const stale = result.outcome === 'stale';
      return {
        outcome: stale ? 'stale' : 'failure',
        state: clone(original),
        providerCalls,
        processedBoundaries,
        plan: plan.metrics,
        snapshotToken,
        failedBoundary: window.messageId,
        receipts,
        errorCode: result.errorCode || `WORLD_STATE_REBUILD_BOUNDARY_${String(result.outcome || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
        ...(stale ? {} : { resume: resumePoint(window.messageId, beforeStep) }),
      };
    }

    {
      candidate = commitMutationBoundary(
        beforeStep,
        withDisabledSpatial(result.state, window.messageId),
        chat.slice(0, window.messageId + 1),
        window.messageId,
        'rebuild',
        // The plan already holds the chat's lineage; re-hashing the prefix at every step was quadratic.
        { lineage: plan.lineage.slice(0, window.messageId + 1) },
      );
    }
    processedBoundaries += 1;
    await reportProgress(window.messageId, {
      boundaryApplied,
      boundaryRejected: allRejected.length,
      aliasRepairs: Number(result.aliasRepairs) || 0,
      completenessHints: Number(result.completenessHints) || 0,
    });
  }

  if (signal?.aborted) return cancelledResult(null);

  // With extraction off the replayed Places are applied at each boundary. A range with no assistant
  // boundary applies none, so commit them at the last message (journaled, so rollback still undoes them).
  if (spatialTimeline && !plan.windows.length && chat.length) {
    const lastMessageId = chat.length - 1;
    candidate = commitMutationBoundary(
      candidate,
      { ...candidate, spatial: spatialTimeline.at(lastMessageId, true) },
      chat,
      lastMessageId,
      'rebuild',
      { lineage: plan.lineage },
    );
  }

  candidate.lineage = plan.lineage;
  candidate.recoveryRequired = null;
  if (spatialTimeline && spatialTimeline.unprovableBelow >= 0 && plan.metrics.startMessageId <= spatialTimeline.unprovableBelow) {
    // Places existed before the oldest saved change, so a rollback below it cannot be proven: keep only
    // journal entries and checkpoints from there on, exactly like a trimmed journal (it fails closed).
    // The first kept entry's state before it is also the state at the floor (no boundary lies between).
    const cutoff = spatialTimeline.unprovableBelow;
    candidate.rollbackJournal = (candidate.rollbackJournal || []).filter(entry => entry.messageId > cutoff);
    if (candidate.rollbackJournal[0]) {
      // Journal entries are shared between state copies: replace, never edit in place.
      const first = candidate.rollbackJournal[0];
      candidate.rollbackJournal[0] = { ...first, prevSeq: 0, beforeMessageId: Math.max(first.beforeMessageId, cutoff) };
    }
    candidate.checkpoints = (candidate.checkpoints || []).filter(item => item.messageId >= cutoff);
    if (candidate.rollbackHead && !candidate.rollbackJournal.some(entry => entry.seq === candidate.rollbackHead.seq)) candidate.rollbackHead = null;
    candidate.rollbackJournalFloorMessageId = Math.max(
      Number.isInteger(candidate.rollbackJournalFloorMessageId) ? candidate.rollbackJournalFloorMessageId : -1,
      cutoff,
    );
  }
  candidate = normalizeState(candidate, { strictSchema: true, chatKey: owner });

  if (!current()) {
    return {
      outcome: 'stale',
      state: clone(original),
      providerCalls,
      processedBoundaries,
      plan: plan.metrics,
      snapshotToken,
      failedBoundary: null,
      receipts,
    };
  }

  return {
    outcome: 'completed',
    state: candidate,
    providerCalls,
    processedBoundaries,
    plan: plan.metrics,
    snapshotToken,
    failedBoundary: null,
    receipts,
    warnings,
  };
}

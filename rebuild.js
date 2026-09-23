import { chatLineage, commitMutationBoundary, reconcileBranch, seedRootCheckpoint } from './branch.js';
import { CAPTURE_LIMITS, runCaptureOperation } from './capture.js';
import { hashText, stableStringify } from './hash.js';
import { extractContextTerms, normalizeAnchor, selectRelevantRecords } from './relevance.js';
import { selectRelevantLocations } from './spatial-relevance.js';
import { canonicalDomain, clone, createState, normalizeState } from './state-core.js';

export const REBUILD_LIMITS = Object.freeze({
  maxBoundaries: 1024,
  maxVisibleRecords: 8,
  resolvedVisibleRecords: 2,
});

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.mes === 'string') return message.mes;
  if (typeof message?.text === 'string') return message.text;
  return '';
}

function roleOf(message) {
  if (message?.role === 'user' || message?.is_user === true) return 'user';
  if (message?.role === 'assistant' || (message?.is_user === false && message?.is_system !== true)) return 'assistant';
  return 'system';
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(number)));
}

function exchangeText(exchange) {
  return (Array.isArray(exchange) ? exchange : [])
    .filter(message => roleOf(message) !== 'system')
    .map(messageText)
    .filter(Boolean)
    .join('\n');
}

export function planChronologicalRebuild(chat = [], {
  maxBoundaries = REBUILD_LIMITS.maxBoundaries,
  startMessageId = 0,
} = {}) {
  const rows = Array.isArray(chat) ? chat : [];
  const lineage = chatLineage(rows);
  const limit = boundedInt(maxBoundaries, REBUILD_LIMITS.maxBoundaries, 1, 4096);
  const start = boundedInt(startMessageId, 0, 0, Math.max(0, rows.length));
  const windows = [];
  let previousAssistant = start - 1;

  for (let messageId = start; messageId < rows.length; messageId += 1) {
    if (roleOf(rows[messageId]) !== 'assistant') continue;
    const raw = rows.slice(previousAssistant + 1, messageId + 1);
    const exchange = raw.map((message, offset) => {
      const sourceMessageId = previousAssistant + 1 + offset;
      return {
        ...clone(message),
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
    },
  };
}

function historicalRelevant(record, recentText) {
  const haystack = normalizeAnchor(recentText);
  const terms = new Set(extractContextTerms(recentText));
  const anchorHit = (record?.anchors || []).some(anchor => {
    const normalized = normalizeAnchor(anchor);
    if (!normalized) return false;
    const anchorTerms = normalized.split(' ').filter(Boolean);
    return anchorTerms.length > 1
      ? haystack.includes(normalized)
      : terms.has(normalized);
  });
  if (anchorHit) return true;

  const summaryTerms = extractContextTerms(record?.summary || '');
  let overlap = 0;
  for (const term of summaryTerms) if (terms.has(term)) overlap += 1;
  return overlap >= 2;
}

function visibleForRebuild(state, exchange, boundaryMessageId) {
  const recentText = exchangeText(exchange);
  const active = selectRelevantRecords(state, {
    recentText,
    currentMessageId: boundaryMessageId,
    maxRecords: Math.min(6, REBUILD_LIMITS.maxVisibleRecords),
  }).selected.map(entry => entry.record);

  const remaining = Math.max(0, REBUILD_LIMITS.maxVisibleRecords - active.length);
  if (!remaining) return active.slice(0, CAPTURE_LIMITS.visibleRecords);

  const historical = (state.records || [])
    .filter(record => ['resolved', 'superseded'].includes(record?.status))
    .filter(record => historicalRelevant(record, recentText))
    .sort((left, right) => {
      const a = Number.isInteger(left?.lastChangedMessage) ? left.lastChangedMessage : -1;
      const b = Number.isInteger(right?.lastChangedMessage) ? right.lastChangedMessage : -1;
      if (b !== a) return b - a;
      return String(left?.id || '').localeCompare(String(right?.id || ''));
    })
    .slice(0, Math.min(REBUILD_LIMITS.resolvedVisibleRecords, remaining));

  const byId = new Map();
  for (const record of [...active, ...historical]) {
    if (record?.id && !byId.has(record.id)) byId.set(record.id, record);
  }
  return [...byId.values()].slice(0, CAPTURE_LIMITS.visibleRecords);
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
  spatialEnabled = false,
  baseMap = null,
  spatialProfile = null,
} = {}) {
  const original = normalizeState(clone(state), { chatKey });
  const owner = String(chatKey || original.chatKey || '');
  if (!owner) throw new Error('chatKey is required');
  if (original.chatKey && original.chatKey !== owner) throw new Error('rebuild chatKey does not match state owner');

  const plan = planChronologicalRebuild(chat, { maxBoundaries, startMessageId });
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

  let candidate;
  if (plan.metrics.startMessageId > 0) {
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
        errorMessage: 'Partial rebuild requires exact canonical history before the selected start message. Use Full chat after a reset.',
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
        errorMessage: 'Exact canonical state before the selected start message is unavailable. Use Full chat or choose a later proven boundary.',
      };
    }
    candidate = normalizeState(clone(restored.state), { strictSchema: true, chatKey: owner });
  } else {
    candidate = seedRootCheckpoint(createState(owner));
    if (spatialEnabled) {
      candidate.spatial.profile = spatialProfile || original.spatial?.profile || null;
      candidate.spatial.baseMapRef = original.spatial?.baseMapRef || null;
    } else {
      // Reality-only rebuild must never erase the disabled sibling subsystem.
      candidate.spatial = clone(original.spatial);
    }
  }
  let providerCalls = 0;
  let processedBoundaries = 0;
  const receipts = [];

  for (const window of plan.windows) {
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
        };
      }
    }

    const visibleRecords = visibleForRebuild(candidate, window.exchange, window.messageId);
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
      return {
        outcome: result.outcome === 'stale' ? 'stale' : 'failure',
        state: clone(original),
        providerCalls,
        processedBoundaries,
        plan: plan.metrics,
        snapshotToken,
        failedBoundary: window.messageId,
        receipts,
        errorCode: result.errorCode || `WORLD_STATE_REBUILD_BOUNDARY_${String(result.outcome || 'UNKNOWN').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`,
      };
    }

    {
      candidate = commitMutationBoundary(
        beforeStep,
        result.state,
        chat.slice(0, window.messageId + 1),
        window.messageId,
        'rebuild',
      );
    }
    processedBoundaries += 1;
    if (typeof onProgress === 'function') {
      try {
        await onProgress({
          operationId,
          messageId: window.messageId,
          processedBoundaries,
          totalBoundaries: plan.metrics.assistantBoundaries,
          providerCalls,
          boundaryApplied,
          boundaryRejected: allRejected.length,
          aliasRepairs: Number(result.aliasRepairs) || 0,
          completenessHints: Number(result.completenessHints) || 0,
          currentRecords: (candidate.records || []).filter(record => record?.status === 'active').length,
          places: (candidate.spatial?.locations || []).filter(location => location?.status !== 'archived').length,
        });
      } catch {
        // Progress reporting is presentation-only and must never fail an atomic rebuild.
      }
    }
  }

  candidate.lineage = plan.lineage;
  candidate.recoveryRequired = null;
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
  };
}

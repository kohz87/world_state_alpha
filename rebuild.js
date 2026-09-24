import { chatLineage, commitMutationBoundary, reconcileBranch, seedRootCheckpoint } from './branch.js';
import { CAPTURE_LIMITS, normalizeCaptureExchange, runCaptureOperation } from './capture.js';
import { hashText, stableStringify } from './hash.js';
import { extractContextTerms, normalizeAnchor, selectRelevantRecords } from './relevance.js';
import { selectRelevantLocations } from './spatial-relevance.js';
import { canonicalDomain, clone, createState, normalizeState } from './state-core.js';

export const REBUILD_LIMITS = Object.freeze({
  maxBoundaries: 1024,
  maxVisibleRecords: 8,
  resolvedVisibleRecords: 2,
  lifecycleVisibleRecords: 2,
  lifecycleRecentMessages: 12,
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

const SYSTEM_MESSAGE_TYPES = new Set([
  'help',
  'welcome',
  'empty',
  'generic',
  'narrator',
  'comment',
  'slash_commands',
  'formatting',
  'hotkeys',
  'macros',
  'welcome_prompt',
  'assistant_note',
]);

function hiddenConversationRole(message) {
  if (message?.is_system !== true) return roleOf(message);

  const extra = message?.extra && typeof message.extra === 'object' ? message.extra : {};
  const type = String(extra.type || '').trim().toLowerCase();
  if (extra.isSmallSys === true || extra.uses_system_ui === true || Array.isArray(extra.tool_invocations)) return 'system';
  if (SYSTEM_MESSAGE_TYPES.has(type)) return 'system';

  if (message?.is_user === true || message?.role === 'user') return 'user';
  if (message?.role === 'assistant') return 'assistant';
  if (type === 'assistant_message') return 'assistant';

  if (typeof message?.original_avatar === 'string' && message.original_avatar.trim()) return 'assistant';
  if (Array.isArray(message?.swipes) || Number.isInteger(message?.swipe_id)) return 'assistant';
  if (message?.gen_started || message?.gen_finished) return 'assistant';
  if (typeof extra.api === 'string' && extra.api.trim()) return 'assistant';
  if (typeof extra.model === 'string' && extra.model.trim()) return 'assistant';
  if (Number.isInteger(extra.gen_id)) return 'assistant';

  return 'system';
}

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
      const virtual = role === 'system' ? clone(message) : virtualizeRebuildMessage(message, role);
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
} = {}) {
  const original = normalizeState(clone(state), { chatKey });
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

  for (const window of plan.windows) {
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

  if (signal?.aborted) return cancelledResult(null);

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

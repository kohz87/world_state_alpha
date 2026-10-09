import { chatLineage, commitMutationBoundary, earliestPartialRebuildStart, firstStoryChange, reconcileBranch, seedRootCheckpoint } from './branch.js';
import { CAPTURE_LIMITS, captureDue, hiddenConversationRole, isNarratorMessage, normalizeCaptureExchange, runCaptureOperation } from './capture.js';
import { INFIX_NAME_SCRIPT, hashText, sharedContentBigrams, spacelessBigrams, stableStringify } from './hash.js';
import { RELEVANCE_STOPWORDS, extractContextTerms, functionWordNames, normalizeAnchor, selectRelevantRecords } from './relevance.js';
import { SUPPORT_STOPWORDS, significantTokens } from './source-firewall.js';
import { selectRelevantLocations } from './spatial-relevance.js';
import { activeCampaignPlaceCount, applySpatialUndoPatch, compactSpatialEvidence, createSpatialState, normalizeSpatialState, placeNameKey } from './spatial-core.js';
import { boundedInt, clone, compareText, hostMessageText, messageRole as roleOf } from './common.js';
import { canonicalDomain, createState, normalizeState } from './state-core.js';

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

// A shallow copy: the exchange row only reads the message's top-level fields and never edits nested ones.
function virtualizeRebuildMessage(message, role) {
  const copy = { ...message };
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


function exchangeText(exchange) {
  return normalizeCaptureExchange(exchange)
    .map(message => message.content)
    .filter(Boolean)
    .join('\n');
}

// `lineage`: the chat's lineage when the caller already computed it (otherwise it is computed here, after the
// boundary limit is checked, so an over-limit chat is refused before any message is hashed or copied).
export function planChronologicalRebuild(chat = [], {
  maxBoundaries = REBUILD_LIMITS.maxBoundaries,
  startMessageId = 0,
  includeHiddenMessages = true,
  lineage: knownLineage = null,
} = {}) {
  const rows = Array.isArray(chat) ? chat : [];
  const limit = boundedInt(maxBoundaries, REBUILD_LIMITS.maxBoundaries, 1, 4096);
  const start = boundedInt(startMessageId, 0, 0, Math.max(0, rows.length));
  let previousAssistant = -1;
  for (let messageId = start - 1; messageId >= 0; messageId -= 1) {
    if (rebuildRoleOf(rows[messageId], includeHiddenMessages) === 'assistant' && !isNarratorMessage(rows[messageId])) {
      previousAssistant = messageId;
      break;
    }
  }

  // A visible narrator message is narration of the next reply's exchange, not a boundary.
  const boundaries = [];
  for (let messageId = start; messageId < rows.length; messageId += 1) {
    if (rebuildRoleOf(rows[messageId], includeHiddenMessages) === 'assistant' && !isNarratorMessage(rows[messageId])) boundaries.push(messageId);
  }
  if (boundaries.length > limit) {
    const error = new Error(`rebuild requires ${boundaries.length} assistant boundaries, exceeding configured limit ${limit}`);
    error.code = 'WORLD_STATE_REBUILD_BOUNDARY_LIMIT';
    error.boundaries = boundaries.length;
    error.limit = limit;
    throw error;
  }

  const lineage = Array.isArray(knownLineage) && knownLineage.length === rows.length ? knownLineage : chatLineage(rows);
  const windows = [];
  let hiddenMessagesIncluded = 0;
  let hiddenAssistantBoundaries = 0;
  for (const messageId of boundaries) {
    if (rows[messageId]?.is_system === true) hiddenAssistantBoundaries += 1;

    const raw = rows.slice(previousAssistant + 1, messageId + 1);
    const exchange = raw.map((message, offset) => {
      const sourceMessageId = previousAssistant + 1 + offset;
      const role = rebuildRoleOf(message, includeHiddenMessages);
      // A row that stays out of the conversation (genuine system rows, or hidden rows when hidden messages
      // are excluded) is marked as system so capture never reads a hidden user turn as current evidence.
      const virtual = role === 'system'
        ? { ...message, role: 'system', is_user: false, is_system: true }
        : virtualizeRebuildMessage(message, role);
      if (message?.is_system === true && role !== 'system') hiddenMessagesIncluded += 1;
      return {
        ...virtual,
        // The host text as lineage and live capture read it (`mes` first), never a stale `content`.
        content: hostMessageText(message),
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

// Function words are not shared topic: "the" and "are" never make a record look addressed, and a
// function-word anchor ("Will") counts only where the exchange uses it as a name.
function rebuildMatchContext(recentText) {
  return {
    haystack: normalizeAnchor(recentText),
    // Every content word of the exchange (it is bounded), so a long reply's newest words are never cut off.
    terms: new Set(normalizeAnchor(recentText).split(' ')
      .filter(term => (term.length >= 2 || /^\d+$/u.test(term)) && !RELEVANCE_STOPWORDS.has(term))),
    names: functionWordNames(recentText),
    // The exchange's content words for the direct-address check, read once per exchange.
    directTerms: new Set(significantTokens(recentText, REBUILD_DIRECT_STOPWORDS)),
    // Its character pairs (Chinese, Japanese, ...), read once per exchange rather than once per record.
    pairs: spacelessBigrams(recentText),
  };
}

// A one-word anchor in a script written without spaces or with attached particles ("王都", "서울") is found
// inside the exchange's runs of letters.
function spacelessAnchorIn(normalized, haystack) {
  return normalized.length >= 2 && INFIX_NAME_SCRIPT.test(normalized) && haystack.includes(normalized);
}

function exchangeOverlap(record, context) {
  const anchorHit = (record?.anchors || []).some(anchor => {
    const normalized = normalizeAnchor(anchor);
    if (!normalized) return false;
    if (normalized.includes(' ')) return ` ${context.haystack} `.includes(` ${normalized} `);
    if (spacelessAnchorIn(normalized, context.haystack)) return true;
    return RELEVANCE_STOPWORDS.has(normalized) ? context.names.has(normalized) : context.terms.has(normalized);
  });
  let shared = 0;
  for (const term of extractContextTerms(record?.summary || '')) if (context.terms.has(term)) shared += 1;
  // Chinese or Japanese summaries share character pairs, not words: content pairs only (one shared word plus
  // common endings is no topic), read only when words and anchors decided nothing.
  const pairs = !anchorHit && shared < 2 && context.pairs.size ? sharedContentBigrams(record?.summary || '', context.pairs) : 0;
  return { relevant: anchorHit || shared >= 2 || pairs >= 3, touched: anchorHit || shared >= 1 || pairs >= 2 };
}

// The firewall's support stopwords plus counting and status words: sharing "two" or "remains" is no topic.
const REBUILD_DIRECT_STOPWORDS = new Set([
  ...SUPPORT_STOPWORDS,
  'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'first', 'second',
  'third', 'last', 'remain', 'remains', 'active',
]);

function rebuildDirectlyAddresses(record, context) {
  if (!context.haystack) return false;

  const anchors = (Array.isArray(record?.anchors) ? record.anchors : [])
    .map(normalizeAnchor)
    .filter(Boolean);
  if (anchors.some(anchor => anchor.includes(' ') && ` ${context.haystack} `.includes(` ${anchor} `))) return true;
  // Any specific one-word anchor (five letters, not a function word, or one in a spaceless script) names the
  // record, however many anchors it has.
  if (anchors.some(anchor => !anchor.includes(' ') && ((anchor.length >= 5 && !RELEVANCE_STOPWORDS.has(anchor)
    && ` ${context.haystack} `.includes(` ${anchor} `)) || spacelessAnchorIn(anchor, context.haystack)))) return true;

  const left = new Set(significantTokens(record?.summary || '', REBUILD_DIRECT_STOPWORDS));
  let shared = 0;
  for (const token of left) if (context.directTerms.has(token)) shared += 1;
  return shared >= 2 || (context.pairs.size > 0 && sharedContentBigrams(record?.summary || '', context.pairs) >= 3);
}

function rebuildLifecycleAndHistoryCandidates(state, recentText, boundaryMessageId) {
  const lifecycle = [];
  let touchesDevelopment = false;
  const historical = [];
  const context = rebuildMatchContext(recentText);

  for (const record of state.records || []) {
    const lastChanged = Number.isInteger(record?.lastChangedMessage) ? record.lastChangedMessage : -1;
    const overlap = exchangeOverlap(record, context);
    const overlapsExchange = overlap.relevant;
    if (record?.kind === 'development' && record?.status === 'active') {
      const recentlyChanged = Number.isInteger(boundaryMessageId)
        && lastChanged >= 0
        && boundaryMessageId > lastChanged
        && (boundaryMessageId - lastChanged) <= REBUILD_LIMITS.lifecycleRecentMessages;
      if (overlap.touched) touchesDevelopment = true;
      // A recently changed development stays visible (an ending may name it by a synonym), after those the
      // exchange touches.
      if (overlapsExchange || recentlyChanged) {
        // Judged only for the developments shown, not every active one.
        const directlyAddressed = rebuildDirectlyAddresses(record, context);
        lifecycle.push({ record, overlapsExchange, touched: overlap.touched, directlyAddressed, lastChanged });
      }
      continue;
    }

    if (['resolved', 'superseded'].includes(record?.status) && overlapsExchange) {
      historical.push({ record, lastChanged });
    }
  }

  lifecycle.sort((left, right) => {
    if (left.overlapsExchange !== right.overlapsExchange) return left.overlapsExchange ? -1 : 1;
    if (left.touched !== right.touched) return left.touched ? -1 : 1;
    if (right.lastChanged !== left.lastChanged) return right.lastChanged - left.lastChanged;
    return compareText(left.record?.id, right.record?.id);
  });
  historical.sort((left, right) => {
    if (right.lastChanged !== left.lastChanged) return right.lastChanged - left.lastChanged;
    return compareText(left.record?.id, right.record?.id);
  });

  const selectedLifecycle = lifecycle.slice(0, REBUILD_LIMITS.lifecycleVisibleRecords);
  return {
    lifecycle: selectedLifecycle.map(item => item.record),
    // The interpretive antecedent of an indirect ending: never a record the exchange does not touch while it
    // is about another development (only an ending that names nothing, "it finally ends", gets that one).
    lifecycleContextRecordIds: selectedLifecycle.length === 1 && !selectedLifecycle[0].directlyAddressed
      && (selectedLifecycle[0].touched || !touchesDevelopment)
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

export function rebuildSnapshotToken({ state, chat, lineage = null }) {
  const rows = Array.isArray(chat) ? chat : [];
  return hashText(stableStringify({
    domain: canonicalDomain(state),
    rollbackJournalSequence: Math.max(0, Number(state?.rollbackJournalSequence) || 0),
    lineage: Array.isArray(lineage) && lineage.length === rows.length ? lineage : chatLineage(rows),
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
      .sort((a, b) => compareText(a.id, b.id)),
    links: normalized.links
      .map(link => ({
        id: link.id,
        from: link.from,
        to: link.to,
        type: link.type,
      }))
      .sort((a, b) => compareText(a.id, b.id)),
    lastCaptureMessage: normalized.lastCaptureMessage,
  };
}

// A validation and test helper (the runtime never calls it): whether two states hold the same current world,
// ignoring ids of evidence, timestamps and history. Kept for scripts/validate-phase5.mjs and the rebuild tests.
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

function spatialHasOperatorContent(spatial) {
  const owned = entity => entity?.operatorOwned === true;
  return Boolean(spatial?.locations?.some(owned) || spatial?.relations?.some(owned) || spatial?.routes?.some(owned));
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
// With extraction on (`operatorOnly`) the same history supplies the operator's own entities; only those
// count as held before the floor, and `hasOperator` says whether the history holds any at all.
function disabledSpatialTimeline(original, chat, { operatorOnly = false, lineage = null } = {}) {
  const journal = Array.isArray(original.rollbackJournal) ? original.rollbackJournal : [];
  const floor = Number.isInteger(original.rollbackJournalFloorMessageId) ? original.rollbackJournalFloorMessageId : -1;
  const held = operatorOnly ? spatialHasOperatorContent : spatialHasContent;
  // Only Spatial patches are replayed; with none, Places stayed as they were since the floor.
  if (!journal.some(entry => entry?.undo?.spatial)) {
    const heldBeforeFloor = floor >= 0 && held(original.spatial);
    return {
      base: clone(original.spatial),
      hasOperator: spatialHasOperatorContent(original.spatial),
      unprovableBelow: heldBeforeFloor ? floor : -1,
      unverified: heldBeforeFloor && firstStoryChange(original.lineage, chat, lineage) <= floor,
      at: () => original.spatial,
      changesAfter: () => false,
      changesBetween: () => false,
    };
  }
  const divergence = firstStoryChange(original.lineage, chat, lineage);
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
  const heldBeforeFloor = floor >= 0 && held(base);
  return {
    base: clone(base),
    hasOperator: spatialHasOperatorContent(base) || steps.some(step => spatialHasOperatorContent(step.spatial)),
    // Below this boundary the Spatial history is unknown (nothing proves when those places appeared).
    unprovableBelow: heldBeforeFloor ? floor : -1,
    unverified: heldBeforeFloor && divergence <= floor,
    at(messageId, last = false) {
      let current = base;
      for (const step of steps) if (last || step.messageId <= messageId) current = step.spatial;
      // Read-only: every caller copies it (the commit normalizes its state, the overlay clones what it keeps),
      // so no copy is made per boundary.
      return current;
    },
    // Whether a replayed change was made after `messageId` (after every boundary when it is null).
    changesAfter: messageId => steps.some(step => messageId === null || step.messageId > messageId),
    // Whether one was made after `after` (from the start when null) up to and including `upTo`.
    changesBetween: (after, upTo) => steps.some(step => (after === null || step.messageId > after) && step.messageId <= upTo),
  };
}

// With Places extraction on, the model's places are rebuilt from narration, but what the operator authored
// (places, relations and routes carrying operatorOwned) is campaign authority: at each boundary the
// candidate holds exactly the operator entities the original Places history held there. A model place with
// the same name gives way to the operator's (its relations and routes move to it). An operator relation or
// route keeps its other end: a model place the rebuild re-created (under a new id) by name, otherwise the
// original place itself, so nothing the operator linked is left pointing at a missing place.
function overlayOperatorSpatial(spatial, source) {
  const next = normalizeSpatialState(spatial);
  const src = source || createSpatialState();
  const owned = list => (list || []).filter(entity => entity?.operatorOwned === true);
  const locations = owned(src.locations);
  const relations = owned(src.relations);
  const routes = owned(src.routes);
  const operatorIds = new Set(locations.map(loc => loc.id));
  const operatorNames = new Map(locations.filter(loc => loc.status === 'active').map(loc => [placeNameKey(loc.name), loc.id]));
  const moved = new Map();
  next.locations = next.locations.filter(loc => {
    if (loc.operatorOwned === true || operatorIds.has(loc.id)) return false;
    const operatorId = loc.status === 'active' ? operatorNames.get(placeNameKey(loc.name)) : null;
    if (operatorId) moved.set(loc.id, operatorId);
    return !operatorId;
  });
  next.locations.push(...locations.map(clone));
  const to = id => moved.get(id) || id;
  const relationIds = new Set(relations.map(rel => rel.id));
  next.relations = next.relations
    .filter(rel => rel.operatorOwned !== true && !relationIds.has(rel.id))
    .map(rel => ({ ...rel, fromId: to(rel.fromId), toId: to(rel.toId) }))
    .filter(rel => rel.fromId !== rel.toId);
  next.relations.push(...relations.map(clone));
  const routeIds = new Set(routes.map(route => route.id));
  next.routes = next.routes
    .filter(route => route.operatorOwned !== true && !routeIds.has(route.id))
    .map(route => ({ ...route, endpoints: [...new Set((route.endpoints || []).map(to))], waypoints: [...new Set((route.waypoints || []).map(to))] }));
  next.routes.push(...routes.map(clone));

  // Ends of operator relations and routes that name a non-operator place of the original history.
  const presentIds = new Set(next.locations.map(loc => loc.id));
  const sourceById = new Map((src.locations || []).map(loc => [loc.id, loc]));
  const activeByName = new Map();
  for (const loc of next.locations) {
    if (loc.status === 'active' && !activeByName.has(placeNameKey(loc.name))) activeByName.set(placeNameKey(loc.name), loc.id);
  }
  const carried = [];
  const endpoint = id => {
    if (presentIds.has(id)) return id;
    const original = sourceById.get(id);
    // Not a stored place (a base-map place, or an override addressed by its base id): left as it is.
    if (!original) return id;
    const rebuilt = activeByName.get(placeNameKey(original.name));
    if (rebuilt) return rebuilt;
    presentIds.add(id);
    carried.push(clone(original));
    return id;
  };
  const relationAt = new Set(relations.map(rel => rel.id));
  const routeAt = new Set(routes.map(route => route.id));
  next.relations = next.relations.map(rel => (relationAt.has(rel.id) ? { ...rel, fromId: endpoint(rel.fromId), toId: endpoint(rel.toId) } : rel));
  next.routes = next.routes.map(route => (routeAt.has(route.id)
    ? { ...route, endpoints: [...new Set((route.endpoints || []).map(endpoint))], waypoints: [...new Set((route.waypoints || []).map(endpoint))] }
    : route));
  next.locations.push(...carried);

  for (const entity of [...locations, ...carried, ...relations, ...routes]) {
    for (const id of entity.evidenceIds || []) if (src.evidence?.[id]) next.evidence[id] = clone(src.evidence[id]);
  }
  return normalizeSpatialState(compactSpatialEvidence(next));
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
  onProgress = undefined,
  maxBoundaries = REBUILD_LIMITS.maxBoundaries,
  startMessageId = 0,
  includeHiddenMessages = true,
  spatialEnabled = false,
  baseMap = null,
  spatialProfile = null,
  resume = null,
  // The chat's lineage when the host already computed it for its own range proof.
  lineage = null,
} = {}) {
  const original = normalizeState(state, { chatKey });
  const owner = String(chatKey || original.chatKey || '');
  if (!owner) throw new Error('chatKey is required');
  if (original.chatKey && original.chatKey !== owner) throw new Error('rebuild chatKey does not match state owner');

  const plan = planChronologicalRebuild(chat, {
    maxBoundaries,
    startMessageId,
    includeHiddenMessages,
    lineage,
  });
  if (plan.windows.length && typeof isCurrent !== 'function') {
    const error = new Error('manual rebuild requires an isCurrent(snapshotToken) guard');
    error.code = 'WORLD_STATE_REBUILD_CURRENT_GUARD_REQUIRED';
    throw error;
  }

  const snapshotToken = rebuildSnapshotToken({ state: original, chat, lineage: plan.lineage });
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

  const spatialTimeline = spatialEnabled ? null : disabledSpatialTimeline(original, chat, { lineage: plan.lineage });
  // With extraction on, the same history supplies the operator's own places at each boundary (skipped
  // entirely when the history holds no operator entity).
  const operatorHistory = spatialEnabled ? disabledSpatialTimeline(original, chat, { operatorOnly: true, lineage: plan.lineage }) : null;
  const operatorTimeline = operatorHistory?.hasOperator ? operatorHistory : null;
  const historyTimeline = spatialTimeline || operatorTimeline;
  const warnings = historyTimeline?.unverified
    ? [{
      code: 'WORLD_STATE_REBUILD_SPATIAL_HISTORY_UNVERIFIED',
      message: spatialTimeline
        ? 'Places were kept as they were before the oldest saved change, but the chat changed before that point, so some places may belong to an abandoned branch. Review Places, or rebuild with Places extraction on.'
        : 'Places you added were kept as they were before the oldest saved change, but the chat changed before that point, so some of them may belong to an abandoned branch. Review Places.',
    }]
    : [];
  const lastWindowMessageId = plan.windows.length ? plan.windows[plan.windows.length - 1].messageId : null;
  // The candidate's Spatial after boundary `messageId`: replayed as it was when extraction is off, or the
  // model's places with the operator's own as they stood there when it is on.
  const spatialAtBoundary = (state, messageId, last = false) => {
    if (spatialTimeline) return { ...state, spatial: spatialTimeline.at(messageId, last) };
    if (operatorTimeline) return { ...state, spatial: overlayOperatorSpatial(state.spatial, operatorTimeline.at(messageId, last)) };
    return state;
  };

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
    const currentLineage = plan.lineage;
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
    const restored = reconcileBranch(original, prefix, { lineage: currentLineage.slice(0, plan.metrics.startMessageId) });
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
      if (operatorTimeline) root.spatial = overlayOperatorSpatial(root.spatial, operatorTimeline.base);
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
        places: activeCampaignPlaceCount(candidate.spatial),
      });
    } catch {
      // Progress reporting is presentation-only and must never fail an atomic rebuild.
    }
  };

  for (const [windowIndex, window] of plan.windows.entries()) {
    if (resumeFromMessageId !== null && window.messageId < resumeFromMessageId) continue;
    // The boundary before this one: the replayed Places it holds are already in the candidate.
    const lastCommittedBoundary = windowIndex > 0 ? plan.windows[windowIndex - 1].messageId : null;
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
      // Committed only when replayed Places change there: a no-op commit would add a checkpoint and evict a
      // real one.
      // The plan's lineage stands for the chat (no prefix copy per boundary).
      if (historyTimeline?.changesBetween?.(lastCommittedBoundary, window.messageId)) {
        candidate = commitMutationBoundary(candidate, spatialAtBoundary(candidate, window.messageId), null, window.messageId, 'rebuild', { lineage: plan.lineage.slice(0, window.messageId + 1) });
      }
      receipts.push({ messageId: window.messageId, outcome: 'empty-boundary', providerCalls: 0, applied: 0, rejected: 0, aliasRepairs: 0, completenessHints: 0, rejections: [] });
      processedBoundaries += 1;
      await reportProgress(window.messageId, { boundaryApplied: 0, boundaryRejected: 0, aliasRepairs: 0, completenessHints: 0 });
      continue;
    }

    // Rebuild reads no lore: a boundary is judged on its own exchange (lore is never evidence).
    const loreText = '';

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

    candidate = commitMutationBoundary(
      beforeStep,
      spatialAtBoundary(result.state, window.messageId),
      // The plan already holds the chat's lineage, which stands for the chat: re-hashing (or copying) the
      // prefix at every step was quadratic.
      null,
      window.messageId,
      'rebuild',
      { lineage: plan.lineage.slice(0, window.messageId + 1) },
    );
    processedBoundaries += 1;
    await reportProgress(window.messageId, {
      boundaryApplied,
      boundaryRejected: allRejected.length,
      aliasRepairs: Number(result.aliasRepairs) || 0,
      completenessHints: Number(result.completenessHints) || 0,
    });
  }

  if (signal?.aborted) return cancelledResult(null);

  // With extraction off the replayed Places are applied at each boundary. Places changed after the last
  // assistant boundary (or in a range with none) are committed at the last message, where they were made
  // (journaled, so deleting that message still undoes them), never folded into an earlier reply.
  const rows = Array.isArray(chat) ? chat : [];
  // Only when a change was made there: a no-op commit would still add a checkpoint and evict an older one.
  if (historyTimeline && rows.length && (lastWindowMessageId === null || lastWindowMessageId < rows.length - 1)
    && historyTimeline.changesAfter(lastWindowMessageId)) {
    const lastMessageId = rows.length - 1;
    candidate = commitMutationBoundary(
      candidate,
      spatialAtBoundary(candidate, lastMessageId, true),
      rows,
      lastMessageId,
      'rebuild',
      { lineage: plan.lineage },
    );
  }

  candidate.lineage = plan.lineage;
  candidate.recoveryRequired = null;
  if (historyTimeline && historyTimeline.unprovableBelow >= 0 && plan.metrics.startMessageId <= historyTimeline.unprovableBelow) {
    // Places existed before the oldest saved change, so a rollback below it cannot be proven: keep only
    // journal entries and checkpoints from there on, exactly like a trimmed journal (it fails closed).
    // The first kept entry's state before it is also the state at the floor (no boundary lies between).
    const cutoff = historyTimeline.unprovableBelow;
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

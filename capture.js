import { fingerprintMessage } from './branch.js';
import { CaptureWireError, parseCaptureJson, validateCaptureEnvelope } from './capture-wire.js';
import { createDiagnosticStore } from './diagnostics.js';
import { consolidateCreateCandidate } from './duplicate.js';
import { hashText, stableStringify } from './hash.js';
import { dispatchWorldStateRequest } from './provider-routing.js';
import { sanitizeAssistantNarration } from './narrative-sanitizer.js';
import { processSpatialCapture } from './spatial-capture.js';
import { applyCaptureSourceFirewall } from './source-firewall.js';
import { clone, reduceMutations } from './state-core.js';

export const CAPTURE_DEFAULT_INTERVAL = 1;
export const CAPTURE_RESPONSE_TOKENS = 2200;
const REALITY_MUTATION_SHAPE = '{"action":"create|update|resolve|supersede","recordId":"existing-id-for-non-create","kind":"fact|development-for-create","summary":"compact current state","status":"active|resolved when creating","trend":"emerging|rising|stable|falling|uncertain when useful","anchors":["concept"],"reason":"grounded reason","evidence":[{"sourceMessageId":123,"claim":"verbatim excerpt from current exchange"}],"relatedRecordIds":["visible-id"],"newEpisodeOfRecordId":"optional visible resolved/superseded id"}';
export const CAPTURE_LIMITS = Object.freeze({
  exchangeMessages: 4,
  exchangeChars: 12000,
  perMessageChars: 7000,
  visibleRecords: 8,
  loreChars: 3500,
});

export const CAPTURE_SYSTEM_PROMPT = [
  'Return exactly one valid JSON object for World State Alpha capture. No markdown or commentary.',
  'You are a conservative continuity extractor, not a narrator or Story Director.',
  'Propose only current world facts/developments already established by the CURRENT EXCHANGE.',
  'Capture is bounded for completeness, not ranked only by immediate PC salience: scan the whole CURRENT EXCHANGE for every distinct material persistent condition, up to the mutation limit.',
  'PC proximity, current objective, or whether the PC intervened are not admission criteria. An established ongoing condition that will continue independently after the PC leaves or ignores it belongs as a development, including when it is now off-screen.',
  'If the exchange establishes several independent persistent conditions, represent each once instead of stopping after the most scene-salient one.',
  'Persistence means useful future continuity after the scene cuts away. Ignore fleeting scenery, momentary positions, routine inventory/skill state, ordinary one-off transactions, notices/offers/rumors, plans, planted seeds, CYOA options, inner chatter, or mere possibilities unless the narration separately establishes the underlying condition as current reality.',
  'Story-driving CoT principles such as autonomous world motion, scene variation, chance, escalation, or avoiding stagnation do not apply to capture and are not evidence.',
  'Existing World State records are current campaign authority. Lore is baseline context/possibility only and cannot by itself establish a current condition.',
  'Never invent off-screen developments, outcomes, consequences, or causal links.',
  'For every non-noop mutation, cite 1-4 short verbatim excerpts from CURRENT EXCHANGE using sourceMessageId.',
  'Use shown record IDs only for update/resolve/supersede/related links. Never create an ID.',
  'Reality mutation field names are exact: use kind and summary. Never substitute category for kind or description for summary.',
  'Use resolve/supersede for lifecycle changes; do not smuggle them through update.',
  'Prefer updating an existing matching record. If nothing material changed, return {"mutations":[]}.',
].join(' ');

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

function clip(value, max) {
  const text = String(value ?? '').trim();
  if (text.length <= max) return text;
  const head = Math.floor(max * 0.55);
  const tail = max - head - 24;
  return `${text.slice(0, head)}\n...[bounded]...\n${text.slice(-tail)}`;
}

export function normalizeCaptureExchange(exchange = []) {
  const candidates = (Array.isArray(exchange) ? exchange : [])
    .filter(message => Number.isInteger(message?.messageId) && roleOf(message) !== 'system')
    .slice(-CAPTURE_LIMITS.exchangeMessages)
    .map(message => ({
      messageId: message.messageId,
      role: roleOf(message),
      lineageKey: typeof message.lineageKey === 'string' ? message.lineageKey : '',
      content: clip(
        roleOf(message) === 'assistant'
          ? sanitizeAssistantNarration(messageText(message))
          : messageText(message),
        CAPTURE_LIMITS.perMessageChars,
      ),
    }));

  let remaining = CAPTURE_LIMITS.exchangeChars;
  const out = [];
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    if (remaining <= 0) break;
    const message = candidates[i];
    const content = clip(message.content, remaining);
    remaining -= content.length;
    out.unshift({ ...message, content });
  }
  return out;
}

export function captureDue({ exchange = [], lastCaptureMessage = null, sourceMessageId = null } = {}) {
  const normalized = normalizeCaptureExchange(exchange);
  const last = normalized.at(-1);
  if (!last || last.role !== 'assistant' || !last.content.trim()) return false;
  const boundary = Number.isInteger(sourceMessageId) ? sourceMessageId : last.messageId;
  if (last.messageId !== boundary) return false;
  return lastCaptureMessage !== boundary;
}

function boundedVisibleRecords(records = []) {
  return (Array.isArray(records) ? records : []).slice(0, CAPTURE_LIMITS.visibleRecords);
}

function renderRecords(records = []) {
  return boundedVisibleRecords(records)
    .map(record => ({
      id: record.id,
      kind: record.kind,
      summary: record.summary,
      status: record.status,
      trend: record.trend ?? null,
      anchors: Array.isArray(record.anchors) ? record.anchors : [],
    }));
}

export function buildCapturePrompt({
  exchange = [],
  visibleRecords = [],
  loreText = '',
  operation = 'capture',
  spatialEnabled = false,
  visibleLocations = [],
  spatialProfile = null,
} = {}) {
  const currentExchange = normalizeCaptureExchange(exchange);
  const records = renderRecords(visibleRecords);
  const lore = clip(loreText, CAPTURE_LIMITS.loreChars);
  const prompt = [
    'CURRENT EXCHANGE (the only automatic mutation evidence source):',
    JSON.stringify(currentExchange.map(({ messageId, role, content }) => ({ messageId, role, content }))),
    '',
    operation === 'rebuild'
      ? 'REBUILD RECOVERY MODE: This is one historical chronological exchange boundary. Recover every materially persistent condition established in this exchange, including conditions that were already off-screen, ignored, or unrelated to the PC objective. Do not infer un-narrated evolution between boundaries; later narrated exchanges must establish later changes.'
      : '',
    'VISIBLE CURRENT WORLD STATE (current authority; use only these IDs):',
    JSON.stringify(records),
    '',
    'RELEVANT LORE BASELINE (context/possibility only; never evidence of current occurrence):',
    lore || '(none)',
    '',
    'PERSISTENCE COMPLETENESS CHECK: Before output, sweep the entire CURRENT EXCHANGE again. Represent every distinct materially persistent current condition established there, even when it is off-screen, ignored by the PC, unrelated to the current objective, or continuing elsewhere after the PC leaves. Do not promote transient scene detail or mere notices/rumors/plans/options into reality. Do not duplicate one condition across mutations.',
    '',
    spatialEnabled ? 'VISIBLE SPATIAL CONTINUITY (current/base authority; use only shown IDs):' : '',
    spatialEnabled ? JSON.stringify((Array.isArray(visibleLocations) ? visibleLocations : []).slice(0, 8).map(location => ({
      id: location.id,
      name: location.name,
      type: location.type,
      context: location.context || '',
      coordinate: location.coordinate || null,
      routeRefs: Array.isArray(location.routeRefs) ? location.routeRefs.slice(0, 8) : [],
      source: location.isBase ? 'base' : 'campaign',
    }))) : '',
    spatialEnabled ? 'SPATIAL PROFILE:' : '',
    spatialEnabled ? JSON.stringify(spatialProfile || null) : '',
    'OUTPUT SHAPE:',
    spatialEnabled
      ? '{"mutations":[' + REALITY_MUTATION_SHAPE + '],"spatialMutations":[{"action":"upsert_location|upsert_relation|upsert_route","locationId":"visible existing id only when updating","name":"grounded persistent place name","type":"generic place type","context":"established context","coordinate":{"x":1.2,"y":3.4,"authority":"narrative_explicit"},"relative":{"toLocationId":"visible anchor id","direction":"east","distanceKm":10,"distanceMode":"straight_line|route|unspecified"},"routeRefs":["visible route"],"admissionReason":"named|explicit_position|explicit_coordinate|revisited|persistent_feature|route_landmark|material_event","evidence":[{"sourceMessageId":123,"claim":"verbatim excerpt from CURRENT EXCHANGE"}]}]}'
      : '{"mutations":[' + REALITY_MUTATION_SHAPE + ']}',
    spatialEnabled
      ? 'Spatial rules: track only persistent established places; never capture generic scenery. Planning/writer_state is not evidence. Do not invent precise coordinates. Route/travel distance is not straight-line displacement. Never assign manual/base/campaign_override authority. If no spatial change return spatialMutations:[] alongside mutations.'
      : '',
    spatialEnabled ? 'For no material change return exactly {"mutations":[],"spatialMutations":[]}.' : 'For no material change return exactly {"mutations":[]}.',
  ].filter(Boolean).join('\n');
  return {
    systemPrompt: CAPTURE_SYSTEM_PROMPT,
    prompt,
    responseLength: CAPTURE_RESPONSE_TOKENS,
    quietToLoud: false,
    instructOverride: true,
    trimNames: false,
  };
}

export function captureSnapshotToken({
  state,
  exchange,
  visibleRecords = [],
  visibleLocations = [],
  spatialEnabled = false,
  sourceMessageId,
  sourceLineageKey,
}) {
  return hashText(stableStringify({
    rollbackJournalSequence: Number(state?.rollbackJournalSequence) || 0,
    lastCaptureMessage: state?.lastCaptureMessage ?? null,
    sourceMessageId,
    sourceLineageKey: String(sourceLineageKey || ''),
    exchange: normalizeCaptureExchange(exchange).map(message => ({
      messageId: message.messageId,
      fingerprint: fingerprintMessage({ role: message.role, content: message.content }),
    })),
    visibleRecords: renderRecords(visibleRecords),
    spatialEnabled: Boolean(spatialEnabled),
    visibleLocations: spatialEnabled
      ? (Array.isArray(visibleLocations) ? visibleLocations : []).slice(0, 8).map(item => ({
        id: item.id,
        name: item.name,
        coordinate: item.coordinate || null,
      }))
      : [],
  }));
}

function rejectedEntry(stage, reason, extra = {}) {
  return { stage, reason: String(reason || 'rejected'), ...extra };
}

function markCaptureAttempt(inputState, sourceMessageId) {
  const next = clone(inputState);
  next.lastCaptureMessage = sourceMessageId;
  return next;
}

export function processCaptureResponse({
  text,
  state,
  exchange,
  visibleRecords = [],
  chatKey,
  sourceMessageId,
  sourceLineageKey,
  operation = 'capture',
  evidenceSourceClass = '',
  spatialEnabled = false,
  visibleLocations = [],
  baseMap = null,
  spatialProfile = null,
} = {}) {
  const raw = parseCaptureJson(text);
  const wire = validateCaptureEnvelope(raw);
  if (operation === 'rebuild' && wire.rejected.length) {
    const first = wire.rejected[0];
    throw new CaptureWireError(
      `rebuild rejected structurally invalid Reality mutation row ${first.index}: ${first.reason}`,
      'WORLD_STATE_REBUILD_REALITY_WIRE_INVALID',
    );
  }
  const boundedRecords = boundedVisibleRecords(visibleRecords);
  const rejected = wire.rejected.map(item => rejectedEntry('wire', item.reason, { code: item.code, index: item.index }));
  const accepted = [];

  for (let index = 0; index < wire.mutations.length; index += 1) {
    const proposal = wire.mutations[index];
    if (proposal.action === 'noop') continue;
    const firewalled = applyCaptureSourceFirewall(proposal, { exchange, visibleRecords: boundedRecords, state });
    if (!firewalled.ok) {
      rejected.push(rejectedEntry('source-firewall', firewalled.reason, { index }));
      continue;
    }
    if (evidenceSourceClass) {
      firewalled.mutation.evidence = (firewalled.mutation.evidence || []).map(item => ({
        ...item,
        sourceClass: evidenceSourceClass,
      }));
    }
    const consolidated = consolidateCreateCandidate(firewalled.mutation, boundedRecords);
    if (!consolidated.ok) {
      rejected.push(rejectedEntry('duplicate-gate', consolidated.reason, {
        index,
        duplicateRecordId: consolidated.duplicate?.record?.id || '',
      }));
      continue;
    }
    accepted.push(consolidated.mutation);
  }

  const reduced = reduceMutations(state, {
    chatKey,
    messageId: sourceMessageId,
    lineageKey: sourceLineageKey,
    operation,
    mutations: accepted,
  });
  for (const item of reduced.rejected) {
    rejected.push(rejectedEntry('reducer', item.reason));
  }

  const nextState = clone(reduced.state);
  nextState.lastCaptureMessage = sourceMessageId;

  let spatialResult = {
    spatial: clone(nextState.spatial),
    applied: [],
    rejected: [],
    proposedCount: 0,
    acceptedCount: 0,
    indexDelta: {
      changedLocationIds: [],
      upsertedLocations: [],
      removedLocationIds: [],
      upsertedRelations: [],
      removedRelationIds: [],
      upsertedRoutes: [],
      removedRouteIds: [],
      relationsChanged: false,
      routesChanged: false,
    },
  };
  if (spatialEnabled) {
    spatialResult = processSpatialCapture({
      rawSpatialMutations: Array.isArray(raw.spatialMutations) ? raw.spatialMutations : [],
      spatial: nextState.spatial,
      exchange,
      visibleLocations,
      baseMap,
      profile: spatialProfile || nextState.spatial?.profile,
      chatKey,
      sourceMessageId,
      sourceLineageKey,
      operation,
      evidenceSourceClass,
    });
    if (operation === 'rebuild') {
      const structuralSpatial = (spatialResult.rejected || []).find(item => item?.stage === 'spatial-wire');
      if (structuralSpatial) {
        throw new CaptureWireError(
          `rebuild rejected structurally invalid Spatial mutation row ${structuralSpatial.index ?? '?'}: ${structuralSpatial.reason}`,
          'WORLD_STATE_REBUILD_SPATIAL_WIRE_INVALID',
        );
      }
    }
    nextState.spatial = spatialResult.spatial;
  }

  return {
    state: nextState,
    proposedCount: Array.isArray(raw.mutations) ? raw.mutations.length : 0,
    acceptedCount: accepted.length,
    applied: reduced.applied,
    rejected,
    indexDelta: reduced.indexDelta || { upsertedRecords: [], appendedLinks: [], corpusRecords: nextState.records.length },
    spatial: spatialResult,
    aliasRepairs: wire.aliasRepairs || 0,
  };
}

export async function runCaptureOperation({
  ctx,
  state,
  exchange,
  visibleRecords = [],
  loreText = '',
  chatKey,
  sourceMessageId,
  sourceLineageKey,
  route = undefined,
  operationId = '',
  timeoutMs = undefined,
  signal = undefined,
  isCurrent = undefined,
  diagnostics = undefined,
  dispatcher = dispatchWorldStateRequest,
  operation = 'capture',
  evidenceSourceClass = '',
  label = 'capture',
  spatialEnabled = false,
  visibleLocations = [],
  baseMap = null,
  spatialProfile = null,
} = {}) {
  const diagnosticStore = diagnostics || createDiagnosticStore();
  const startedAt = Date.now();

  if (!captureDue({ exchange, lastCaptureMessage: state?.lastCaptureMessage, sourceMessageId })) {
    return { outcome: 'skipped', state: clone(state), providerCalls: 0, rejected: [], applied: [] };
  }

  const snapshotToken = captureSnapshotToken({
    state,
    exchange,
    visibleRecords,
    visibleLocations,
    spatialEnabled,
    sourceMessageId,
    sourceLineageKey,
  });
  if (typeof isCurrent !== 'function') {
    const error = new Error('automatic capture requires an isCurrent(snapshotToken) guard');
    error.code = 'WORLD_STATE_CAPTURE_CURRENT_GUARD_REQUIRED';
    throw error;
  }
  const current = () => isCurrent(snapshotToken);
  if (!current()) {
    return { outcome: 'stale', state: clone(state), providerCalls: 0, rejected: [], applied: [], snapshotToken };
  }

  const options = buildCapturePrompt({
    exchange,
    visibleRecords,
    loreText,
    operation,
    spatialEnabled,
    visibleLocations,
    spatialProfile,
  });
  let dispatched;
  try {
    dispatched = await dispatcher(ctx, options, {
      route,
      chatKey,
      operationId,
      timeoutMs,
      signal,
      isCurrent: current,
      label,
    });
  } catch (error) {
    const receipt = error?.receipt || {};
    const providerCalls = receipt.dispatched ? 1 : 0;
    const stale = error?.code === 'WORLD_STATE_ROUTE_CANCELLED' && !current();
    const outcome = stale ? 'stale' : (receipt.outcome || 'failure');
    diagnosticStore.record(chatKey, {
      operationId,
      label,
      sourceMessageId,
      outcome,
      code: error?.code || 'PROVIDER_ERROR',
      detail: String(error?.message || error).slice(0, 320),
      route: receipt.route || '',
      profileId: receipt.profileId || '',
      providerCalls,
      candidateRecords: Math.min(visibleRecords.length, CAPTURE_LIMITS.visibleRecords),
      promptChars: options.systemPrompt.length + options.prompt.length,
      responseChars: 0,
      durationMs: Date.now() - startedAt,
    });
    return {
      outcome,
      state: stale || providerCalls === 0 ? clone(state) : markCaptureAttempt(state, sourceMessageId),
      providerCalls,
      rejected: [rejectedEntry('provider', error?.message || error, { code: error?.code || 'PROVIDER_ERROR' })],
      applied: [],
      snapshotToken,
      errorCode: error?.code || 'PROVIDER_ERROR',
      routeReceipt: receipt,
    };
  }

  if (!current()) {
    diagnosticStore.record(chatKey, {
      operationId,
      label,
      sourceMessageId,
      outcome: 'stale',
      code: 'WORLD_STATE_CAPTURE_STALE',
      detail: 'Operation became stale before provider output could be applied.',
      route: dispatched.receipt?.route || '',
      profileId: dispatched.receipt?.profileId || '',
      providerCalls: 1,
      candidateRecords: Math.min(visibleRecords.length, CAPTURE_LIMITS.visibleRecords),
      promptChars: options.systemPrompt.length + options.prompt.length,
      responseChars: dispatched.text.length,
      durationMs: Date.now() - startedAt,
    });
    return { outcome: 'stale', state: clone(state), providerCalls: 1, rejected: [], applied: [], snapshotToken };
  }

  try {
    const processed = processCaptureResponse({
      text: dispatched.text,
      state,
      exchange,
      visibleRecords,
      chatKey,
      sourceMessageId,
      sourceLineageKey,
      operation,
      evidenceSourceClass,
      spatialEnabled,
      visibleLocations,
      baseMap,
      spatialProfile,
    });
    const spatialApplied = processed.spatial?.applied?.length || 0;
    const spatialRejected = processed.spatial?.rejected?.length || 0;
    const outcome = (processed.applied.length + spatialApplied) > 0 ? 'applied' : 'no-change';
    diagnosticStore.record(chatKey, {
      operationId,
      label,
      sourceMessageId,
      outcome,
      code: processed.aliasRepairs ? 'WORLD_STATE_PROVIDER_ALIAS_REPAIRED' : '',
      detail: processed.aliasRepairs
        ? `Repaired ${processed.aliasRepairs} unambiguous provider field alias${processed.aliasRepairs === 1 ? '' : 'es'} before validation.`
        : '',
      route: dispatched.receipt?.route || '',
      profileId: dispatched.receipt?.profileId || '',
      providerCalls: 1,
      proposed: processed.proposedCount + (processed.spatial?.proposedCount || 0),
      accepted: processed.acceptedCount + (processed.spatial?.acceptedCount || 0),
      applied: processed.applied.length + spatialApplied,
      rejected: processed.rejected.length + spatialRejected,
      aliasRepairs: processed.aliasRepairs || 0,
      candidateRecords: Math.min(visibleRecords.length, CAPTURE_LIMITS.visibleRecords),
      promptChars: options.systemPrompt.length + options.prompt.length,
      responseChars: dispatched.text.length,
      durationMs: Date.now() - startedAt,
    });
    return { ...processed, outcome, providerCalls: 1, snapshotToken, routeReceipt: dispatched.receipt };
  } catch (error) {
    if (!(error instanceof CaptureWireError)) throw error;
    diagnosticStore.record(chatKey, {
      operationId,
      label,
      sourceMessageId,
      outcome: 'invalid-response',
      code: error.code,
      detail: String(error.message || error).slice(0, 320),
      route: dispatched.receipt?.route || '',
      profileId: dispatched.receipt?.profileId || '',
      providerCalls: 1,
      candidateRecords: Math.min(visibleRecords.length, CAPTURE_LIMITS.visibleRecords),
      promptChars: options.systemPrompt.length + options.prompt.length,
      responseChars: dispatched.text.length,
      durationMs: Date.now() - startedAt,
    });
    return {
      outcome: 'invalid-response',
      state: markCaptureAttempt(state, sourceMessageId),
      providerCalls: 1,
      rejected: [rejectedEntry('response', error.message, { code: error.code })],
      applied: [],
      snapshotToken,
      routeReceipt: dispatched.receipt,
    };
  }
}

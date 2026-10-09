import { DUPLICATE_THRESHOLD, duplicateLookupKeys, duplicateSimilarity, mergeAnchors } from './duplicate.js';
import { createDiagnosticStore } from './diagnostics.js';
import { detectElapsedHintFromExchange, normalizeElapsedHint } from './elapsed.js';
import { EVOLUTION_WIRE_LIMITS, EvolutionWireError, parseEvolutionJson, validateEvolutionEnvelope } from './evolution-wire.js';
import { buildWorldStateInjection } from './injection.js';
import { dispatchWorldStateRequest } from './provider-routing.js';
import { selectBackgroundDevelopments, updateRelevanceIndex } from './relevance.js';
import { captureExchangeIndex, evidenceClaimGrounded } from './source-firewall.js';
import { clipMiddle } from './common.js';
import { reduceMutations } from './state-core.js';

export const EVOLUTION_RESPONSE_TOKENS = 2600;
export const EVOLUTION_LIMITS = Object.freeze({
  targets: 6,
  relevantTargets: 4,
  backgroundTargets: 3,
  backgroundScan: 32,
  historicalEvidencePerTarget: 4,
  affectingEvidence: 8,
  loreChars: 3500,
  timeAnchorChars: 160,
});

export const EVOLUTION_SYSTEM_PROMPT = [
  'Return exactly one valid JSON object for World State Alpha targeted evolution. No markdown or commentary.',
  'You are a conservative causal continuity evaluator, not a narrator, Story Director, simulator, or quest generator.',
  'Evaluate only the supplied TARGET DEVELOPMENTS. Do not touch records that were not supplied.',
  'Elapsed time is permission to evaluate; elapsed time alone is not evidence that a change occurred.',
  'Story-driving CoT principles such as autonomous world motion, scene variation, chance, escalation, or avoiding stagnation do not apply to evolution and are not evidence.',
  'Existing World State is current campaign authority. Lore is baseline context/causal possibility only and cannot establish that an event occurred.',
  'Prefer stable when the supplied state and support do not causally justify a change.',
  'Do not invent new actors, negotiations, attacks, discoveries, decisions, outcomes, or chance events merely to make the world move.',
  'Every evaluation, including stable, must cite the elapsed/current trigger supportId shown for that target; a changed outcome must also cite the supportIds that justify the change. Use only supportIds shown for that target.',
  'At most one derived development may be proposed. It must be a strongly grounded consequence of at least two supplied target developments, or one target plus grounded CURRENT affecting evidence.',
  'Never create an episode merely because static lore still describes an old pressure.',
  'Keep the JSON valid: escape every double quote inside a JSON string as \\"; never leave a raw double quote inside a reason or summary.',
].join(' ');

function recordFromEntry(entry) {
  return entry?.record || entry || null;
}

function lastEvaluationBoundary(record) {
  if (Number.isInteger(record?.lastEvaluatedMessage)) return record.lastEvaluatedMessage;
  if (Number.isInteger(record?.lastChangedMessage)) return record.lastChangedMessage;
  if (Number.isInteger(record?.createdAtMessage)) return record.createdAtMessage;
  return -1;
}

function normalizeAffectingEvidence(rawItems, targetIds, exchange) {
  const exchangeById = captureExchangeIndex(exchange);
  const accepted = [];
  const rejected = [];
  const seen = new Set();

  for (const raw of (Array.isArray(rawItems) ? rawItems : []).slice(0, EVOLUTION_LIMITS.affectingEvidence)) {
    const recordId = typeof raw?.recordId === 'string' ? raw.recordId.trim().slice(0, 120) : '';
    const sourceMessageId = Number.isInteger(raw?.sourceMessageId) ? raw.sourceMessageId : null;
    const claim = typeof raw?.claim === 'string' ? raw.claim.trim().slice(0, 500) : '';
    if (!recordId || !targetIds.has(recordId)) {
      rejected.push({ raw, reason: 'affecting evidence must target a selected active development' });
      continue;
    }
    const source = exchangeById.get(sourceMessageId);
    if (!source || source.role === 'system') {
      rejected.push({ raw, reason: 'affecting evidence must reference the current user/assistant exchange' });
      continue;
    }
    if (!evidenceClaimGrounded(claim, source.text)) {
      rejected.push({ raw, reason: 'affecting evidence claim is not grounded as a current-exchange excerpt' });
      continue;
    }
    const key = `${recordId}|${sourceMessageId}|${claim}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accepted.push({
      recordId,
      sourceMessageId,
      lineageKey: source.lineageKey,
      sourceClass: source.role === 'user' ? 'user_narration' : 'assistant_narration',
      claim,
    });
  }
  return { accepted, rejected };
}

function resolveElapsedHint(input, exchange, sourceMessageId, sourceLineageKey) {
  if (input) {
    return normalizeElapsedHint(input, {
      sourceMessageId,
      lineageKey: sourceLineageKey,
      source: 'explicit',
    });
  }
  return detectElapsedHintFromExchange(exchange);
}

export function planLazyEvolution(state, {
  selectedEntries = [],
  exchange = [],
  elapsedHint = null,
  affectingEvidence = [],
  sourceMessageId = null,
  sourceLineageKey = '',
  maxTargets = EVOLUTION_LIMITS.targets,
} = {}) {
  const selectedDevelopments = [];
  const seenSelected = new Set();
  for (const entry of Array.isArray(selectedEntries) ? selectedEntries : []) {
    const record = recordFromEntry(entry);
    if (record?.kind !== 'development' || record?.status !== 'active' || seenSelected.has(record.id)) continue;
    seenSelected.add(record.id);
    selectedDevelopments.push(record);
  }
  const selectedIds = new Set(selectedDevelopments.map(record => record.id));
  const elapsed = resolveElapsedHint(elapsedHint, exchange, sourceMessageId, sourceLineageKey);
  const grounded = normalizeAffectingEvidence(affectingEvidence, selectedIds, exchange);
  const evidenceByRecord = new Map();

  for (const item of grounded.accepted) {
    if (!evidenceByRecord.has(item.recordId)) evidenceByRecord.set(item.recordId, []);
    evidenceByRecord.get(item.recordId).push(item);
  }

  const targets = [];
  for (const record of selectedDevelopments) {
    const lastEvaluated = lastEvaluationBoundary(record);
    const directEvidence = (evidenceByRecord.get(record.id) || [])
      .filter(item => item.sourceMessageId > lastEvaluated);
    const elapsedBoundary = Number.isInteger(elapsed?.sourceMessageId) ? elapsed.sourceMessageId : sourceMessageId;
    const elapsedDue = Boolean(
      elapsed?.meaningful
      && Number.isInteger(elapsedBoundary)
      && elapsedBoundary > lastEvaluated,
    );
    if (!elapsedDue && directEvidence.length === 0) continue;

    targets.push({
      record,
      trigger: {
        elapsed: elapsedDue,
        directEvidence: directEvidence.length > 0,
      },
      directEvidence,
    });
    // Never more targets than the wire accepts evaluations for: the reply must answer every target.
    if (targets.length >= Math.max(1, Math.min(EVOLUTION_WIRE_LIMITS.evaluations, Number(maxTargets) || EVOLUTION_LIMITS.targets))) break;
  }

  return {
    targets,
    elapsedHint: elapsed,
    affectingEvidence: grounded.accepted,
    rejectedAffectingEvidence: grounded.rejected,
    metrics: {
      selectedDevelopments: selectedDevelopments.length,
      targets: targets.length,
      elapsedTrigger: targets.filter(target => target.trigger.elapsed).length,
      directEvidenceTrigger: targets.filter(target => target.trigger.directEvidence).length,
    },
  };
}

function allowedHistoricalEvidence(state, record) {
  const out = [];
  const allowedClasses = new Set(['user_narration', 'assistant_narration', 'recent_history', 'manual', 'rebuild']);
  const ids = Array.isArray(record?.evidenceIds) ? record.evidenceIds : [];
  for (let index = ids.length - 1; index >= 0 && out.length < EVOLUTION_LIMITS.historicalEvidencePerTarget; index -= 1) {
    const evidence = state?.evidence?.[ids[index]];
    if (!evidence?.claim || !allowedClasses.has(evidence.sourceClass)) continue;
    out.push(evidence);
  }
  return out.reverse();
}

export function buildEvolutionContext(state, plan, {
  currentTimeAnchor = '',
} = {}) {
  const supportCatalog = {};
  const targetSupportIds = {};
  const promptTargets = [];
  let historicalSequence = 0;
  let currentSequence = 0;
  const targetIds = plan.targets.map(target => target.record.id);

  let timeSupportId = '';
  if (plan.elapsedHint?.meaningful) {
    timeSupportId = 't0';
    supportCatalog[timeSupportId] = {
      id: timeSupportId,
      type: 'time',
      recordIds: [...targetIds],
      claim: plan.elapsedHint.context || plan.elapsedHint.raw,
      sourceMessageId: plan.elapsedHint.sourceMessageId,
      lineageKey: plan.elapsedHint.lineageKey,
      meaningful: true,
    };
  }

  for (const target of plan.targets) {
    const record = target.record;
    const supportIds = [];
    const historical = [];
    for (const evidence of allowedHistoricalEvidence(state, record)) {
      const id = `h${historicalSequence++}`;
      supportCatalog[id] = {
        id,
        type: 'historical',
        recordIds: [record.id],
        claim: evidence.claim,
        sourceMessageId: evidence.sourceMessageId,
        lineageKey: evidence.lineageKey,
        sourceClass: evidence.sourceClass,
        timeAnchor: evidence.timeAnchor || '',
      };
      supportIds.push(id);
      historical.push({
        supportId: id,
        claim: evidence.claim,
        sourceClass: evidence.sourceClass,
        timeAnchor: evidence.timeAnchor || '',
      });
    }

    const current = [];
    for (const evidence of target.directEvidence) {
      const id = `c${currentSequence++}`;
      supportCatalog[id] = {
        id,
        type: 'current',
        recordIds: [record.id],
        claim: evidence.claim,
        sourceMessageId: evidence.sourceMessageId,
        lineageKey: evidence.lineageKey,
        sourceClass: evidence.sourceClass,
      };
      supportIds.push(id);
      current.push({
        supportId: id,
        sourceMessageId: evidence.sourceMessageId,
        claim: evidence.claim,
      });
    }

    if (timeSupportId && target.trigger.elapsed) supportIds.push(timeSupportId);
    targetSupportIds[record.id] = [...new Set(supportIds)];

    promptTargets.push({
      recordId: record.id,
      summary: record.summary,
      trend: record.trend ?? null,
      anchors: Array.isArray(record.anchors) ? record.anchors : [],
      lastChangedMessage: record.lastChangedMessage,
      lastEvaluatedMessage: record.lastEvaluatedMessage,
      timeAnchor: record.timeAnchor || '',
      trigger: target.trigger,
      allowedSupportIds: targetSupportIds[record.id],
      historicalEvidence: historical,
      currentAffectingEvidence: current,
    });
  }

  return {
    targets: plan.targets,
    elapsedHint: plan.elapsedHint,
    affectingEvidence: plan.affectingEvidence,
    supportCatalog,
    targetSupportIds,
    promptTargets,
    currentTimeAnchor: clipMiddle(currentTimeAnchor, EVOLUTION_LIMITS.timeAnchorChars, 0.58),
  };
}

export function buildEvolutionPrompt(context, {
  loreText = '',
} = {}) {
  const elapsed = context.elapsedHint?.meaningful
    ? {
        supportId: 't0',
        raw: context.elapsedHint.raw,
        amount: context.elapsedHint.amount,
        unit: context.elapsedHint.unit,
      }
    : null;

  const prompt = [
    'TARGET DEVELOPMENTS:',
    JSON.stringify(context.promptTargets),
    '',
    'MEANINGFUL ELAPSED HINT (evaluation trigger, not proof of change):',
    elapsed ? JSON.stringify(elapsed) : '(none)',
    '',
    'CURRENT OPAQUE TIME ANCHOR:',
    context.currentTimeAnchor || '(none)',
    '',
    'RELEVANT LORE BASELINE (causal constraints/possibilities only; not occurrence evidence):',
    clipMiddle(loreText, EVOLUTION_LIMITS.loreChars, 0.58) || '(none)',
    '',
    'OUTPUT SHAPE:',
    '{"evaluations":[{"recordId":"shown-id","outcome":"stable|update|resolve|supersede","summary":"required for resolve/supersede; replacement when update needs it","trend":"emerging|rising|stable|falling|uncertain when update needs it","anchors":["optional additional anchors"],"reason":"causal explanation grounded in shown state/support","supportIds":["only IDs allowed for this target"]}],"derived":[{"summary":"optional one new development","trend":"optional","anchors":["..."],"causeRecordIds":["target-id"],"reason":"strict causal explanation","supportIds":["shown support IDs"]}]}',
    'Return exactly one evaluation for every target. Use outcome "stable" when change is not causally justified.',
    'Do not output a derived development unless its creation gate is clearly satisfied.',
  ].join('\n');

  return {
    systemPrompt: EVOLUTION_SYSTEM_PROMPT,
    prompt,
    responseLength: EVOLUTION_RESPONSE_TOKENS,
    quietToLoud: false,
    instructOverride: true,
    trimNames: false,
  };
}

function supportRows(ids, context, recordId = null) {
  const rows = [];
  const seen = new Set();
  for (const id of Array.isArray(ids) ? ids : []) {
    if (seen.has(id)) continue;
    seen.add(id);
    const support = context.supportCatalog[id];
    if (!support) throw new EvolutionWireError(`unknown supportId: ${id}`);
    if (recordId && !context.targetSupportIds[recordId]?.includes(id)) {
      throw new EvolutionWireError(`supportId ${id} is not allowed for target ${recordId}`);
    }
    rows.push(support);
  }
  return rows;
}

function changeHasCausalSupport(supports) {
  const hasCurrent = supports.some(item => item.type === 'current');
  const hasTime = supports.some(item => item.type === 'time' && item.meaningful);
  const hasHistorical = supports.some(item => item.type === 'historical');
  return hasCurrent || (hasTime && hasHistorical);
}

function newEvidenceFromSupports(supports, currentTimeAnchor) {
  const out = [];
  const seen = new Set();
  for (const support of supports) {
    if (!['current', 'time'].includes(support.type)) continue;
    const key = `${support.type}|${support.sourceMessageId}|${support.claim}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (support.type === 'current') {
      out.push({
        sourceMessageId: support.sourceMessageId,
        lineageKey: support.lineageKey,
        sourceClass: support.sourceClass,
        claim: support.claim,
      });
    } else {
      out.push({
        sourceMessageId: support.sourceMessageId,
        lineageKey: support.lineageKey,
        sourceClass: 'elapsed_hint',
        claim: support.claim,
        timeAnchor: currentTimeAnchor || '',
      });
    }
  }
  return out;
}

function triggerSupportIds(context, recordId) {
  return (context.targetSupportIds[recordId] || [])
    .filter(id => ['time', 'current'].includes(context.supportCatalog[id]?.type));
}

function evaluationMutation(evaluation, context) {
  let supports = supportRows(evaluation.supportIds, context, evaluation.recordId);
  // A stable result changes nothing, and the target was only offered because
  // of its own trigger, so record that trigger as the evaluation provenance
  // when the model left it out. Changed outcomes must still cite it themselves.
  if (evaluation.outcome === 'stable' && !supports.some(item => item.type === 'time' || item.type === 'current')) {
    supports = supportRows([...evaluation.supportIds, ...triggerSupportIds(context, evaluation.recordId)], context, evaluation.recordId);
  }
  if (supports.length === 0) {
    throw new EvolutionWireError(`evaluation for ${evaluation.recordId} requires at least one supportId`);
  }
  if (!supports.some(item => item.type === 'time' || item.type === 'current')) {
    throw new EvolutionWireError(`evaluation for ${evaluation.recordId} must cite its elapsed/current trigger support`);
  }
  if (evaluation.outcome !== 'stable' && !changeHasCausalSupport(supports)) {
    throw new EvolutionWireError(
      `changed evaluation for ${evaluation.recordId} requires current affecting evidence or meaningful elapsed time plus prior accepted evidence`,
    );
  }

  const evidence = newEvidenceFromSupports(supports, context.currentTimeAnchor);
  const mutation = {
    action: evaluation.outcome === 'stable' ? 'update' : evaluation.outcome,
    recordId: evaluation.recordId,
    reason: evaluation.reason,
    evidence,
  };

  if (evaluation.outcome === 'update') {
    if (evaluation.summary) mutation.summary = evaluation.summary;
    if (Object.hasOwn(evaluation, 'trend')) mutation.trend = evaluation.trend;
    if (Array.isArray(evaluation.anchors) && evaluation.anchors.length) {
      // Evolution has no narration to ground new anchors against, so it can add to a development's anchors
      // but never drop the ones retrieval already finds it by.
      const target = context.targets.find(item => item.record.id === evaluation.recordId)?.record;
      mutation.anchors = mergeAnchors(target?.anchors || [], evaluation.anchors);
    }
  }
  if ((evaluation.outcome === 'resolve' || evaluation.outcome === 'supersede') && evaluation.summary) {
    mutation.summary = evaluation.summary;
  }
  if (evaluation.outcome !== 'stable' && context.currentTimeAnchor) {
    mutation.timeAnchor = context.currentTimeAnchor;
  }
  return { mutation, supports };
}

// The records a derived development could duplicate, found through the relevance index (active and retired
// records sharing a whole anchor or a counted summary word) plus this batch's targets, whose evaluated text
// the index does not hold yet. Null compares every record (no index, or spaceless-script text).
function duplicatePool(index, candidate, targetIds) {
  const keys = index?.byId && index.tombstones?.byId ? duplicateLookupKeys(candidate) : null;
  if (!keys) return null;
  const pool = new Set(targetIds);
  for (const terms of [index, index.tombstones]) {
    for (const anchor of keys.anchors) for (const id of terms.anchorPhrases?.get(anchor) || []) pool.add(id);
    for (const word of keys.words) for (const id of terms.summaryTokens?.get(word) || []) pool.add(id);
  }
  return pool;
}

function derivedMutation(candidate, context, state, index = null) {
  const targetIds = new Set(context.targets.map(target => target.record.id));
  if (!candidate.causeRecordIds.length || candidate.causeRecordIds.some(id => !targetIds.has(id))) {
    return { ok: false, reason: 'derived development causeRecordIds must reference supplied targets only' };
  }
  let supports;
  try {
    supports = supportRows(candidate.supportIds, context);
  } catch (error) {
    return { ok: false, reason: String(error?.message || error) };
  }
  const supportIds = new Set(candidate.supportIds);
  const unrelatedSupport = supports.find(item =>
    item.type !== 'time' && !item.recordIds.some(id => candidate.causeRecordIds.includes(id)));
  if (unrelatedSupport) {
    return { ok: false, reason: 'derived development support must belong to one of its declared cause records' };
  }
  const currentSupportForCause = supports.some(item =>
    item.type === 'current' && item.recordIds.some(id => candidate.causeRecordIds.includes(id)));
  const uncoveredCause = candidate.causeRecordIds.find(causeId =>
    !supports.some(item => item.type !== 'time' && item.recordIds.includes(causeId)));
  if (uncoveredCause) {
    return { ok: false, reason: 'each declared derived cause requires its own non-time support' };
  }
  if (candidate.causeRecordIds.length < 2 && !currentSupportForCause) {
    return {
      ok: false,
      reason: 'derived development requires at least two target causes or one target plus grounded current affecting evidence',
    };
  }
  if (!changeHasCausalSupport(supports)) {
    return { ok: false, reason: 'derived development lacks causal support' };
  }

  let bestDuplicate = null;
  const pool = duplicatePool(index, candidate, targetIds);
  for (const record of Array.isArray(state?.records) ? state.records : []) {
    if (pool && !pool.has(record?.id)) continue;
    const score = duplicateSimilarity({ kind: 'development', ...candidate }, record);
    if (!bestDuplicate || score > bestDuplicate.score) bestDuplicate = { record, score };
  }
  if (bestDuplicate && bestDuplicate.score >= DUPLICATE_THRESHOLD) {
    return {
      ok: false,
      reason: bestDuplicate.record.status === 'active'
        ? 'derived development is already represented by current state'
        : 'derived development duplicates a resolved/superseded episode and cannot resurrect it',
      duplicateRecordId: bestDuplicate.record.id,
    };
  }

  const evidence = newEvidenceFromSupports(
    [...supportIds].map(id => context.supportCatalog[id]).filter(Boolean),
    context.currentTimeAnchor,
  );
  return {
    ok: true,
    mutation: {
      action: 'create',
      kind: 'development',
      summary: candidate.summary,
      trend: candidate.trend,
      anchors: candidate.anchors,
      causedBy: candidate.causeRecordIds,
      reason: candidate.reason,
      evidence,
      ...(context.currentTimeAnchor ? { timeAnchor: context.currentTimeAnchor } : {}),
    },
  };
}

export function processEvolutionResponse({
  text,
  state,
  context,
  index = null,
  chatKey,
  sourceMessageId,
  sourceLineageKey,
} = {}) {
  const raw = parseEvolutionJson(text);
  const wire = validateEvolutionEnvelope(raw);
  const evaluationWireErrors = wire.rejected.filter(item => item.section === 'evaluations');
  if (evaluationWireErrors.length) {
    throw new EvolutionWireError(evaluationWireErrors.map(item => item.reason).join('; '));
  }

  const targetIds = context.targets.map(target => target.record.id);
  if (wire.evaluations.length !== targetIds.length) {
    throw new EvolutionWireError('evolution response must contain exactly one evaluation per target');
  }
  const seen = new Set();
  const evaluationMutations = [];
  const outcomes = [];

  for (const evaluation of wire.evaluations) {
    if (!targetIds.includes(evaluation.recordId)) {
      throw new EvolutionWireError(`evaluation references non-target record: ${evaluation.recordId}`);
    }
    if (seen.has(evaluation.recordId)) {
      throw new EvolutionWireError(`duplicate evaluation for target: ${evaluation.recordId}`);
    }
    seen.add(evaluation.recordId);
    const prepared = evaluationMutation(evaluation, context);
    evaluationMutations.push(prepared.mutation);
    outcomes.push({ recordId: evaluation.recordId, outcome: evaluation.outcome });
  }

  // Derived developments are judged against the evaluated state; with none proposed, the batch's own
  // reduction below is the only copy.
  const projectedEvaluations = wire.derived.length ? reduceMutations(state, {
    chatKey,
    messageId: sourceMessageId,
    lineageKey: sourceLineageKey,
    operation: 'evolution',
    mutations: evaluationMutations,
  }) : null;
  if (projectedEvaluations?.rejected.length) {
    throw new EvolutionWireError(
      `deterministic reducer rejected evolution evaluations: ${projectedEvaluations.rejected.map(item => item.reason).join('; ')}`,
    );
  }

  const rejectedDerived = wire.rejected
    .filter(item => item.section === 'derived')
    .map(item => ({ stage: 'wire', reason: item.reason, index: item.index }));
  const derivedMutations = [];
  for (const candidate of wire.derived) {
    const admitted = derivedMutation(candidate, context, projectedEvaluations.state, index);
    if (!admitted.ok) {
      rejectedDerived.push({ stage: 'derived-gate', reason: admitted.reason, duplicateRecordId: admitted.duplicateRecordId || '' });
      continue;
    }
    derivedMutations.push(admitted.mutation);
  }

  const reduced = reduceMutations(state, {
    chatKey,
    messageId: sourceMessageId,
    lineageKey: sourceLineageKey,
    operation: 'evolution',
    mutations: [...evaluationMutations, ...derivedMutations],
  });
  if (reduced.rejected.length) {
    throw new EvolutionWireError(
      `deterministic reducer rejected evolution ${projectedEvaluations ? 'batch' : 'evaluations'}: ${reduced.rejected.map(item => item.reason).join('; ')}`,
    );
  }

  return {
    state: reduced.state,
    applied: reduced.applied,
    outcomes,
    stableCount: outcomes.filter(item => item.outcome === 'stable').length,
    changedCount: outcomes.filter(item => item.outcome !== 'stable').length,
    derivedCount: derivedMutations.length,
    rejectedDerived,
    proposedDerivedCount: raw.derived.length,
    indexDelta: reduced.indexDelta || { upsertedRecords: [], appendedLinks: [], corpusRecords: reduced.state.records.length },
  };
}

export async function runLazyEvolution({
  ctx,
  state,
  // The relevance index of `state`, when the host has one: the derived-development duplicate check looks
  // up its candidates there instead of comparing every record.
  index = null,
  selectedEntries = [],
  exchange = [],
  elapsedHint = null,
  affectingEvidence = [],
  maxTargets = EVOLUTION_LIMITS.targets,
  loreText = '',
  currentTimeAnchor = '',
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
} = {}) {
  const plan = planLazyEvolution(state, {
    selectedEntries,
    exchange,
    elapsedHint,
    affectingEvidence,
    sourceMessageId,
    sourceLineageKey,
    maxTargets,
  });

  // A run that changes nothing (skipped, stale, failed or invalid) returns the state it was given: no copy,
  // and a host compares it by identity.
  if (!plan.targets.length) {
    return {
      outcome: 'skipped',
      state,
      providerCalls: 0,
      plan,
      applied: [],
      outcomes: [],
      rejectedDerived: [],
    };
  }

  if (!Number.isInteger(sourceMessageId) || sourceMessageId < 0 || !String(sourceLineageKey || '').trim()) {
    const error = new Error('lazy evolution requires an owned raw-message boundary');
    error.code = 'WORLD_STATE_EVOLUTION_BOUNDARY_REQUIRED';
    throw error;
  }
  if (typeof isCurrent !== 'function') {
    const error = new Error('lazy evolution requires an isCurrent() guard');
    error.code = 'WORLD_STATE_EVOLUTION_CURRENT_GUARD_REQUIRED';
    throw error;
  }

  const context = buildEvolutionContext(state, plan, { currentTimeAnchor });
  const current = () => isCurrent();
  if (!current()) {
    return {
      outcome: 'stale',
      state,
      providerCalls: 0,
      plan,
      applied: [],
      outcomes: [],
      rejectedDerived: [],
    };
  }

  const options = buildEvolutionPrompt(context, { loreText });
  const diagnosticStore = diagnostics || createDiagnosticStore();
  const startedAt = Date.now();
  let dispatched;

  try {
    dispatched = await dispatcher(ctx, options, {
      route,
      chatKey,
      operationId,
      timeoutMs,
      signal,
      isCurrent: current,
      label: 'lazy-evolution',
    });
  } catch (error) {
    const receipt = error?.receipt || {};
    const stale = error?.code === 'WORLD_STATE_ROUTE_CANCELLED' && !current();
    diagnosticStore.record(chatKey, {
      operationId,
      label: 'lazy-evolution',
      sourceMessageId,
      outcome: stale ? 'stale' : (receipt.outcome || 'failure'),
      code: error?.code || 'PROVIDER_ERROR',
      route: receipt.route || '',
      profileId: receipt.profileId || '',
      providerCalls: receipt.dispatched ? 1 : 0,
      candidateRecords: plan.targets.length,
      promptChars: options.systemPrompt.length + options.prompt.length,
      responseChars: 0,
      durationMs: Date.now() - startedAt,
    });
    return {
      outcome: stale ? 'stale' : 'failure',
      state,
      providerCalls: receipt.dispatched ? 1 : 0,
      plan,
      applied: [],
      outcomes: [],
      rejectedDerived: [],
      errorCode: error?.code || 'PROVIDER_ERROR',
      routeReceipt: receipt,
    };
  }

  if (!current()) {
    diagnosticStore.record(chatKey, {
      operationId,
      label: 'lazy-evolution',
      sourceMessageId,
      outcome: 'stale',
      code: 'WORLD_STATE_EVOLUTION_STALE',
      route: dispatched.receipt?.route || '',
      profileId: dispatched.receipt?.profileId || '',
      providerCalls: 1,
      candidateRecords: plan.targets.length,
      promptChars: options.systemPrompt.length + options.prompt.length,
      responseChars: dispatched.text.length,
      durationMs: Date.now() - startedAt,
      responseJson: dispatched.text,
    });
    return {
      outcome: 'stale',
      state,
      providerCalls: 1,
      plan,
      applied: [],
      outcomes: [],
      rejectedDerived: [],
      routeReceipt: dispatched.receipt,
    };
  }

  try {
    const processed = processEvolutionResponse({
      text: dispatched.text,
      state,
      context,
      index,
      chatKey,
      sourceMessageId,
      sourceLineageKey,
    });
    const outcome = processed.changedCount > 0 || processed.derivedCount > 0 ? 'evolved' : 'stable';
    diagnosticStore.record(chatKey, {
      operationId,
      label: 'lazy-evolution',
      sourceMessageId,
      outcome,
      route: dispatched.receipt?.route || '',
      profileId: dispatched.receipt?.profileId || '',
      providerCalls: 1,
      proposed: context.targets.length + processed.proposedDerivedCount,
      accepted: processed.applied.length,
      applied: processed.applied.length,
      rejected: processed.rejectedDerived.length,
      candidateRecords: plan.targets.length,
      promptChars: options.systemPrompt.length + options.prompt.length,
      responseChars: dispatched.text.length,
      durationMs: Date.now() - startedAt,
      responseJson: dispatched.text,
      rejectionsJson: JSON.stringify(processed.rejectedDerived || []),
    });
    return {
      ...processed,
      outcome,
      providerCalls: 1,
      plan,
      routeReceipt: dispatched.receipt,
    };
  } catch (error) {
    if (!(error instanceof EvolutionWireError)) throw error;
    diagnosticStore.record(chatKey, {
      operationId,
      label: 'lazy-evolution',
      sourceMessageId,
      outcome: 'invalid-response',
      code: error.code,
      route: dispatched.receipt?.route || '',
      profileId: dispatched.receipt?.profileId || '',
      providerCalls: 1,
      candidateRecords: plan.targets.length,
      promptChars: options.systemPrompt.length + options.prompt.length,
      responseChars: dispatched.text.length,
      durationMs: Date.now() - startedAt,
      responseJson: dispatched.text,
      rejectionsJson: JSON.stringify([{ stage: 'response', code: error.code, reason: String(error.message || error).slice(0, 320) }]),
    });
    return {
      outcome: 'invalid-response',
      state,
      providerCalls: 1,
      plan,
      applied: [],
      outcomes: [],
      rejectedDerived: [],
      errorCode: error.code,
      errorMessage: error.message,
      routeReceipt: dispatched.receipt,
    };
  }
}

export async function prepareWorldStateContinuity({
  ctx,
  state,
  index = null,
  recentText = '',
  loreText = '',
  currentMessageId = null,
  exchange = [],
  elapsedHint = null,
  affectingEvidence = [],
  currentTimeAnchor = '',
  budgetTokens = undefined,
  maxRecords = undefined,
  depth = undefined,
  candidateCap = 128,
  chatKey,
  sourceMessageId = currentMessageId,
  sourceLineageKey,
  route = undefined,
  operationId = '',
  timeoutMs = undefined,
  signal = undefined,
  isCurrent = undefined,
  diagnostics = undefined,
  dispatcher = dispatchWorldStateRequest,
  // false: do not apply evolution's record changes to `index` and return no
  // post-evolution injection, so a host publishes evolution.indexDelta with the
  // state only once it is saved. Background selection still advances the
  // index's catch-up cursor/boundary, so a host must rebuild the index from its
  // cached state when the save does not happen. (With true, a run that does not
  // complete puts the cursor back itself.)
  publishIndex = true,
} = {}) {
  const beforeInjection = buildWorldStateInjection(state, {
    index,
    recentText,
    loreText,
    currentMessageId,
    candidateCap,
    ...(budgetTokens === undefined ? {} : { budgetTokens }),
    ...(maxRecords === undefined ? {} : { maxRecords }),
    ...(depth === undefined ? {} : { depth }),
  });

  const resolvedElapsedHint = resolveElapsedHint(
    elapsedHint,
    exchange,
    sourceMessageId,
    sourceLineageKey,
  );
  const relevantDevelopments = beforeInjection.selected
    .filter(entry => {
      const record = recordFromEntry(entry);
      return record?.kind === 'development' && record?.status === 'active';
    });
  // Due first, then the cap: a relevant development evaluated since the skip (or untouched by new evidence) is
  // never due, and must not crowd a due one out of the four relevant slots.
  const dueIds = relevantDevelopments.length > EVOLUTION_LIMITS.relevantTargets
    ? new Set(planLazyEvolution(state, {
      selectedEntries: relevantDevelopments,
      exchange,
      elapsedHint: resolvedElapsedHint,
      affectingEvidence,
      sourceMessageId,
      sourceLineageKey,
      maxTargets: EVOLUTION_LIMITS.targets,
    }).targets.map(target => target.record?.id).filter(Boolean))
    : null;
  const relevantEvolutionEntries = (dueIds
    ? relevantDevelopments.filter(entry => dueIds.has(recordFromEntry(entry)?.id))
    : relevantDevelopments)
    .slice(0, EVOLUTION_LIMITS.relevantTargets);
  const relevantIds = new Set(
    relevantEvolutionEntries
      .map(entry => recordFromEntry(entry)?.id)
      .filter(Boolean),
  );
  const elapsedBoundary = Number.isInteger(resolvedElapsedHint?.sourceMessageId)
    ? resolvedElapsedHint.sourceMessageId
    : sourceMessageId;
  // Only relevant developments that are due (evaluated before this skip, or affected by new evidence) take
  // a slot: one evaluated since is skipped by the plan and must not leave a background slot empty.
  const dueRelevant = resolvedElapsedHint?.meaningful && index
    ? planLazyEvolution(state, {
      selectedEntries: relevantEvolutionEntries,
      exchange,
      elapsedHint: resolvedElapsedHint,
      affectingEvidence,
      sourceMessageId,
      sourceLineageKey,
    }).targets.length
    : relevantEvolutionEntries.length;
  // The catch-up cursor before this selection: a run that does not complete gives the slots back, so the same
  // developments are tried again on a later turn.
  const cursorBefore = index ? { cursor: index.backgroundCursor, boundary: index.backgroundElapsedBoundary } : null;
  const backgroundSelection = resolvedElapsedHint?.meaningful && index
    ? selectBackgroundDevelopments(index, {
        excludeIds: relevantIds,
        currentMessageId: elapsedBoundary,
        maxRecords: Math.min(
          EVOLUTION_LIMITS.backgroundTargets,
          Math.max(0, EVOLUTION_LIMITS.targets - dueRelevant),
        ),
        scanCap: EVOLUTION_LIMITS.backgroundScan,
      })
    : { selected: [], metrics: { examined: 0, poolSize: 0, available: 0, selected: 0 } };
  const evolutionEntries = [
    ...relevantEvolutionEntries,
    ...backgroundSelection.selected,
  ];

  // Nothing to evaluate: the state is returned as it is (unchanged), not copied.
  if (!evolutionEntries.length) {
    return {
      state,
      injection: beforeInjection,
      evolution: {
        outcome: 'skipped',
        providerCalls: 0,
        applied: [],
        outcomes: [],
        rejectedDerived: [],
        backgroundSelection: backgroundSelection.metrics,
      },
      providerCalls: 0,
    };
  }

  const evolution = await runLazyEvolution({
    ctx,
    state,
    index,
    selectedEntries: evolutionEntries,
    exchange,
    elapsedHint: resolvedElapsedHint,
    affectingEvidence,
    maxTargets: EVOLUTION_LIMITS.targets,
    loreText,
    currentTimeAnchor,
    chatKey,
    sourceMessageId,
    sourceLineageKey,
    route,
    operationId,
    timeoutMs,
    signal,
    isCurrent,
    diagnostics,
    dispatcher,
  });
  evolution.backgroundSelection = backgroundSelection.metrics;
  if (publishIndex && cursorBefore && backgroundSelection.selected.length && !['evolved', 'stable'].includes(evolution.outcome)) {
    index.backgroundCursor = cursorBefore.cursor;
    index.backgroundElapsedBoundary = cursorBefore.boundary;
  }

  const nextState = evolution.state || state;
  if (!publishIndex) {
    return { state: nextState, injection: null, evolution, providerCalls: evolution.providerCalls || 0 };
  }
  if (index && evolution.indexDelta) {
    updateRelevanceIndex(index, evolution.indexDelta);
  }

  const injection = buildWorldStateInjection(nextState, {
    index,
    recentText,
    loreText,
    currentMessageId,
    candidateCap,
    ...(budgetTokens === undefined ? {} : { budgetTokens }),
    ...(maxRecords === undefined ? {} : { maxRecords }),
    ...(depth === undefined ? {} : { depth }),
  });

  return {
    state: nextState,
    injection,
    evolution,
    providerCalls: evolution.providerCalls || 0,
  };
}

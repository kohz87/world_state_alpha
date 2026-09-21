import { duplicateSimilarity } from './duplicate.js';
import { createDiagnosticStore } from './diagnostics.js';
import { detectElapsedHintFromExchange, normalizeElapsedHint } from './elapsed.js';
import { EvolutionWireError, parseEvolutionJson, validateEvolutionEnvelope } from './evolution-wire.js';
import { hashText, stableStringify } from './hash.js';
import { buildWorldStateInjection } from './injection.js';
import { dispatchWorldStateRequest } from './provider-routing.js';
import { updateRelevanceIndex } from './relevance.js';
import { captureExchangeIndex, evidenceClaimGrounded } from './source-firewall.js';
import { clone, reduceMutations } from './state-core.js';

export const EVOLUTION_RESPONSE_TOKENS = 2600;
export const EVOLUTION_LIMITS = Object.freeze({
  targets: 4,
  historicalEvidencePerTarget: 4,
  affectingEvidence: 8,
  loreChars: 3500,
  timeAnchorChars: 160,
  duplicateThreshold: 0.78,
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
  'A changed outcome must cite supplied supportIds. Use only supportIds shown for that target.',
  'At most one derived development may be proposed. It must be a strongly grounded consequence of at least two supplied target developments, or one target plus grounded CURRENT affecting evidence.',
  'Never create an episode merely because static lore still describes an old pressure.',
].join(' ');

function clip(value, max) {
  const raw = String(value ?? '').trim();
  if (raw.length <= max) return raw;
  const head = Math.floor(max * 0.58);
  const tail = Math.max(0, max - head - 24);
  return `${raw.slice(0, head)}\n...[bounded]...\n${raw.slice(-tail)}`;
}

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
    if (targets.length >= Math.max(1, Math.min(8, Number(maxTargets) || EVOLUTION_LIMITS.targets))) break;
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
      claim: plan.elapsedHint.raw,
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
    currentTimeAnchor: clip(currentTimeAnchor, EVOLUTION_LIMITS.timeAnchorChars),
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
    clip(loreText, EVOLUTION_LIMITS.loreChars) || '(none)',
    '',
    'OUTPUT SHAPE:',
    '{"evaluations":[{"recordId":"shown-id","outcome":"stable|update|resolve|supersede","summary":"required for resolve/supersede; replacement when update needs it","trend":"emerging|rising|stable|falling|uncertain when update needs it","anchors":["optional replacement anchors"],"reason":"causal explanation grounded in shown state/support","supportIds":["only IDs allowed for this target"]}],"derived":[{"summary":"optional one new development","trend":"optional","anchors":["..."],"causeRecordIds":["target-id"],"reason":"strict causal explanation","supportIds":["shown support IDs"]}]}',
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

function evaluationMutation(evaluation, context) {
  const supports = supportRows(evaluation.supportIds, context, evaluation.recordId);
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
    if (Object.hasOwn(evaluation, 'anchors')) mutation.anchors = evaluation.anchors;
  }
  if ((evaluation.outcome === 'resolve' || evaluation.outcome === 'supersede') && evaluation.summary) {
    mutation.summary = evaluation.summary;
  }
  if (evaluation.outcome !== 'stable' && context.currentTimeAnchor) {
    mutation.timeAnchor = context.currentTimeAnchor;
  }
  return { mutation, supports };
}

function derivedMutation(candidate, context, state) {
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
  for (const record of Array.isArray(state?.records) ? state.records : []) {
    const score = duplicateSimilarity({ kind: 'development', ...candidate }, record);
    if (!bestDuplicate || score > bestDuplicate.score) bestDuplicate = { record, score };
  }
  if (bestDuplicate && bestDuplicate.score >= EVOLUTION_LIMITS.duplicateThreshold) {
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

  const projectedEvaluations = reduceMutations(state, {
    chatKey,
    messageId: sourceMessageId,
    lineageKey: sourceLineageKey,
    operation: 'evolution',
    mutations: evaluationMutations,
  });
  if (projectedEvaluations.rejected.length) {
    throw new EvolutionWireError(
      `deterministic reducer rejected evolution evaluations: ${projectedEvaluations.rejected.map(item => item.reason).join('; ')}`,
    );
  }

  const rejectedDerived = wire.rejected
    .filter(item => item.section === 'derived')
    .map(item => ({ stage: 'wire', reason: item.reason, index: item.index }));
  const derivedMutations = [];
  for (const candidate of wire.derived) {
    const admitted = derivedMutation(candidate, context, projectedEvaluations.state);
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
      `deterministic reducer rejected evolution batch: ${reduced.rejected.map(item => item.reason).join('; ')}`,
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

export function evolutionSnapshotToken({
  state,
  context,
  sourceMessageId,
  sourceLineageKey,
} = {}) {
  return hashText(stableStringify({
    rollbackJournalSequence: Number(state?.rollbackJournalSequence) || 0,
    sourceMessageId,
    sourceLineageKey: String(sourceLineageKey || ''),
    elapsedHint: context?.elapsedHint || null,
    targets: (context?.targets || []).map(target => ({
      id: target.record.id,
      summary: target.record.summary,
      status: target.record.status,
      trend: target.record.trend,
      anchors: target.record.anchors,
      lastChangedMessage: target.record.lastChangedMessage,
      lastEvaluatedMessage: target.record.lastEvaluatedMessage,
      evidenceIds: target.record.evidenceIds,
    })),
    affectingEvidence: context?.affectingEvidence || [],
  }));
}

export async function runLazyEvolution({
  ctx,
  state,
  selectedEntries = [],
  exchange = [],
  elapsedHint = null,
  affectingEvidence = [],
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
  });

  if (!plan.targets.length) {
    return {
      outcome: 'skipped',
      state: clone(state),
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
    const error = new Error('lazy evolution requires an isCurrent(snapshotToken) guard');
    error.code = 'WORLD_STATE_EVOLUTION_CURRENT_GUARD_REQUIRED';
    throw error;
  }

  const context = buildEvolutionContext(state, plan, { currentTimeAnchor });
  const snapshotToken = evolutionSnapshotToken({ state, context, sourceMessageId, sourceLineageKey });
  const current = () => isCurrent(snapshotToken);
  if (!current()) {
    return {
      outcome: 'stale',
      state: clone(state),
      providerCalls: 0,
      plan,
      applied: [],
      outcomes: [],
      rejectedDerived: [],
      snapshotToken,
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
      state: clone(state),
      providerCalls: receipt.dispatched ? 1 : 0,
      plan,
      applied: [],
      outcomes: [],
      rejectedDerived: [],
      snapshotToken,
      errorCode: error?.code || 'PROVIDER_ERROR',
      routeReceipt: receipt,
    };
  }

  if (!current()) {
    diagnosticStore.record(chatKey, {
      operationId,
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
    });
    return {
      outcome: 'stale',
      state: clone(state),
      providerCalls: 1,
      plan,
      applied: [],
      outcomes: [],
      rejectedDerived: [],
      snapshotToken,
      routeReceipt: dispatched.receipt,
    };
  }

  try {
    const processed = processEvolutionResponse({
      text: dispatched.text,
      state,
      context,
      chatKey,
      sourceMessageId,
      sourceLineageKey,
    });
    const outcome = processed.changedCount > 0 || processed.derivedCount > 0 ? 'evolved' : 'stable';
    diagnosticStore.record(chatKey, {
      operationId,
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
    });
    return {
      ...processed,
      outcome,
      providerCalls: 1,
      plan,
      snapshotToken,
      routeReceipt: dispatched.receipt,
    };
  } catch (error) {
    if (!(error instanceof EvolutionWireError)) throw error;
    diagnosticStore.record(chatKey, {
      operationId,
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
    });
    return {
      outcome: 'invalid-response',
      state: clone(state),
      providerCalls: 1,
      plan,
      applied: [],
      outcomes: [],
      rejectedDerived: [],
      snapshotToken,
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

  if (!beforeInjection.selected.length) {
    return {
      state: clone(state),
      injection: beforeInjection,
      evolution: {
        outcome: 'skipped',
        providerCalls: 0,
        applied: [],
        outcomes: [],
        rejectedDerived: [],
      },
      providerCalls: 0,
    };
  }

  const evolution = await runLazyEvolution({
    ctx,
    state,
    selectedEntries: beforeInjection.selected,
    exchange,
    elapsedHint,
    affectingEvidence,
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

  const nextState = evolution.state || state;
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

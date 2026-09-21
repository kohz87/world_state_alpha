import { fingerprintMessage } from './branch.js';
import { CaptureWireError, parseCaptureJson, validateCaptureEnvelope } from './capture-wire.js';
import { createDiagnosticStore } from './diagnostics.js';
import { consolidateCreateCandidate } from './duplicate.js';
import { hashText, stableStringify } from './hash.js';
import { dispatchWorldStateRequest } from './provider-routing.js';
import { applyCaptureSourceFirewall } from './source-firewall.js';
import { clone, reduceMutations } from './state-core.js';

export const CAPTURE_DEFAULT_INTERVAL = 1;
export const CAPTURE_RESPONSE_TOKENS = 2200;
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
  'Story-driving CoT principles such as autonomous world motion, scene variation, chance, escalation, or avoiding stagnation do not apply to capture and are not evidence.',
  'Existing World State records are current campaign authority. Lore is baseline context/possibility only and cannot by itself establish a current condition.',
  'Never invent off-screen developments, outcomes, consequences, or causal links.',
  'For every non-noop mutation, cite 1-4 short verbatim excerpts from CURRENT EXCHANGE using sourceMessageId.',
  'Use shown record IDs only for update/resolve/supersede/related links. Never create an ID.',
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
      content: clip(messageText(message), CAPTURE_LIMITS.perMessageChars),
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

export function buildCapturePrompt({ exchange = [], visibleRecords = [], loreText = '' } = {}) {
  const currentExchange = normalizeCaptureExchange(exchange);
  const records = renderRecords(visibleRecords);
  const lore = clip(loreText, CAPTURE_LIMITS.loreChars);
  const prompt = [
    'CURRENT EXCHANGE (the only automatic mutation evidence source):',
    JSON.stringify(currentExchange.map(({ messageId, role, content }) => ({ messageId, role, content }))),
    '',
    'VISIBLE CURRENT WORLD STATE (current authority; use only these IDs):',
    JSON.stringify(records),
    '',
    'RELEVANT LORE BASELINE (context/possibility only; never evidence of current occurrence):',
    lore || '(none)',
    '',
    'OUTPUT SHAPE:',
    '{"mutations":[{"action":"create|update|resolve|supersede","recordId":"existing-id-for-non-create","kind":"fact|development-for-create","summary":"compact current state","status":"active|resolved when creating","trend":"emerging|rising|stable|falling|uncertain when useful","anchors":["concept"],"reason":"grounded reason","evidence":[{"sourceMessageId":123,"claim":"verbatim excerpt from current exchange"}],"relatedRecordIds":["visible-id"],"newEpisodeOfRecordId":"optional visible resolved/superseded id"}]}',
    'For no material change return exactly {"mutations":[]}.',
  ].join('\n');
  return {
    systemPrompt: CAPTURE_SYSTEM_PROMPT,
    prompt,
    responseLength: CAPTURE_RESPONSE_TOKENS,
    quietToLoud: false,
    instructOverride: true,
    trimNames: false,
  };
}

export function captureSnapshotToken({ state, exchange, visibleRecords = [], sourceMessageId, sourceLineageKey }) {
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
} = {}) {
  const raw = parseCaptureJson(text);
  const wire = validateCaptureEnvelope(raw);
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

  return {
    state: nextState,
    proposedCount: Array.isArray(raw.mutations) ? raw.mutations.length : 0,
    acceptedCount: accepted.length,
    applied: reduced.applied,
    rejected,
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
} = {}) {
  const diagnosticStore = diagnostics || createDiagnosticStore();
  const startedAt = Date.now();

  if (!captureDue({ exchange, lastCaptureMessage: state?.lastCaptureMessage, sourceMessageId })) {
    return { outcome: 'skipped', state: clone(state), providerCalls: 0, rejected: [], applied: [] };
  }

  const snapshotToken = captureSnapshotToken({ state, exchange, visibleRecords, sourceMessageId, sourceLineageKey });
  if (typeof isCurrent !== 'function') {
    const error = new Error('automatic capture requires an isCurrent(snapshotToken) guard');
    error.code = 'WORLD_STATE_CAPTURE_CURRENT_GUARD_REQUIRED';
    throw error;
  }
  const current = () => isCurrent(snapshotToken);
  if (!current()) {
    return { outcome: 'stale', state: clone(state), providerCalls: 0, rejected: [], applied: [], snapshotToken };
  }

  const options = buildCapturePrompt({ exchange, visibleRecords, loreText });
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
      sourceMessageId,
      outcome,
      code: error?.code || 'PROVIDER_ERROR',
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
      sourceMessageId,
      outcome: 'stale',
      code: 'WORLD_STATE_CAPTURE_STALE',
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
    });
    const outcome = processed.applied.length > 0 ? 'applied' : 'no-change';
    diagnosticStore.record(chatKey, {
      operationId,
      sourceMessageId,
      outcome,
      route: dispatched.receipt?.route || '',
      profileId: dispatched.receipt?.profileId || '',
      providerCalls: 1,
      proposed: processed.proposedCount,
      accepted: processed.acceptedCount,
      applied: processed.applied.length,
      rejected: processed.rejected.length,
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
      sourceMessageId,
      outcome: 'invalid-response',
      code: error.code,
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

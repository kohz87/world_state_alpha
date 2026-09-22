import { LIMITS, RECORD_TRENDS } from './constants.js';

export const EVOLUTION_OUTCOMES = Object.freeze(['stable', 'update', 'resolve', 'supersede']);
export const EVOLUTION_WIRE_LIMITS = Object.freeze({
  evaluations: 6,
  supportIds: 8,
  derived: 1,
  reasonChars: 500,
});

export class EvolutionWireError extends Error {
  constructor(message, code = 'WORLD_STATE_EVOLUTION_WIRE_INVALID') {
    super(message);
    this.name = 'WorldStateEvolutionWireError';
    this.code = code;
  }
}

function text(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function uniqueStrings(value, maxItems, maxChars = 120) {
  if (!Array.isArray(value)) return [];
  const out = [];
  const seen = new Set();
  for (const item of value) {
    const clean = text(item, maxChars);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeEvaluation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new EvolutionWireError('evaluation must be an object');
  }
  const recordId = text(raw.recordId, 120);
  const outcome = text(raw.outcome, 24);
  const reason = text(raw.reason, EVOLUTION_WIRE_LIMITS.reasonChars);
  if (!recordId) throw new EvolutionWireError('evaluation requires recordId');
  if (!EVOLUTION_OUTCOMES.includes(outcome)) throw new EvolutionWireError('unsupported evaluation outcome');
  if (!reason) throw new EvolutionWireError('evaluation requires a grounded causal reason');

  const evaluation = {
    recordId,
    outcome,
    reason,
    supportIds: uniqueStrings(raw.supportIds, EVOLUTION_WIRE_LIMITS.supportIds),
  };

  if (outcome === 'stable') return evaluation;

  if (Object.hasOwn(raw, 'summary')) evaluation.summary = text(raw.summary, LIMITS.summaryChars);
  if (Object.hasOwn(raw, 'trend')) {
    evaluation.trend = RECORD_TRENDS.includes(raw.trend) ? raw.trend : null;
  }
  if (Object.hasOwn(raw, 'anchors')) {
    evaluation.anchors = uniqueStrings(raw.anchors, LIMITS.anchorsPerRecord, LIMITS.anchorChars);
  }

  if ((outcome === 'resolve' || outcome === 'supersede') && !evaluation.summary) {
    throw new EvolutionWireError(`${outcome} evaluation requires a compact current summary`);
  }
  if (outcome === 'update'
    && !evaluation.summary
    && !Object.hasOwn(evaluation, 'trend')
    && !Object.hasOwn(evaluation, 'anchors')) {
    throw new EvolutionWireError('update evaluation contains no update fields');
  }
  return evaluation;
}

function normalizeDerived(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new EvolutionWireError('derived development must be an object');
  }
  const summary = text(raw.summary, LIMITS.summaryChars);
  const reason = text(raw.reason, EVOLUTION_WIRE_LIMITS.reasonChars);
  if (!summary || !reason) throw new EvolutionWireError('derived development requires summary and reason');
  return {
    summary,
    trend: RECORD_TRENDS.includes(raw.trend) ? raw.trend : null,
    anchors: uniqueStrings(raw.anchors, LIMITS.anchorsPerRecord, LIMITS.anchorChars),
    causeRecordIds: uniqueStrings(raw.causeRecordIds, 4),
    supportIds: uniqueStrings(raw.supportIds, EVOLUTION_WIRE_LIMITS.supportIds),
    reason,
  };
}

export function parseEvolutionJson(rawText) {
  const raw = String(rawText ?? '').trim();
  if (!raw.startsWith('{') || !raw.endsWith('}')) {
    throw new EvolutionWireError('evolution response must be one JSON object with no prose or markdown');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new EvolutionWireError(`evolution response is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new EvolutionWireError('evolution response root must be an object');
  }
  if (!Array.isArray(parsed.evaluations)) throw new EvolutionWireError('evolution response requires evaluations array');
  if (parsed.evaluations.length > EVOLUTION_WIRE_LIMITS.evaluations) {
    throw new EvolutionWireError('evolution response exceeds evaluation limit');
  }
  const derived = parsed.derived === undefined ? [] : parsed.derived;
  if (!Array.isArray(derived)) throw new EvolutionWireError('derived must be an array when present');
  if (derived.length > EVOLUTION_WIRE_LIMITS.derived) {
    throw new EvolutionWireError('evolution response exceeds derived-development limit');
  }
  return { evaluations: parsed.evaluations, derived };
}

export function validateEvolutionEnvelope(raw) {
  const accepted = [];
  const rejected = [];
  for (let index = 0; index < raw.evaluations.length; index += 1) {
    try {
      accepted.push(normalizeEvaluation(raw.evaluations[index]));
    } catch (error) {
      rejected.push({
        section: 'evaluations',
        index,
        code: error?.code || 'WORLD_STATE_EVOLUTION_WIRE_INVALID',
        reason: String(error?.message || error),
      });
    }
  }

  const derived = [];
  for (let index = 0; index < raw.derived.length; index += 1) {
    try {
      derived.push(normalizeDerived(raw.derived[index]));
    } catch (error) {
      rejected.push({
        section: 'derived',
        index,
        code: error?.code || 'WORLD_STATE_EVOLUTION_WIRE_INVALID',
        reason: String(error?.message || error),
      });
    }
  }
  return { evaluations: accepted, derived, rejected };
}

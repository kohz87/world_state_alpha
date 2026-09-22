import { LIMITS, MUTATION_ACTIONS, RECORD_KINDS, RECORD_STATUSES, RECORD_TRENDS } from './constants.js';

export const CAPTURE_WIRE_LIMITS = Object.freeze({
  mutations: 8,
  evidencePerMutation: 4,
  relatedRecordIds: 8,
  reasonChars: 400,
});

export class CaptureWireError extends Error {
  constructor(message, code = 'WORLD_STATE_CAPTURE_WIRE_INVALID') {
    super(message);
    this.name = 'WorldStateCaptureWireError';
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

function evidenceItem(raw) {
  if (!raw || typeof raw !== 'object') throw new CaptureWireError('evidence item must be an object');
  if (!Number.isInteger(raw.sourceMessageId) || raw.sourceMessageId < 0) {
    throw new CaptureWireError('evidence sourceMessageId must be a non-negative integer');
  }
  const claim = text(raw.claim, LIMITS.claimChars);
  if (!claim) throw new CaptureWireError('evidence claim is required');
  return { sourceMessageId: raw.sourceMessageId, claim };
}

function repairProviderAliases(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { mutation: raw, repairs: 0 };
  }
  const mutation = { ...raw };
  let repairs = 0;

  const summary = text(mutation.summary, LIMITS.summaryChars);
  const description = text(mutation.description, LIMITS.summaryChars);
  if (summary && description && summary !== description) {
    throw new CaptureWireError('conflicting summary/description provider fields');
  }
  if (!summary && description) {
    mutation.summary = description;
    repairs += 1;
  }

  if (text(mutation.action, 24) === 'create') {
    const kind = text(mutation.kind, 40);
    const category = text(mutation.category, 40);
    if (kind && category && kind !== category) {
      throw new CaptureWireError('conflicting kind/category provider fields');
    }
    if (!kind && category && RECORD_KINDS.includes(category)) {
      mutation.kind = category;
      repairs += 1;
    }
  }

  return { mutation, repairs };
}

function normalizeMutation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CaptureWireError('mutation must be an object');
  }
  const action = text(raw.action, 24);
  if (!MUTATION_ACTIONS.includes(action)) throw new CaptureWireError(`unsupported mutation action: ${action || '(missing)'}`);

  if (action === 'noop') return { action: 'noop' };

  const evidenceRaw = Array.isArray(raw.evidence) ? raw.evidence : [];
  if (evidenceRaw.length === 0) throw new CaptureWireError(`${action} mutation requires evidence`);
  if (evidenceRaw.length > CAPTURE_WIRE_LIMITS.evidencePerMutation) {
    throw new CaptureWireError('mutation contains too many evidence items');
  }

  const mutation = {
    action,
    summary: text(raw.summary, LIMITS.summaryChars),
    reason: text(raw.reason, CAPTURE_WIRE_LIMITS.reasonChars),
    evidence: evidenceRaw.map(evidenceItem),
    relatedRecordIds: uniqueStrings(raw.relatedRecordIds, CAPTURE_WIRE_LIMITS.relatedRecordIds),
  };
  if (raw.anchors !== undefined) {
    mutation.anchors = uniqueStrings(raw.anchors, LIMITS.anchorsPerRecord, LIMITS.anchorChars);
  }
  if (raw.trend !== undefined) {
    mutation.trend = raw.trend === null ? null : (RECORD_TRENDS.includes(raw.trend) ? raw.trend : null);
  }

  if (action === 'create') {
    if (!RECORD_KINDS.includes(raw.kind)) throw new CaptureWireError('create mutation requires kind=fact|development');
    if (!mutation.summary) throw new CaptureWireError('create mutation requires summary');
    if (raw.recordId !== undefined && text(raw.recordId, 120)) {
      throw new CaptureWireError('provider must not assign recordId for create');
    }
    mutation.kind = raw.kind;
    mutation.status = raw.status === undefined ? 'active' : raw.status;
    if (!['active', 'resolved'].includes(mutation.status)) {
      throw new CaptureWireError('create status must be active or resolved');
    }
    const priorEpisode = text(raw.newEpisodeOfRecordId, 120);
    if (priorEpisode) mutation.newEpisodeOfRecordId = priorEpisode;
    return mutation;
  }

  const recordId = text(raw.recordId, 120);
  if (!recordId) throw new CaptureWireError(`${action} mutation requires recordId`);
  mutation.recordId = recordId;
  if (raw.status !== undefined) {
    if (!RECORD_STATUSES.includes(raw.status)) throw new CaptureWireError('invalid mutation status');
    mutation.status = raw.status;
  }
  if (action === 'update' && !mutation.summary && raw.trend === undefined && raw.anchors === undefined) {
    throw new CaptureWireError('update mutation contains no update fields');
  }
  return mutation;
}

export function parseCaptureJson(rawText) {
  const input = String(rawText ?? '').trim();
  const fenced = input.match(/^\`\`\`(?:json)?\s*([\s\S]*?)\s*\`\`\`$/i);
  const raw = fenced ? fenced[1].trim() : input;
  if (!raw.startsWith('{') || !raw.endsWith('}')) {
    throw new CaptureWireError('capture response must be one JSON object, optionally wrapped in a single json code fence, with no surrounding prose');
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new CaptureWireError(`capture response is not valid JSON: ${error.message}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new CaptureWireError('capture response root must be an object');
  }
  if (!Array.isArray(parsed.mutations)) throw new CaptureWireError('capture response requires mutations array');
  if (parsed.mutations.length > CAPTURE_WIRE_LIMITS.mutations) {
    throw new CaptureWireError('capture response exceeds mutation limit');
  }
  return parsed;
}

export function validateCaptureEnvelope(raw) {
  const accepted = [];
  const rejected = [];
  let aliasRepairs = 0;
  const mutations = Array.isArray(raw?.mutations) ? raw.mutations : [];
  for (let index = 0; index < mutations.length; index += 1) {
    try {
      const repaired = repairProviderAliases(mutations[index]);
      aliasRepairs += repaired.repairs;
      accepted.push(normalizeMutation(repaired.mutation));
    } catch (error) {
      rejected.push({
        index,
        code: error?.code || 'WORLD_STATE_CAPTURE_WIRE_INVALID',
        reason: String(error?.message || error),
      });
    }
  }
  return { mutations: accepted, rejected, aliasRepairs };
}

import { clone } from './state-core.js';

function messageText(message) {
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.mes === 'string') return message.mes;
  if (typeof message?.text === 'string') return message.text;
  return '';
}

function messageRole(message) {
  if (message?.role === 'user' || message?.is_user === true) return 'user';
  if (message?.role === 'assistant' || (message?.is_user === false && message?.is_system !== true)) return 'assistant';
  return 'system';
}

function canonicalText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function evidenceClaimGrounded(claim, sourceText) {
  const needle = canonicalText(claim);
  const haystack = canonicalText(sourceText);
  const tokens = needle.split(' ').filter(token => token.length > 1);
  return needle.length >= 8 && tokens.length >= 2 && haystack.includes(needle);
}

export function captureExchangeIndex(exchange = []) {
  const map = new Map();
  for (const message of Array.isArray(exchange) ? exchange : []) {
    if (!Number.isInteger(message?.messageId) || message.messageId < 0) continue;
    map.set(message.messageId, {
      messageId: message.messageId,
      role: messageRole(message),
      text: messageText(message),
      lineageKey: typeof message.lineageKey === 'string' ? message.lineageKey : '',
    });
  }
  return map;
}

export function applyCaptureSourceFirewall(mutation, {
  exchange = [],
  visibleRecords = [],
  state,
} = {}) {
  const candidate = clone(mutation);
  if (candidate.action === 'noop') return { ok: true, mutation: candidate };

  const exchangeById = captureExchangeIndex(exchange);
  const visibleIds = new Set((Array.isArray(visibleRecords) ? visibleRecords : []).map(record => record?.id).filter(Boolean));
  const stateRecords = new Map((Array.isArray(state?.records) ? state.records : []).map(record => [record.id, record]));

  if (candidate.action !== 'create') {
    if (!visibleIds.has(candidate.recordId) || !stateRecords.has(candidate.recordId)) {
      return { ok: false, reason: 'target record was not part of the bounded capture context' };
    }
  }

  if (candidate.action === 'create' && candidate.newEpisodeOfRecordId) {
    const prior = stateRecords.get(candidate.newEpisodeOfRecordId);
    if (!visibleIds.has(candidate.newEpisodeOfRecordId) || !prior || !['resolved', 'superseded'].includes(prior.status)) {
      return { ok: false, reason: 'newEpisodeOfRecordId must reference a visible resolved/superseded record' };
    }
  }

  for (const relatedId of candidate.relatedRecordIds || []) {
    if (!visibleIds.has(relatedId) || !stateRecords.has(relatedId)) {
      return { ok: false, reason: 'relatedRecordIds may reference only visible current-state records' };
    }
  }

  const evidence = [];
  for (const item of candidate.evidence || []) {
    const source = exchangeById.get(item.sourceMessageId);
    if (!source || source.role === 'system') {
      return { ok: false, reason: 'automatic capture evidence must come from the current user/assistant exchange' };
    }
    if (!evidenceClaimGrounded(item.claim, source.text)) {
      return { ok: false, reason: 'evidence claim is not grounded as an excerpt of its source message' };
    }
    evidence.push({
      sourceMessageId: item.sourceMessageId,
      lineageKey: source.lineageKey,
      sourceClass: source.role === 'user' ? 'user_narration' : 'assistant_narration',
      claim: item.claim,
    });
  }

  if (evidence.length === 0) {
    return { ok: false, reason: 'automatic capture mutation has no grounded current-exchange evidence' };
  }

  candidate.evidence = evidence;
  return { ok: true, mutation: candidate };
}

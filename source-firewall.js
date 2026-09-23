import { clone } from './state-core.js';
import { sanitizeAssistantNarration } from './narrative-sanitizer.js';

export { sanitizeAssistantNarration } from './narrative-sanitizer.js';

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

const REPORTED_INFORMATION_RE = /\b(?:reports?|reported|reportedly|reporting|rumou?rs?|rumou?red|claims?|claimed|claiming|alleges?|alleged|allegedly|according to|warns?|warned|warning|warnings|believes?|believed|belief|beliefs|suspects?|suspected|predicts?|predicted|prediction|predictions|forecasts?|forecasted|said to|says?|said|states|stated|announces?|announced|declares?|declared|orders?|ordered|demands?|demanded|threatens?|threatened|promises?|promised|offers?|offered|refuses?|refused|asks?|asked|requests?|requested|confesses?|confessed|admits?|admitted|denies|denied|accuses?|accused|proclaims?|proclaimed|swears?|swore|vows?|vowed|word is|word was|word has|news of|news that|news about|accounts? of|accounts? that|talk of|gossip|hearsay)\b/iu;

function quotedDialogueSegments(sourceText) {
  const source = String(sourceText ?? '');
  const segments = [];
  for (const pattern of [/"([^"]+)"/gu, /“([^”]+)”/gu, /„([^“]+)“/gu]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) segments.push(match[1]);
    }
  }
  return segments;
}

function sourceWithoutQuotedDialogue(sourceText) {
  return String(sourceText ?? '')
    .replace(/"[^"]+"/gu, ' ')
    .replace(/“[^”]+”/gu, ' ')
    .replace(/„[^“]+“/gu, ' ');
}

export function evidenceClaimQuotedOnly(claim, sourceText) {
  if (!evidenceClaimGrounded(claim, sourceText)) return false;
  const quoted = quotedDialogueSegments(sourceText)
    .some(segment => evidenceClaimGrounded(claim, segment));
  if (!quoted) return false;
  return !evidenceClaimGrounded(claim, sourceWithoutQuotedDialogue(sourceText));
}

export function preservesReportedInformationStatus(summary) {
  return REPORTED_INFORMATION_RE.test(String(summary ?? ''));
}

export function captureExchangeIndex(exchange = []) {
  const map = new Map();
  for (const message of Array.isArray(exchange) ? exchange : []) {
    if (!Number.isInteger(message?.messageId) || message.messageId < 0) continue;
    const role = messageRole(message);
    const raw = messageText(message);
    const text = role === 'assistant' ? sanitizeAssistantNarration(raw) : raw;
    map.set(message.messageId, {
      messageId: message.messageId,
      role,
      text,
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
  let quotedOnlyEvidence = 0;
  for (const item of candidate.evidence || []) {
    const source = exchangeById.get(item.sourceMessageId);
    if (!source || source.role === 'system') {
      return { ok: false, reason: 'automatic capture evidence must come from the current user/assistant exchange' };
    }
    if (!evidenceClaimGrounded(item.claim, source.text)) {
      return { ok: false, reason: 'evidence claim is not grounded as an excerpt of its source message' };
    }
    if (evidenceClaimQuotedOnly(item.claim, source.text)) quotedOnlyEvidence += 1;
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

  if (quotedOnlyEvidence === evidence.length) {
    const existing = candidate.recordId ? stateRecords.get(candidate.recordId) : null;
    const epistemicSummary = candidate.summary || existing?.summary || '';
    if (!preservesReportedInformationStatus(epistemicSummary)) {
      return {
        ok: false,
        reason: 'quoted dialogue alone may establish reported information or the speech act itself, but the mutation summary must preserve reporting/uncertainty or describe the speech act instead of promoting the underlying claim to fact',
      };
    }
  }

  candidate.evidence = evidence;
  return { ok: true, mutation: candidate };
}

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

const SUPPORT_STOPWORDS = new Set([
  'the', 'and', 'that', 'this', 'with', 'from', 'into', 'onto', 'over', 'under', 'after', 'before',
  'while', 'where', 'when', 'then', 'than', 'they', 'them', 'their', 'there', 'here', 'have', 'has',
  'had', 'was', 'were', 'are', 'is', 'been', 'being', 'will', 'would', 'could', 'should', 'about',
  'among', 'through', 'around', 'still', 'current', 'currently', 'now', 'near', 'behind', 'outside',
]);

function significantTokens(value) {
  return canonicalText(value)
    .split(' ')
    .filter(token => token.length >= 3 && !SUPPORT_STOPWORDS.has(token))
    .map(token => {
      if (token.length > 5 && token.endsWith('ies')) return token.slice(0, -3) + 'y';
      if (token.length > 4 && token.endsWith('s')) return token.slice(0, -1);
      return token;
    });
}

function lexicalAffinity(left, right, anchors = []) {
  const a = canonicalText(left);
  const b = canonicalText(right);
  if (!a || !b) return false;
  if (a.length >= 8 && b.includes(a)) return true;
  if (b.length >= 8 && a.includes(b)) return true;

  const leftTokens = significantTokens(a);
  const rightTokens = new Set(significantTokens(b));
  const shared = leftTokens.filter(token => rightTokens.has(token));
  if (shared.length >= 2) return true;

  for (const anchor of Array.isArray(anchors) ? anchors : []) {
    const normalized = canonicalText(anchor);
    if (normalized.length >= 3 && a.includes(normalized) && b.includes(normalized)) return true;
  }

  return shared.length === 1
    && shared[0].length >= 6;
}

export function evidenceClaimGrounded(claim, sourceText) {
  const needle = canonicalText(claim);
  const haystack = canonicalText(sourceText);
  const tokens = needle.split(' ').filter(token => token.length > 1);
  return needle.length >= 8 && tokens.length >= 2 && haystack.includes(needle);
}

const REPORTED_INFORMATION_RE = /\b(?:reports?|reported|reportedly|reporting|rumou?rs?|rumou?red|claims?|claimed|claiming|alleges?|alleged|allegedly|according to|warns?|warned|warning|warnings|believes?|believed|belief|beliefs|suspects?|suspected|predicts?|predicted|prediction|predictions|forecasts?|forecasted|said to|says?|said|states|stated|announces?|announced|declares?|declared|orders?|ordered|demands?|demanded|threatens?|threatened|promises?|promised|offers?|offered|refuses?|refused|asks?|asked|requests?|requested|confesses?|confessed|admits?|admitted|denies|denied|accuses?|accused|proclaims?|proclaimed|swears?|swore|vows?|vowed|word is|word was|word has|news of|news that|news about|accounts? of|accounts? that|talk of|gossip|hearsay)\b/iu;
const ATTRIBUTION_RE = /\b(?:reports?|reported|reportedly|reporting|rumou?rs?|rumou?red|claims?|claimed|claiming|alleges?|alleged|allegedly|according to|warns?|warned|warning|warnings|believes?|believed|belief|beliefs|suspects?|suspected|predicts?|predicted|prediction|predictions|forecasts?|forecasted|said to|says?|said|states|stated|announces?|announced|declares?|declared|confesses?|confessed|admits?|admitted|denies|denied|accuses?|accused|proclaims?|proclaimed|swears?|swore|vows?|vowed|word is|word was|word has|news of|news that|news about|accounts? of|accounts? that|talk of|gossip|hearsay)\b/iu;

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

function evidenceClaimAttributed(claim, sourceText) {
  if (evidenceClaimQuotedOnly(claim, sourceText)) return true;
  const source = String(sourceText ?? '');
  const segments = source.split(/(?<=[.!?])\s+|\r?\n+/u).filter(Boolean);
  return segments.some(segment => evidenceClaimGrounded(claim, segment) && ATTRIBUTION_RE.test(segment));
}

function anchorSupported(anchor, evidence, existingRecord = null, assertionText = '') {
  const normalized = canonicalText(anchor);
  if (!normalized) return false;
  if ((existingRecord?.anchors || []).some(item => canonicalText(item) === normalized)) return true;
  if (evidence.some(item => {
    const claim = canonicalText(item.claim);
    if (claim.includes(normalized)) return true;
    const anchorTokens = significantTokens(normalized);
    const claimTokens = new Set(significantTokens(claim));
    if (anchorTokens.length === 0) return false;
    const shared = anchorTokens.filter(token => claimTokens.has(token));
    return shared.length >= Math.ceil(anchorTokens.length / 2)
      && shared.some(token => token.length >= 4);
  })) return true;
  if (!canonicalText(assertionText).includes(normalized)) return false;
  const anchorTokens = significantTokens(normalized);
  return evidence.some(item => {
    const claimTokens = new Set(significantTokens(item.claim));
    return anchorTokens.some(token => token.length >= 5 && claimTokens.has(token));
  });
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
  const evidenceSupport = [];
  for (const item of candidate.evidence || []) {
    const source = exchangeById.get(item.sourceMessageId);
    if (!source || source.role === 'system') {
      return { ok: false, reason: 'automatic capture evidence must come from the current user/assistant exchange' };
    }
    if (!evidenceClaimGrounded(item.claim, source.text)) {
      return { ok: false, reason: 'evidence claim is not grounded as an excerpt of its source message' };
    }
    const normalizedEvidence = {
      sourceMessageId: item.sourceMessageId,
      lineageKey: source.lineageKey,
      sourceClass: source.role === 'user' ? 'user_narration' : 'assistant_narration',
      claim: item.claim,
    };
    evidence.push(normalizedEvidence);
    evidenceSupport.push({
      ...normalizedEvidence,
      attributed: evidenceClaimAttributed(item.claim, source.text),
    });
  }

  if (evidence.length === 0) {
    return { ok: false, reason: 'automatic capture mutation has no grounded current-exchange evidence' };
  }

  const existing = candidate.recordId ? stateRecords.get(candidate.recordId) : null;
  const assertionText = candidate.summary || existing?.summary || '';
  const affinityAnchors = candidate.anchors ?? existing?.anchors ?? [];
  const supportingEvidence = evidenceSupport.filter(item => lexicalAffinity(assertionText, item.claim, affinityAnchors));
  if (!supportingEvidence.length) {
    return { ok: false, reason: 'mutation summary/current subject is not supported by its cited evidence claims' };
  }

  if (candidate.anchors !== undefined) {
    candidate.anchors = candidate.anchors.filter(anchor => anchorSupported(anchor, evidenceSupport, existing, assertionText));
  }

  if (supportingEvidence.every(item => item.attributed)) {
    const epistemicSummary = candidate.summary || existing?.summary || '';
    if (!preservesReportedInformationStatus(epistemicSummary)) {
      return {
        ok: false,
        reason: 'quoted dialogue alone or other attributed evidence may establish reported information or the speech act itself, but the mutation summary must preserve reporting/uncertainty or describe the speech act instead of promoting the underlying claim to fact',
      };
    }
  }

  candidate.evidence = evidence;
  return { ok: true, mutation: candidate };
}

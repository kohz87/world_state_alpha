import { canonicalText } from './hash.js';

const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'of', 'to', 'and', 'or', 'in', 'on', 'at', 'for', 'with', 'by']);

function tokenSet(value) {
  return new Set(canonicalText(value).split(' ').filter(token => token.length > 1 && !STOP.has(token)));
}

function jaccard(left, right) {
  if (!left.size && !right.size) return 0;
  let overlap = 0;
  for (const value of left) if (right.has(value)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}

function anchorSet(record) {
  return new Set((Array.isArray(record?.anchors) ? record.anchors : []).map(canonicalText).filter(Boolean));
}

// Words that tell two otherwise identical subjects apart when they modify the
// same noun ("north gate" / "south gate", "first battalion" / "second"). State
// words (high/low, old/new) describe a change of one subject, not two subjects.
const DISTINGUISHING_WORDS = new Set([
  'north', 'south', 'east', 'west', 'northern', 'southern', 'eastern', 'western',
  'northeast', 'northwest', 'southeast', 'southwest', 'upper', 'lower', 'inner', 'outer',
  'left', 'right', 'front', 'rear', 'first', 'second', 'third', 'fourth', 'fifth', 'last',
  'main', 'side', 'central', 'middle',
]);

// A number followed by one of these counts something ("3 times a week", "5 silver", "4 days"): it is a
// quantity that changes, never an identifier, even right after a name ("raid Harrow 3 times").
const QUANTITY_WORDS = new Set([
  'time', 'times', 'per', 'percent', 'more', 'less', 'fewer', 'x',
  'second', 'seconds', 'minute', 'minutes', 'hour', 'hours', 'day', 'days', 'night', 'nights',
  'week', 'weeks', 'month', 'months', 'season', 'seasons', 'year', 'years',
  'mile', 'miles', 'league', 'leagues', 'km', 'kilometers', 'kilometres', 'meter', 'meters', 'metre', 'metres',
  'foot', 'feet', 'yard', 'yards', 'pace', 'paces',
  'coin', 'coins', 'gold', 'silver', 'copper', 'crown', 'crowns', 'mark', 'marks',
  'man', 'men', 'people', 'person', 'persons',
]);

function subjectModifiers(summary, otherTokens) {
  const modifiers = new Map();
  // Per sentence, so a sentence's capitalized first word is never taken for a name.
  for (const sentence of String(summary ?? '').normalize('NFKC').split(/[.!?;]+/u)) {
    const words = sentence.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    for (let index = 0; index + 1 < words.length; index += 1) {
      const word = words[index];
      const lower = word.toLocaleLowerCase();
      const noun = words[index + 1].toLocaleLowerCase();
      // A number right after a capitalized shared noun is an identifier ("Squad 12", "Gate 3"); after a
      // lowercase word it is a quantity ("has lasted 3 days"), and only an ordinal (1st) names a subject. A
      // number that counts the next word ("Harrow 3 times", "Tolls 5 silver") or is followed by more digits
      // ("3,000", "2.5") is a quantity too. Here the number is `noun` and the shared word before it `lower`.
      const counted = (words[index + 2] || '').toLocaleLowerCase();
      if (/^\p{N}+$/u.test(noun) && /^\p{Lu}/u.test(word) && !STOP.has(lower) && otherTokens.has(lower) && !otherTokens.has(noun)
        && !QUANTITY_WORDS.has(counted) && !/^\p{N}/u.test(counted)) {
        if (!modifiers.has(lower)) modifiers.set(lower, new Set());
        modifiers.get(lower).add(noun);
      }
      if (STOP.has(noun) || !otherTokens.has(noun) || otherTokens.has(lower) || STOP.has(lower)) continue;
      // A name (capitalized, not a sentence's first word), an ordinal number (1st, 2nd), or a direction/ordinal word.
      const distinguishing = DISTINGUISHING_WORDS.has(lower) || /^\p{N}+(?:st|nd|rd|th)$/u.test(lower)
        || (index > 0 && /^\p{Lu}/u.test(word));
      if (!distinguishing) continue;
      if (!modifiers.has(noun)) modifiers.set(noun, new Set());
      modifiers.get(noun).add(lower);
    }
  }
  return modifiers;
}

// Two summaries name different subjects when the same noun carries different
// distinguishing modifiers in each; such conditions are never merged or
// treated as one, however much else they share.
export function distinctSubjects(left, right) {
  const leftTokens = new Set(canonicalText(left).split(' ').filter(Boolean));
  const rightTokens = new Set(canonicalText(right).split(' ').filter(Boolean));
  const leftModifiers = subjectModifiers(left, rightTokens);
  if (!leftModifiers.size) return false;
  const rightModifiers = subjectModifiers(right, leftTokens);
  for (const [noun, modifiers] of leftModifiers) {
    const other = rightModifiers.get(noun);
    if (other && [...modifiers].every(word => !other.has(word))) return true;
  }
  return false;
}

export function duplicateSimilarity(candidate, record) {
  if (!candidate || !record || candidate.kind !== record.kind) return 0;
  if (distinctSubjects(candidate.summary, record.summary)) return 0;
  const leftSummary = canonicalText(candidate.summary);
  const rightSummary = canonicalText(record.summary);
  if (leftSummary && leftSummary === rightSummary) return 1;

  const summaryScore = jaccard(tokenSet(leftSummary), tokenSet(rightSummary));
  const anchorsA = anchorSet(candidate);
  const anchorsB = anchorSet(record);
  const anchorScore = jaccard(anchorsA, anchorsB);
  const anchorEvidence = anchorsA.size > 0 && anchorsB.size > 0;
  return anchorEvidence ? (0.6 * anchorScore) + (0.4 * summaryScore) : summaryScore;
}

export function mergeAnchors(existing = [], incoming = [], max = 20) {
  const out = [];
  const seen = new Set();
  for (const value of [...existing, ...incoming]) {
    const key = canonicalText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(String(value).trim());
    if (out.length >= max) break;
  }
  return out;
}

function explicitNewEpisodeRelated(candidate, prior, score, threshold, { beyondAnchorWords = false } = {}) {
  // The anchor fallback below must not merge different subjects (north/south gate) that the score keeps apart.
  if (distinctSubjects(candidate?.summary, prior?.summary)) return false;
  if (score >= threshold) return true;
  const candidateAnchors = anchorSet(candidate);
  const priorAnchors = anchorSet(prior);
  const sharedAnchors = [...candidateAnchors].filter(anchor => priorAnchors.has(anchor));
  const strongSharedAnchor = sharedAnchors.some(anchor => anchor.includes(' '));

  // Before an active record absorbs the new episode (its summary is replaced), the shared summary words must
  // go beyond the shared anchor's own words: "lower city" in both says nothing more than the anchor, so it
  // cannot tie a plague to food riots. Linking to the episode's own earlier record keeps the looser rule.
  const anchorWords = new Set(beyondAnchorWords ? sharedAnchors.flatMap(anchor => anchor.split(' ')) : []);
  const candidateSummary = tokenSet(candidate?.summary || '');
  const priorSummary = tokenSet(prior?.summary || '');
  let sharedSummaryTokens = 0;
  for (const token of candidateSummary) if (priorSummary.has(token) && !anchorWords.has(token)) sharedSummaryTokens += 1;

  return strongSharedAnchor && sharedSummaryTokens >= 2;
}

export const DUPLICATE_THRESHOLD = 0.78;

export function consolidateCreateCandidate(
  mutation,
  visibleRecords = [],
  { threshold = DUPLICATE_THRESHOLD, resolvedThreshold = 0.70, newEpisodeThreshold = 0.55 } = {},
) {
  if (mutation?.action !== 'create') return { ok: true, mutation, duplicate: null };
  const records = Array.isArray(visibleRecords) ? visibleRecords : [];

  if (mutation.newEpisodeOfRecordId) {
    if (mutation.status === 'resolved') {
      return {
        ok: false,
        reason: 'a genuinely new episode must be active; an already-finished recurrence is not durable current world state',
        duplicate: null,
      };
    }
    const prior = records.find(record => record.id === mutation.newEpisodeOfRecordId) || null;
    const score = prior ? duplicateSimilarity(mutation, prior) : 0;
    if (!prior
      || !['resolved', 'superseded'].includes(prior.status)
      || !explicitNewEpisodeRelated(mutation, prior, score, newEpisodeThreshold)) {
      return {
        ok: false,
        reason: 'newEpisodeOfRecordId must identify a sufficiently related visible resolved/superseded episode',
        duplicate: prior ? { record: prior, score } : null,
      };
    }

    let activeDuplicate = null;
    for (const record of records) {
      if (record.status !== 'active') continue;
      const activeScore = duplicateSimilarity(mutation, record);
      if (!explicitNewEpisodeRelated(mutation, record, activeScore, threshold, { beyondAnchorWords: true })) continue;
      if (!activeDuplicate || activeScore > activeDuplicate.score) {
        activeDuplicate = { record, score: activeScore };
      }
    }
    if (activeDuplicate) {
      const record = activeDuplicate.record;
      return {
        ok: true,
        duplicate: activeDuplicate,
        mutation: {
          action: 'update',
          recordId: record.id,
          summary: mutation.summary,
          status: record.status,
          ...(Object.hasOwn(mutation, 'trend') ? { trend: mutation.trend } : {}),
          anchors: mergeAnchors(record.anchors, mutation.anchors),
          reason: mutation.reason,
          evidence: mutation.evidence,
          relatedRecordIds: [...new Set([
            ...(mutation.relatedRecordIds || []).filter(id => id !== record.id),
            prior.id,
          ])],
        },
      };
    }

    return {
      ok: true,
      duplicate: { record: prior, score },
      mutation: {
        ...mutation,
        relatedRecordIds: [...new Set([...(mutation.relatedRecordIds || []), prior.id])],
      },
    };
  }

  const terminalCreate = mutation.status === 'resolved';
  const rejectUnmatchedTerminalCreate = duplicate => ({
    ok: false,
    reason: 'a new already-resolved record cannot be created as history; resolve a sufficiently related visible active record instead',
    duplicate,
  });

  let bestActive = null;
  let bestHistorical = null;
  let bestOverall = null;
  for (const record of records) {
    const score = duplicateSimilarity(mutation, record);
    const candidate = { record, score };
    if (!bestOverall || score > bestOverall.score) bestOverall = candidate;
    if (record.status === 'active') {
      if (!bestActive || score > bestActive.score) bestActive = candidate;
    } else if (!bestHistorical || score > bestHistorical.score) {
      bestHistorical = candidate;
    }
  }

  // Prefer a sufficiently similar current episode over an older tombstone.
  // This lets a provider's redundant create proposal consolidate into the
  // actual current record even when historical wording happens to be closer.
  if (bestActive && bestActive.score >= threshold) {
    const record = bestActive.record;
    const action = terminalCreate ? 'resolve' : 'update';
    return {
      ok: true,
      duplicate: bestActive,
      mutation: {
        action,
        recordId: record.id,
        summary: mutation.summary,
        ...(action === 'update' ? {
          status: record.status,
          ...(Object.hasOwn(mutation, 'trend') ? { trend: mutation.trend } : {}),
          anchors: mergeAnchors(record.anchors, mutation.anchors),
        } : {}),
        reason: mutation.reason,
        evidence: mutation.evidence,
        relatedRecordIds: (mutation.relatedRecordIds || []).filter(id => id !== record.id),
      },
    };
  }

  if (terminalCreate) {
    return rejectUnmatchedTerminalCreate(bestActive || bestHistorical || bestOverall);
  }

  if (bestHistorical && bestHistorical.score >= resolvedThreshold) {
    return {
      ok: false,
      reason: 'candidate duplicates a resolved/superseded episode; passive baseline/current similarity cannot resurrect it',
      duplicate: bestHistorical,
    };
  }

  return { ok: true, mutation, duplicate: bestOverall };

}

function canonicalText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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

export function duplicateSimilarity(candidate, record) {
  if (!candidate || !record || candidate.kind !== record.kind) return 0;
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

function mergeAnchors(existing = [], incoming = [], max = 20) {
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

function explicitNewEpisodeRelated(candidate, prior, score, threshold) {
  if (score >= threshold) return true;
  const candidateAnchors = anchorSet(candidate);
  const priorAnchors = anchorSet(prior);
  const sharedAnchors = [...candidateAnchors].filter(anchor => priorAnchors.has(anchor));
  const strongSharedAnchor = sharedAnchors.some(anchor => anchor.includes(' '));

  const candidateSummary = tokenSet(candidate?.summary || '');
  const priorSummary = tokenSet(prior?.summary || '');
  let sharedSummaryTokens = 0;
  for (const token of candidateSummary) if (priorSummary.has(token)) sharedSummaryTokens += 1;

  return strongSharedAnchor && sharedSummaryTokens >= 2;
}

export function consolidateCreateCandidate(
  mutation,
  visibleRecords = [],
  { threshold = 0.78, resolvedThreshold = 0.70, newEpisodeThreshold = 0.55 } = {},
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
      if (!explicitNewEpisodeRelated(mutation, record, activeScore, threshold)) continue;
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
          trend: mutation.trend,
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
          trend: mutation.trend,
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

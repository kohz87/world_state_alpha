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

export function consolidateCreateCandidate(
  mutation,
  visibleRecords = [],
  { threshold = 0.78, newEpisodeThreshold = 0.55 } = {},
) {
  if (mutation?.action !== 'create') return { ok: true, mutation, duplicate: null };
  const records = Array.isArray(visibleRecords) ? visibleRecords : [];

  if (mutation.newEpisodeOfRecordId) {
    const prior = records.find(record => record.id === mutation.newEpisodeOfRecordId) || null;
    const score = prior ? duplicateSimilarity(mutation, prior) : 0;
    if (!prior || !['resolved', 'superseded'].includes(prior.status) || score < newEpisodeThreshold) {
      return {
        ok: false,
        reason: 'newEpisodeOfRecordId must identify a sufficiently related visible resolved/superseded episode',
        duplicate: prior ? { record: prior, score } : null,
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

  let best = null;
  for (const record of records) {
    const score = duplicateSimilarity(mutation, record);
    if (!best || score > best.score) best = { record, score };
  }

  if (!best || best.score < threshold) return { ok: true, mutation, duplicate: best };

  const record = best.record;
  if (record.status === 'active') {
    const action = mutation.status === 'resolved' ? 'resolve' : 'update';
    return {
      ok: true,
      duplicate: best,
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

  return {
    ok: false,
    reason: 'candidate duplicates a resolved/superseded episode; passive baseline/current similarity cannot resurrect it',
    duplicate: best,
  };
}

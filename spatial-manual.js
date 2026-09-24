import { chatLineage, commitMutationBoundary, firstLineageDivergence } from './branch.js';
import { SPATIAL_AUTHORITIES, SPATIAL_LIMITS } from './constants.js';
import { clone, normalizeState } from './state-core.js';
import {
  normalizeCoordinate,
  reduceSpatialMutations,
  resolveEffectiveLocations,
} from './spatial-core.js';

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function exactBoundary(chat, messageId, state = null) {
  if (!Array.isArray(chat) || chat.length === 0) {
    return null; // Root / no-message context
  }
  if (!Number.isInteger(messageId) || messageId < 0 || messageId >= chat.length) {
    const error = new Error('spatial manual mutation requires an existing raw-message boundary');
    error.code = 'WORLD_STATE_SPATIAL_MANUAL_BOUNDARY_REQUIRED';
    throw error;
  }
  if (messageId !== chat.length - 1) {
    const error = new Error('spatial manual mutation must be anchored to the current raw-message head');
    error.code = 'WORLD_STATE_SPATIAL_MANUAL_HEAD_REQUIRED';
    throw error;
  }
  const lineage = chatLineage(chat);
  const previous = Array.isArray(state?.lineage) ? state.lineage : [];
  if (previous.length) {
    const divergence = firstLineageDivergence(previous, lineage);
    if (divergence >= 0 && divergence < previous.length) {
      const error = new Error('spatial manual mutation state lineage does not match current chat branch');
      error.code = 'WORLD_STATE_SPATIAL_MANUAL_BRANCH_MISMATCH';
      throw error;
    }
  }
  return lineage[messageId];
}

export function querySpatialLocations(state, {
  baseMap = null,
  text = '',
  status = 'active',
} = {}) {
  const normalized = normalizeState(state);
  const locations = resolveEffectiveLocations(normalized.spatial, baseMap);
  const needle = clean(text, 120).toLowerCase();

  return locations.filter(loc => {
    if (status && loc.status !== status) return false;
    if (!needle) return true;
    return loc.name.toLowerCase().includes(needle)
      || loc.type.toLowerCase().includes(needle)
      || (loc.context && loc.context.toLowerCase().includes(needle));
  });
}

export function inspectSpatialLocation(state, locationId, baseMap = null) {
  const normalized = normalizeState(state);
  const locations = resolveEffectiveLocations(normalized.spatial, baseMap);
  const loc = locations.find(l => l.id === locationId || l.overrideId === locationId);
  if (!loc) return null;

  const evidence = (loc.evidenceIds || [])
    .map(evId => normalized.spatial?.evidence?.[evId])
    .filter(Boolean)
    .map(item => clone(item));

  const campaignId = loc.overrideId || loc.id;
  const relations = (normalized.spatial?.relations || [])
    .filter(r => r.fromId === loc.id || r.toId === loc.id
      || r.fromId === campaignId || r.toId === campaignId);

  return {
    location: clone(loc),
    evidence,
    relations,
  };
}

export function applySpatialManualMutation({
  state,
  chat = [],
  chatKey,
  messageId = null,
  mutation,
  note = '',
  baseMap = null,
} = {}) {
  const before = normalizeState(clone(state), { chatKey });
  const owner = String(chatKey || before.chatKey || '');
  if (!owner) throw new Error('chatKey is required');

  const boundary = Array.isArray(chat) && chat.length > 0
    ? exactBoundary(chat, messageId, before)
    : null;

  const effectiveMsgId = boundary ? boundary.messageId : -1;
  const effectiveLineageKey = boundary ? boundary.lineageKey : 'root';

  const operatorClaim = clean(note, SPATIAL_LIMITS.notesChars) || 'Manual spatial edit';
  const proposal = {
    ...clone(mutation),
    evidence: [{
      sourceMessageId: effectiveMsgId >= 0 ? effectiveMsgId : null,
      lineageKey: effectiveLineageKey,
      sourceClass: 'manual',
      claim: operatorClaim,
    }],
  };

  // Manual coordinate edits are campaign authority. The operator may label
  // provenance (manual / narrative_explicit / derived / relative / unknown),
  // but base_canonical and campaign_override remain reserved for their source
  // mechanisms. Manual coordinates lock by default; explicit locked:false
  // permits later grounded automatic correction according to authority rank.
  if (proposal.action === 'upsert_location' && proposal.coordinate && typeof proposal.coordinate === 'object') {
    const normalized = normalizeCoordinate(proposal.coordinate);
    const requestedAuthority = SPATIAL_AUTHORITIES.includes(proposal.coordinate.authority)
      ? proposal.coordinate.authority
      : 'manual';
    const authority = ['base_canonical', 'campaign_override'].includes(requestedAuthority)
      ? 'manual'
      : requestedAuthority;
    const hasCoordinate = Number.isFinite(normalized.x) && Number.isFinite(normalized.y);
    proposal.coordinate = {
      ...normalized,
      authority,
      locked: hasCoordinate && proposal.coordinate.locked !== false,
    };
  }

  const reduced = reduceSpatialMutations(before.spatial, {
    chatKey: owner,
    messageId: effectiveMsgId >= 0 ? effectiveMsgId : null,
    lineageKey: effectiveLineageKey,
    operation: 'manual',
    mutations: [proposal],
  }, baseMap, { allowBaseScan: true });

  if (reduced.rejected.length > 0 && reduced.applied.length === 0) {
    return {
      outcome: 'rejected',
      state: clone(before),
      applied: [],
      rejected: reduced.rejected.map(item => ({ stage: 'spatial-reducer', reason: item.reason })),
    };
  }

  const nextState = clone(before);
  nextState.spatial = reduced.spatial;

  if (boundary) {
    const committed = commitMutationBoundary(
      before,
      nextState,
      chat.slice(0, messageId + 1),
      messageId,
      'spatial-manual',
    );
    return {
      outcome: 'applied',
      state: committed,
      applied: reduced.applied,
      rejected: reduced.rejected,
      indexDelta: reduced.indexDelta,
    };
  }

  // Root / no-message update (e.g. attaching base map profile at setup)
  if (nextState.checkpoints.length) {
    const rootCp = nextState.checkpoints.find(c => c.messageId === -1);
    if (rootCp) {
      rootCp.snapshot.spatial = clone(nextState.spatial);
    }
  }

  return {
    outcome: 'applied',
    state: normalizeState(nextState),
    applied: reduced.applied,
    rejected: reduced.rejected,
    indexDelta: reduced.indexDelta,
  };
}

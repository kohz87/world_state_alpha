import { chatLineage, commitMutationBoundary, firstLineageDivergence } from './branch.js';
import { SPATIAL_AUTHORITIES, SPATIAL_LIMITS } from './constants.js';
import { clone } from './common.js';
import { cloneState, normalizeState, readableState } from './state-core.js';
import {
  normalizeCoordinate,
  reduceSpatialMutations,
} from './spatial-core.js';

function clean(value, max = 500) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

// `knownLineage`: the chat's lineage when the caller already computed it for this same chat.
function exactBoundary(chat, messageId, state = null, knownLineage = null) {
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
  const lineage = Array.isArray(knownLineage) && knownLineage.length === chat.length ? knownLineage : chatLineage(chat);
  const previous = Array.isArray(state?.lineage) ? state.lineage : [];
  if (previous.length) {
    const divergence = firstLineageDivergence(previous, lineage);
    if (divergence >= 0 && divergence < previous.length) {
      const error = new Error('spatial manual mutation state lineage does not match current chat branch');
      error.code = 'WORLD_STATE_SPATIAL_MANUAL_BRANCH_MISMATCH';
      throw error;
    }
  }
  // The chat is fingerprinted once: the commit reuses this lineage.
  return { boundary: lineage[messageId], lineage };
}

export function applySpatialManualMutation({
  state,
  chat = [],
  chatKey,
  messageId = null,
  mutation,
  note = '',
  baseMap = null,
  lineage = null,
} = {}) {
  // Only read: the reducer and the commit make their own copies.
  const before = readableState(state, { chatKey });
  const owner = String(chatKey || before.chatKey || '');
  if (!owner) throw new Error('chatKey is required');

  const checked = Array.isArray(chat) && chat.length > 0
    ? exactBoundary(chat, messageId, before, lineage)
    : null;
  const boundary = checked?.boundary || null;

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
    // A campaign override keeps its override authority through manual edits (Lock then Unlock must not
    // leave it a releasable 'manual' coordinate that narration may move).
    const target = before.spatial.locations.find(loc => loc.id === proposal.locationId);
    const authority = target?.baseRefId && ['manual', 'campaign_override'].includes(requestedAuthority)
      ? 'campaign_override'
      : ['base_canonical', 'campaign_override'].includes(requestedAuthority) ? 'manual' : requestedAuthority;
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
      state: cloneState(before),
      applied: [],
      rejected: reduced.rejected.map(item => ({ stage: 'spatial-reducer', reason: item.reason })),
    };
  }

  // The commit (or the root update below) copies this before it is kept.
  const nextState = { ...before, spatial: reduced.spatial };

  if (boundary) {
    const committed = commitMutationBoundary(
      before,
      nextState,
      chat,
      messageId,
      'spatial-manual',
      { lineage: checked.lineage },
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
    // Checkpoint entries are shared between state copies: replace the root entry, never edit it.
    const rootIndex = nextState.checkpoints.findIndex(c => c.messageId === -1);
    if (rootIndex >= 0) {
      nextState.checkpoints = [...nextState.checkpoints];
      const rootCp = nextState.checkpoints[rootIndex];
      nextState.checkpoints[rootIndex] = { ...rootCp, snapshot: { ...rootCp.snapshot, spatial: clone(nextState.spatial) } };
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

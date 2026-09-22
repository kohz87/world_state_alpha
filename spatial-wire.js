import {
  SPATIAL_ADMISSION_REASONS,
  SPATIAL_AUTHORITIES,
  SPATIAL_DISTANCE_MODES,
  SPATIAL_LIMITS,
} from './constants.js';

export const SPATIAL_WIRE_LIMITS = Object.freeze({
  mutations: 8,
  evidencePerMutation: 4,
  routeRefs: 8,
  noteChars: SPATIAL_LIMITS.notesChars,
});

export class SpatialWireError extends Error {
  constructor(message, code = 'WORLD_STATE_SPATIAL_WIRE_INVALID') {
    super(message);
    this.name = 'WorldStateSpatialWireError';
    this.code = code;
  }
}

function text(value, max = 400) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function uniqueStrings(value, maxItems = 8, maxChars = 120) {
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
  if (!raw || typeof raw !== 'object') throw new SpatialWireError('spatial evidence item must be an object');
  if (!Number.isInteger(raw.sourceMessageId) || raw.sourceMessageId < 0) {
    throw new SpatialWireError('spatial evidence sourceMessageId must be a non-negative integer');
  }
  const claim = text(raw.claim, 500);
  if (!claim) throw new SpatialWireError('spatial evidence claim is required');
  return { sourceMessageId: raw.sourceMessageId, claim };
}

function coordinate(raw) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object') throw new SpatialWireError('coordinate must be an object or null');
  const x = Number.isFinite(raw.x) ? raw.x : null;
  const y = Number.isFinite(raw.y) ? raw.y : null;
  if ((x === null) !== (y === null)) throw new SpatialWireError('coordinate requires both x and y or neither');
  const authority = SPATIAL_AUTHORITIES.includes(raw.authority) ? raw.authority : 'narrative_explicit';
  return { x, y, authority, locked: false };
}

function relative(raw) {
  if (raw === null || raw === undefined) return null;
  if (!raw || typeof raw !== 'object') throw new SpatialWireError('relative must be an object or null');
  const toLocationId = text(raw.toLocationId, 120);
  const direction = text(raw.direction, 30).toLowerCase();
  const distanceKm = Number.isFinite(raw.distanceKm) && raw.distanceKm >= 0 ? raw.distanceKm : null;
  const distanceMode = SPATIAL_DISTANCE_MODES.includes(raw.distanceMode) ? raw.distanceMode : 'unspecified';
  if (!toLocationId || !direction) throw new SpatialWireError('relative requires toLocationId and direction');
  return { toLocationId, direction, distanceKm, distanceMode };
}

function normalizeLocationMutation(raw) {
  const locationId = text(raw.locationId, 120);
  const name = text(raw.name, SPATIAL_LIMITS.nameChars);
  const evidenceRaw = Array.isArray(raw.evidence) ? raw.evidence : [];
  if (!name) throw new SpatialWireError('spatial location name is required');
  if (!SPATIAL_ADMISSION_REASONS.includes(raw.admissionReason)) {
    throw new SpatialWireError('spatial create/update requires a valid admissionReason');
  }
  if (evidenceRaw.length === 0 || evidenceRaw.length > SPATIAL_WIRE_LIMITS.evidencePerMutation) {
    throw new SpatialWireError('spatial mutation requires 1-4 evidence items');
  }
  return {
    action: 'upsert_location',
    ...(locationId ? { locationId } : {}),
    name,
    type: text(raw.type, SPATIAL_LIMITS.typeChars) || 'landmark',
    context: text(raw.context, SPATIAL_LIMITS.contextChars),
    coordinate: coordinate(raw.coordinate),
    relative: relative(raw.relative),
    routeRefs: uniqueStrings(raw.routeRefs, SPATIAL_WIRE_LIMITS.routeRefs),
    notes: text(raw.notes, SPATIAL_WIRE_LIMITS.noteChars),
    admissionReason: raw.admissionReason,
    evidence: evidenceRaw.map(evidenceItem),
  };
}

function normalizeRelationMutation(raw) {
  const fromId = text(raw.fromId, 120);
  const toId = text(raw.toId, 120);
  if (!fromId || !toId || fromId === toId) throw new SpatialWireError('spatial relation requires distinct fromId and toId');
  const evidenceRaw = Array.isArray(raw.evidence) ? raw.evidence : [];
  if (evidenceRaw.length === 0 || evidenceRaw.length > SPATIAL_WIRE_LIMITS.evidencePerMutation) {
    throw new SpatialWireError('spatial relation requires 1-4 evidence items');
  }
  return {
    action: 'upsert_relation',
    ...(text(raw.relationId, 140) ? { relationId: text(raw.relationId, 140) } : {}),
    fromId,
    toId,
    direction: text(raw.direction, 30).toLowerCase() || null,
    distanceKm: Number.isFinite(raw.distanceKm) && raw.distanceKm >= 0 ? raw.distanceKm : null,
    distanceMode: SPATIAL_DISTANCE_MODES.includes(raw.distanceMode) ? raw.distanceMode : 'unspecified',
    notes: text(raw.notes, SPATIAL_WIRE_LIMITS.noteChars),
    evidence: evidenceRaw.map(evidenceItem),
  };
}

function normalizeRouteMutation(raw) {
  const routeId = text(raw.routeId, 140);
  const name = text(raw.name, SPATIAL_LIMITS.nameChars);
  if (!name) throw new SpatialWireError('spatial route name is required');
  const evidenceRaw = Array.isArray(raw.evidence) ? raw.evidence : [];
  if (evidenceRaw.length === 0 || evidenceRaw.length > SPATIAL_WIRE_LIMITS.evidencePerMutation) {
    throw new SpatialWireError('spatial route requires 1-4 evidence items');
  }
  return {
    action: 'upsert_route',
    ...(routeId ? { routeId } : {}),
    name,
    type: text(raw.type, SPATIAL_LIMITS.typeChars) || 'route',
    endpoints: uniqueStrings(raw.endpoints, 8),
    waypoints: uniqueStrings(raw.waypoints, 16),
    context: text(raw.context, SPATIAL_LIMITS.contextChars),
    evidence: evidenceRaw.map(evidenceItem),
  };
}

export function validateSpatialMutation(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SpatialWireError('spatial mutation must be an object');
  const action = text(raw.action, 32);
  if (action === 'upsert_location') return normalizeLocationMutation(raw);
  if (action === 'upsert_relation') return normalizeRelationMutation(raw);
  if (action === 'upsert_route') return normalizeRouteMutation(raw);
  throw new SpatialWireError('unsupported spatial automatic action: ' + (action || '(missing)'));
}

export function validateSpatialEnvelope(raw) {
  const source = Array.isArray(raw) ? raw : [];
  if (source.length > SPATIAL_WIRE_LIMITS.mutations) {
    throw new SpatialWireError('spatial mutation count exceeds limit');
  }
  const mutations = [];
  const rejected = [];
  for (let index = 0; index < source.length; index += 1) {
    try {
      mutations.push(validateSpatialMutation(source[index]));
    } catch (error) {
      rejected.push({
        index,
        code: error?.code || 'WORLD_STATE_SPATIAL_WIRE_INVALID',
        reason: String(error?.message || error),
      });
    }
  }
  return { mutations, rejected };
}

import {
  EVIDENCE_SOURCE_CLASSES,
  LIMITS,
  SPATIAL_AUTHORITIES,
  SPATIAL_DISTANCE_MODES,
  SPATIAL_LIMITS,
  SPATIAL_LOCATION_STATUSES,
} from './constants.js';
import { boundedText, clone, keyedUndo, ownEntry, reservedMapKey, restoreKeyed, uniqueStrings } from './common.js';
import { canonicalText, deterministicId, stableStringify } from './hash.js';

function messageId(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function boundedEvidenceRefs(items) {
  const refs = uniqueStrings(items, Number.MAX_SAFE_INTEGER, 120);
  if (refs.length <= SPATIAL_LIMITS.evidenceRefsPerLocation) return refs;
  return [refs[0], ...refs.slice(-(SPATIAL_LIMITS.evidenceRefsPerLocation - 1))];
}

export function createSpatialState() {
  return {
    profile: null,
    baseMapRef: null,
    locations: [],
    relations: [],
    routes: [],
    evidence: {},
    lastCaptureMessage: null,
  };
}

const CARTESIAN_AXES = Object.freeze(['+x', '-x', '+y', '-y']);

function normalizeCartesianAxis(value, fallback) {
  const clean = boundedText(value, 10).toLowerCase();
  return CARTESIAN_AXES.includes(clean) ? clean : fallback;
}

function axisVector(axis) {
  switch (axis) {
    case '+x': return { x: 1, y: 0 };
    case '-x': return { x: -1, y: 0 };
    case '-y': return { x: 0, y: -1 };
    case '+y':
    default:
      return { x: 0, y: 1 };
  }
}

function defaultEastAxisForNorth(northAxis) {
  switch (northAxis) {
    case '+x': return '-y';
    case '-x': return '+y';
    case '-y': return '-x';
    case '+y':
    default:
      return '+x';
  }
}

function axesArePerpendicular(northAxis, eastAxis) {
  const north = axisVector(northAxis);
  const east = axisVector(eastAxis);
  return (north.x * east.x + north.y * east.y) === 0;
}

export function normalizeSpatialProfile(raw, { strict = false } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const declaredSystem = boundedText(raw.system, 30).toLowerCase();
  if (strict && declaredSystem && declaredSystem !== 'cartesian2d') {
    throw new Error(`unsupported spatial coordinate system: ${raw.system}`);
  }
  const system = 'cartesian2d';
  if (strict && raw.northAxis !== undefined && raw.northAxis !== null && !CARTESIAN_AXES.includes(boundedText(raw.northAxis, 10).toLowerCase())) {
    throw new Error(`invalid spatial north axis: ${raw.northAxis}`);
  }
  if (strict && raw.eastAxis !== undefined && raw.eastAxis !== null && !CARTESIAN_AXES.includes(boundedText(raw.eastAxis, 10).toLowerCase())) {
    throw new Error(`invalid spatial east axis: ${raw.eastAxis}`);
  }
  const northAxis = normalizeCartesianAxis(raw.northAxis, '+y');
  let eastAxis = normalizeCartesianAxis(raw.eastAxis, defaultEastAxisForNorth(northAxis));
  if (strict && raw.eastAxis !== undefined && raw.eastAxis !== null && !axesArePerpendicular(northAxis, eastAxis)) {
    throw new Error('spatial profile axes must be perpendicular');
  }
  if (!axesArePerpendicular(northAxis, eastAxis)) {
    eastAxis = defaultEastAxisForNorth(northAxis);
  }

  if (strict && raw.unitKm !== undefined && raw.unitKm !== null
    && (!Number.isFinite(raw.unitKm) || raw.unitKm <= 0)) {
    throw new Error('spatial profile unitKm must be a positive number or null');
  }
  const unitKm = Number.isFinite(raw.unitKm) && raw.unitKm > 0 ? raw.unitKm : null;

  if (strict && raw.decimalStep !== undefined && raw.decimalStep !== null
    && (!Number.isFinite(raw.decimalStep) || raw.decimalStep <= 0)) {
    throw new Error('spatial profile decimalStep must be a positive number');
  }
  const decimalStep = Number.isFinite(raw.decimalStep) && raw.decimalStep > 0
    ? raw.decimalStep
    : SPATIAL_LIMITS.defaultDecimalStep;

  if (strict && raw.trueNorthLocked !== undefined && raw.trueNorthLocked !== null
    && typeof raw.trueNorthLocked !== 'boolean') {
    throw new Error('spatial profile trueNorthLocked must be boolean');
  }
  const trueNorthLocked = raw.trueNorthLocked !== false;

  const hasBounds = raw.bounds !== undefined && raw.bounds !== null;
  if (strict && hasBounds && (typeof raw.bounds !== 'object' || Array.isArray(raw.bounds))) {
    throw new Error('spatial profile bounds must be an object or null');
  }
  const rawBounds = hasBounds && typeof raw.bounds === 'object' ? raw.bounds : null;
  if (strict && rawBounds) {
    const complete = Number.isFinite(rawBounds.xMin)
      && Number.isFinite(rawBounds.xMax)
      && Number.isFinite(rawBounds.yMin)
      && Number.isFinite(rawBounds.yMax);
    if (!complete || rawBounds.xMin > rawBounds.xMax || rawBounds.yMin > rawBounds.yMax) {
      throw new Error('spatial profile bounds require finite xMin/xMax/yMin/yMax with min <= max');
    }
  }
  const bounds = rawBounds
    && Number.isFinite(rawBounds.xMin)
    && Number.isFinite(rawBounds.xMax)
    && Number.isFinite(rawBounds.yMin)
    && Number.isFinite(rawBounds.yMax)
    && rawBounds.xMin <= rawBounds.xMax
    && rawBounds.yMin <= rawBounds.yMax
    ? {
      xMin: rawBounds.xMin,
      xMax: rawBounds.xMax,
      yMin: rawBounds.yMin,
      yMax: rawBounds.yMax,
    }
    : null;

  return {
    system,
    northAxis,
    eastAxis,
    unitKm,
    bounds,
    decimalStep,
    trueNorthLocked,
  };
}

export function resolveSpatialProfile(spatialState, baseMap = null) {
  if (baseMap) return baseMap.profile ? normalizeSpatialProfile(baseMap.profile, { strict: true }) : null;
  return normalizeSpatialProfile(spatialState?.profile);
}

export function normalizeBaseMapRef(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = boundedText(raw.id, 120);
  if (!id) return null;
  return {
    id,
    name: boundedText(raw.name, SPATIAL_LIMITS.nameChars) || id,
    version: boundedText(raw.version, 40),
    digest: boundedText(raw.digest, 80) || '',
    path: boundedText(raw.path, 500) || '',
  };
}

export function normalizeCoordinate(raw, { strict = false } = {}) {
  if (!raw || typeof raw !== 'object') {
    return { x: null, y: null, authority: 'unknown', locked: false };
  }
  const rawX = Number.isFinite(raw.x) ? raw.x : null;
  const rawY = Number.isFinite(raw.y) ? raw.y : null;
  const hasCoordinate = rawX !== null && rawY !== null;
  const x = hasCoordinate ? rawX : null;
  const y = hasCoordinate ? rawY : null;
  if (strict && raw.authority !== undefined && raw.authority !== null && !SPATIAL_AUTHORITIES.includes(raw.authority)) {
    throw new Error(`invalid spatial coordinate authority: ${raw.authority}`);
  }
  const authority = SPATIAL_AUTHORITIES.includes(raw.authority) ? raw.authority : 'unknown';
  const locked = hasCoordinate && Boolean(raw.locked);
  return { x, y, authority, locked };
}

export function normalizeSpatialLocation(raw, { strict = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('spatial location must be an object');
  const id = boundedText(raw.id, 120);
  if (!id) throw new Error('spatial location id is required');
  const name = boundedText(raw.name, SPATIAL_LIMITS.nameChars);
  if (!name) throw new Error('spatial location name is required');
  const type = boundedText(raw.type, SPATIAL_LIMITS.typeChars) || 'landmark';
  if (strict && raw.status !== undefined && raw.status !== null && !SPATIAL_LOCATION_STATUSES.includes(raw.status)) {
    throw new Error(`invalid spatial location status: ${raw.status}`);
  }
  const status = SPATIAL_LOCATION_STATUSES.includes(raw.status) ? raw.status : 'active';
  const baseRefId = boundedText(raw.baseRefId, 120) || null;
  const coordinate = normalizeCoordinate(raw.coordinate, { strict });
  const context = boundedText(raw.context, SPATIAL_LIMITS.contextChars);
  const routeRefs = uniqueStrings(raw.routeRefs, SPATIAL_LIMITS.routeRefsPerLocation, 120);
  const createdAtMessage = messageId(raw.createdAtMessage);
  const lastChangedMessage = messageId(raw.lastChangedMessage);
  const evidenceIds = boundedEvidenceRefs(raw.evidenceIds);
  const notes = boundedText(raw.notes, SPATIAL_LIMITS.notesChars);

  return {
    id,
    name,
    type,
    status,
    baseRefId,
    coordinate,
    context,
    routeRefs,
    createdAtMessage,
    lastChangedMessage,
    evidenceIds,
    notes,
    ...(raw.operatorOwned === true ? { operatorOwned: true } : {}),
    // The place a merged-away duplicate was merged into: narration of its old name means that place.
    ...(boundedText(raw.mergedInto, 120) ? { mergedInto: boundedText(raw.mergedInto, 120) } : {}),
  };
}

export function normalizeSpatialRelation(raw, { strict = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('spatial relation must be an object');
  const id = boundedText(raw.id, 140);
  const fromId = boundedText(raw.fromId, 120);
  const toId = boundedText(raw.toId, 120);
  if (!id || !fromId || !toId) throw new Error('spatial relation id/fromId/toId are required');

  const direction = boundedText(raw.direction, 30).toLowerCase() || null;
  const distanceKm = Number.isFinite(raw.distanceKm) && raw.distanceKm >= 0 ? raw.distanceKm : null;
  if (strict && raw.distanceMode !== undefined && raw.distanceMode !== null && !SPATIAL_DISTANCE_MODES.includes(raw.distanceMode)) {
    throw new Error(`invalid spatial distance mode: ${raw.distanceMode}`);
  }
  const distanceMode = SPATIAL_DISTANCE_MODES.includes(raw.distanceMode) ? raw.distanceMode : 'unspecified';
  const notes = boundedText(raw.notes, SPATIAL_LIMITS.notesChars);
  const evidenceIds = boundedEvidenceRefs(raw.evidenceIds);

  return {
    id,
    fromId,
    toId,
    direction,
    distanceKm,
    distanceMode,
    notes,
    evidenceIds,
    ...(raw.operatorOwned === true ? { operatorOwned: true } : {}),
  };
}

export function normalizeSpatialRoute(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('spatial route must be an object');
  const id = boundedText(raw.id, 140);
  const name = boundedText(raw.name, SPATIAL_LIMITS.nameChars);
  if (!id || !name) throw new Error('spatial route id and name are required');

  const type = boundedText(raw.type, SPATIAL_LIMITS.typeChars) || 'road';
  const endpoints = uniqueStrings(raw.endpoints, 8, 120);
  const waypoints = uniqueStrings(raw.waypoints, 32, 120);
  const context = boundedText(raw.context, SPATIAL_LIMITS.contextChars);
  const evidenceIds = boundedEvidenceRefs(raw.evidenceIds);

  return {
    id,
    name,
    type,
    endpoints,
    waypoints,
    context,
    evidenceIds,
    ...(raw.operatorOwned === true ? { operatorOwned: true } : {}),
  };
}

export function normalizeSpatialEvidence(raw, { strict = false } = {}) {
  if (!raw || typeof raw !== 'object') throw new Error('spatial evidence must be an object');
  const id = boundedText(raw.id, 140);
  if (!id) throw new Error('spatial evidence id is required');
  if (reservedMapKey(id)) throw new Error(`spatial evidence id is reserved: ${id}`);
  if (strict && raw.sourceClass !== undefined && raw.sourceClass !== null && !EVIDENCE_SOURCE_CLASSES.includes(raw.sourceClass)) {
    throw new Error(`invalid spatial evidence sourceClass: ${raw.sourceClass}`);
  }
  const sourceClass = EVIDENCE_SOURCE_CLASSES.includes(raw.sourceClass) ? raw.sourceClass : 'assistant_narration';

  return {
    id,
    sourceMessageId: messageId(raw.sourceMessageId),
    lineageKey: boundedText(raw.lineageKey, 80),
    sourceClass,
    claim: boundedText(raw.claim, LIMITS.claimChars),
    locationIds: uniqueStrings(raw.locationIds, 16, 120),
  };
}

export function normalizeSpatialState(raw, { strict = false } = {}) {
  if (!raw || typeof raw !== 'object') {
    return createSpatialState();
  }

  const spatial = createSpatialState();
  spatial.profile = normalizeSpatialProfile(raw.profile, { strict });
  spatial.baseMapRef = normalizeBaseMapRef(raw.baseMapRef);
  spatial.lastCaptureMessage = messageId(raw.lastCaptureMessage);

  const locIds = new Set();
  for (const item of Array.isArray(raw.locations) ? raw.locations : []) {
    try {
      const loc = normalizeSpatialLocation(item, { strict });
      if (locIds.has(loc.id)) {
        if (strict) throw new Error(`duplicate spatial location id: ${loc.id}`);
        continue;
      }
      locIds.add(loc.id);
      spatial.locations.push(loc);
    } catch (error) {
      if (strict) throw error;
    }
  }

  const relIds = new Set();
  for (const item of Array.isArray(raw.relations) ? raw.relations : []) {
    try {
      const rel = normalizeSpatialRelation(item, { strict });
      if (relIds.has(rel.id)) {
        if (strict) throw new Error(`duplicate spatial relation id: ${rel.id}`);
        continue;
      }
      relIds.add(rel.id);
      spatial.relations.push(rel);
    } catch (error) {
      if (strict) throw error;
    }
  }

  const routeIds = new Set();
  for (const item of Array.isArray(raw.routes) ? raw.routes : []) {
    try {
      const rt = normalizeSpatialRoute(item);
      if (routeIds.has(rt.id)) {
        if (strict) throw new Error(`duplicate spatial route id: ${rt.id}`);
        continue;
      }
      routeIds.add(rt.id);
      spatial.routes.push(rt);
    } catch (error) {
      if (strict) throw error;
    }
  }

  if (raw.evidence && typeof raw.evidence === 'object' && !Array.isArray(raw.evidence)) {
    const evidenceIds = new Set();
    for (const [key, item] of Object.entries(raw.evidence)) {
      try {
        const ev = normalizeSpatialEvidence(item, { strict });
        if (strict && key !== ev.id) {
          throw new Error(`spatial evidence map key/id mismatch: ${key} != ${ev.id}`);
        }
        if (evidenceIds.has(ev.id)) {
          if (strict) throw new Error(`duplicate spatial evidence id: ${ev.id}`);
          continue;
        }
        evidenceIds.add(ev.id);
        spatial.evidence[ev.id] = ev;
      } catch (error) {
        if (strict) throw error;
      }
    }
  }

  // Operator authorship is kept on the entity itself, so trimming its bounded
  // evidence or relabelling it on import never hands it back to the model. A
  // state saved before the flag existed derives it from manual evidence.
  for (const entity of [...spatial.locations, ...spatial.relations, ...spatial.routes]) {
    if (entity.operatorOwned !== true && (entity.evidenceIds || []).some(id => ownEntry(spatial.evidence, id)?.sourceClass === 'manual')) {
      entity.operatorOwned = true;
    }
  }

  if (strict) {
    const entities = [
      ...spatial.locations.map(item => ['location', item]),
      ...spatial.relations.map(item => ['relation', item]),
      ...spatial.routes.map(item => ['route', item]),
    ];
    for (const [kind, entity] of entities) {
      for (const evidenceId of entity.evidenceIds || []) {
        if (!ownEntry(spatial.evidence, evidenceId)) {
          throw new Error(`spatial ${kind} ${entity.id} references missing evidence: ${evidenceId}`);
        }
      }
    }
  }

  return spatial;
}

export function authorityRank(authority, locked = false) {
  if (authority === 'manual' && locked) return 100;
  if (authority === 'campaign_override') return 90;
  if (authority === 'base_canonical') return 80;
  if (authority === 'narrative_explicit') return 60;
  // An unlocked manual coordinate is intentionally releasable: explicit grounded
  // narration may correct it, while deterministic derivation still may not.
  if (authority === 'manual') return 55;
  if (authority === 'derived') return 50;
  if (authority === 'relative') return 40;
  return 0; // unknown
}

export function validateBounds(x, y, bounds = null) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  if (!bounds) return true;
  return x >= bounds.xMin && x <= bounds.xMax && y >= bounds.yMin && y <= bounds.yMax;
}

export function kmToUnits(km, unitKm = null) {
  const scale = Number(unitKm);
  if (!Number.isFinite(scale) || scale <= 0) return null;
  return (Number(km) || 0) / scale;
}

export function roundDecimal(value, step = SPATIAL_LIMITS.defaultDecimalStep) {
  const numeric = Number(value);
  const s = Number(step) || SPATIAL_LIMITS.defaultDecimalStep;
  if (!Number.isFinite(numeric) || !Number.isFinite(s) || s <= 0) return NaN;
  // Nudge exact decimal half-steps past binary floating-point representation
  // noise, then trim the multiplication artifact deterministically.
  const scaled = numeric / s;
  // Preserve JavaScript Math.round tie semantics (toward +Infinity) while
  // compensating for decimal values represented just below the half-step.
  const rounded = Math.round(scaled + 1e-12) * s;
  return Number(rounded.toPrecision(15));
}

export function directionFromDelta(dx, dy, {
  northAxis = '+y',
  eastAxis = '+x',
} = {}) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) return null;
  const normalizedNorth = normalizeCartesianAxis(northAxis, '+y');
  let normalizedEast = normalizeCartesianAxis(eastAxis, defaultEastAxisForNorth(normalizedNorth));
  if (!axesArePerpendicular(normalizedNorth, normalizedEast)) {
    normalizedEast = defaultEastAxisForNorth(normalizedNorth);
  }
  const north = axisVector(normalizedNorth);
  const east = axisVector(normalizedEast);
  const northComponent = dx * north.x + dy * north.y;
  const eastComponent = dx * east.x + dy * east.y;
  const angleRad = Math.atan2(eastComponent, northComponent);
  const angleDeg = (angleRad * 180 / Math.PI + 360) % 360;

  if (angleDeg >= 337.5 || angleDeg < 22.5) return 'north';
  if (angleDeg >= 22.5 && angleDeg < 67.5) return 'northeast';
  if (angleDeg >= 67.5 && angleDeg < 112.5) return 'east';
  if (angleDeg >= 112.5 && angleDeg < 157.5) return 'southeast';
  if (angleDeg >= 157.5 && angleDeg < 202.5) return 'south';
  if (angleDeg >= 202.5 && angleDeg < 247.5) return 'southwest';
  if (angleDeg >= 247.5 && angleDeg < 292.5) return 'west';
  return 'northwest';
}

export function canonicalSpatialDirection(value) {
  // "north-east" and "north east" are northeast.
  const raw = boundedText(value, 30).toLowerCase().replace(/^(north|south)[\s-]+(east|west)$/u, '$1$2');
  const aliases = {
    n: 'north',
    ne: 'northeast',
    e: 'east',
    se: 'southeast',
    s: 'south',
    sw: 'southwest',
    w: 'west',
    nw: 'northwest',
  };
  // Own keys only: "constructor" or "tostring" is no alias (and no compass point).
  return Object.hasOwn(aliases, raw) ? aliases[raw] : raw;
}

// Null prototype: a stored direction such as 'constructor' or 'tostring' is never mistaken for a compass point.
export const OPPOSITE_DIRECTION = Object.freeze(Object.assign(Object.create(null), {
  north: 'south', south: 'north', east: 'west', west: 'east',
  northeast: 'southwest', southwest: 'northeast', northwest: 'southeast', southeast: 'northwest',
}));

// The coordinate of the place an effective id names as the state holds it now: its active campaign entry (an
// override answers to the base id it shadows), else its visible projection. `campaignByEffectiveId` maps
// effective ids to the stored entries (references, so a coordinate moved in place is read as it is now).
function currentCoordinateFor(id, effectiveById, spatial, campaignByEffectiveId) {
  return campaignByEffectiveId.get(id)?.coordinate || effectiveCoordinateFor(id, effectiveById, spatial);
}

function effectiveCoordinateFor(id, effectiveById, spatial) {
  const effective = effectiveById.get(id);
  if (effective?.coordinate) return effective.coordinate;
  const campaign = spatial.locations.find(loc => loc.id === id);
  return campaign?.coordinate || null;
}

export function deriveCoordinate(anchorCoord, {
  direction,
  distanceKm,
  distanceMode = 'straight_line',
  unitKm = null,
  decimalStep = SPATIAL_LIMITS.defaultDecimalStep,
  bounds = null,
  northAxis = '+y',
  eastAxis = '+x',
} = {}) {
  if (distanceMode !== 'straight_line') return null;
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;
  if (!Number.isFinite(unitKm) || unitKm <= 0) return null;
  if (!anchorCoord || !Number.isFinite(anchorCoord.x) || !Number.isFinite(anchorCoord.y)) return null;

  const dir = canonicalSpatialDirection(direction);
  const distUnits = kmToUnits(distanceKm, unitKm);
  const diagonal = 1 / Math.SQRT2;
  let eastComponent = 0;
  let northComponent = 0;

  switch (dir) {
    case 'north': northComponent = 1; break;
    case 'south': northComponent = -1; break;
    case 'east': eastComponent = 1; break;
    case 'west': eastComponent = -1; break;
    case 'northeast': eastComponent = diagonal; northComponent = diagonal; break;
    case 'northwest': eastComponent = -diagonal; northComponent = diagonal; break;
    case 'southeast': eastComponent = diagonal; northComponent = -diagonal; break;
    case 'southwest': eastComponent = -diagonal; northComponent = -diagonal; break;
    default: return null;
  }

  const normalizedNorth = normalizeCartesianAxis(northAxis, '+y');
  let normalizedEast = normalizeCartesianAxis(eastAxis, defaultEastAxisForNorth(normalizedNorth));
  if (!axesArePerpendicular(normalizedNorth, normalizedEast)) {
    normalizedEast = defaultEastAxisForNorth(normalizedNorth);
  }
  const north = axisVector(normalizedNorth);
  const east = axisVector(normalizedEast);
  const dx = distUnits * (eastComponent * east.x + northComponent * north.x);
  const dy = distUnits * (eastComponent * east.y + northComponent * north.y);

  const rawX = anchorCoord.x + dx;
  const rawY = anchorCoord.y + dy;
  const x = roundDecimal(rawX, decimalStep);
  const y = roundDecimal(rawY, decimalStep);

  if (!validateBounds(x, y, bounds)) return null;

  return {
    x,
    y,
    authority: 'derived',
    locked: false,
  };
}

// id -> base entry, built once per (read-only) base map so a lookup never walks the whole map.
const baseLocationIndexes = new WeakMap();
function baseLocationIndex(baseMap) {
  const locations = baseMap && Array.isArray(baseMap.locations) ? baseMap.locations : null;
  if (!locations) return new Map();
  let index = baseLocationIndexes.get(locations);
  if (!index) {
    index = new Map();
    for (const item of locations) if (item && item.id) index.set(item.id, item);
    baseLocationIndexes.set(locations, index);
  }
  return index;
}

// A place name as capture and the reducer compare it.
export const placeNameKey = canonicalText;

// A stored place's name key, folded once per place object and name rather than once per proposal compared.
const storedNameKeys = new WeakMap();
function storedNameKey(loc) {
  const hit = storedNameKeys.get(loc);
  if (hit && hit.name === loc.name) return hit.key;
  const key = placeNameKey(loc.name);
  storedNameKeys.set(loc, { name: loc.name, key });
  return key;
}

// name -> base entries with that name, built once per (read-only) base map like the id index. A name that
// several base places share is ambiguous: `{ ambiguous: true }`, never an arbitrary one of them.
const baseNameIndexes = new WeakMap();
export function baseLocationByName(baseMap, name) {
  const locations = baseMap && Array.isArray(baseMap.locations) ? baseMap.locations : null;
  const key = placeNameKey(name);
  if (!locations || !key) return null;
  let index = baseNameIndexes.get(locations);
  if (!index) {
    index = new Map();
    for (const item of locations) {
      const itemKey = item?.id ? placeNameKey(item.name) : '';
      if (itemKey) index.set(itemKey, index.has(itemKey) ? { ambiguous: true } : item);
    }
    baseNameIndexes.set(locations, index);
  }
  return index.get(key) || null;
}

// The places a rebuild reports (its progress and its result alike): active campaign places, never archived
// places or read-only base-map places.
export function activeCampaignPlaceCount(spatial) {
  return (Array.isArray(spatial?.locations) ? spatial.locations : []).filter(location => location?.status === 'active').length;
}

// name -> base route with that name, built once per base map (no scan on a turn).
const baseRouteNameIndexes = new WeakMap();
export function baseRouteByName(baseMap, name) {
  const routes = baseMap && Array.isArray(baseMap.routes) ? baseMap.routes : null;
  const key = placeNameKey(name);
  if (!routes || !key) return null;
  let index = baseRouteNameIndexes.get(routes);
  if (!index) {
    index = new Map();
    for (const item of routes) {
      const itemKey = item?.id ? placeNameKey(item.name) : '';
      if (itemKey && !index.has(itemKey)) index.set(itemKey, item);
    }
    baseRouteNameIndexes.set(routes, index);
  }
  return index.get(key) || null;
}

// The id relations and routes use for a stored place: an override answers to the base id it shadows while
// that base place exists. Without the base map at hand, an attached map (baseMapRef) is assumed to still
// hold it; once the map is detached, or replaced by one without that place, the override is its own place.
export function effectiveLocationId(loc, baseMap = null, spatialState = null) {
  if (!loc?.baseRefId) return loc?.id || '';
  const locations = baseMap && Array.isArray(baseMap.locations) ? baseMap.locations : null;
  if (locations) return baseLocationIndex(baseMap).has(loc.baseRefId) ? loc.baseRefId : loc.id;
  return spatialState?.baseMapRef?.id ? loc.baseRefId : loc.id;
}

function effectiveBaseLocation(item) {
  const axis = at => {
    const value = Number.isFinite(item.coordinate?.[at ? 'y' : 'x']) ? item.coordinate[at ? 'y' : 'x'] : (Array.isArray(item.coord) ? item.coord[at] : null);
    return Number.isFinite(value) ? value : null;
  };
  const x = axis(0);
  const y = axis(1);
  const known = x !== null && y !== null;
  return {
    ...clone(item),
    baseRefId: null,
    isBase: true,
    // Only a stated position is base canonical and locked; a base place without one is simply unknown.
    coordinate: known
      ? { x, y, authority: 'base_canonical', locked: true }
      : { x: null, y: null, authority: 'unknown', locked: false },
  };
}

// `onlyIds` resolves just those effective ids (same result for each as a full resolve) without touching the
// rest of the base map: a capture that changed two places must not clone a thousand-place map.
export function resolveEffectiveLocations(spatialState, baseMap = null, { onlyIds = null } = {}) {
  const effective = new Map();
  let baseIndex = null;
  const baseHas = id => {
    if (!baseMap || !Array.isArray(baseMap.locations)) return false;
    baseIndex = baseIndex || baseLocationIndex(baseMap);
    return baseIndex.has(id);
  };

  // 1. Load base locations as read-only base_canonical
  if (onlyIds) {
    for (const id of onlyIds) {
      if (!baseHas(id)) continue;
      effective.set(id, effectiveBaseLocation(baseIndex.get(id)));
    }
  } else if (baseMap && Array.isArray(baseMap.locations)) {
    for (const item of baseMap.locations) {
      if (!item || !item.id) continue;
      effective.set(item.id, effectiveBaseLocation(item));
    }
  }

  // 2. Apply campaign overrides and campaign-created locations
  const campaignKeys = new Set();
  for (const loc of spatialState?.locations || []) {
    const overrides = Boolean(loc.baseRefId) && (campaignKeys.has(loc.baseRefId) || baseHas(loc.baseRefId));
    const key = overrides ? loc.baseRefId : loc.id;
    campaignKeys.add(key);
    if (onlyIds && !onlyIds.has(key)) continue;
    if (overrides) {
      // Campaign override shadows base location
      const base = effective.get(loc.baseRefId);
      effective.set(loc.baseRefId, {
        ...base,
        ...clone(loc),
        id: base.id, // effective id remains the base id for continuity
        overrideId: loc.id,
        baseRefId: loc.baseRefId,
        isBase: true,
        isOverridden: true,
        status: loc.status || 'active',
        coordinate: normalizeCoordinate(loc.coordinate),
      });
    } else {
      // Campaign-created location (or an override whose base is absent)
      effective.set(loc.id, { ...clone(loc), isBase: false });
    }
  }

  return [...effective.values()];
}

export function resolveEffectiveRoutes(spatialState, baseMap = null) {
  const routes = new Map();
  if (baseMap && Array.isArray(baseMap.routes)) {
    for (const rt of baseMap.routes) {
      if (rt?.id) routes.set(rt.id, { ...clone(rt), isBase: true });
    }
  }
  for (const rt of spatialState?.routes || []) {
    if (rt?.id) routes.set(rt.id, { ...clone(rt), isBase: false });
  }
  return [...routes.values()];
}

export function compactSpatialEvidence(spatialState) {
  const referenced = new Set();
  for (const loc of spatialState.locations || []) {
    for (const id of loc.evidenceIds || []) referenced.add(id);
  }
  for (const rel of spatialState.relations || []) {
    for (const id of rel.evidenceIds || []) referenced.add(id);
  }
  for (const rt of spatialState.routes || []) {
    for (const id of rt.evidenceIds || []) referenced.add(id);
  }
  if (spatialState.evidence && typeof spatialState.evidence === 'object') {
    for (const key of Object.keys(spatialState.evidence)) {
      if (!referenced.has(key)) {
        delete spatialState.evidence[key];
      }
    }
  }
  return spatialState;
}

export function buildSpatialUndoPatch(beforeSpatial, afterSpatial) {
  const before = normalizeSpatialState(beforeSpatial);
  const after = normalizeSpatialState(afterSpatial);

  const locations = keyedUndo(before.locations, after.locations);
  const relations = keyedUndo(before.relations, after.relations);
  const routes = keyedUndo(before.routes, after.routes);
  const evidence = keyedUndo(Object.values(before.evidence), Object.values(after.evidence));

  const profileChanged = stableStringify(before.profile) !== stableStringify(after.profile);
  const baseMapRefChanged = stableStringify(before.baseMapRef) !== stableStringify(after.baseMapRef);
  const lastCaptureChanged = before.lastCaptureMessage !== after.lastCaptureMessage;

  const changed = locations.length || relations.length || routes.length || evidence.length
    || profileChanged || baseMapRefChanged || lastCaptureChanged;

  if (!changed) return null;

  return {
    locations,
    relations,
    routes,
    evidence,
    profileBefore: before.profile ? clone(before.profile) : null,
    profileChanged,
    baseMapRefBefore: before.baseMapRef ? clone(before.baseMapRef) : null,
    baseMapRefChanged,
    lastCaptureMessageBefore: before.lastCaptureMessage,
    lastCaptureChanged,
  };
}

export function applySpatialUndoPatch(inputSpatial, patch) {
  const spatial = normalizeSpatialState(inputSpatial);
  if (!patch) return spatial;

  spatial.locations = restoreKeyed(spatial.locations, patch.locations);
  spatial.relations = restoreKeyed(spatial.relations, patch.relations);
  spatial.routes = restoreKeyed(spatial.routes, patch.routes);

  const evidenceItems = restoreKeyed(Object.values(spatial.evidence), patch.evidence);
  spatial.evidence = Object.fromEntries(evidenceItems.map(item => [item.id, item]));

  if (patch.profileChanged) {
    spatial.profile = patch.profileBefore ? clone(patch.profileBefore) : null;
  }
  if (patch.baseMapRefChanged) {
    spatial.baseMapRef = patch.baseMapRefBefore ? clone(patch.baseMapRefBefore) : null;
  }
  if (patch.lastCaptureChanged) {
    spatial.lastCaptureMessage = messageId(patch.lastCaptureMessageBefore);
  }

  return spatial;
}

function locationIdFor(chatKey, context, ordinal, name, salt = 0) {
  return deterministicId('wsloc', [
    chatKey || context.chatKey || '',
    context.messageId,
    context.lineageKey,
    ordinal,
    boundedText(name, 40),
    // Only a collision adds a salt, so ids that never collided stay as they were.
    ...(salt ? [salt] : []),
  ]);
}

function spatialEvidenceIdFor(chatKey, locationId, context, ordinal, claim) {
  return deterministicId('wsev', [
    chatKey || context.chatKey || '',
    locationId,
    context.messageId,
    context.lineageKey,
    ordinal,
    boundedText(claim, LIMITS.claimChars),
  ]);
}

function relationIdFor(chatKey, fromId, toId, context) {
  return deterministicId('wsrel', [
    chatKey || context.chatKey || '',
    fromId,
    toId,
    context.messageId,
    context.lineageKey,
  ]);
}

function routeIdFor(chatKey, name, context) {
  return deterministicId('wsrt', [
    chatKey || context.chatKey || '',
    boundedText(name, 40),
    context.messageId,
    context.lineageKey,
  ]);
}

function addEntitySpatialEvidence(spatial, entity, locationIds, proposal, context, chatKey, counter) {
  const added = [];
  for (const raw of Array.isArray(proposal.evidence) ? proposal.evidence : []) {
    if (!raw || typeof raw !== 'object' || !boundedText(raw.claim, LIMITS.claimChars)) continue;
    const ordinal = counter.value++;
    const ownerKey = entity.id || locationIds.join('|') || 'spatial';
    const id = spatialEvidenceIdFor(chatKey, ownerKey, context, ordinal, raw.claim);
    const ev = normalizeSpatialEvidence({
      ...raw,
      id,
      sourceMessageId: messageId(raw.sourceMessageId) ?? context.messageId,
      lineageKey: boundedText(raw.lineageKey, 80) || context.lineageKey,
      locationIds,
    });
    const existing = ownEntry(spatial.evidence, id);
    if (existing && stableStringify(existing) !== stableStringify(ev)) {
      throw new Error(`deterministic spatial evidence id collision: ${id}`);
    }
    if (!existing) spatial.evidence[id] = ev;
    added.push(id);
  }
  entity.evidenceIds = boundedEvidenceRefs([...(entity.evidenceIds || []), ...added]);
  // Manual evidence marks operator authorship on the entity, independent of evidence retention.
  if (added.some(id => ownEntry(spatial.evidence, id)?.sourceClass === 'manual')) entity.operatorOwned = true;
}

function addSpatialEvidence(spatial, location, proposal, context, chatKey, counter) {
  addEntitySpatialEvidence(spatial, location, [location.id], proposal, context, chatKey, counter);
}

// Normalization builds a fresh Spatial state, the reducer's one private copy; the input is only read (the
// prior coordinates and the index delta's before-side). The journal's undo patch is built at the commit.
export function reduceSpatialMutations(inputSpatial, batch, baseMap = null, options = {}) {
  const spatial = normalizeSpatialState(inputSpatial);
  const before = inputSpatial && typeof inputSpatial === 'object' ? inputSpatial : createSpatialState();
  // The input's places by id as normalization keeps them (the first entry of a repeated id).
  const beforeById = new Map();
  for (const loc of Array.isArray(before.locations) ? before.locations : []) {
    if (loc && typeof loc === 'object' && loc.id && !beforeById.has(loc.id)) beforeById.set(loc.id, loc);
  }
  const chatKey = String(batch?.chatKey || '');
  const context = {
    chatKey,
    messageId: messageId(batch?.messageId),
    lineageKey: boundedText(batch?.lineageKey, 80),
    operation: boundedText(batch?.operation, 24) || 'capture',
  };

  const automaticNarrative = context.operation === 'capture' || context.operation === 'rebuild';
  const proposals = Array.isArray(batch?.mutations) ? batch.mutations : [];
  const applied = [];
  const rejected = [];
  const evidenceCounter = { value: 0 };
  const visibleEffective = Array.isArray(options.visibleLocations)
    ? options.visibleLocations
    : (options.allowBaseScan ? resolveEffectiveLocations(spatial, baseMap) : []);
  const effectiveById = new Map(visibleEffective.map(loc => [loc.id, loc]));
  // Active campaign entries by effective id, built when a relation needs it and dropped whenever a place
  // action may add, remove or re-key one.
  let campaignIndex = null;
  const campaignByEffectiveId = () => {
    if (!campaignIndex) {
      campaignIndex = new Map();
      for (const loc of spatial.locations) {
        if (loc.status === 'archived') continue;
        const key = effectiveLocationId(loc, baseMap, spatial);
        if (!campaignIndex.has(key)) campaignIndex.set(key, loc);
      }
    }
    return campaignIndex;
  };

  for (let index = 0; index < proposals.length; index += 1) {
    const proposal = proposals[index];
    if (!proposal || typeof proposal !== 'object') {
      rejected.push({ proposal, reason: 'mutation must be an object' });
      continue;
    }
    const action = proposal.action || 'upsert_location';
    if (action !== 'upsert_relation' && action !== 'delete_relation' && action !== 'upsert_route') campaignIndex = null;

    if (action === 'set_profile') {
      spatial.profile = normalizeSpatialProfile(proposal.profile, { strict: true });
      let clearedDerivedCoordinates = 0;
      if (proposal.clearDerivedCoordinates === true) {
        for (const location of spatial.locations) {
          if (location?.coordinate?.authority !== 'derived') continue;
          if (!Number.isFinite(location.coordinate.x) || !Number.isFinite(location.coordinate.y)) continue;
          location.coordinate = normalizeCoordinate({
            x: null,
            y: null,
            authority: 'unknown',
            locked: false,
          });
          location.lastChangedMessage = context.messageId;
          clearedDerivedCoordinates += 1;
          applied.push({ action: 'clear_derived_coordinate', locationId: location.id });
        }
      }
      applied.push({ action: 'set_profile', clearedDerivedCoordinates });
      continue;
    }

    if (action === 'set_base_map_ref') {
      const nextRef = normalizeBaseMapRef(proposal.baseMapRef);
      spatial.baseMapRef = nextRef;
      // Relations and routes address an override by the base id it shadows only while that base place
      // exists: re-key them when the map is detached, attached or replaced (`baseMap` is the map now attached;
      // without it an attach cannot tell which places exist, so nothing is re-keyed).
      const known = !nextRef || (baseMap && Array.isArray(baseMap.locations));
      if (known) {
        const nextBase = nextRef ? baseLocationIndex(baseMap) : new Map();
        const rekey = new Map();
        for (const loc of spatial.locations) {
          if (!loc.baseRefId) continue;
          if (nextBase.has(loc.baseRefId)) rekey.set(loc.id, loc.baseRefId);
          else rekey.set(loc.baseRefId, loc.id);
        }
        if (rekey.size) {
          const to = id => rekey.get(id) || id;
          spatial.relations = spatial.relations
            .map(rel => ({ ...rel, fromId: to(rel.fromId), toId: to(rel.toId) }))
            .filter(rel => rel.fromId !== rel.toId);
          for (const route of spatial.routes) {
            route.endpoints = uniqueStrings((route.endpoints || []).map(to), 8, 120);
            route.waypoints = uniqueStrings((route.waypoints || []).map(to), 32, 120);
          }
        }
      }
      applied.push({ action: 'set_base_map_ref' });
      continue;
    }

    if (action === 'upsert_location') {
      const name = boundedText(proposal.name, SPATIAL_LIMITS.nameChars);
      if (!name) {
        rejected.push({ proposal, reason: 'location name is required' });
        continue;
      }

      // Resolve direct stored campaign IDs first (including overrideId), then
      // fall back to the effective/base projection used by automatic capture.
      const targetId = boundedText(proposal.locationId, 120);
      let existingLoc = null;
      let isBaseLoc = false;

      if (targetId) {
        existingLoc = spatial.locations.find(l => l.id === targetId) || null;
        if (!existingLoc && effectiveById.has(targetId)) {
          const eff = effectiveById.get(targetId);
          if (eff.isBase && !eff.overrideId) {
            isBaseLoc = true;
            existingLoc = eff;
          } else {
            existingLoc = spatial.locations.find(l => l.id === (eff.overrideId || eff.id)) || null;
          }
        }
      }

      if (targetId && !existingLoc) {
        rejected.push({ proposal, reason: 'locationId does not reference a visible existing location' });
        continue;
      }

      if (!existingLoc && !targetId) {
        // Name consolidation for duplicates (punctuation-folded, as capture matches names).
        const normName = placeNameKey(name);
        const existingCandidate = spatial.locations.find(l => l.status === 'active' && storedNameKey(l) === normName);
        if (existingCandidate) {
          existingLoc = existingCandidate;
        }
      }

      // Provider-authored narrative work (capture or rebuild) must NOT mutate a base location without explicit manual override
      if (isBaseLoc && automaticNarrative) {
        rejected.push({ proposal, reason: 'provider narrative cannot mutate base canonical location' });
        continue;
      }

      if (existingLoc && !isBaseLoc) {
        // Update existing campaign location.
        const priorCoord = existingLoc.coordinate;
        const proposedCoord = proposal.coordinate && typeof proposal.coordinate === 'object'
          ? normalizeCoordinate(proposal.coordinate)
          : null;

        if (proposedCoord) {
          const proposedKnown = Number.isFinite(proposedCoord.x) && Number.isFinite(proposedCoord.y);
          if (automaticNarrative) {
            // Provider narration may refine a coordinate only when it has an actual
            // grounded coordinate pair. Unknown/null proposals never erase state.
            if (proposedKnown) {
              const priorRank = authorityRank(priorCoord.authority, priorCoord.locked);
              const proposedRank = authorityRank(proposedCoord.authority, proposedCoord.locked);
              // Authority protects a position; a place with none (a position-less override included) may get one.
              const priorKnown = Number.isFinite(priorCoord.x) && Number.isFinite(priorCoord.y);
              const samePosition = priorKnown && priorCoord.x === proposedCoord.x && priorCoord.y === proposedCoord.y;

              if (samePosition) {
                // A confirmation of the same position (a locked one included) only adds evidence and metadata:
                // the stronger authority stays.
                if (!priorCoord.locked && proposedRank > priorRank) existingLoc.coordinate = proposedCoord;
              } else if (priorKnown && priorCoord.locked && !proposedCoord.locked) {
                rejected.push({ proposal, reason: 'cannot overwrite locked coordinate' });
                continue;
              } else if (priorKnown && priorRank > proposedRank) {
                rejected.push({ proposal, reason: `cannot overwrite coordinate with lower authority (${proposedCoord.authority} < ${priorCoord.authority})` });
                continue;
              } else {
                existingLoc.coordinate = proposedCoord;
              }
            }
          } else {
            // Manual/operator edits may explicitly clear X/Y.
            existingLoc.coordinate = proposedCoord;
          }
        }

        const hasManualEvidence = existingLoc.operatorOwned === true || (existingLoc.evidenceIds || [])
          .some(id => ownEntry(spatial.evidence, id)?.sourceClass === 'manual');
        const preserveManualMetadata = automaticNarrative && hasManualEvidence;

        // Provider narration may add route associations and improve coordinate
        // certainty, but must not casually rewrite operator-authored metadata.
        if (!preserveManualMetadata) {
          existingLoc.name = name;
          if (Object.hasOwn(proposal, 'type') && boundedText(proposal.type, SPATIAL_LIMITS.typeChars)) {
            existingLoc.type = boundedText(proposal.type, SPATIAL_LIMITS.typeChars);
          }
          if (Object.hasOwn(proposal, 'context')) {
            existingLoc.context = boundedText(proposal.context, SPATIAL_LIMITS.contextChars);
          }
          if (Object.hasOwn(proposal, 'notes')) {
            existingLoc.notes = boundedText(proposal.notes, SPATIAL_LIMITS.notesChars);
          }
        }
        if (Array.isArray(proposal.routeRefs)) {
          const incoming = uniqueStrings(proposal.routeRefs, SPATIAL_LIMITS.routeRefsPerLocation, 120);
          existingLoc.routeRefs = automaticNarrative
            ? uniqueStrings([...existingLoc.routeRefs, ...incoming], SPATIAL_LIMITS.routeRefsPerLocation, 120)
            : incoming;
        }
        if (proposal.status && SPATIAL_LOCATION_STATUSES.includes(proposal.status)) {
          existingLoc.status = proposal.status;
        }

        addSpatialEvidence(spatial, existingLoc, proposal, context, chatKey, evidenceCounter);
        existingLoc.lastChangedMessage = context.messageId;
        applied.push({ action: 'update_location', locationId: existingLoc.id });
        continue;
      }

      // A base place changes only through an explicit override: a plain upsert at its id would otherwise create a
      // campaign place under the base id that shadows it.
      if (isBaseLoc && !proposal.createOverride) {
        rejected.push({ proposal, reason: 'a base-map place is changed only through an override (createOverride)' });
        continue;
      }

      // If manual create override of a base location
      if (isBaseLoc && proposal.createOverride) {
        if (spatial.locations.length >= SPATIAL_LIMITS.maxLocations) {
          rejected.push({ proposal, reason: 'campaign spatial location limit reached' });
          continue;
        }
        // Like a new place: two same-named base places overridden at one chat head must not share an id.
        let id = locationIdFor(chatKey, context, index, name);
        for (let salt = 1; spatial.locations.some(loc => loc.id === id); salt += 1) id = locationIdFor(chatKey, context, index, name, salt);
        const overrideLoc = normalizeSpatialLocation({
          id,
          name,
          type: proposal.type || existingLoc.type,
          status: 'active',
          baseRefId: existingLoc.id,
          coordinate: proposal.coordinate
            ? { ...normalizeCoordinate(proposal.coordinate), authority: 'campaign_override' }
            : { ...existingLoc.coordinate, authority: 'campaign_override', locked: false },
          context: proposal.context !== undefined ? proposal.context : existingLoc.context,
          routeRefs: proposal.routeRefs || existingLoc.routeRefs,
          createdAtMessage: context.messageId,
          lastChangedMessage: context.messageId,
          evidenceIds: [],
          notes: proposal.notes || '',
        });
        spatial.locations.push(overrideLoc);
        addSpatialEvidence(spatial, overrideLoc, proposal, context, chatKey, evidenceCounter);
        applied.push({ action: 'create_override', locationId: id, baseRefId: existingLoc.id });
        continue;
      }

      // Create new campaign location
      if (spatial.locations.length >= SPATIAL_LIMITS.maxLocations) {
        rejected.push({ proposal, reason: 'campaign spatial location limit reached' });
        continue;
      }
      // The same name at the same chat head (re-adding an archived place, or two names sharing their first
      // 40 characters) would reuse an id already stored, and normalization would drop the new place.
      let id = targetId || locationIdFor(chatKey, context, index, name);
      for (let salt = 1; !targetId && spatial.locations.some(loc => loc.id === id); salt += 1) {
        id = locationIdFor(chatKey, context, index, name, salt);
      }
      const coord = proposal.coordinate ? normalizeCoordinate(proposal.coordinate) : { x: null, y: null, authority: 'unknown', locked: false };

      const newLoc = normalizeSpatialLocation({
        id,
        name,
        type: proposal.type || 'landmark',
        status: 'active',
        baseRefId: null,
        coordinate: coord,
        context: proposal.context || '',
        routeRefs: proposal.routeRefs || [],
        createdAtMessage: context.messageId,
        lastChangedMessage: context.messageId,
        evidenceIds: [],
        notes: proposal.notes || '',
      });

      spatial.locations.push(newLoc);
      addSpatialEvidence(spatial, newLoc, proposal, context, chatKey, evidenceCounter);
      applied.push({ action: 'create_location', locationId: id });
      continue;
    }

    if (action === 'archive_location') {
      const targetId = boundedText(proposal.locationId, 120);
      const loc = spatial.locations.find(l => l.id === targetId);
      if (loc) {
        loc.status = 'archived';
        loc.lastChangedMessage = context.messageId;
        // An operator's archive is operator intent: recorded with its evidence and kept by a rebuild that
        // re-extracts Places (the model's copy of the place does not come back).
        if (!automaticNarrative) {
          addEntitySpatialEvidence(spatial, loc, [loc.id], proposal, context, chatKey, evidenceCounter);
          loc.operatorOwned = true;
        }
        applied.push({ action: 'archive_location', locationId: targetId });
      } else {
        rejected.push({ proposal, reason: 'location not found for archive' });
      }
      continue;
    }

    if (action === 'delete_location') {
      const targetId = boundedText(proposal.locationId, 120);
      const idx = spatial.locations.findIndex(l => l.id === targetId);
      if (idx >= 0) {
        spatial.locations.splice(idx, 1);
        spatial.relations = spatial.relations.filter(rel => rel.fromId !== targetId && rel.toId !== targetId);
        for (const route of spatial.routes) {
          route.endpoints = (route.endpoints || []).filter(id => id !== targetId);
          route.waypoints = (route.waypoints || []).filter(id => id !== targetId);
        }
        applied.push({ action: 'delete_location', locationId: targetId });
      } else {
        rejected.push({ proposal, reason: 'location not found for delete' });
      }
      continue;
    }

    if (action === 'merge_locations') {
      const sourceId = boundedText(proposal.sourceId, 120);
      const targetId = boundedText(proposal.targetId, 120);
      const sourceLoc = spatial.locations.find(l => l.id === sourceId);
      const targetLoc = spatial.locations.find(l => l.id === targetId);
      if (targetLoc && targetLoc.status !== 'active') {
        rejected.push({ proposal, reason: 'cannot merge into an archived place' });
        continue;
      }
      if (sourceLoc && targetLoc && sourceId !== targetId) {
        targetLoc.routeRefs = uniqueStrings([...targetLoc.routeRefs, ...sourceLoc.routeRefs], SPATIAL_LIMITS.routeRefsPerLocation, 120);
        targetLoc.evidenceIds = boundedEvidenceRefs([...targetLoc.evidenceIds, ...sourceLoc.evidenceIds]);
        if (!targetLoc.context && sourceLoc.context) targetLoc.context = sourceLoc.context;
        if (!targetLoc.notes && sourceLoc.notes) targetLoc.notes = sourceLoc.notes;
        // Operator authority survives the merge even when the source's manual evidence is trimmed.
        if (sourceLoc.operatorOwned === true) targetLoc.operatorOwned = true;

        const targetRank = authorityRank(targetLoc.coordinate?.authority, targetLoc.coordinate?.locked);
        const sourceRank = authorityRank(sourceLoc.coordinate?.authority, sourceLoc.coordinate?.locked);
        const targetKnown = Number.isFinite(targetLoc.coordinate?.x) && Number.isFinite(targetLoc.coordinate?.y);
        const sourceKnown = Number.isFinite(sourceLoc.coordinate?.x) && Number.isFinite(sourceLoc.coordinate?.y);
        if (sourceKnown && (!targetKnown || (!targetLoc.coordinate?.locked && sourceRank > targetRank))) {
          targetLoc.coordinate = normalizeCoordinate(sourceLoc.coordinate);
        }

        // Relations and routes point at effective ids (an override is addressed by the base id it
        // shadows): move every id the source answers to onto the id the target answers to.
        const sourceIds = new Set([sourceId, sourceLoc.baseRefId].filter(Boolean));
        const targetEffectiveId = effectiveLocationId(targetLoc, baseMap, spatial);
        // The target's own stored and base ids join its effective id too, so its relations never split.
        const targetIds = new Set([targetId, targetLoc.baseRefId].filter(Boolean));
        const moveId = id => (sourceIds.has(id) || targetIds.has(id) ? targetEffectiveId : id);
        const rewritten = [];
        const relSeen = new Map();
        for (const rel of spatial.relations) {
          const nextRel = {
            ...rel,
            fromId: moveId(rel.fromId),
            toId: moveId(rel.toId),
          };
          if (nextRel.fromId === nextRel.toId) continue;
          const sig = [nextRel.fromId, nextRel.toId, nextRel.direction || '', nextRel.distanceKm ?? '', nextRel.distanceMode || ''].join('|');
          const kept = relSeen.get(sig);
          if (kept) {
            // A dropped duplicate's operator authority and evidence move to the relation that is kept, so the
            // compaction below never drops the support it was accepted on.
            if (nextRel.operatorOwned === true) kept.operatorOwned = true;
            kept.evidenceIds = boundedEvidenceRefs([...(kept.evidenceIds || []), ...(nextRel.evidenceIds || [])]);
            continue;
          }
          relSeen.set(sig, nextRel);
          rewritten.push(nextRel);
        }
        spatial.relations = rewritten;

        for (const route of spatial.routes) {
          route.endpoints = uniqueStrings((route.endpoints || []).map(moveId), 8, 120);
          route.waypoints = uniqueStrings((route.waypoints || []).map(moveId), 32, 120);
        }

        sourceLoc.status = 'archived';
        sourceLoc.mergedInto = targetId;
        sourceLoc.lastChangedMessage = context.messageId;
        targetLoc.lastChangedMessage = context.messageId;
        // An operator's merge is operator intent on both places: a rebuild keeps the merged-away name pointing
        // at the place it was merged into instead of re-creating the duplicate.
        if (!automaticNarrative) {
          addEntitySpatialEvidence(spatial, targetLoc, [targetLoc.id, sourceLoc.id], proposal, context, chatKey, evidenceCounter);
          sourceLoc.operatorOwned = true;
          targetLoc.operatorOwned = true;
        }
        applied.push({ action: 'merge_locations', sourceId, targetId });
      } else {
        rejected.push({ proposal, reason: 'source or target location not found for merge' });
      }
      continue;
    }

    if (action === 'upsert_relation') {
      const fromId = boundedText(proposal.fromId, 120);
      const toId = boundedText(proposal.toId, 120);
      if (!fromId || !toId) {
        rejected.push({ proposal, reason: 'relation fromId and toId are required' });
        continue;
      }
      if (fromId === toId) {
        rejected.push({ proposal, reason: 'spatial relation cannot point to the same location' });
        continue;
      }

      const direction = proposal.direction ? canonicalSpatialDirection(proposal.direction) : null;
      const profile = resolveSpatialProfile(spatial, baseMap);
      // Where the places are now (an override created or moved earlier in this batch included), not where the
      // visible projection saw them before the reply.
      const fromCoord = currentCoordinateFor(fromId, effectiveById, spatial, campaignByEffectiveId());
      const toCoord = currentCoordinateFor(toId, effectiveById, spatial, campaignByEffectiveId());
      // Only a compass point can contradict a coordinate delta: a free-text direction ("upriver") is kept.
      if (direction && OPPOSITE_DIRECTION[direction]
        && profile?.trueNorthLocked === true
        && Number.isFinite(fromCoord?.x) && Number.isFinite(fromCoord?.y)
        && Number.isFinite(toCoord?.x) && Number.isFinite(toCoord?.y)) {
        const actual = directionFromDelta(
          toCoord.x - fromCoord.x,
          toCoord.y - fromCoord.y,
          profile,
        );
        if (actual && canonicalSpatialDirection(actual) !== direction) {
          rejected.push({ proposal, reason: 'relation direction conflicts with authoritative coordinate delta under locked True North' });
          continue;
        }
      }

      const id = boundedText(proposal.relationId, 140) || relationIdFor(chatKey, fromId, toId, context);
      // A relation id names that relation only between its own places (either way round): one between other
      // places is never overwritten through it.
      const byId = spatial.relations.find(r => r.id === id);
      const reversedById = Boolean(byId && byId.fromId === toId && byId.toId === fromId);
      if (byId && !reversedById && !(byId.fromId === fromId && byId.toId === toId)) {
        rejected.push({ proposal, reason: 'relationId names a relation between other places' });
        continue;
      }
      let existingRel = byId || spatial.relations.find(r => r.fromId === fromId && r.toId === toId) || null;
      // A relation addressed from its other side is read from its own side: the opposite compass point (a
      // free-text direction has none, so it does not overwrite the stored one).
      let stated = reversedById ? (direction && OPPOSITE_DIRECTION[direction]) || null : direction;
      if (!existingRel && (!direction || OPPOSITE_DIRECTION[direction])) {
        // The same pair stated the other way round ("Oakvale lies west of Millbrook" for Millbrook east of
        // Oakvale) is that relation, read from its own side: never a second, possibly contradictory one.
        // A free-text direction has no opposite, so it stays a relation of its own rather than being lost.
        existingRel = spatial.relations.find(r => r.fromId === toId && r.toId === fromId) || null;
        if (existingRel && direction) stated = OPPOSITE_DIRECTION[direction];
      }

      if (existingRel) {
        const hasManualEvidence = existingRel.operatorOwned === true || (existingRel.evidenceIds || [])
          .some(evidenceId => ownEntry(spatial.evidence, evidenceId)?.sourceClass === 'manual');
        const preserveManualRelation = automaticNarrative && hasManualEvidence;
        if (!preserveManualRelation) {
          if (stated) existingRel.direction = stated;
          if (Number.isFinite(proposal.distanceKm)) {
            // Narration restating the same distance without qualifying it never decays an established mode.
            const restated = automaticNarrative && proposal.distanceMode === 'unspecified' && existingRel.distanceKm === proposal.distanceKm;
            existingRel.distanceKm = proposal.distanceKm;
            if (proposal.distanceMode && !restated) existingRel.distanceMode = proposal.distanceMode;
          } else if (proposal.distanceMode && !automaticNarrative) {
            existingRel.distanceMode = proposal.distanceMode;
          }
          // A narrated mention without a distance never relabels the stored distance's mode
          // (a road distance must not turn into an unqualified, straight-line-looking one).
          if (proposal.notes) existingRel.notes = boundedText(proposal.notes, SPATIAL_LIMITS.notesChars);
        }
        addEntitySpatialEvidence(spatial, existingRel, [fromId, toId], proposal, context, chatKey, evidenceCounter);
        applied.push({ action: 'update_relation', relationId: existingRel.id });
      } else {
        const rel = normalizeSpatialRelation({
          id,
          fromId,
          toId,
          direction,
          distanceKm: proposal.distanceKm ?? null,
          distanceMode: proposal.distanceMode || 'unspecified',
          notes: proposal.notes || '',
          evidenceIds: [],
        });
        spatial.relations.push(rel);
        addEntitySpatialEvidence(spatial, rel, [fromId, toId], proposal, context, chatKey, evidenceCounter);
        applied.push({ action: 'create_relation', relationId: id });
      }
      continue;
    }

    if (action === 'delete_relation') {
      const relationId = boundedText(proposal.relationId, 140);
      const fromId = boundedText(proposal.fromId, 120);
      const toId = boundedText(proposal.toId, 120);
      const beforeCount = spatial.relations.length;
      spatial.relations = spatial.relations.filter(rel => {
        if (relationId && rel.id === relationId) return false;
        if (!relationId && fromId && toId && rel.fromId === fromId && rel.toId === toId) return false;
        return true;
      });
      if (spatial.relations.length < beforeCount) {
        applied.push({ action: 'delete_relation', relationId: relationId || null, fromId, toId });
      } else {
        rejected.push({ proposal, reason: 'relation not found for delete' });
      }
      continue;
    }

    if (action === 'upsert_route') {
      const name = boundedText(proposal.name, SPATIAL_LIMITS.nameChars);
      if (!name) {
        rejected.push({ proposal, reason: 'route name is required' });
        continue;
      }
      const id = boundedText(proposal.routeId, 140) || routeIdFor(chatKey, name, context);
      // Names fold like place names ("North-Road" is "North Road").
      let existingRt = spatial.routes.find(r => r.id === id || placeNameKey(r.name) === placeNameKey(name));

      if (existingRt) {
        const hasManualEvidence = existingRt.operatorOwned === true || (existingRt.evidenceIds || [])
          .some(evidenceId => ownEntry(spatial.evidence, evidenceId)?.sourceClass === 'manual');
        const preserveManualRoute = automaticNarrative && hasManualEvidence;
        if (!preserveManualRoute) {
          if (proposal.type) existingRt.type = boundedText(proposal.type, SPATIAL_LIMITS.typeChars);
          if (Array.isArray(proposal.endpoints)) existingRt.endpoints = uniqueStrings(proposal.endpoints, 8, 120);
          if (Array.isArray(proposal.waypoints)) existingRt.waypoints = uniqueStrings(proposal.waypoints, 32, 120);
          if (proposal.context) existingRt.context = boundedText(proposal.context, SPATIAL_LIMITS.contextChars);
        }
        addEntitySpatialEvidence(spatial, existingRt, existingRt.endpoints || [], proposal, context, chatKey, evidenceCounter);
        applied.push({ action: 'update_route', routeId: existingRt.id });
      } else {
        const rt = normalizeSpatialRoute({
          id,
          name,
          type: proposal.type || (automaticNarrative ? 'route' : 'road'),
          endpoints: proposal.endpoints || [],
          waypoints: proposal.waypoints || [],
          context: proposal.context || '',
          evidenceIds: [],
        });
        spatial.routes.push(rt);
        addEntitySpatialEvidence(spatial, rt, rt.endpoints || [], proposal, context, chatKey, evidenceCounter);
        applied.push({ action: 'create_route', routeId: id });
      }
      continue;
    }

    rejected.push({ proposal, reason: `unsupported spatial action: ${action}` });
  }

  // A place that moved under a locked True North must not keep a stored compass direction its new
  // coordinates contradict. An automatic move that contradicts an operator-authored relation is undone
  // (the operator's direction stands); any other contradicted direction is cleared, its distance kept.
  const lockedProfile = resolveSpatialProfile(spatial, baseMap);
  if (lockedProfile?.trueNorthLocked === true && spatial.relations.length) {
    // A new override of a base place moves it from the base coordinate.
    const priorCoordinateOf = loc => (beforeById.has(loc.id) ? normalizeCoordinate(beforeById.get(loc.id).coordinate) : null)
      || (loc.baseRefId ? effectiveById.get(loc.baseRefId)?.coordinate : null);
    // Only a place this pass changed can have moved (the actions name it): no pass over every place.
    const touchedIds = new Set(applied.flatMap(item => [item.locationId, item.targetId]).filter(Boolean));
    const movedLocations = new Map();
    for (const loc of spatial.locations) {
      if (!touchedIds.has(loc.id)) continue;
      const prior = priorCoordinateOf(loc);
      if (!prior) continue;
      if (prior.x !== loc.coordinate?.x || prior.y !== loc.coordinate?.y) movedLocations.set(effectiveLocationId(loc, baseMap, spatial), loc);
    }
    // One lookup of the places as they stand after every action of this pass.
    campaignIndex = null;
    const coordinateOf = id => campaignByEffectiveId().get(id)?.coordinate || effectiveCoordinateFor(id, effectiveById, spatial);
    const contradicted = rel => {
      const direction = canonicalSpatialDirection(rel.direction);
      if (!OPPOSITE_DIRECTION[direction] || (!movedLocations.has(rel.fromId) && !movedLocations.has(rel.toId))) return false;
      const fromCoord = coordinateOf(rel.fromId);
      const toCoord = coordinateOf(rel.toId);
      if (!Number.isFinite(fromCoord?.x) || !Number.isFinite(fromCoord?.y)
        || !Number.isFinite(toCoord?.x) || !Number.isFinite(toCoord?.y)) return false;
      const actual = directionFromDelta(toCoord.x - fromCoord.x, toCoord.y - fromCoord.y, lockedProfile);
      return Boolean(actual) && canonicalSpatialDirection(actual) !== direction;
    };
    const operatorRelation = rel => rel.operatorOwned === true
      || (rel.evidenceIds || []).some(id => ownEntry(spatial.evidence, id)?.sourceClass === 'manual');
    if (automaticNarrative) {
      for (const rel of spatial.relations) {
        if (!operatorRelation(rel) || !contradicted(rel)) continue;
        for (const endpoint of [rel.fromId, rel.toId]) {
          const loc = movedLocations.get(endpoint);
          if (!loc) continue;
          loc.coordinate = clone(priorCoordinateOf(loc));
          movedLocations.delete(endpoint);
          rejected.push({ proposal: { action: 'upsert_location', locationId: loc.id }, reason: 'coordinate move contradicts an operator-authored relation direction' });
        }
      }
    }
    for (const rel of spatial.relations) {
      if (!rel.direction || !contradicted(rel)) continue;
      rel.direction = null;
      applied.push({ action: 'clear_relation_direction', relationId: rel.id });
    }
  }

  compactSpatialEvidence(spatial);

  if (context.operation === 'capture' && applied.length > 0) {
    spatial.lastCaptureMessage = context.messageId;
  }

  const changedStoredLocationIds = new Set();
  const changedRelationIds = new Set();
  const removedRelationIds = new Set();
  const changedRouteIds = new Set();

  for (const item of applied) {
    if (item.locationId) changedStoredLocationIds.add(item.locationId);
    if (item.baseRefId) changedStoredLocationIds.add(item.baseRefId);
    if (item.sourceId) changedStoredLocationIds.add(item.sourceId);
    if (item.targetId) changedStoredLocationIds.add(item.targetId);
    if (item.relationId) {
      if (item.action === 'delete_relation') removedRelationIds.add(item.relationId);
      else changedRelationIds.add(item.relationId);
    }
    if (item.routeId) changedRouteIds.add(item.routeId);
  }

  const beforeCampaignById = beforeById;
  const afterCampaignById = new Map((spatial.locations || []).map(loc => [loc.id, loc]));
  const changedEffectiveIds = new Set();

  for (const storedId of changedStoredLocationIds) {
    const afterLoc = afterCampaignById.get(storedId);
    const beforeLoc = beforeCampaignById.get(storedId);
    // Keyed exactly as resolveEffectiveLocations keys the place, so the index delta matches the resolved list.
    const resolvedKey = loc => (loc.baseRefId && baseMap && Array.isArray(baseMap.locations) && baseLocationIndex(baseMap).has(loc.baseRefId)
      ? loc.baseRefId
      : loc.id);
    const effectiveId = afterLoc ? resolvedKey(afterLoc) : beforeLoc ? resolvedKey(beforeLoc) : storedId;
    if (effectiveId) changedEffectiveIds.add(effectiveId);
  }
  // Only the changed places are resolved; an empty batch touches no base entry.
  const finalEffectiveById = new Map(resolveEffectiveLocations(spatial, baseMap, { onlyIds: changedEffectiveIds }).map(loc => [loc.id, loc]));

  const upsertedLocations = [];
  const removedLocationIds = [];
  for (const effectiveId of changedEffectiveIds) {
    const current = finalEffectiveById.get(effectiveId);
    if (current) upsertedLocations.push(clone(current));
    else removedLocationIds.push(effectiveId);
  }

  const relationById = new Map((spatial.relations || []).map(rel => [rel.id, rel]));
  const upsertedRelations = [...changedRelationIds]
    .map(id => relationById.get(id))
    .filter(Boolean)
    .map(clone);

  const routeById = new Map((spatial.routes || []).map(route => [route.id, route]));
  const upsertedRoutes = [...changedRouteIds]
    .map(id => routeById.get(id))
    .filter(Boolean)
    .map(clone);

  return {
    spatial,
    applied,
    rejected,
    indexDelta: {
      changedLocationIds: [...changedEffectiveIds],
      upsertedLocations,
      removedLocationIds,
      upsertedRelations,
      removedRelationIds: [...removedRelationIds],
      upsertedRoutes,
      removedRouteIds: [],
    },
  };
}

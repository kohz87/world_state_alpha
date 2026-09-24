import { SPATIAL_LIMITS } from './constants.js';
import { deterministicId, hashText, stableStringify } from './hash.js';
import {
  normalizeCoordinate,
  normalizeSpatialLocation,
  normalizeSpatialProfile,
  normalizeSpatialRoute,
} from './spatial-core.js';

function boundedText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeBaseCoordinate(item) {
  if (item?.coordinate && typeof item.coordinate === 'object' && !Array.isArray(item.coordinate)) {
    return normalizeCoordinate(item.coordinate);
  }
  if (Array.isArray(item?.coord) && item.coord.length >= 2) {
    return normalizeCoordinate({ x: Number(item.coord[0]), y: Number(item.coord[1]) });
  }
  return normalizeCoordinate(null);
}

export function parseBaseMap(rawInput) {
  let raw = rawInput;
  if (typeof rawInput === 'string') {
    try {
      raw = JSON.parse(rawInput);
    } catch (error) {
      throw new Error(`invalid base map JSON: ${error.message}`);
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('base map payload must be an object');
  }

  const name = boundedText(raw.name, SPATIAL_LIMITS.nameChars) || 'Base Map';
  const version = boundedText(raw.version, 40);
  const id = boundedText(raw.id, 120) || deterministicId('bmap', [name]);
  const profile = raw.profile && typeof raw.profile === 'object'
    ? normalizeSpatialProfile(raw.profile, { strict: true })
    : null;

  const locations = [];
  for (let index = 0; index < (Array.isArray(raw.locations) ? raw.locations : []).length; index += 1) {
    const item = raw.locations[index];
    if (!item || typeof item !== 'object') continue;

    const locName = boundedText(item.name, SPATIAL_LIMITS.nameChars);
    if (!locName) continue;

    const locId = boundedText(item.id, 120) || deterministicId('bloc', [id, locName]);
    const coordinate = normalizeBaseCoordinate(item);
    const hasCoordinate = Number.isFinite(coordinate.x) && Number.isFinite(coordinate.y);
    coordinate.authority = hasCoordinate ? 'base_canonical' : 'unknown';
    coordinate.locked = hasCoordinate;

    locations.push(normalizeSpatialLocation({
      ...item,
      id: locId,
      name: locName,
      type: boundedText(item.type, SPATIAL_LIMITS.typeChars) || 'landmark',
      status: 'active',
      baseRefId: null,
      coordinate,
      context: boundedText(item.context, SPATIAL_LIMITS.contextChars),
      routeRefs: Array.isArray(item.routeRefs) ? item.routeRefs : [],
      createdAtMessage: null,
      lastChangedMessage: null,
      evidenceIds: [],
    }, { strict: true }));
  }

  const locationIds = new Set();
  for (const location of locations) {
    if (locationIds.has(location.id)) {
      throw new Error(`duplicate base-map location id: ${location.id}`);
    }
    locationIds.add(location.id);
  }
  const routes = [];
  const routeIds = new Set();
  for (let index = 0; index < (Array.isArray(raw.routes) ? raw.routes : []).length; index += 1) {
    const item = raw.routes[index];
    if (!item || typeof item !== 'object') continue;

    const routeName = boundedText(item.name, SPATIAL_LIMITS.nameChars);
    if (!routeName) continue;

    const routeId = boundedText(item.id, 120) || deterministicId('brt', [id, routeName]);
    const endpoints = Array.isArray(item.endpoints)
      ? item.endpoints.filter(value => locationIds.has(String(value || '').trim()))
      : [];
    const waypoints = Array.isArray(item.waypoints)
      ? item.waypoints.filter(value => locationIds.has(String(value || '').trim()))
      : [];

    if (routeIds.has(routeId)) throw new Error(`duplicate base-map route id: ${routeId}`);
    routeIds.add(routeId);

    routes.push(normalizeSpatialRoute({
      ...item,
      id: routeId,
      name: routeName,
      type: boundedText(item.type, SPATIAL_LIMITS.typeChars) || 'corridor',
      endpoints,
      waypoints,
      context: boundedText(item.context, SPATIAL_LIMITS.contextChars),
      evidenceIds: [],
    }, { strict: true }));
  }

  const digest = hashText(stableStringify({ id, name, version, profile, locations, routes }));

  return Object.freeze({
    id,
    name,
    version,
    digest,
    profile,
    locations: Object.freeze(locations),
    routes: Object.freeze(routes),
  });
}

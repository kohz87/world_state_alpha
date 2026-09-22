import { SPATIAL_LIMITS } from './constants.js';
import { deterministicId, hashText, stableStringify } from './hash.js';
import {
  normalizeCoordinate,
  normalizeSpatialLocation,
  normalizeSpatialProfile,
  normalizeSpatialRoute,
} from './spatial-core.js';

const TERNIA_DEFAULT_BOUNDS = Object.freeze({ xMin: -500, xMax: 500, yMin: -500, yMax: 500 });

function boundedText(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeAxis(axis, fallback) {
  const clean = boundedText(axis, 10).toLowerCase();
  if (clean === '+y' || clean === '-y' || clean === '+x' || clean === '-x') return clean;
  return fallback;
}

function extractCoord(item) {
  if (!item || typeof item !== 'object') return { x: null, y: null };
  if (Array.isArray(item.coord) && item.coord.length >= 2) {
    const x = Number(item.coord[0]);
    const y = Number(item.coord[1]);
    return { x: Number.isFinite(x) ? x : null, y: Number.isFinite(y) ? y : null };
  }
  if (Array.isArray(item.center) && item.center.length >= 2) {
    const x = Number(item.center[0]);
    const y = Number(item.center[1]);
    return { x: Number.isFinite(x) ? x : null, y: Number.isFinite(y) ? y : null };
  }
  if (Array.isArray(item.coordinate) && item.coordinate.length >= 2) {
    const x = Number(item.coordinate[0]);
    const y = Number(item.coordinate[1]);
    return { x: Number.isFinite(x) ? x : null, y: Number.isFinite(y) ? y : null };
  }
  if (item.coordinate && typeof item.coordinate === 'object') {
    const x = Number(item.coordinate.x);
    const y = Number(item.coordinate.y);
    return { x: Number.isFinite(x) ? x : null, y: Number.isFinite(y) ? y : null };
  }
  return { x: null, y: null };
}

function parseBounds(rawBounds, fallback = null) {
  if (!rawBounds || typeof rawBounds !== 'object') {
    return fallback ? { ...fallback } : null;
  }

  let xMin = null;
  let xMax = null;
  let yMin = null;
  let yMax = null;

  if (Array.isArray(rawBounds.x) && rawBounds.x.length >= 2) {
    xMin = Number(rawBounds.x[0]);
    xMax = Number(rawBounds.x[1]);
  } else {
    const rawXMin = rawBounds.x_min ?? rawBounds.xMin;
    const rawXMax = rawBounds.x_max ?? rawBounds.xMax;
    if (Number.isFinite(Number(rawXMin)) && Number.isFinite(Number(rawXMax))) {
      xMin = Number(rawXMin);
      xMax = Number(rawXMax);
    }
  }

  if (Array.isArray(rawBounds.y) && rawBounds.y.length >= 2) {
    yMin = Number(rawBounds.y[0]);
    yMax = Number(rawBounds.y[1]);
  } else {
    const rawYMin = rawBounds.y_min ?? rawBounds.yMin;
    const rawYMax = rawBounds.y_max ?? rawBounds.yMax;
    if (Number.isFinite(Number(rawYMin)) && Number.isFinite(Number(rawYMax))) {
      yMin = Number(rawYMin);
      yMax = Number(rawYMax);
    }
  }

  if ([xMin, xMax, yMin, yMax].every(Number.isFinite) && xMin <= xMax && yMin <= yMax) {
    return { xMin, xMax, yMin, yMax };
  }
  return fallback ? { ...fallback } : null;
}

function coordMatches(c1, c2, tolerance = 0.01) {
  if (!c1 || !c2 || !Number.isFinite(c1.x) || !Number.isFinite(c1.y) || !Number.isFinite(c2.x) || !Number.isFinite(c2.y)) return false;
  return Math.abs(c1.x - c2.x) <= tolerance && Math.abs(c1.y - c2.y) <= tolerance;
}

export function parseTerniaBaseMap(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Ternia base map must be an object');

  const name = boundedText(raw.world || raw.name, SPATIAL_LIMITS.nameChars) || 'Ternia';
  const version = boundedText(raw.version, 40) || '0.9.10';
  const id = boundedText(raw.id, 120) || deterministicId('bmap_ternia', [name, version]);

  const coordSys = raw.coordinate_system && typeof raw.coordinate_system === 'object'
    ? raw.coordinate_system
    : {};

  const northAxis = normalizeAxis(coordSys.north || coordSys.north_axis || coordSys.northAxis, '+y');
  const eastAxis = normalizeAxis(coordSys.east || coordSys.east_axis || coordSys.eastAxis, '+x');
  const unitKm = Number(coordSys.unit_km ?? coordSys.unitKm) || 5;
  const bounds = parseBounds(coordSys.bounds, TERNIA_DEFAULT_BOUNDS);
  const decimalStep = Number(coordSys.decimal_step ?? coordSys.decimalStep) || 0.1;
  const trueNorthLocked = coordSys.true_north_lock !== false
    && coordSys.true_north_locked !== false
    && coordSys.trueNorthLocked !== false;

  const profile = normalizeSpatialProfile({
    system: 'cartesian2d',
    northAxis,
    eastAxis,
    unitKm,
    bounds,
    decimalStep,
    trueNorthLocked,
  });

  // Parse major routes first so we can associate route anchors with locations
  const routes = [];
  const routeAnchorMap = new Map(); // routeName -> array of {x, y}

  if (Array.isArray(raw.major_routes)) {
    for (let index = 0; index < raw.major_routes.length; index += 1) {
      const item = raw.major_routes[index];
      if (!item || typeof item !== 'object') continue;
      const rtName = boundedText(item.name, SPATIAL_LIMITS.nameChars);
      if (!rtName) continue;
      const rtId = boundedText(item.id, 120) || deterministicId('brt', [id, rtName, index]);
      const anchorsList = [];
      if (Array.isArray(item.anchors)) {
        for (const pt of item.anchors) {
          if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
            anchorsList.push({ x: Number(pt[0]), y: Number(pt[1]) });
          }
        }
      }
      routeAnchorMap.set(rtName, anchorsList);

      const normRoute = normalizeSpatialRoute({
        id: rtId,
        name: rtName,
        type: boundedText(item.mode, SPATIAL_LIMITS.typeChars) || 'land',
        endpoints: [],
        waypoints: [],
        context: boundedText(item.role || item.context || item.description, SPATIAL_LIMITS.contextChars),
        evidenceIds: [],
      });
      routes.push(normRoute);
    }
  } else if (raw.major_routes && typeof raw.major_routes === 'object') {
    let index = 0;
    for (const [rtName, path] of Object.entries(raw.major_routes)) {
      const cleanName = boundedText(rtName, SPATIAL_LIMITS.nameChars);
      if (!cleanName) continue;
      const rtId = deterministicId('brt', [id, cleanName, index++]);
      const anchorsList = [];
      if (Array.isArray(path)) {
        for (const pt of path) {
          if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
            anchorsList.push({ x: Number(pt[0]), y: Number(pt[1]) });
          }
        }
      }
      routeAnchorMap.set(cleanName, anchorsList);

      const normRoute = normalizeSpatialRoute({
        id: rtId,
        name: cleanName,
        type: 'corridor',
        endpoints: [],
        waypoints: [],
        context: '',
        evidenceIds: [],
      });
      routes.push(normRoute);
    }
  }

  // Also check route_geometry for mode/role/anchors if major_routes was empty or lacked them
  if (raw.route_geometry && typeof raw.route_geometry === 'object') {
    for (const [rtName, geom] of Object.entries(raw.route_geometry)) {
      const cleanName = boundedText(rtName, SPATIAL_LIMITS.nameChars);
      if (!cleanName) continue;
      if (!routeAnchorMap.has(cleanName)) {
        const anchorsList = [];
        if (Array.isArray(geom?.anchors)) {
          for (const pt of geom.anchors) {
            if (Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])) {
              anchorsList.push({ x: Number(pt[0]), y: Number(pt[1]) });
            }
          }
        }
        routeAnchorMap.set(cleanName, anchorsList);
      }
      const existingRoute = routes.find(r => r.name === cleanName);
      if (existingRoute && geom && typeof geom === 'object') {
        // major_routes supplies strategic anchors; route_geometry may enrich
        // route identity metadata. draw_path is deliberately ignored here.
        const mode = boundedText(geom.mode, SPATIAL_LIMITS.typeChars);
        const role = boundedText(geom.role, SPATIAL_LIMITS.contextChars);
        if (mode) existingRoute.type = mode;
        if (role) existingRoute.context = role;
      } else if (!existingRoute && geom && typeof geom === 'object') {
        const rtId = deterministicId('brt', [id, cleanName, routes.length]);
        const normRoute = normalizeSpatialRoute({
          id: rtId,
          name: cleanName,
          type: boundedText(geom.mode, SPATIAL_LIMITS.typeChars) || 'land',
          endpoints: [],
          waypoints: [],
          context: boundedText(geom.role, SPATIAL_LIMITS.contextChars),
          evidenceIds: [],
        });
        routes.push(normRoute);
      }
    }
  }

  // Helper to collect raw location sources
  const rawSources = [];

  // 1. Top-level locations (highest preference)
  for (const item of Array.isArray(raw.locations) ? raw.locations : []) {
    if (item && typeof item === 'object') {
      rawSources.push({ ...item, _sourceClass: 'top_location', _priority: 1 });
    }
  }

  // 2. Starting area center and local_features
  if (raw.starting_area && typeof raw.starting_area === 'object') {
    const sa = raw.starting_area;
    const localRouteByFeature = new Map();
    if (sa.local_geometry && typeof sa.local_geometry === 'object') {
      for (const geometry of Object.values(sa.local_geometry)) {
        if (!geometry || typeof geometry !== 'object') continue;
        const parentRoute = boundedText(geometry.parent_route, SPATIAL_LIMITS.nameChars);
        if (!parentRoute || !Array.isArray(geometry.supports)) continue;
        for (const supportedName of geometry.supports) {
          const key = boundedText(supportedName, SPATIAL_LIMITS.nameChars).toLowerCase();
          if (key && !localRouteByFeature.has(key)) localRouteByFeature.set(key, parentRoute);
        }
      }
    }

    const saCenter = extractCoord(sa);
    if (saCenter.x !== null && saCenter.y !== null) {
      const saName = boundedText(sa.name, SPATIAL_LIMITS.nameChars) || 'Starting Area';
      const localParentRoute = localRouteByFeature.get(saName.toLowerCase());
      rawSources.push({
        name: saName,
        coord: [saCenter.x, saCenter.y],
        type: boundedText(sa.type, SPATIAL_LIMITS.typeChars) || 'settlement',
        region: sa.region,
        description: sa.description,
        routes: sa.parent_route ? [sa.parent_route] : (localParentRoute ? [localParentRoute] : (sa.routes || [])),
        _sourceClass: 'starting_area',
        _priority: 2,
      });
    }

    if (Array.isArray(sa.local_features)) {
      for (const feat of sa.local_features) {
        if (feat && typeof feat === 'object') {
          const featureName = boundedText(feat.name, SPATIAL_LIMITS.nameChars);
          const localParentRoute = featureName ? localRouteByFeature.get(featureName.toLowerCase()) : '';
          const defaultRoutes = [
            ...(sa.parent_route ? [sa.parent_route] : []),
            ...(localParentRoute ? [localParentRoute] : []),
          ];
          rawSources.push({
            ...feat,
            routes: Array.isArray(feat.routes) ? [...feat.routes, ...defaultRoutes] : (feat.route ? [feat.route, ...defaultRoutes] : defaultRoutes),
            region: feat.region || sa.region,
            _sourceClass: 'starting_feature',
            _priority: 3,
          });
        }
      }
    }
  }

  // 3. Wild zones
  if (Array.isArray(raw.wild_zones)) {
    for (const wz of raw.wild_zones) {
      if (wz && typeof wz === 'object') {
        rawSources.push({
          ...wz,
          type: boundedText(wz.type, SPATIAL_LIMITS.typeChars) || 'wilderness',
          _sourceClass: 'wild_zone',
          _priority: 4,
        });
      }
    }
  }

  // 4. Geographic features
  if (Array.isArray(raw.geographic_features)) {
    for (const gf of raw.geographic_features) {
      if (gf && typeof gf === 'object') {
        rawSources.push({
          ...gf,
          type: boundedText(gf.type, SPATIAL_LIMITS.typeChars) || 'geographic_feature',
          _sourceClass: 'geographic_feature',
          _priority: 5,
        });
      }
    }
  }

  // Deduplicate by explicit source identity or normalized name only.
  // Coordinate equality is corroboration, never identity: a city, academy,
  // palace, gate, or district may legitimately share one coarse map anchor.
  const locationMap = new Map(); // key -> unified location candidate
  const nameToKey = new Map();
  const sourceIdToKey = new Map();

  for (let index = 0; index < rawSources.length; index += 1) {
    const src = rawSources[index];
    const locName = boundedText(src.name, SPATIAL_LIMITS.nameChars);
    if (!locName) continue;
    const coord = extractCoord(src);
    const normName = locName.toLowerCase();
    const sourceId = boundedText(src.id, 120);

    let existingKey = sourceId ? sourceIdToKey.get(sourceId) : nameToKey.get(normName);
    if (!existingKey && sourceId) {
      const byName = nameToKey.get(normName);
      const namedCandidate = byName ? locationMap.get(byName) : null;
      if (namedCandidate && !namedCandidate._sourceId) existingKey = byName;
    }

    if (existingKey && locationMap.has(existingKey)) {
      // Merge another representation of the same explicit/name identity.
      const existing = locationMap.get(existingKey);
      if (sourceId && !existing._sourceId) existing._sourceId = sourceId;
      if (sourceId) sourceIdToKey.set(sourceId, existingKey);
      if (src._priority < existing._priority) {
        // Preferred source overwrites primary name/type.
        existing.name = locName;
        existing.type = boundedText(src.type, SPATIAL_LIMITS.typeChars) || existing.type;
        existing._priority = src._priority;
      }
      if ((existing.coord.x === null || existing.coord.y === null) && coord.x !== null && coord.y !== null) {
        existing.coord = coord;
      }
      const extraContext = boundedText(src.description || src.context || src.notes, SPATIAL_LIMITS.contextChars);
      if (extraContext && !existing.context.includes(extraContext)) {
        existing.context = existing.context ? `${existing.context} ${extraContext}`.slice(0, SPATIAL_LIMITS.contextChars) : extraContext;
      }
      const srcRoutes = Array.isArray(src.routes || src.routeRefs) ? (src.routes || src.routeRefs) : [];
      for (const r of srcRoutes) {
        if (typeof r === 'string' && r.trim() && !existing.routeRefs.includes(r.trim())) {
          existing.routeRefs.push(r.trim());
        }
      }
    } else {
      const key = `bloc_cand_${sourceId || normName}_${index}`;
      const context = boundedText(src.description || src.context || src.notes, SPATIAL_LIMITS.contextChars);
      const rawRoutes = Array.isArray(src.routes || src.routeRefs) ? (src.routes || src.routeRefs) : [];
      const routeRefs = [];
      for (const r of rawRoutes) {
        if (typeof r === 'string' && r.trim() && !routeRefs.includes(r.trim())) {
          routeRefs.push(r.trim());
        }
      }

      const candidate = {
        name: locName,
        type: boundedText(src.type, SPATIAL_LIMITS.typeChars) || 'settlement',
        coord,
        context,
        routeRefs,
        _priority: src._priority,
        _sourceId: sourceId,
      };

      locationMap.set(key, candidate);
      if (!nameToKey.has(normName)) nameToKey.set(normName, key);
      if (sourceId) sourceIdToKey.set(sourceId, key);
    }
  }

  // Associate major route anchors with locations
  const locations = [];
  let locIndex = 0;
  for (const candidate of locationMap.values()) {
    const locCoord = candidate.coord;
    if (locCoord.x !== null && locCoord.y !== null) {
      // Check if location coord equals any major-route anchor
      for (const [rtName, anchors] of routeAnchorMap.entries()) {
        if (anchors.some(anchor => coordMatches(locCoord, anchor))) {
          if (!candidate.routeRefs.includes(rtName)) {
            candidate.routeRefs.push(rtName);
          }
        }
      }
    }

    const locId = deterministicId('bloc', [id, candidate.name, locIndex++]);
    const normLoc = normalizeSpatialLocation({
      id: locId,
      name: candidate.name,
      type: candidate.type,
      status: 'active',
      baseRefId: null,
      coordinate: {
        x: locCoord.x,
        y: locCoord.y,
        authority: 'base_canonical',
        locked: true,
      },
      context: candidate.context,
      routeRefs: candidate.routeRefs,
      createdAtMessage: null,
      lastChangedMessage: null,
      evidenceIds: [],
      notes: '',
    });
    locations.push(normLoc);
  }

  const digest = hashText(stableStringify({ id, profile, locations, routes }));

  return Object.freeze({
    id,
    name,
    version,
    adapter: 'ternia_v0_9_10',
    digest,
    profile,
    locations: Object.freeze(locations),
    routes: Object.freeze(routes),
  });
}

export function parseGenericBaseMap(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('base map must be an object');

  const name = boundedText(raw.name || raw.world, SPATIAL_LIMITS.nameChars) || 'Generic Map';
  const version = boundedText(raw.version, 40) || '1.0.0';
  const id = boundedText(raw.id, 120) || deterministicId('bmap_gen', [name, version]);

  const rawProfile = raw.profile && typeof raw.profile === 'object'
    ? raw.profile
    : (raw.coordinate_system && typeof raw.coordinate_system === 'object' ? raw.coordinate_system : null);
  const rawUnitKm = Number(rawProfile?.unitKm ?? rawProfile?.unit_km);
  const profile = rawProfile
    ? normalizeSpatialProfile({
      system: rawProfile.system || 'cartesian2d',
      northAxis: normalizeAxis(rawProfile.northAxis || rawProfile.north_axis || rawProfile.north, '+y'),
      eastAxis: normalizeAxis(rawProfile.eastAxis || rawProfile.east_axis || rawProfile.east, '+x'),
      unitKm: Number.isFinite(rawUnitKm) && rawUnitKm > 0 ? rawUnitKm : null,
      bounds: parseBounds(rawProfile.bounds, null),
      decimalStep: Number(rawProfile.decimalStep ?? rawProfile.decimal_step) || SPATIAL_LIMITS.defaultDecimalStep,
      trueNorthLocked: rawProfile.trueNorthLocked !== false
        && rawProfile.true_north_locked !== false
        && rawProfile.true_north_lock !== false,
    })
    : null;

  const locations = [];
  for (let index = 0; index < (Array.isArray(raw.locations) ? raw.locations : []).length; index += 1) {
    const item = raw.locations[index];
    if (!item || typeof item !== 'object') continue;
    const locName = boundedText(item.name, SPATIAL_LIMITS.nameChars);
    if (!locName) continue;
    const locId = boundedText(item.id, 120) || deterministicId('bloc', [id, locName, index]);
    const coord = normalizeCoordinate(item.coordinate || (Array.isArray(item.coord) ? { x: item.coord[0], y: item.coord[1] } : null));
    coord.authority = 'base_canonical';
    coord.locked = true;

    const normLoc = normalizeSpatialLocation({
      ...item,
      id: locId,
      name: locName,
      type: boundedText(item.type, SPATIAL_LIMITS.typeChars) || 'landmark',
      status: 'active',
      baseRefId: null,
      coordinate: coord,
      context: boundedText(item.context || item.description, SPATIAL_LIMITS.contextChars),
      routeRefs: Array.isArray(item.routeRefs || item.routes) ? (item.routeRefs || item.routes) : [],
      createdAtMessage: null,
      lastChangedMessage: null,
      evidenceIds: [],
    });
    locations.push(normLoc);
  }

  const routes = [];
  for (let index = 0; index < (Array.isArray(raw.routes || raw.major_routes) ? (raw.routes || raw.major_routes) : []).length; index += 1) {
    const item = (raw.routes || raw.major_routes)[index];
    if (!item) continue;
    const rtName = typeof item === 'string' ? item : boundedText(item.name, SPATIAL_LIMITS.nameChars);
    if (!rtName) continue;
    const rtId = boundedText(item.id, 120) || deterministicId('brt', [id, rtName, index]);
    const normRoute = normalizeSpatialRoute({
      ...(typeof item === 'object' ? item : {}),
      id: rtId,
      name: rtName,
      type: boundedText(item.type || item.mode, SPATIAL_LIMITS.typeChars) || 'corridor',
      endpoints: Array.isArray(item.endpoints) ? item.endpoints : [],
      waypoints: Array.isArray(item.waypoints) ? item.waypoints : [],
      context: boundedText(item.context || item.role, SPATIAL_LIMITS.contextChars),
      evidenceIds: [],
    });
    routes.push(normRoute);
  }

  const digest = hashText(stableStringify({ id, profile, locations, routes }));

  return Object.freeze({
    id,
    name,
    version,
    adapter: 'generic_v1',
    digest,
    profile,
    locations: Object.freeze(locations),
    routes: Object.freeze(routes),
  });
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
  if (!raw || typeof raw !== 'object') throw new Error('base map payload must be an object');

  // Stored base-map copies contain the already-normalized adapter projection.
  // Re-normalize their generic fields for validation, but preserve the explicit
  // adapter identity so provenance does not silently change after reload.
  if (raw.adapter && raw.profile && Array.isArray(raw.locations) && Array.isArray(raw.routes)) {
    const parsed = parseGenericBaseMap(raw);
    const declaredAdapter = boundedText(raw.adapter, 80);
    const adapter = ['generic_v1', 'ternia_v0_9_10'].includes(declaredAdapter)
      ? declaredAdapter
      : parsed.adapter;
    return Object.freeze({ ...parsed, adapter });
  }

  // Ternia is one explicit adapter, not the default meaning of coordinate_system.
  // Generic maps may use the same Cartesian field names without inheriting
  // Ternia-specific starting-area / Wild Zone / geography parsing.
  if (String(raw.world || '').trim().toLowerCase() === 'ternia') {
    return parseTerniaBaseMap(raw);
  }
  return parseGenericBaseMap(raw);
}

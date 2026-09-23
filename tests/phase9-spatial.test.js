import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  BUNDLE_VERSION,
  ROLLBACK_JOURNAL_VERSION,
  SCHEMA_VERSION,
  SIDECAR_FORMAT_VERSION,
  SPATIAL_ADMISSION_REASONS,
  SPATIAL_AUTHORITIES,
  SPATIAL_DISTANCE_MODES,
  SPATIAL_LIMITS,
  SPATIAL_LOCATION_STATUSES,
} from '../constants.js';
import {
  authorityRank,
  createSpatialState,
  deriveCoordinate,
  directionFromDelta,
  kmToUnits,
  normalizeCoordinate,
  normalizeSpatialLocation,
  normalizeSpatialProfile,
  normalizeSpatialRelation,
  normalizeSpatialRoute,
  normalizeSpatialState,
  reduceSpatialMutations,
  resolveEffectiveLocations,
  resolveEffectiveRoutes,
  roundDecimal,
  straightLineDistance,
  unitsToKm,
  validateBounds,
} from '../spatial-core.js';
import { parseBaseMap, parseGenericBaseMap, parseTerniaBaseMap } from '../spatial-base-map.js';
import { loadBaseMapSource, storeBaseMapSource } from '../host-base-map.js';
import { processSpatialCapture } from '../spatial-capture.js';
import { validateSpatialEnvelope } from '../spatial-wire.js';
import {
  buildSpatialRelevanceIndex,
  selectRelevantLocations,
  updateSpatialRelevanceIndex,
} from '../spatial-relevance.js';
import {
  buildSpatialInjection,
  renderSpatialInjection,
  WORLD_STATE_SPATIAL_HEADER,
} from '../spatial-injection.js';
import {
  applySpatialManualMutation,
  inspectSpatialLocation,
  querySpatialLocations,
} from '../spatial-manual.js';
import {
  containsWriterState,
  extractWriterStateBlocks,
  sanitizeAssistantNarration,
} from '../narrative-sanitizer.js';
import { buildCapturePrompt, runCaptureOperation } from '../capture.js';
import { runManualRebuild } from '../rebuild.js';
import { buildWorldStateUiModel, renderWorldStatePanel } from '../ui.js';
import { createState, normalizeState, reduceMutations } from '../state-core.js';
import { chatLineage, commitMutationBoundary, reconcileBranch, seedRootCheckpoint } from '../branch.js';
import { exportBundle, importBundle } from '../transfer.js';

test('Phase 9 constants, schema versions, and limits', () => {
  assert.equal(SCHEMA_VERSION, 2);
  assert.equal(SIDECAR_FORMAT_VERSION, 1);
  assert.equal(BUNDLE_VERSION, 1);
  assert.equal(ROLLBACK_JOURNAL_VERSION, 1);

  assert.ok(SPATIAL_AUTHORITIES.includes('manual'));
  assert.ok(SPATIAL_AUTHORITIES.includes('campaign_override'));
  assert.ok(SPATIAL_AUTHORITIES.includes('base_canonical'));
  assert.ok(SPATIAL_AUTHORITIES.includes('narrative_explicit'));
  assert.ok(SPATIAL_AUTHORITIES.includes('derived'));
  assert.ok(SPATIAL_AUTHORITIES.includes('relative'));
  assert.ok(SPATIAL_AUTHORITIES.includes('unknown'));

  assert.ok(SPATIAL_LOCATION_STATUSES.includes('active'));
  assert.ok(SPATIAL_LOCATION_STATUSES.includes('archived'));
  assert.equal(SPATIAL_LOCATION_STATUSES.includes('ruined'), false, 'ruin is type/context, not a lifecycle ontology');

  assert.ok(SPATIAL_DISTANCE_MODES.includes('straight_line'));
  assert.ok(SPATIAL_DISTANCE_MODES.includes('route'));
  assert.ok(SPATIAL_DISTANCE_MODES.includes('unspecified'));

  assert.ok(SPATIAL_LIMITS.maxLocations >= 100);
  assert.ok(SPATIAL_LIMITS.promptBudgetTokens >= 100);
  assert.ok(SPATIAL_LIMITS.candidateCap >= 64);
});

test('Coordinate math: unitsToKm, kmToUnits, and roundDecimal', () => {
  assert.equal(unitsToKm(1, 5), 5);
  assert.equal(unitsToKm(3.2, 5), 16);
  assert.equal(unitsToKm(0, 5), 0);

  assert.equal(kmToUnits(15, 5), 3);
  assert.equal(kmToUnits(2.5, 5), 0.5);
  assert.equal(kmToUnits(0, 5), 0);

  assert.equal(roundDecimal(12.3456, 0.1), 12.3);
  assert.equal(roundDecimal(12.36, 0.1), 12.4);
  assert.equal(roundDecimal(12.35, 0.1), 12.4);
  assert.equal(roundDecimal(-5.55, 0.1), -5.5);
});

test('Coordinate math: straightLineDistance and directionFromDelta', () => {
  // 3-4-5 triangle in units -> 5 units * 5km/unit = 25km
  const dist = straightLineDistance({ x: 0, y: 0 }, { x: 3, y: 4 }, 5);
  assert.equal(dist, 25);

  // Invalid coords return null
  assert.equal(straightLineDistance(null, { x: 1, y: 1 }), null);
  assert.equal(straightLineDistance({ x: 'a', y: 0 }, { x: 1, y: 1 }), null);

  // Cardinal directions (+Y is North, +X is East)
  assert.equal(directionFromDelta(0, 10), 'north');
  assert.equal(directionFromDelta(0, -10), 'south');
  assert.equal(directionFromDelta(10, 0), 'east');
  assert.equal(directionFromDelta(-10, 0), 'west');

  // Diagonal directions
  assert.equal(directionFromDelta(10, 10), 'northeast');
  assert.equal(directionFromDelta(-10, 10), 'northwest');
  assert.equal(directionFromDelta(10, -10), 'southeast');
  assert.equal(directionFromDelta(-10, -10), 'southwest');

  // Near-zero delta returns null
  assert.equal(directionFromDelta(0, 0), null);
});

test('Coordinate math: deriveCoordinate with cardinal and diagonal vectors', () => {
  const origin = { x: 10, y: 20 };

  // 15 km North @ 5 km/unit = +3 units in Y -> (10, 23)
  const north = deriveCoordinate(origin, {
    direction: 'north',
    distanceKm: 15,
    distanceMode: 'straight_line',
    unitKm: 5,
    decimalStep: 0.1,
  });
  assert.deepEqual(north, { x: 10, y: 23, authority: 'derived', locked: false });

  // 10 km East @ 5 km/unit = +2 units in X -> (12, 20)
  const east = deriveCoordinate(origin, {
    direction: 'east',
    distanceKm: 10,
    distanceMode: 'straight_line',
    unitKm: 5,
    decimalStep: 0.1,
  });
  assert.deepEqual(east, { x: 12, y: 20, authority: 'derived', locked: false });

  // 10 km Southwest @ 5 km/unit = 2 units / sqrt(2) = 1.414 units -> (-1.4, -1.4) offset -> (8.6, 18.6)
  const sw = deriveCoordinate(origin, {
    direction: 'southwest',
    distanceKm: 10,
    distanceMode: 'straight_line',
    unitKm: 5,
    decimalStep: 0.1,
  });
  assert.deepEqual(sw, { x: 8.6, y: 18.6, authority: 'derived', locked: false });

  // Out of bounds derivation returns null
  const outOfBounds = deriveCoordinate(origin, {
    direction: 'north',
    distanceKm: 500,
    distanceMode: 'straight_line',
    unitKm: 5,
    bounds: { x: [-50, 50], y: [-50, 50] },
  });
  assert.equal(outOfBounds, null);

  // Unresolved travel route distance does not derive exact straight coordinate
  const routeDist = deriveCoordinate(origin, {
    direction: 'north',
    distanceKm: 15,
    distanceMode: 'travel_route',
    unitKm: 5,
  });
  assert.equal(routeDist, null);
});

test('Unconfigured Spatial profile never inherits Ternia scale or True North implicitly', () => {
  const spatial = createSpatialState();
  spatial.locations.push(normalizeSpatialLocation({
    id: 'wsloc_anchor_no_profile',
    name: 'Anchor Keep',
    type: 'keep',
    status: 'active',
    coordinate: { x: 10, y: 20, authority: 'manual', locked: true },
    createdAtMessage: 1,
    lastChangedMessage: 1,
    evidenceIds: [],
  }));

  const exchange = [{
    messageId: 2,
    role: 'assistant',
    content: 'The Split Antler stands 10 km directly east of Anchor Keep.',
  }];

  const captured = processSpatialCapture({
    rawSpatialMutations: [{
      action: 'upsert_location',
      name: 'The Split Antler',
      type: 'inn',
      admissionReason: 'explicit_position',
      relative: {
        toLocationId: 'wsloc_anchor_no_profile',
        direction: 'east',
        distanceKm: 10,
        distanceMode: 'straight_line',
      },
      evidence: [{
        sourceMessageId: 2,
        claim: 'The Split Antler stands 10 km directly east of Anchor Keep.',
      }],
    }],
    spatial,
    exchange,
    visibleLocations: spatial.locations,
    profile: null,
    chatKey: 'chat:test:no-profile',
    sourceMessageId: 2,
    sourceLineageKey: 'ln2',
  });

  assert.equal(captured.applied.length >= 1, true);
  const splitAntler = captured.spatial.locations.find(item => item.name === 'The Split Antler');
  assert.ok(splitAntler);
  assert.equal(splitAntler.coordinate.x, null);
  assert.equal(splitAntler.coordinate.y, null);
  assert.equal(splitAntler.coordinate.authority, 'relative');
  assert.equal(captured.spatial.relations.length, 1);
  assert.equal(captured.spatial.relations[0].distanceKm, 10);

  const injection = buildSpatialInjection(captured.spatial, {
    recentText: 'We approach The Split Antler.',
    budgetTokens: 500,
  });
  assert.ok(injection.text.includes('The Split Antler'));
  assert.equal(injection.text.includes('True North is locked'), false);
});

test('Configured profile without unit scale cannot derive distance coordinates', () => {
  const profile = normalizeSpatialProfile({
    system: 'cartesian2d',
    northAxis: '+y',
    eastAxis: '+x',
    trueNorthLocked: true,
  });
  assert.equal(profile.unitKm, null);
  assert.equal(straightLineDistance({ x: 0, y: 0 }, { x: 3, y: 4 }), null);
  assert.equal(unitsToKm(5), null);
  assert.equal(kmToUnits(5), null);
  assert.equal(deriveCoordinate({ x: 0, y: 0 }, {
    direction: 'east',
    distanceKm: 10,
    distanceMode: 'straight_line',
    unitKm: profile.unitKm,
    northAxis: profile.northAxis,
    eastAxis: profile.eastAxis,
  }), null);
});

test('Configured Cartesian axes govern cardinal derivation and direction', () => {
  const profile = normalizeSpatialProfile({
    system: 'cartesian2d',
    northAxis: '+x',
    eastAxis: '-y',
    unitKm: 5,
    decimalStep: 0.1,
    trueNorthLocked: true,
  });

  assert.equal(profile.northAxis, '+x');
  assert.equal(profile.eastAxis, '-y');
  assert.equal(profile.bounds, null);

  const north = deriveCoordinate({ x: 0, y: 0 }, {
    direction: 'north',
    distanceKm: 10,
    distanceMode: 'straight_line',
    unitKm: profile.unitKm,
    decimalStep: profile.decimalStep,
    bounds: profile.bounds,
    northAxis: profile.northAxis,
    eastAxis: profile.eastAxis,
  });
  assert.deepEqual(north, { x: 2, y: 0, authority: 'derived', locked: false });

  const east = deriveCoordinate({ x: 0, y: 0 }, {
    direction: 'east',
    distanceKm: 10,
    distanceMode: 'straight_line',
    unitKm: profile.unitKm,
    decimalStep: profile.decimalStep,
    bounds: profile.bounds,
    northAxis: profile.northAxis,
    eastAxis: profile.eastAxis,
  });
  assert.deepEqual(east, { x: 0, y: -2, authority: 'derived', locked: false });

  assert.equal(directionFromDelta(2, 0, profile), 'north');
  assert.equal(directionFromDelta(0, -2, profile), 'east');
  assert.equal(directionFromDelta(-2, 0, profile), 'south');
  assert.equal(directionFromDelta(0, 2, profile), 'west');
});

test('Authority ranking and precedence hierarchy', () => {
  const manualLocked = authorityRank('manual', true);
  const campaignOverride = authorityRank('campaign_override', false);
  const baseCanonical = authorityRank('base_canonical', false);
  const manualUnlocked = authorityRank('manual', false);
  const narrativeExplicit = authorityRank('narrative_explicit', false);
  const derived = authorityRank('derived', false);
  const relative = authorityRank('relative', false);
  const unknown = authorityRank('unknown', false);

  assert.ok(manualLocked > campaignOverride, 'manual locked > campaign_override');
  assert.ok(campaignOverride > baseCanonical, 'campaign_override > base_canonical');
  assert.ok(baseCanonical > narrativeExplicit, 'base_canonical > narrative_explicit');
  assert.ok(narrativeExplicit > manualUnlocked, 'grounded narrative_explicit may correct an unlocked manual coordinate');
  assert.ok(manualUnlocked > derived, 'unlocked manual still outranks deterministic derivation');
  assert.ok(derived > relative, 'derived > relative');
  assert.ok(relative > unknown, 'relative > unknown');
  assert.equal(authorityRank('invalid_authority'), 0);
});

test('unknown explicit Spatial location IDs fail closed instead of becoming creates', () => {
  const spatial = createSpatialState();
  const result = reduceSpatialMutations(spatial, {
    chatKey: 'chat:test:stale-spatial-id',
    messageId: 1,
    lineageKey: 'ln1',
    operation: 'manual',
    mutations: [{
      action: 'upsert_location',
      locationId: 'wsloc_from_another_chat',
      name: 'Stale Old-Chat Inn',
      type: 'inn',
    }],
  }, null, { visibleLocations: [] });

  assert.equal(result.applied.length, 0);
  assert.equal(result.spatial.locations.length, 0);
  assert.match(result.rejected[0].reason, /locationId.*existing location/i);
});

test('Ternia base-map parsing preserves distinct co-located named anchors', () => {
  const baseMap = parseTerniaBaseMap({
    world: 'Ternia',
    version: 'audit',
    coordinate_system: {
      north: '+y',
      east: '+x',
      unit_km: 5,
      bounds: { x: [-10, 10], y: [-10, 10] },
    },
    locations: [
      { id: 'city', name: 'Crownspire City', type: 'capital', coord: [2, 3] },
      { id: 'academy', name: 'Royal Academy', type: 'institution', coord: [2, 3] },
    ],
  });

  assert.equal(baseMap.locations.length, 2);
  assert.deepEqual(baseMap.locations.map(item => item.name).sort(), ['Crownspire City', 'Royal Academy']);
});

test('generic base map without an explicit coordinate profile remains profileless', () => {
  const baseMap = parseGenericBaseMap({
    name: 'Profileless Generic Map',
    version: '1',
    locations: [{ name: 'Dockside', type: 'district' }],
  });

  assert.equal(baseMap.profile, null);
});

test('Base map parsing on real Ternia v0.9.10 sample fixture', () => {
  const rawJson = fs.readFileSync('tests/fixtures/ternia-sample.json', 'utf8');
  const baseMap = parseBaseMap(rawJson);

  assert.match(baseMap.id, /^bmap_ternia_/);
  assert.equal(baseMap.name, 'Ternia');
  assert.equal(baseMap.version, '0.9.10');
  assert.equal(baseMap.adapter, 'ternia_v0_9_10');
  assert.equal(baseMap.profile.unitKm, 5);
  assert.equal(baseMap.profile.decimalStep, 0.1);
  assert.deepEqual(baseMap.profile.bounds, { xMin: -500, xMax: 500, yMin: -500, yMax: 500 });
  assert.equal(baseMap.profile.trueNorthLocked, true);
  assert.equal(baseMap.digest.length, 16, 'repository deterministic content digest computed');

  const names = new Set(baseMap.locations.map(l => l.name));
  for (const expected of [
    'Lareth',
    'Halmere',
    'Kesselpass',
    'Brackenford',
    'Stone Bridge',
    'Fordhouse Inn',
    'Cairnwatch',
    'Gloamwood Pocket',
    'Skyrend Mountains',
  ]) {
    assert.ok(names.has(expected), expected + ' imported from its real registry layer');
  }

  const halmere = baseMap.locations.find(l => l.name === 'Halmere');
  const brackenford = baseMap.locations.find(l => l.name === 'Brackenford');
  const stoneBridge = baseMap.locations.find(l => l.name === 'Stone Bridge');
  const cairnwatch = baseMap.locations.find(l => l.name === 'Cairnwatch');
  assert.ok(halmere.routeRefs.includes('North Road'), 'exact major-route anchor associated');
  assert.ok(brackenford.routeRefs.includes('North Road'), 'starting-area center associated');
  assert.ok(stoneBridge.routeRefs.includes('North Road'), 'local_geometry support associated');
  assert.ok(cairnwatch.routeRefs.includes('North Road'), 'local_geometry support associated');

  const northRoad = baseMap.routes.find(route => route.name === 'North Road');
  assert.equal(northRoad.type, 'land');
  assert.match(northRoad.context, /authoritative drawable route path/i);
  assert.deepEqual(northRoad.waypoints, [], 'route draw_path is not imported as displacement geometry');

  assert.ok(Object.isFrozen(baseMap));
  assert.ok(Object.isFrozen(baseMap.locations));
});

test('Base map immutability & campaign override shadowing', () => {
  const sampleJson = fs.readFileSync('tests/fixtures/ternia-sample.json', 'utf8');
  const baseMap = parseBaseMap(sampleJson);

  const spatialState = createSpatialState();
  const halmereBase = baseMap.locations.find(l => l.name === 'Halmere');

  const initialEffective = resolveEffectiveLocations(spatialState, baseMap);
  const initialHalmere = initialEffective.find(l => l.id === halmereBase.id);
  assert.ok(initialHalmere);
  assert.equal(initialHalmere.coordinate.authority, 'base_canonical');
  assert.equal(initialHalmere.coordinate.locked, true);
  assert.equal(initialHalmere.status, 'active');

  const overrideRes = reduceSpatialMutations(spatialState, {
    chatKey: 'chat:test:override',
    messageId: 10,
    lineageKey: 'ln10',
    operation: 'manual',
    mutations: [{
      action: 'upsert_location',
      locationId: halmereBase.id,
      name: 'Halmere After the Siege',
      type: halmereBase.type,
      context: 'The outer ward was destroyed in the siege of year 402.',
      notes: 'Campaign-specific change.',
      createOverride: true,
    }],
  }, baseMap, { allowBaseScan: true });

  assert.equal(overrideRes.applied.length, 1);
  assert.equal(overrideRes.spatial.locations.length, 1);
  assert.equal(overrideRes.spatial.locations[0].baseRefId, halmereBase.id);
  assert.equal(overrideRes.spatial.locations[0].coordinate.authority, 'campaign_override');

  const resolved = resolveEffectiveLocations(overrideRes.spatial, baseMap);
  const resolvedHalmere = resolved.find(l => l.id === halmereBase.id);
  assert.ok(resolvedHalmere);
  assert.equal(resolvedHalmere.name, 'Halmere After the Siege');
  assert.equal(resolvedHalmere.isOverridden, true);
  assert.ok(resolvedHalmere.overrideId);
  assert.equal(resolvedHalmere.coordinate.authority, 'campaign_override');

  assert.equal(resolved.filter(l => l.id === halmereBase.id).length, 1, 'override shadows rather than duplicates base');
  assert.equal(halmereBase.name, 'Halmere', 'read-only base source remains untouched');
  assert.equal(halmereBase.coordinate.authority, 'base_canonical');
});

test('True North lock direction conflict rejection', () => {
  const spatialState = createSpatialState();
  spatialState.profile = normalizeSpatialProfile({ trueNorthLocked: true, unitKm: 5 });
  spatialState.locations.push(normalizeSpatialLocation({
    id: 'wsloc_anchor',
    name: 'North Gate Tower',
    type: 'tower',
    status: 'active',
    baseRefId: null,
    coordinate: { x: 0, y: 0, authority: 'manual', locked: true },
    createdAtMessage: 1,
    lastChangedMessage: 1,
    evidenceIds: [],
  }));

  const exchange = [
    { messageId: 1, role: 'user', content: 'Where is the South Post?' },
    { messageId: 2, role: 'assistant', content: 'The South Post stands south of the North Gate Tower at coordinates [0, 10].' },
  ];

  const result = processSpatialCapture({
    rawSpatialMutations: [{
      action: 'upsert_location',
      name: 'South Post',
      type: 'post',
      coordinate: { x: 0, y: 10 },
      relative: { toLocationId: 'wsloc_anchor', direction: 'south', distanceKm: 50, distanceMode: 'straight_line' },
      admissionReason: 'explicit_coordinate',
      evidence: [{ sourceMessageId: 2, claim: 'The South Post stands south of the North Gate Tower at coordinates [0, 10].' }],
    }],
    spatial: spatialState,
    exchange,
    visibleLocations: spatialState.locations,
    profile: spatialState.profile,
    chatKey: 'chat:test:truenorth',
    sourceMessageId: 2,
    sourceLineageKey: 'ln2',
  });

  assert.equal(result.acceptedCount, 0);
  assert.equal(result.applied.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0].stage, 'spatial-true-north');
});

test('Admission gate: named places accepted, generic scenery rejected', () => {
  const spatialState = createSpatialState();
  const exchange = [
    { messageId: 1, role: 'assistant', content: 'The party enters the Shattered Keep, resting by a clearing near some trees along the dirt road.' },
  ];

  const result = processSpatialCapture({
    rawSpatialMutations: [
      {
        action: 'upsert_location',
        name: 'Shattered Keep',
        type: 'ruins',
        admissionReason: 'named',
        evidence: [{ sourceMessageId: 1, claim: 'The party enters the Shattered Keep' }],
      },
      {
        action: 'upsert_location',
        name: 'a clearing',
        type: 'clearing',
        admissionReason: 'named',
        evidence: [{ sourceMessageId: 1, claim: 'resting by a clearing' }],
      },
      {
        action: 'upsert_location',
        name: 'some trees',
        type: 'woods',
        admissionReason: 'named',
        evidence: [{ sourceMessageId: 1, claim: 'near some trees' }],
      },
      {
        action: 'upsert_location',
        name: 'the road',
        type: 'road',
        admissionReason: 'named',
        evidence: [{ sourceMessageId: 1, claim: 'along the dirt road' }],
      },
    ],
    spatial: spatialState,
    exchange,
    visibleLocations: [],
    profile: spatialState.profile,
    chatKey: 'chat:test:admission',
    sourceMessageId: 1,
    sourceLineageKey: 'ln1',
  });

  assert.equal(result.acceptedCount, 1);
  assert.equal(result.applied.length, 1);
  assert.equal(result.spatial.locations.length, 1);
  assert.equal(result.spatial.locations[0].name, 'Shattered Keep');
  assert.equal(result.rejected.length, 3);
  for (const rej of result.rejected) assert.equal(rej.stage, 'spatial-admission');
});

test('Automatic coordinate firewall: fabricated coordinates stripped, explicit accepted', () => {
  const spatialState = createSpatialState();
  spatialState.profile = normalizeSpatialProfile({ unitKm: 5, decimalStep: 0.1 });
  const exchange = [{
    messageId: 1,
    role: 'assistant',
    content: 'We reached Ironwatch Fortress at grid [15.0, 30.0]. Later we spotted Falcon Peak in the distance.',
  }];

  const result = processSpatialCapture({
    rawSpatialMutations: [
      {
        action: 'upsert_location',
        name: 'Ironwatch Fortress',
        type: 'fortress',
        coordinate: { x: 15.0, y: 30.0 },
        admissionReason: 'explicit_coordinate',
        evidence: [{ sourceMessageId: 1, claim: 'We reached Ironwatch Fortress at grid [15.0, 30.0].' }],
      },
      {
        action: 'upsert_location',
        name: 'Falcon Peak',
        type: 'mountain',
        coordinate: { x: 88.0, y: 99.0 },
        admissionReason: 'named',
        evidence: [{ sourceMessageId: 1, claim: 'Later we spotted Falcon Peak in the distance.' }],
      },
    ],
    spatial: spatialState,
    exchange,
    visibleLocations: [],
    profile: spatialState.profile,
    chatKey: 'chat:test:firewall',
    sourceMessageId: 1,
    sourceLineageKey: 'ln1',
  });

  assert.equal(result.acceptedCount, 2);
  assert.equal(result.applied.length, 2);

  const ironwatch = result.spatial.locations.find(m => m.name === 'Ironwatch Fortress');
  assert.deepEqual(
    { x: ironwatch.coordinate.x, y: ironwatch.coordinate.y, authority: ironwatch.coordinate.authority },
    { x: 15, y: 30, authority: 'narrative_explicit' },
  );

  const falcon = result.spatial.locations.find(m => m.name === 'Falcon Peak');
  assert.equal(falcon.coordinate.x, null);
  assert.equal(falcon.coordinate.y, null);
  assert.equal(falcon.coordinate.authority, 'unknown');
});

test('Campaign spatial location ceiling rejects new durable locations without truncating existing state', () => {
  const spatial = createSpatialState();
  spatial.locations = Array.from({ length: SPATIAL_LIMITS.maxLocations }, (_, index) =>
    normalizeSpatialLocation({
      id: 'wsloc_cap_' + index,
      name: 'Cap Place ' + index,
      type: 'landmark',
      status: 'active',
      coordinate: { x: null, y: null, authority: 'unknown', locked: false },
      createdAtMessage: 1,
      lastChangedMessage: 1,
      evidenceIds: [],
    }));

  const result = reduceSpatialMutations(spatial, {
    chatKey: 'chat:test:cap',
    messageId: 2,
    lineageKey: 'ln2',
    operation: 'manual',
    mutations: [{
      action: 'upsert_location',
      name: 'One Place Too Many',
      type: 'landmark',
      evidence: [{
        sourceMessageId: 2,
        lineageKey: 'ln2',
        sourceClass: 'manual',
        claim: 'Manual spatial edit',
      }],
    }],
  });

  assert.equal(result.applied.length, 0);
  assert.equal(result.rejected.length, 1);
  assert.match(result.rejected[0].reason, /location limit/i);
  assert.equal(result.spatial.locations.length, SPATIAL_LIMITS.maxLocations);
});

test('Narrative Sanitizer strips writer_state blocks completely from capture and evidence', () => {
  const textWithWriterState = [
    'The party arrives at the mountain pass.',
    '<writer_state type="analysis">Consider opening a rift to Shadowrealm at coordinates [99.9, 99.9].</writer_state>',
    'The guide points to Old Watchtower.',
    '<WRITER_STATE priority="high">',
    'Future plot hypothesis: The watchtower collapsed.',
    '</WRITER_STATE>',
    '<NPC_Inner_Chatter>KARR: I think the bridge is secretly cursed.</NPC_Inner_Chatter>',
    '<CYOA>1. Burn the watchtower. 2. Open the sealed gate.</CYOA>',
    '<Skill_Mastery>Detection: 2/10</Skill_Mastery>',
    '<World_State>**Off-Screen:** Market extortion remains active.</World_State>',
    '<!-- INVENTORY_BLOCK_V05 <Inventory>Imaginary Key | 1</Inventory> -->',
  ].join('\n');

  assert.ok(containsWriterState(textWithWriterState));
  assert.equal(extractWriterStateBlocks(textWithWriterState).length, 2);

  const sanitized = sanitizeAssistantNarration(textWithWriterState);
  assert.ok(!sanitized.toLowerCase().includes('writer_state'));
  assert.ok(!sanitized.includes('Shadowrealm'));
  assert.ok(!sanitized.includes('Future plot hypothesis'));
  assert.ok(!sanitized.includes('secretly cursed'));
  assert.ok(!sanitized.includes('Burn the watchtower'));
  assert.ok(!sanitized.includes('Detection: 2/10'));
  assert.ok(!sanitized.includes('Imaginary Key'));
  assert.ok(sanitized.includes('The party arrives at the mountain pass.'));
  assert.ok(sanitized.includes('The guide points to Old Watchtower.'));
  assert.ok(sanitized.includes('Market extortion remains active.'));

  const captureRes = processSpatialCapture({
    rawSpatialMutations: [{
      action: 'upsert_location',
      name: 'Shadowrealm Rift',
      type: 'rift',
      admissionReason: 'named',
      evidence: [{ sourceMessageId: 1, claim: 'opening a rift to Shadowrealm' }],
    }],
    spatial: createSpatialState(),
    exchange: [{ messageId: 1, role: 'assistant', content: textWithWriterState }],
    visibleLocations: [],
    profile: null,
    chatKey: 'chat:test:sanitizer',
    sourceMessageId: 1,
    sourceLineageKey: 'ln1',
  });

  assert.equal(captureRes.acceptedCount, 0);
  assert.equal(captureRes.applied.length, 0);
  assert.equal(captureRes.rejected.length, 1);
  assert.equal(captureRes.rejected[0].stage, 'spatial-source-firewall');

  const unclosed = sanitizeAssistantNarration('Visible narration. <writer_state>future hypothesis');
  assert.equal(unclosed, 'Visible narration.', 'unclosed writer_state tail is removed conservatively');
});

test('Ephemeral spatial relevance indexing over 1000 locations', () => {
  const spatial = createSpatialState();
  spatial.locations = Array.from({ length: 1000 }, (_, i) => ({
    id: `wsloc_test_${i}`,
    name: i === 555 ? 'Dragonmaw Chasm' : `Location ${i}`,
    type: i === 555 ? 'canyon' : 'landmark',
    status: 'active',
    baseRefId: null,
    coordinate: { x: i * 0.1, y: i * 0.1, authority: 'derived', locked: false },
    context: i === 555 ? 'Deep volcanic fissure guarded by ancient drakes.' : `Standard place ${i}`,
    routeRefs: i === 555 ? ['Old Highway'] : [],
    createdAtMessage: 1,
    lastChangedMessage: 1,
    evidenceIds: [],
    notes: '',
  }));

  const index = buildSpatialRelevanceIndex(spatial);
  const result = selectRelevantLocations(spatial, {
    index,
    recentText: 'The party cautiously skirts the edge of Dragonmaw Chasm.',
    maxLocations: 6,
    candidateCap: 128,
  });

  assert.ok(result.metrics.indexUsed, 'Index was utilized');
  assert.ok(result.metrics.candidateLocations <= 128, 'Candidate cap respected');
  assert.equal(result.selected[0]?.location?.id, 'wsloc_test_555');
  assert.equal(result.selected[0]?.location?.name, 'Dragonmaw Chasm');

  const frostpeak = {
    id: 'wsloc_test_1001',
    name: 'Frostpeak Spire',
    type: 'mountain',
    status: 'active',
    baseRefId: null,
    coordinate: { x: 1, y: 2, authority: 'manual', locked: true },
    context: 'Icy peak',
    routeRefs: [],
    createdAtMessage: 2,
    lastChangedMessage: 2,
    evidenceIds: [],
    notes: '',
  };
  updateSpatialRelevanceIndex(index, {
    upsertedLocations: [frostpeak],
    removedLocationIds: ['wsloc_test_555'],
  });
  assert.ok(!index.byId.has('wsloc_test_555'));
  assert.ok(index.byId.has('wsloc_test_1001'));
});

test('Spatial relevance retrieves a location from indexed context terms', () => {
  const spatial = createSpatialState();
  spatial.locations.push(normalizeSpatialLocation({
    id: 'wsloc_context_red_lantern',
    name: 'Red Lantern',
    type: 'inn',
    status: 'active',
    coordinate: { x: null, y: null, authority: 'unknown', locked: false },
    context: 'Blackfen marsh district',
    routeRefs: [],
    evidenceIds: [],
  }));

  const index = buildSpatialRelevanceIndex(spatial);
  const result = selectRelevantLocations(spatial, {
    index,
    recentText: 'We return to the Blackfen marsh district.',
    maxLocations: 4,
  });

  assert.equal(result.selected.some(item => item.location.id === 'wsloc_context_red_lantern'), true);
});

test('Spatial continuity injection rendering and token budgeting', () => {
  const selectedLocations = [
    {
      location: {
        id: 'wsloc_1',
        name: 'Halmere',
        type: 'town',
        status: 'active',
        coordinate: { x: 10.0, y: 20.0 },
        routeRefs: ['North Road'],
        context: 'Regional capital and trade hub.',
      },
      score: 10,
      source: 'seed',
    },
    {
      location: {
        id: 'wsloc_2',
        name: 'Kesselpass',
        type: 'fortress',
        status: 'active',
        coordinate: { x: 10.0, y: 35.0 },
        routeRefs: ['North Road'],
        context: 'Heavily fortified mountain crossing.',
      },
      score: 8,
      source: 'relation',
    },
  ];

  const relations = [
    { fromId: 'wsloc_1', toId: 'wsloc_2', direction: 'north', distanceKm: 75 },
  ];

  const rendered = renderSpatialInjection(selectedLocations, relations, [], {
    budgetTokens: 500,
    trueNorthLocked: true,
  });

  assert.ok(rendered.text.includes(WORLD_STATE_SPATIAL_HEADER));
  assert.ok(rendered.text.includes('Halmere (town) [coord: 10, 20] (on route: North Road)'));
  assert.ok(rendered.text.includes('Kesselpass is north of Halmere (75 km)'));
  assert.ok(rendered.text.includes('True North is locked'));
  assert.ok(rendered.estimatedTokens <= 500);
  assert.equal(rendered.included.length, 2);

  const tight = renderSpatialInjection(selectedLocations, relations, [], {
    budgetTokens: 180,
    trueNorthLocked: true,
  });
  assert.ok(tight.estimatedTokens <= 180);
});

test('Spatial disabled mode produces zero prompt additions and empty injection', () => {
  const exchange = [
    { messageId: 1, role: 'user', content: 'Hello' },
    { messageId: 2, role: 'assistant', content: 'Greetings traveller.' },
  ];

  // Capture prompt when disabled
  const disabledPrompt = buildCapturePrompt({
    exchange,
    visibleRecords: [],
    loreText: '',
    spatialEnabled: false,
  });

  assert.ok(!disabledPrompt.systemPrompt.includes('SPATIAL CONTINUITY INSTRUCTIONS'));
  assert.ok(!disabledPrompt.prompt.includes('SPATIAL LOCATIONS (READ-ONLY)'));

  // Injection when spatial is empty
  const emptyInjection = buildSpatialInjection(createSpatialState(), {
    recentText: 'Walking along the path.',
  });
  assert.equal(emptyInjection.text, '');
  assert.equal(emptyInjection.included.length, 0);
});

test('Spatial manual CRUD operations and rollback', () => {
  let state = createState('chat:test:manual');
  const chat = [
    { role: 'user', content: 'Let us chart the realm.' },
    { role: 'assistant', content: 'A good idea.' },
  ];

  const createRes = applySpatialManualMutation({
    state,
    chat,
    chatKey: 'chat:test:manual',
    messageId: 1,
    mutation: {
      action: 'upsert_location',
      name: 'Sunspire Citadel',
      type: 'citadel',
      coordinate: { x: 40, y: 50 },
      context: 'High mountain citadel.',
    },
    note: 'Player discovered citadel',
  });

  assert.equal(createRes.outcome, 'applied');
  state = createRes.state;
  assert.equal(state.spatial.locations.length, 1);
  const created = state.spatial.locations[0];
  assert.equal(created.name, 'Sunspire Citadel');
  assert.equal(created.coordinate.authority, 'manual');
  assert.equal(created.coordinate.locked, true, 'manual coordinate locks by default');

  const query = querySpatialLocations(state, { text: 'Sunspire' });
  assert.equal(query.length, 1);
  const inspection = inspectSpatialLocation(state, query[0].id);
  assert.equal(inspection.location.name, 'Sunspire Citadel');
  assert.equal(inspection.evidence.length, 1);
  assert.equal(inspection.evidence[0].claim, 'Player discovered citadel');

  const unlockRes = applySpatialManualMutation({
    state,
    chat,
    chatKey: 'chat:test:manual',
    messageId: 1,
    mutation: {
      action: 'upsert_location',
      locationId: query[0].id,
      name: query[0].name,
      coordinate: { x: 40, y: 50, locked: false },
    },
    note: 'Coordinate may be corrected by later explicit narration',
  });
  assert.equal(unlockRes.outcome, 'applied');
  state = unlockRes.state;
  assert.equal(state.spatial.locations[0].coordinate.authority, 'manual');
  assert.equal(state.spatial.locations[0].coordinate.locked, false);

  const branched = reconcileBranch(state, chat.slice(0, 1));
  assert.equal(branched.exactRestored, true);
  assert.equal(branched.state.spatial.locations.length, 0, 'manual spatial create rolls back with its message boundary');
});

test('manual Spatial edits support rename, clearing, replacement route refs, and unknown-coordinate unlock', () => {
  let state = createState('chat:test:manual-edit');
  const chat = [
    { role: 'user', content: 'We establish a place.' },
    { role: 'assistant', content: 'The Old Lantern stands beside Old Road.' },
  ];

  const created = applySpatialManualMutation({
    state,
    chat,
    chatKey: state.chatKey,
    messageId: 1,
    mutation: {
      action: 'upsert_location',
      name: 'Old Lantern',
      type: 'inn',
      context: 'Old context',
      notes: 'Old notes',
      routeRefs: ['Old Road'],
      coordinate: { x: 10, y: 20, authority: 'manual', locked: true },
    },
    note: 'Create location',
  });
  assert.equal(created.outcome, 'applied');
  state = created.state;
  const id = state.spatial.locations[0].id;

  const edited = applySpatialManualMutation({
    state,
    chat,
    chatKey: state.chatKey,
    messageId: 1,
    mutation: {
      action: 'upsert_location',
      locationId: id,
      name: 'New Lantern',
      type: 'inn',
      context: '',
      notes: '',
      routeRefs: [],
      coordinate: { x: null, y: null, authority: 'unknown', locked: true },
    },
    note: 'Rename and clear editable fields',
  });

  assert.equal(edited.outcome, 'applied');
  const loc = edited.state.spatial.locations[0];
  assert.equal(loc.name, 'New Lantern');
  assert.equal(loc.context, '');
  assert.equal(loc.notes, '');
  assert.deepEqual(loc.routeRefs, []);
  assert.equal(loc.coordinate.x, null);
  assert.equal(loc.coordinate.y, null);
  assert.equal(loc.coordinate.locked, false, 'unknown coordinates cannot be authority-locked');
});

test('manual Spatial mutations require the current raw-message boundary when chat history exists', () => {
  const state = createState('chat:test:manual-boundary');
  const chat = [{ role: 'assistant', content: 'A road is established.' }];

  assert.throws(() => applySpatialManualMutation({
    state,
    chat,
    chatKey: state.chatKey,
    messageId: null,
    mutation: {
      action: 'upsert_location',
      name: 'Roadside Camp',
      type: 'camp',
    },
    note: 'Attempt unowned mutation',
  }), /existing raw-message boundary/);
});

test('campaign override remains editable by its stored overrideId', () => {
  const baseMap = parseBaseMap({
    name: 'Override Test Map',
    profile: { system: 'cartesian2d', unitKm: 1 },
    locations: [{
      id: 'base-town',
      name: 'Base Town',
      type: 'town',
      coordinate: { x: 1, y: 2 },
      context: 'Base context',
    }],
    routes: [],
  });
  let state = createState('chat:test:override-edit');

  const created = applySpatialManualMutation({
    state,
    chat: [],
    chatKey: state.chatKey,
    mutation: {
      action: 'upsert_location',
      locationId: 'base-town',
      name: 'Base Town',
      type: 'town',
      createOverride: true,
      context: 'Campaign context',
    },
    note: 'Create campaign override',
    baseMap,
  });
  assert.equal(created.outcome, 'applied');
  state = created.state;
  const overrideId = state.spatial.locations[0].id;

  const edited = applySpatialManualMutation({
    state,
    chat: [],
    chatKey: state.chatKey,
    mutation: {
      action: 'upsert_location',
      locationId: overrideId,
      name: 'Renamed Town',
      type: 'city',
      context: 'Edited campaign context',
    },
    note: 'Edit campaign override',
    baseMap,
  });

  assert.equal(edited.outcome, 'applied');
  assert.equal(edited.state.spatial.locations.length, 1);
  assert.equal(edited.state.spatial.locations[0].name, 'Renamed Town');
  assert.equal(edited.state.spatial.locations[0].type, 'city');
  assert.equal(edited.state.spatial.locations[0].context, 'Edited campaign context');
});

test('strict Spatial normalization rejects duplicate identities and evidence key/id drift', () => {
  const duplicateLocations = {
    ...createSpatialState(),
    locations: [
      { id: 'wsloc_dup', name: 'First Place' },
      { id: 'wsloc_dup', name: 'Conflicting Place' },
    ],
  };
  assert.throws(
    () => normalizeSpatialState(duplicateLocations, { strict: true }),
    /duplicate spatial location id: wsloc_dup/,
  );

  const duplicateRelations = {
    ...createSpatialState(),
    relations: [
      { id: 'wsrel_dup', fromId: 'a', toId: 'b' },
      { id: 'wsrel_dup', fromId: 'b', toId: 'c' },
    ],
  };
  assert.throws(
    () => normalizeSpatialState(duplicateRelations, { strict: true }),
    /duplicate spatial relation id: wsrel_dup/,
  );

  const duplicateRoutes = {
    ...createSpatialState(),
    routes: [
      { id: 'wsroute_dup', name: 'North Road' },
      { id: 'wsroute_dup', name: 'South Road' },
    ],
  };
  assert.throws(
    () => normalizeSpatialState(duplicateRoutes, { strict: true }),
    /duplicate spatial route id: wsroute_dup/,
  );

  const evidenceKeyDrift = {
    ...createSpatialState(),
    evidence: {
      wrong_key: {
        id: 'wse_spatial_actual',
        sourceMessageId: 0,
        lineageKey: 'ln0',
        sourceClass: 'assistant_narration',
        claim: 'The road reaches the gate.',
        locationIds: [],
      },
    },
  };
  assert.throws(
    () => normalizeSpatialState(evidenceKeyDrift, { strict: true }),
    /spatial evidence map key\/id mismatch: wrong_key != wse_spatial_actual/,
  );

  const danglingEvidence = {
    ...createSpatialState(),
    locations: [{
      id: 'wsloc_live',
      name: 'Live Place',
      evidenceIds: ['wse_spatial_missing'],
    }],
  };
  assert.throws(
    () => normalizeSpatialState(danglingEvidence, { strict: true }),
    /spatial location wsloc_live references missing evidence: wse_spatial_missing/,
  );

  const danglingRelationEvidence = {
    ...createSpatialState(),
    relations: [{
      id: 'wsrel_live',
      fromId: 'base:a',
      toId: 'base:b',
      evidenceIds: ['wse_spatial_missing'],
    }],
  };
  assert.throws(
    () => normalizeSpatialState(danglingRelationEvidence, { strict: true }),
    /spatial relation wsrel_live references missing evidence: wse_spatial_missing/,
  );

  const danglingRouteEvidence = {
    ...createSpatialState(),
    routes: [{
      id: 'wsroute_live',
      name: 'Live Route',
      evidenceIds: ['wse_spatial_missing'],
    }],
  };
  assert.throws(
    () => normalizeSpatialState(danglingRouteEvidence, { strict: true }),
    /spatial route wsroute_live references missing evidence: wse_spatial_missing/,
  );

  assert.equal(
    normalizeSpatialState(duplicateLocations).locations.length,
    1,
    'non-strict Spatial normalization keeps repair semantics',
  );
});

test('strict Spatial normalization rejects present invalid authority enums and coordinate axes', () => {
  assert.throws(
    () => normalizeSpatialState({ ...createSpatialState(), locations: [{ id: 'wsloc_bad', name: 'Bad', status: 'destroyed' }] }, { strict: true }),
    /invalid spatial location status: destroyed/,
  );
  assert.throws(
    () => normalizeSpatialState({ ...createSpatialState(), locations: [{ id: 'wsloc_bad', name: 'Bad', coordinate: { x: 1, y: 2, authority: 'omniscient' } }] }, { strict: true }),
    /invalid spatial coordinate authority: omniscient/,
  );
  assert.throws(
    () => normalizeSpatialState({ ...createSpatialState(), relations: [{ id: 'wsrel_bad', fromId: 'a', toId: 'b', distanceMode: 'teleport' }] }, { strict: true }),
    /invalid spatial distance mode: teleport/,
  );
  assert.throws(
    () => normalizeSpatialState({ ...createSpatialState(), evidence: { wse_bad: { id: 'wse_bad', sourceClass: 'invented', claim: 'Bad provenance.', locationIds: [] } } }, { strict: true }),
    /invalid spatial evidence sourceClass: invented/,
  );
  assert.throws(
    () => normalizeSpatialState({ ...createSpatialState(), profile: { northAxis: '+x', eastAxis: '-x' } }, { strict: true }),
    /spatial profile axes must be perpendicular/,
  );

  const legacyEmpty = normalizeSpatialState(undefined, { strict: true });
  assert.deepEqual(legacyEmpty, createSpatialState());
});

test('Schema 1 to Schema 2 migration and old checkpoint rollback safety', () => {
  const schema1 = {
    schemaVersion: 1,
    chatKey: 'chat:test:schema1',
    records: [{
      id: 'wsr_old',
      kind: 'fact',
      summary: 'Legacy fact from schema 1.',
      status: 'active',
      anchors: ['legacy'],
      createdAtMessage: 1,
      lastChangedMessage: 1,
      lastEvaluatedMessage: 1,
      timeAnchor: '',
      evidenceIds: [],
      causedBy: [],
      affects: [],
    }],
    evidence: {},
    links: [],
    lineage: [],
  };

  const migrated = normalizeState(schema1, { strictSchema: true });
  assert.equal(migrated.schemaVersion, 2);
  assert.deepEqual(migrated.spatial, createSpatialState());

  const originalChat = [
    { role: 'user', content: 'Message 0' },
    { role: 'assistant', content: 'Message 1' },
  ];
  const lineage = chatLineage(originalChat);
  const checkpointState = normalizeState({
    schemaVersion: 2,
    chatKey: 'chat:test:branch',
    records: [],
    evidence: {},
    links: [],
    spatial: {
      ...createSpatialState(),
      profile: normalizeSpatialProfile({}),
      locations: [normalizeSpatialLocation({
        id: 'wsloc_future',
        name: 'Future City',
        status: 'active',
        coordinate: { x: 5, y: 5, authority: 'narrative_explicit', locked: false },
      })],
    },
    lineage,
    checkpoints: [{
      messageId: 0,
      lineageKey: lineage[0].lineageKey,
      rollbackSeq: 0,
      snapshot: {
        schemaVersion: 1,
        records: [],
        evidence: {},
        links: [],
        lastCaptureMessage: null,
      },
    }],
    rollbackJournal: [],
  });

  const reconciled = reconcileBranch(checkpointState, originalChat.slice(0, 1));
  assert.equal(reconciled.action, 'exact-checkpoint');
  assert.equal(reconciled.state.spatial.locations.length, 0);
  assert.equal(reconciled.state.schemaVersion, 2);
});

test('UI projections: escaped HTML rendering and spatial tab model', () => {
  const state = createState('chat:test:ui');
  state.spatial.locations.push(normalizeSpatialLocation({
    id: 'wsloc_xss',
    name: 'Tavern <script>alert(1)</script>',
    type: 'inn & pub',
    status: 'active',
    baseRefId: null,
    coordinate: { x: 10, y: 20, authority: 'manual', locked: true },
    context: 'Danger <img src=x onerror=alert(1)>',
    routeRefs: ['Safe Road'],
    createdAtMessage: 1,
    lastChangedMessage: 1,
    evidenceIds: [],
    notes: '',
  }));

  const uiModel = buildWorldStateUiModel(state);
  assert.ok(uiModel.spatial);
  assert.equal(uiModel.spatial.locations.length, 1);
  assert.equal(uiModel.spatial.locations[0].authorityLabel, 'Manual 🔒');

  const html = renderWorldStatePanel(uiModel, { activeTab: 'spatial' });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<img src=x onerror=alert(1)>'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('data-wsa-tab="spatial"'));
  assert.ok(html.includes('aria-label="Places"'));
  assert.ok(html.includes('Manual 🔒'));
});

test('Host base map storage adapter', async () => {
  const fileStore = new Map();
  const hostAdapter = {
    async uploadJsonFile(filename, data) {
      fileStore.set(filename, JSON.stringify(data));
      return { path: `/user/files/${filename}` };
    },
    async fetchJsonFile(path) {
      const filename = path.replace('/user/files/', '');
      const content = fileStore.get(filename);
      return content ? JSON.parse(content) : null;
    },
  };

  const rawJson = fs.readFileSync('tests/fixtures/ternia-sample.json', 'utf8');
  const result = await storeBaseMapSource(hostAdapter, rawJson);

  assert.equal(result.pointer.id, result.baseMap.id);
  assert.match(result.pointer.id, /^bmap_ternia_/);
  assert.ok(result.pointer.path.includes('world-state-alpha-basemap-'));
  assert.equal(result.pointer.digest, result.baseMap.digest);

  const loaded = await loadBaseMapSource(hostAdapter, result.pointer);
  assert.ok(loaded);
  assert.equal(loaded.id, result.baseMap.id);
  assert.equal(loaded.digest, result.baseMap.digest);
  assert.equal(loaded.locations.length, result.baseMap.locations.length);
  assert.equal(fileStore.size, 1, 'base source stored as an immutable copied payload');
});


test('Manual authority labeling preserves reserved source authorities and unlock semantics', () => {
  let state = createState('chat:test:manual-authority');

  const derived = applySpatialManualMutation({
    state,
    chat: [],
    chatKey: 'chat:test:manual-authority',
    mutation: {
      action: 'upsert_location',
      name: 'Glass Hill',
      type: 'hill',
      coordinate: { x: 12, y: 14, authority: 'derived', locked: false },
    },
    note: 'Operator records a deterministically derived coordinate.',
  });
  assert.equal(derived.outcome, 'applied');
  state = derived.state;
  assert.equal(state.spatial.locations[0].coordinate.authority, 'derived');
  assert.equal(state.spatial.locations[0].coordinate.locked, false);

  const reserved = applySpatialManualMutation({
    state: createState('chat:test:manual-reserved'),
    chat: [],
    chatKey: 'chat:test:manual-reserved',
    mutation: {
      action: 'upsert_location',
      name: 'Operator Point',
      type: 'landmark',
      coordinate: { x: 3, y: 4, authority: 'base_canonical', locked: true },
    },
    note: 'Operator coordinate must not impersonate base source authority.',
  });
  assert.equal(reserved.state.spatial.locations[0].coordinate.authority, 'manual');

  const unlockedSpatial = createSpatialState();
  unlockedSpatial.locations.push(normalizeSpatialLocation({
    id: 'wsloc_manual_open',
    name: 'Open Marker',
    type: 'landmark',
    status: 'active',
    coordinate: { x: 0, y: 0, authority: 'manual', locked: false },
  }));
  const corrected = reduceSpatialMutations(unlockedSpatial, {
    chatKey: 'chat:test:manual-authority',
    messageId: 2,
    lineageKey: 'ln2',
    operation: 'capture',
    mutations: [{
      action: 'upsert_location',
      locationId: 'wsloc_manual_open',
      name: 'Open Marker',
      coordinate: { x: 1, y: 0, authority: 'narrative_explicit', locked: false },
    }],
  }, null, { visibleLocations: unlockedSpatial.locations });
  assert.equal(corrected.applied.length, 1);
  assert.equal(corrected.spatial.locations[0].coordinate.x, 1);

  const lockedSpatial = createSpatialState();
  lockedSpatial.locations.push(normalizeSpatialLocation({
    id: 'wsloc_manual_locked',
    name: 'Locked Marker',
    type: 'landmark',
    status: 'active',
    coordinate: { x: 0, y: 0, authority: 'manual', locked: true },
  }));
  const blocked = reduceSpatialMutations(lockedSpatial, {
    chatKey: 'chat:test:manual-authority',
    messageId: 2,
    lineageKey: 'ln2',
    operation: 'capture',
    mutations: [{
      action: 'upsert_location',
      locationId: 'wsloc_manual_locked',
      name: 'Locked Marker',
      coordinate: { x: 1, y: 0, authority: 'narrative_explicit', locked: false },
    }],
  }, null, { visibleLocations: lockedSpatial.locations });
  assert.equal(blocked.applied.length, 0);
  assert.match(blocked.rejected[0].reason, /locked coordinate/i);
});

test('Manual spatial relations obey True North in the reducer', () => {
  const spatial = createSpatialState();
  spatial.profile = normalizeSpatialProfile({ trueNorthLocked: true });
  spatial.locations.push(
    normalizeSpatialLocation({
      id: 'wsloc_south',
      name: 'South House',
      coordinate: { x: 10, y: 10, authority: 'manual', locked: true },
    }),
    normalizeSpatialLocation({
      id: 'wsloc_north',
      name: 'North House',
      coordinate: { x: 10, y: 20, authority: 'manual', locked: true },
    }),
  );

  const bad = reduceSpatialMutations(spatial, {
    chatKey: 'chat:test:manual-north',
    messageId: 3,
    lineageKey: 'ln3',
    operation: 'manual',
    mutations: [{
      action: 'upsert_relation',
      fromId: 'wsloc_south',
      toId: 'wsloc_north',
      direction: 'south',
      distanceKm: 50,
      distanceMode: 'straight_line',
    }],
  }, null, { visibleLocations: spatial.locations });
  assert.equal(bad.applied.length, 0);
  assert.match(bad.rejected[0].reason, /True North/i);

  const good = reduceSpatialMutations(spatial, {
    chatKey: 'chat:test:manual-north',
    messageId: 3,
    lineageKey: 'ln3',
    operation: 'manual',
    mutations: [{
      action: 'upsert_relation',
      fromId: 'wsloc_south',
      toId: 'wsloc_north',
      direction: 'north',
      distanceKm: 50,
      distanceMode: 'straight_line',
    }],
  }, null, { visibleLocations: spatial.locations });
  assert.equal(good.applied.length, 1);
  assert.equal(good.spatial.relations[0].direction, 'north');
});

test('Merge rewires spatial graph and delete removes dangling relations/routes', () => {
  const spatial = createSpatialState();
  spatial.locations.push(
    normalizeSpatialLocation({
      id: 'wsloc_a',
      name: 'Old Alderhook',
      coordinate: { x: 1, y: 1, authority: 'derived', locked: false },
      routeRefs: ['Timber Road'],
    }),
    normalizeSpatialLocation({
      id: 'wsloc_b',
      name: 'Alderhook',
      coordinate: { x: 2, y: 2, authority: 'manual', locked: true },
    }),
    normalizeSpatialLocation({
      id: 'wsloc_c',
      name: 'Rimecross',
      coordinate: { x: 0, y: 0, authority: 'manual', locked: true },
    }),
  );
  spatial.relations.push(normalizeSpatialRelation({
    id: 'wsrel_a',
    fromId: 'wsloc_a',
    toId: 'wsloc_c',
    direction: 'southwest',
    distanceKm: 10,
    distanceMode: 'straight_line',
  }));
  spatial.routes.push(normalizeSpatialRoute({
    id: 'wsrt_test',
    name: 'Timber Road',
    endpoints: ['wsloc_a', 'wsloc_c'],
    waypoints: ['wsloc_a'],
  }));

  const merged = reduceSpatialMutations(spatial, {
    chatKey: 'chat:test:merge',
    messageId: 5,
    lineageKey: 'ln5',
    operation: 'manual',
    mutations: [{ action: 'merge_locations', sourceId: 'wsloc_a', targetId: 'wsloc_b' }],
  });
  assert.equal(merged.applied.length, 1);
  assert.equal(merged.spatial.locations.find(item => item.id === 'wsloc_a').status, 'archived');
  assert.equal(merged.spatial.relations[0].fromId, 'wsloc_b');
  assert.deepEqual(merged.spatial.routes[0].endpoints, ['wsloc_b', 'wsloc_c']);
  assert.deepEqual(merged.spatial.routes[0].waypoints, ['wsloc_b']);

  const deleted = reduceSpatialMutations(merged.spatial, {
    chatKey: 'chat:test:merge',
    messageId: 6,
    lineageKey: 'ln6',
    operation: 'manual',
    mutations: [{ action: 'delete_location', locationId: 'wsloc_b' }],
  });
  assert.equal(deleted.applied.length, 1);
  assert.equal(deleted.spatial.locations.some(item => item.id === 'wsloc_b'), false);
  assert.equal(deleted.spatial.relations.some(rel => rel.fromId === 'wsloc_b' || rel.toId === 'wsloc_b'), false);
  assert.equal(deleted.spatial.routes[0].endpoints.includes('wsloc_b'), false);
  assert.equal(deleted.spatial.routes[0].waypoints.includes('wsloc_b'), false);
});

test('Same generated location name remains isolated per campaign owner', () => {
  function createFor(chatKey) {
    return reduceSpatialMutations(createSpatialState(), {
      chatKey,
      messageId: 1,
      lineageKey: 'ln1',
      operation: 'capture',
      mutations: [{
        action: 'upsert_location',
        name: 'The Split Antler',
        type: 'inn',
        coordinate: { x: null, y: null, authority: 'unknown', locked: false },
      }],
    });
  }
  const a = createFor('campaign:A');
  const b = createFor('campaign:B');
  assert.equal(a.spatial.locations.length, 1);
  assert.equal(b.spatial.locations.length, 1);
  assert.notEqual(a.spatial.locations[0].id, b.spatial.locations[0].id);
});

test('Spatial UI exposes the complete manual continuity edit surface', () => {
  const state = createState('chat:test:ui-controls');
  state.spatial.locations.push(normalizeSpatialLocation({
    id: 'wsloc_controls',
    name: 'Fallow Watch',
    type: 'ruin',
    coordinate: { x: 42.3, y: 171.8, authority: 'manual', locked: true },
    context: 'Northern Ternia',
  }));
  const html = renderWorldStatePanel(buildWorldStateUiModel(state), { activeTab: 'spatial' });
  for (const required of [
    'data-wsa-spatial-action="add_location_modal"',
    'data-wsa-spatial-action="save_location"',
    'data-wsa-spatial-action="toggle_lock"',
    'data-wsa-spatial-action="archive_location"',
    'data-wsa-spatial-action="merge_location"',
    'data-wsa-spatial-action="delete_location"',
    'data-wsa-field="authority"',
    'data-wsa-field="relativeAnchor"',
    'data-wsa-field="direction"',
    'data-wsa-field="distanceKm"',
    'data-wsa-field="distanceMode"',
    'data-wsa-field="routeRefs"',
  ]) assert.ok(html.includes(required), required);
  const hostSource = fs.readFileSync('index.js', 'utf8');
  const uiSource = fs.readFileSync('ui.js', 'utf8');
  for (const action of ['add_location_modal', 'archive_location', 'merge_location']) {
    assert.ok(hostSource.includes(`actionId === '${action}'`), 'host handles ' + action);
  }
  assert.match(uiSource, /context: getVal\('context'\) !== undefined/);
  assert.match(uiSource, /notes: getVal\('notes'\) !== undefined/);
  assert.doesNotMatch(uiSource, /context: getVal\('context'\) \|\| currentLoc/);
  assert.doesNotMatch(uiSource, /notes: getVal\('notes'\) \|\| currentLoc/);
});

test('Rebuild uses the sanitized evidence view: writer_state alone cannot establish Spatial state', async () => {
  const chatKey = 'chat:test:spatial-rebuild-firewall';
  const chat = [
    { role: 'user', content: 'We continue along the empty road.' },
    {
      role: 'assistant',
      content: '<writer_state>A hamlet named Ghostmere exists northeast of Rimecross.</writer_state> The road remains empty.',
    },
  ];
  const dispatcher = async () => ({
    text: JSON.stringify({
      mutations: [],
      spatialMutations: [{
        action: 'upsert_location',
        name: 'Ghostmere',
        type: 'hamlet',
        admissionReason: 'named',
        evidence: [{
          sourceMessageId: 1,
          claim: 'A hamlet named Ghostmere exists northeast of Rimecross.',
        }],
      }],
    }),
    receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
  });

  const result = await runManualRebuild({
    ctx: {},
    dispatcher,
    state: createState(chatKey),
    chat,
    chatKey,
    isCurrent: () => true,
    spatialEnabled: true,
    spatialProfile: normalizeSpatialProfile({}),
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.state.spatial.locations.length, 0);
  assert.equal(result.providerCalls, 1);
});

test('Rebuild may establish Spatial state from actual accepted narration', async () => {
  const chatKey = 'chat:test:spatial-rebuild-narration';
  const chat = [
    { role: 'user', content: 'What is ahead?' },
    { role: 'assistant', content: 'A permanent hamlet named Alderhook stands beside the road.' },
  ];
  const dispatcher = async () => ({
    text: JSON.stringify({
      mutations: [],
      spatialMutations: [{
        action: 'upsert_location',
        name: 'Alderhook',
        type: 'hamlet',
        admissionReason: 'named',
        evidence: [{
          sourceMessageId: 1,
          claim: 'A permanent hamlet named Alderhook stands beside the road.',
        }],
      }],
    }),
    receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
  });

  const result = await runManualRebuild({
    ctx: {},
    dispatcher,
    state: createState(chatKey),
    chat,
    chatKey,
    isCurrent: () => true,
    spatialEnabled: true,
    spatialProfile: normalizeSpatialProfile({}),
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.state.spatial.locations.length, 1);
  assert.equal(result.state.spatial.locations[0].name, 'Alderhook');
  assert.equal(result.state.spatial.evidence[result.state.spatial.locations[0].evidenceIds[0]].sourceClass, 'rebuild');
});


test('Generic coordinate_system stays generic rather than selecting the Ternia adapter', () => {
  const generic = parseBaseMap({
    name: 'Orbital Deck',
    version: '1.0',
    coordinate_system: {
      north: '+y',
      east: '+x',
      unit_km: 2,
      bounds: { x_min: -20, x_max: 20, y_min: -10, y_max: 10 },
      decimal_step: 0.5,
      true_north_lock: true,
    },
    locations: [{
      name: 'Habitat Ring',
      type: 'module',
      coord: [3.5, -2],
      context: 'Rotating habitat reference point',
    }],
  });
  assert.equal(generic.adapter, 'generic_v1');
  assert.equal(generic.profile.unitKm, 2);
  assert.deepEqual(generic.profile.bounds, { xMin: -20, xMax: 20, yMin: -10, yMax: 10 });
  assert.equal(generic.profile.decimalStep, 0.5);
  assert.equal(generic.locations[0].name, 'Habitat Ring');
  assert.equal(generic.locations[0].coordinate.authority, 'base_canonical');
});


test('Spatial-only automatic capture is classified applied without creating a Reality record', async () => {
  const chatKey = 'chat:test:spatial-only-capture';
  const chat = [
    { role: 'user', content: 'What is this place called?' },
    { role: 'assistant', content: 'The permanent roadside inn is named The Split Antler.' },
  ];
  const lineage = chatLineage(chat);
  const state = createState(chatKey);
  const result = await runCaptureOperation({
    ctx: {},
    state,
    exchange: chat.map((message, messageId) => ({
      ...message,
      messageId,
      lineageKey: lineage[messageId].lineageKey,
    })),
    visibleRecords: [],
    chatKey,
    sourceMessageId: 1,
    sourceLineageKey: lineage[1].lineageKey,
    isCurrent: () => true,
    dispatcher: async () => ({
      text: JSON.stringify({
        mutations: [],
        spatialMutations: [{
          action: 'upsert_location',
          name: 'The Split Antler',
          type: 'inn',
          admissionReason: 'named',
          evidence: [{
            sourceMessageId: 1,
            claim: 'The permanent roadside inn is named The Split Antler.',
          }],
        }],
      }),
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
    }),
    spatialEnabled: true,
    spatialProfile: normalizeSpatialProfile({}),
  });

  assert.equal(result.outcome, 'applied');
  assert.equal(result.providerCalls, 1);
  assert.equal(result.state.records.length, 0);
  assert.equal(result.state.spatial.locations.length, 1);
  assert.equal(result.state.spatial.locations[0].name, 'The Split Antler');
});

test('Stored Ternia base-map copy preserves adapter identity after reload', async () => {
  const fileStore = new Map();
  const hostAdapter = {
    async uploadJsonFile(filename, data) {
      fileStore.set(filename, JSON.stringify(data));
      return { path: '/user/files/' + filename };
    },
    async fetchJsonFile(path) {
      const filename = path.replace('/user/files/', '');
      const content = fileStore.get(filename);
      return content ? JSON.parse(content) : null;
    },
  };

  const rawJson = fs.readFileSync('tests/fixtures/ternia-sample.json', 'utf8');
  const stored = await storeBaseMapSource(hostAdapter, rawJson);
  assert.equal(stored.baseMap.adapter, 'ternia_v0_9_10');

  const loaded = await loadBaseMapSource(hostAdapter, stored.pointer);
  assert.ok(loaded);
  assert.equal(loaded.adapter, 'ternia_v0_9_10');
  assert.equal(loaded.digest, stored.baseMap.digest);
});

test('Foreign campaign import retains base source identity but clears machine-local source path', () => {
  const state = createState('campaign:source');
  state.spatial.profile = normalizeSpatialProfile({
    unitKm: 5,
    trueNorthLocked: true,
  });
  state.spatial.baseMapRef = {
    id: 'bmap_ternia_fixture',
    name: 'Ternia',
    version: '0.9.10',
    adapter: 'ternia_v0_9_10',
    digest: 'abc123',
    path: '/user/files/world-state-alpha-basemap-abc123.json',
  };

  const text = exportBundle(state, { exportedAt: '2026-09-22T00:00:00.000Z' });
  const imported = importBundle(text, { targetChatKey: 'campaign:other' });

  assert.equal(imported.spatial.baseMapRef.id, 'bmap_ternia_fixture');
  assert.equal(imported.spatial.baseMapRef.digest, 'abc123');
  assert.equal(imported.spatial.baseMapRef.adapter, 'ternia_v0_9_10');
  assert.equal(imported.spatial.baseMapRef.path, '');
});

test('Same-boundary manual spatial edits coalesce and roll back exactly', () => {
  const chatKey = 'chat:test:spatial-coalesce';
  const chat = [{ role: 'assistant', content: 'The party makes camp.' }];
  let state = seedRootCheckpoint(createState(chatKey));

  const created = applySpatialManualMutation({
    state,
    chat,
    chatKey,
    messageId: 0,
    mutation: {
      action: 'upsert_location',
      name: 'Camp Nine',
      type: 'camp',
      coordinate: { x: 2, y: 3, authority: 'manual', locked: true },
    },
    note: 'Operator adds Camp Nine.',
  });
  assert.equal(created.outcome, 'applied');

  const locationId = created.state.spatial.locations[0].id;
  const edited = applySpatialManualMutation({
    state: created.state,
    chat,
    chatKey,
    messageId: 0,
    mutation: {
      action: 'upsert_location',
      locationId,
      name: 'Camp Nine',
      type: 'camp',
      context: 'Permanent supply camp.',
    },
    note: 'Operator refines Camp Nine.',
  });
  assert.equal(edited.outcome, 'applied');
  assert.equal(edited.state.rollbackJournal.length, 1, 'same raw boundary should coalesce into one journal mutation');
  assert.equal(edited.state.spatial.locations[0].context, 'Permanent supply camp.');

  const rolled = reconcileBranch(edited.state, []);
  assert.equal(rolled.failClosed, false);
  assert.equal(rolled.exactRestored, true);
  assert.equal(rolled.state.spatial.locations.length, 0);
  assert.equal(Object.keys(rolled.state.spatial.evidence).length, 0);
});

test('Generic scenery may be admitted only when independent persistence is established', () => {
  const spatial = createSpatialState();
  const exchange = [{
    messageId: 1,
    role: 'assistant',
    content: 'We return to the campsite beside Rimecross. The same campsite still holds the permanent supply crates.',
  }];

  const result = processSpatialCapture({
    rawSpatialMutations: [{
      action: 'upsert_location',
      name: 'the campsite',
      type: 'camp',
      admissionReason: 'revisited',
      evidence: [{
        sourceMessageId: 1,
        claim: 'We return to the campsite beside Rimecross.',
      }],
    }],
    spatial,
    exchange,
    visibleLocations: [],
    profile: spatial.profile,
    chatKey: 'chat:test:revisited-camp',
    sourceMessageId: 1,
    sourceLineageKey: 'ln1',
  });

  assert.equal(result.applied.length, 1);
  assert.equal(result.spatial.locations[0].name, 'the campsite');
});

test('Name-only capture cannot duplicate or automatically override a visible base location', () => {
  const baseMap = parseBaseMap(fs.readFileSync('tests/fixtures/ternia-sample.json', 'utf8'));
  const spatial = createSpatialState();
  spatial.profile = baseMap.profile;
  const halmere = resolveEffectiveLocations(spatial, baseMap).find(item => item.name === 'Halmere');
  assert.ok(halmere);

  const exchange = [{
    messageId: 1,
    role: 'assistant',
    content: 'Halmere remains the northern march city, unchanged on the map.',
  }];

  const result = processSpatialCapture({
    rawSpatialMutations: [{
      action: 'upsert_location',
      name: 'Halmere',
      type: 'city',
      admissionReason: 'named',
      context: 'northern march city',
      evidence: [{
        sourceMessageId: 1,
        claim: 'Halmere remains the northern march city',
      }],
    }],
    spatial,
    exchange,
    visibleLocations: [halmere],
    baseMap,
    profile: baseMap.profile,
    chatKey: 'chat:test:base-duplicate',
    sourceMessageId: 1,
    sourceLineageKey: 'ln1',
  });

  assert.equal(result.spatial.locations.length, 0, 'automatic capture must not mint a campaign duplicate');
  assert.equal(result.applied.length, 0, 'base canonical location requires explicit campaign override');
  assert.ok(result.rejected.some(item => /base/i.test(item.reason)));
});

test('Host Spatial lifecycle preloads base authority and fails closed when attached source is unavailable', () => {
  const source = fs.readFileSync('index.js', 'utf8');

  assert.match(
    source,
    /if \(loadedState\?\.spatial\?\.baseMapRef\?\.id\) \{[\s\S]*await getChatBaseMap\(chatKey, loadedState\)[\s\S]*resetSpatialRelevanceIndex/,
  );
  assert.match(
    source,
    /if \(before\.spatial\?\.baseMapRef\?\.id && !baseMap\) \{\s*spatialCaptureEnabled = false;/,
  );
  assert.match(
    source,
    /if \(!baseRef\?\.id \|\| baseMap\) \{[\s\S]*buildSpatialInjection/,
  );
  assert.match(
    source,
    /const coordinateChanged = fd\.x !== priorX[\s\S]*nextAuthority !== String\(priorCoord\.authority \|\| 'unknown'\)/,
  );
});

test('Automatic capture cannot rewrite operator-authored relation or route semantics', () => {
  let state = createState('chat:test:manual-spatial-authority');

  const addA = applySpatialManualMutation({
    state,
    chat: [],
    chatKey: state.chatKey,
    mutation: { action: 'upsert_location', name: 'Anchor A', type: 'post' },
    note: 'Operator adds Anchor A.',
  });
  state = addA.state;
  const addB = applySpatialManualMutation({
    state,
    chat: [],
    chatKey: state.chatKey,
    mutation: { action: 'upsert_location', name: 'Anchor B', type: 'post' },
    note: 'Operator adds Anchor B.',
  });
  state = addB.state;
  const [a, b] = state.spatial.locations;

  const manualRelation = applySpatialManualMutation({
    state,
    chat: [],
    chatKey: state.chatKey,
    mutation: {
      action: 'upsert_relation',
      fromId: a.id,
      toId: b.id,
      direction: 'east',
      distanceKm: 10,
      distanceMode: 'route',
      notes: 'Operator-owned relation.',
    },
    note: 'Operator records the road relation.',
  });
  state = manualRelation.state;

  const manualRoute = applySpatialManualMutation({
    state,
    chat: [],
    chatKey: state.chatKey,
    mutation: {
      action: 'upsert_route',
      name: 'Old Timber Road',
      type: 'road',
      endpoints: [a.id, b.id],
      context: 'Operator-owned route.',
    },
    note: 'Operator records Old Timber Road.',
  });
  state = manualRoute.state;

  const relationId = state.spatial.relations[0].id;
  const routeId = state.spatial.routes[0].id;

  const automatic = reduceSpatialMutations(state.spatial, {
    chatKey: state.chatKey,
    messageId: 12,
    lineageKey: 'ln12',
    operation: 'capture',
    mutations: [
      {
        action: 'upsert_relation',
        relationId,
        fromId: a.id,
        toId: b.id,
        direction: 'west',
        distanceKm: 99,
        distanceMode: 'straight_line',
        notes: 'Model rewrite.',
        evidence: [{ sourceMessageId: 12, lineageKey: 'ln12', sourceClass: 'assistant_narration', claim: 'The route is mentioned again.' }],
      },
      {
        action: 'upsert_route',
        routeId,
        name: 'Old Timber Road',
        type: 'sea lane',
        endpoints: [a.id],
        waypoints: [b.id],
        context: 'Model rewrite.',
        evidence: [{ sourceMessageId: 12, lineageKey: 'ln12', sourceClass: 'assistant_narration', claim: 'The route is mentioned again.' }],
      },
    ],
  }, null, { visibleLocations: state.spatial.locations });

  assert.equal(automatic.applied.length, 2, 'confirming automatic evidence may still attach');
  const relation = automatic.spatial.relations.find(item => item.id === relationId);
  assert.equal(relation.direction, 'east');
  assert.equal(relation.distanceKm, 10);
  assert.equal(relation.distanceMode, 'route');
  assert.equal(relation.notes, 'Operator-owned relation.');

  const route = automatic.spatial.routes.find(item => item.id === routeId);
  assert.equal(route.type, 'road');
  assert.deepEqual(route.endpoints, [a.id, b.id]);
  assert.deepEqual(route.waypoints, []);
  assert.equal(route.context, 'Operator-owned route.');
});

test('writer_state planning cannot establish a Reality Core fact', async () => {
  const state = createState('chat:test:writer-reality');
  const exchange = [{
    messageId: 0,
    role: 'assistant',
    lineageKey: 'ln0',
    content: '<writer_state>The Northglass bridge is destroyed.</writer_state>The river runs quietly beneath the intact bridge.',
  }];

  const result = await runCaptureOperation({
    ctx: {
      extensionSettings: { world_state_alpha: {}, disabledExtensions: [] },
      async generateRaw() {
        return JSON.stringify({
          mutations: [{
            action: 'create',
            kind: 'fact',
            summary: 'The Northglass bridge is destroyed.',
            anchors: ['Northglass bridge'],
            reason: 'planned destruction',
            evidence: [{
              sourceMessageId: 0,
              claim: 'The Northglass bridge is destroyed.',
            }],
          }],
        });
      },
    },
    state,
    exchange,
    visibleRecords: [],
    chatKey: state.chatKey,
    sourceMessageId: 0,
    sourceLineageKey: 'ln0',
    operationId: 'writer-reality',
    isCurrent: () => true,
  });

  assert.equal(result.providerCalls, 1);
  assert.equal(result.state.records.length, 0);
  assert.equal(result.applied.length, 0);
  assert.ok(result.rejected.length > 0);
});

test('writer_state planning cannot move an established location or create a route', () => {
  const spatial = createSpatialState();
  spatial.locations.push(
    normalizeSpatialLocation({
      id: 'wsloc_watch',
      name: 'Fallow Watch',
      type: 'ruin',
      coordinate: { x: 10, y: 20, authority: 'narrative_explicit', locked: false },
    }),
    normalizeSpatialLocation({
      id: 'wsloc_cross',
      name: 'Rimecross',
      type: 'town',
      coordinate: { x: 5, y: 15, authority: 'manual', locked: true },
    }),
  );

  const exchange = [{
    messageId: 4,
    role: 'assistant',
    content: [
      '<writer_state>',
      'Move Fallow Watch to [99, 99].',
      'Create the Secret Wolf Road between Fallow Watch and Rimecross.',
      '</writer_state>',
      'Fallow Watch remains quiet beneath the evening rain.',
    ].join('\n'),
  }];

  const result = processSpatialCapture({
    rawSpatialMutations: [
      {
        action: 'upsert_location',
        locationId: 'wsloc_watch',
        name: 'Fallow Watch',
        type: 'ruin',
        admissionReason: 'explicit_coordinate',
        coordinate: { x: 99, y: 99 },
        evidence: [{ sourceMessageId: 4, claim: 'Move Fallow Watch to [99, 99].' }],
      },
      {
        action: 'upsert_route',
        name: 'Secret Wolf Road',
        type: 'road',
        endpoints: ['wsloc_watch', 'wsloc_cross'],
        evidence: [{ sourceMessageId: 4, claim: 'Create the Secret Wolf Road between Fallow Watch and Rimecross.' }],
      },
    ],
    spatial,
    exchange,
    visibleLocations: spatial.locations,
    profile: spatial.profile,
    chatKey: 'chat:test:writer-spatial-update',
    sourceMessageId: 4,
    sourceLineageKey: 'ln4',
  });

  assert.equal(result.applied.length, 0);
  assert.equal(result.spatial.locations.find(item => item.id === 'wsloc_watch').coordinate.x, 10);
  assert.equal(result.spatial.routes.length, 0);
  assert.equal(result.rejected.length, 2);
});

test('rebuild cannot shadow a base-map location through narrative coordinate authority', async () => {
  const baseMap = parseBaseMap(fs.readFileSync('tests/fixtures/ternia-sample.json', 'utf8'));
  const halmere = baseMap.locations.find(item => item.name === 'Halmere');
  assert.ok(halmere);

  const state = createState('rebuild-base-authority');
  state.spatial.profile = baseMap.profile;
  state.spatial.baseMapRef = {
    id: baseMap.id,
    digest: baseMap.digest,
    adapter: baseMap.adapter,
  };
  const chat = [
    { role: 'user', content: 'I check the map.' },
    { role: 'assistant', content: 'Halmere is at (99, 88).' },
  ];
  const result = await runManualRebuild({
    ctx: {},
    state,
    chat,
    chatKey: 'rebuild-base-authority',
    spatialEnabled: true,
    baseMap,
    spatialProfile: baseMap.profile,
    isCurrent: () => true,
    dispatcher: async () => ({
      text: JSON.stringify({
        mutations: [],
        spatialMutations: [{
          action: 'upsert_location',
          locationId: halmere.id,
          name: 'Halmere',
          type: halmere.type,
          admissionReason: 'explicit_coordinate',
          coordinate: { x: 99, y: 88, authority: 'narrative_explicit' },
          evidence: [{ sourceMessageId: 1, claim: 'Halmere is at (99, 88).' }],
        }],
      }),
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
    }),
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.state.spatial.locations.length, 0, 'rebuild must not create a campaign shadow of base authority');
  const effective = resolveEffectiveLocations(result.state.spatial, baseMap).find(item => item.id === halmere.id);
  assert.equal(effective.coordinate.x, halmere.coordinate.x);
  assert.equal(effective.coordinate.y, halmere.coordinate.y);
});

test('rebuild aborts on a structurally malformed Spatial mutation row', async () => {
  const chat = [
    { role: 'user', content: 'I arrive.' },
    { role: 'assistant', content: 'Applecross Culvert is visible.' },
  ];
  const original = createState('rebuild-spatial-wire');
  original.spatial.locations.push(normalizeSpatialLocation({
    id: 'wsloc_existing',
    name: 'Existing Place',
    coordinate: { x: 1, y: 2, authority: 'narrative_explicit', locked: false },
  }));
  const result = await runManualRebuild({
    ctx: {},
    state: original,
    chat,
    chatKey: 'rebuild-spatial-wire',
    spatialEnabled: true,
    isCurrent: () => true,
    dispatcher: async () => ({
      text: JSON.stringify({
        mutations: [],
        spatialMutations: [{ action: 'upsert_location', name: 'Applecross Culvert' }],
      }),
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
    }),
  });
  assert.equal(result.outcome, 'failure');
  assert.deepEqual(result.state, normalizeState(original, { chatKey: 'rebuild-spatial-wire' }));
});

test('direct spatial relation requires grounded direction and distance fields', () => {
  const spatial = createSpatialState();
  spatial.locations.push(
    normalizeSpatialLocation({ id: 'oakford', name: 'Oakford', coordinate: { x: null, y: null, authority: 'unknown' } }),
    normalizeSpatialLocation({ id: 'pineford', name: 'Pineford', coordinate: { x: null, y: null, authority: 'unknown' } }),
  );
  const exchange = [{
    messageId: 4,
    lineageKey: 'ln4',
    role: 'assistant',
    content: 'Oakford and Pineford are both quiet today.',
  }];
  const result = processSpatialCapture({
    rawSpatialMutations: [{
      action: 'upsert_relation',
      fromId: 'oakford',
      toId: 'pineford',
      direction: 'north',
      distanceKm: 900,
      distanceMode: 'straight_line',
      evidence: [{ sourceMessageId: 4, claim: 'Oakford and Pineford are both quiet today.' }],
    }],
    spatial,
    exchange,
    visibleLocations: spatial.locations,
    chatKey: 'relation-grounding',
    sourceMessageId: 4,
    sourceLineageKey: 'ln4',
  });
  assert.equal(result.spatial.relations.length, 0);
  assert.match(result.rejected[0]?.reason || '', /grounded direction|numeric distance/i);
});

test('grounded named place survives an unsupported optional relative block', () => {
  const spatial = createSpatialState();
  spatial.locations.push(normalizeSpatialLocation({
    id: 'brackenford-visible',
    name: 'Brackenford',
    type: 'village',
    coordinate: { x: null, y: null, authority: 'unknown' },
  }));
  const exchange = [{
    messageId: 2,
    lineageKey: 'ln2',
    role: 'assistant',
    content: 'Down the lane at the Northgate Stockyard, iron tires clattered against split-log ramps.',
  }];

  const result = processSpatialCapture({
    rawSpatialMutations: [{
      action: 'upsert_location',
      name: 'Northgate Stockyard',
      type: 'yard',
      context: 'Stockyard with timber racks and rental handcarts',
      admissionReason: 'named',
      relative: {
        toLocationId: 'brackenford-visible',
        direction: 'unspecified',
        distanceKm: null,
        distanceMode: 'unspecified',
      },
      evidence: [{
        sourceMessageId: 2,
        claim: 'Down the lane at the Northgate Stockyard, iron tires clattered against split-log ramps.',
      }],
    }],
    spatial,
    exchange,
    visibleLocations: spatial.locations,
    chatKey: 'named-place-relative-drop',
    sourceMessageId: 2,
    sourceLineageKey: 'ln2',
  });

  assert.equal(result.spatial.locations.some(item => item.name === 'Northgate Stockyard'), true);
  assert.equal(result.spatial.relations.length, 0);
  assert.match(
    result.rejected.find(item => item.stage === 'spatial-relative')?.reason || '',
    /relative relation dropped.*named location retained/i,
  );
});

test('direct spatial relation admits only the grounded precision actually narrated', () => {
  const spatial = createSpatialState();
  spatial.locations.push(
    normalizeSpatialLocation({ id: 'oakford-grounded', name: 'Oakford', coordinate: { x: null, y: null, authority: 'unknown' } }),
    normalizeSpatialLocation({ id: 'pineford-grounded', name: 'Pineford', coordinate: { x: null, y: null, authority: 'unknown' } }),
  );
  const exchange = [{
    messageId: 5,
    lineageKey: 'ln5',
    role: 'assistant',
    content: 'Pineford lies 10 km north of Oakford by road.',
  }];
  const result = processSpatialCapture({
    rawSpatialMutations: [{
      action: 'upsert_relation',
      fromId: 'oakford-grounded',
      toId: 'pineford-grounded',
      direction: 'north',
      distanceKm: 10,
      distanceMode: 'straight_line',
      evidence: [{ sourceMessageId: 5, claim: 'Pineford lies 10 km north of Oakford by road.' }],
    }],
    spatial,
    exchange,
    visibleLocations: spatial.locations,
    chatKey: 'relation-grounded',
    sourceMessageId: 5,
    sourceLineageKey: 'ln5',
  });
  assert.equal(result.spatial.relations.length, 1);
  assert.equal(result.spatial.relations[0].direction, 'north');
  assert.equal(result.spatial.relations[0].distanceKm, 10);
  assert.equal(result.spatial.relations[0].distanceMode, 'route', 'model straight-line precision must be downgraded to narrated road distance');
});

test('explicit World_State current-location header recovers Applecross coordinates without model Spatial output', async () => {
  const exchange = [{
    messageId: 1,
    lineageKey: 'ln1',
    role: 'assistant',
    content: '<Blocks>\n<World_State>\n**📅 Time:** CY 327, 07:29 am | **🌤 Loc:** Applecross Culvert | South of Brackenford | [31.4, 163.6] | **🌡 Wx:** Overcast, steady drizzle, 11°C, low wind\n</World_State>\n</Blocks>',
  }];
  const state = createState('applecross-header');
  const result = await runCaptureOperation({
    ctx: {},
    dispatcher: async () => ({
      text: '{"mutations":[],"spatialMutations":[]}',
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
    }),
    state,
    exchange,
    chatKey: 'applecross-header',
    sourceMessageId: 1,
    sourceLineageKey: 'ln1',
    spatialEnabled: true,
    visibleLocations: [],
    isCurrent: () => true,
  });
  assert.equal(result.outcome, 'applied');
  assert.equal(result.state.spatial.locations.length, 1);
  const place = result.state.spatial.locations[0];
  assert.equal(place.name, 'Applecross Culvert');
  assert.equal(place.coordinate.x, 31.4);
  assert.equal(place.coordinate.y, 163.6);
  assert.equal(place.coordinate.authority, 'narrative_explicit');
  assert.match(place.context, /South of Brackenford/);
});

test('deterministically recovered World_State location uses ordinary rollback ownership', async () => {
  const chat = [{
    role: 'assistant',
    content: '<World_State>\n**Loc:** Applecross Culvert | South of Brackenford | [31.4, 163.6]\n</World_State>',
  }];
  const lineage = chatLineage(chat);
  const exchange = [{ ...chat[0], messageId: 0, lineageKey: lineage[0].lineageKey }];
  const before = seedRootCheckpoint(createState('applecross-rollback'));
  const captured = await runCaptureOperation({
    ctx: {},
    dispatcher: async () => ({
      text: '{"mutations":[],"spatialMutations":[]}',
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
    }),
    state: before,
    exchange,
    chatKey: 'applecross-rollback',
    sourceMessageId: 0,
    sourceLineageKey: lineage[0].lineageKey,
    spatialEnabled: true,
    visibleLocations: [],
    isCurrent: () => true,
  });
  const committed = commitMutationBoundary(before, captured.state, chat, 0, 'capture');
  assert.equal(committed.spatial.locations.some(item => item.name === 'Applecross Culvert'), true);

  const rolled = reconcileBranch(committed, []);
  assert.equal(rolled.failClosed, false);
  assert.equal(rolled.state.spatial.locations.some(item => item.name === 'Applecross Culvert'), false);
});

test('Spatial-disabled capture does not apply deterministic World_State header extraction', async () => {
  const exchange = [{
    messageId: 1,
    lineageKey: 'ln1',
    role: 'assistant',
    content: '<World_State>\n**Loc:** Applecross Culvert | [31.4, 163.6]\n</World_State>',
  }];
  const result = await runCaptureOperation({
    ctx: {},
    dispatcher: async () => ({
      text: '{"mutations":[]}',
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
    }),
    state: createState('applecross-disabled'),
    exchange,
    chatKey: 'applecross-disabled',
    sourceMessageId: 1,
    sourceLineageKey: 'ln1',
    spatialEnabled: false,
    isCurrent: () => true,
  });
  assert.equal(result.state.spatial.locations.length, 0);
});

test('explicit World_State header supplements matching model proposal without duplicating it', () => {
  const spatial = createSpatialState();
  const exchange = [{
    messageId: 2,
    lineageKey: 'ln2',
    role: 'assistant',
    content: '<World_State>\n**Loc:** Applecross Culvert | South of Brackenford | [31.4, 163.6]\n</World_State>',
  }];
  const result = processSpatialCapture({
    rawSpatialMutations: [{
      action: 'upsert_location',
      name: 'Applecross Culvert',
      type: 'culvert',
      context: 'South of Brackenford',
      admissionReason: 'explicit_position',
      evidence: [{ sourceMessageId: 2, claim: 'Applecross Culvert | South of Brackenford' }],
    }],
    spatial,
    exchange,
    visibleLocations: [],
    chatKey: 'applecross-dedupe',
    sourceMessageId: 2,
    sourceLineageKey: 'ln2',
  });
  assert.equal(result.spatial.locations.length, 1);
  assert.equal(result.spatial.locations[0].coordinate.x, 31.4);
  assert.equal(result.spatial.locations[0].coordinate.y, 163.6);
});

test('rebuild recovers explicit World_State location header when provider omits Spatial mutation', async () => {
  const chat = [
    { role: 'user', content: 'I look around.' },
    {
      role: 'assistant',
      content: '<World_State>\n**Loc:** Applecross Culvert | South of Brackenford | [31.4, 163.6]\n</World_State>',
    },
  ];
  const result = await runManualRebuild({
    ctx: {},
    state: createState('applecross-rebuild'),
    chat,
    chatKey: 'applecross-rebuild',
    spatialEnabled: true,
    isCurrent: () => true,
    dispatcher: async () => ({
      text: '{"mutations":[],"spatialMutations":[]}',
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
    }),
  });
  assert.equal(result.outcome, 'completed');
  const place = result.state.spatial.locations.find(item => item.name === 'Applecross Culvert');
  assert.ok(place);
  assert.equal(place.coordinate.x, 31.4);
  assert.equal(place.coordinate.y, 163.6);
});

test('explicit current-location coordinate parser accepts signed, Markdown, pipe, and quoted-axis forms', () => {
  const forms = [
    '[+12.4, +45.0]',
    '(+12.4, +45.0)',
    'X: +12.4, Y: +45.0',
    'X: +12.4 | Y: +45.0',
    '**X:** +12.4 | **Y:** +45.0',
    '"X": +12.4, "Y": +45.0',
  ];
  for (let index = 0; index < forms.length; index += 1) {
    const name = 'Coordinate Marker ' + index;
    const result = processSpatialCapture({
      rawSpatialMutations: [],
      spatial: createSpatialState(),
      exchange: [{
        messageId: index,
        lineageKey: 'ln' + index,
        role: 'assistant',
        content: '<World_State>\n**Loc:** ' + name + ' | ' + forms[index] + '\n</World_State>',
      }],
      visibleLocations: [],
      chatKey: 'coordinate-format-' + index,
      sourceMessageId: index,
      sourceLineageKey: 'ln' + index,
    });
    assert.equal(result.spatial.locations.length, 1, forms[index]);
    assert.equal(result.spatial.locations[0].coordinate.x, 12.4, forms[index]);
    assert.equal(result.spatial.locations[0].coordinate.y, 45, forms[index]);
  }
});

test('conflicting explicit current-location coordinates fail closed without a Spatial write', () => {
  const result = processSpatialCapture({
    rawSpatialMutations: [],
    spatial: createSpatialState(),
    exchange: [{
      messageId: 3,
      lineageKey: 'ln3',
      role: 'assistant',
      content: '<World_State>\n**Loc:** Ambiguous Ford | [1, 2] | [3, 4]\n</World_State>',
    }],
    visibleLocations: [],
    chatKey: 'coordinate-conflict',
    sourceMessageId: 3,
    sourceLineageKey: 'ln3',
  });
  assert.equal(result.spatial.locations.length, 0);
  assert.match(result.rejected[0]?.reason || '', /conflicting coordinate pairs/i);
});

test('Manual Spatial API always records operator provenance even without a custom note', () => {
  const state = createState('chat:test:manual-provenance');
  const result = applySpatialManualMutation({
    state,
    chat: [],
    chatKey: state.chatKey,
    mutation: {
      action: 'upsert_location',
      name: 'Operator Camp',
      type: 'camp',
      coordinate: { x: 1, y: 2, authority: 'manual', locked: true },
    },
  });

  assert.equal(result.outcome, 'applied');
  const location = result.state.spatial.locations[0];
  assert.equal(location.evidenceIds.length, 1);
  const evidence = result.state.spatial.evidence[location.evidenceIds[0]];
  assert.equal(evidence.sourceClass, 'manual');
  assert.equal(evidence.claim, 'Manual spatial edit');
});

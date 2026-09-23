import fs from 'node:fs';
import {
  BUNDLE_VERSION,
  ROLLBACK_JOURNAL_VERSION,
  SCHEMA_VERSION,
  SIDECAR_FORMAT_VERSION,
} from '../constants.js';
import { parseBaseMap } from '../spatial-base-map.js';
import {
  authorityRank,
  createSpatialState,
  deriveCoordinate,
  directionFromDelta,
  normalizeSpatialState,
  reduceSpatialMutations,
  resolveEffectiveLocations,
  straightLineDistance,
} from '../spatial-core.js';
import { buildSpatialRelevanceIndex, selectRelevantLocations } from '../spatial-relevance.js';
import { createState, normalizeState, reduceMutations } from '../state-core.js';
import { commitMutationBoundary, reconcileBranch } from '../branch.js';
import { sanitizeAssistantNarration } from '../narrative-sanitizer.js';

const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const indexSource = fs.readFileSync('index.js', 'utf8');
const spatialCoreSource = fs.readFileSync('spatial-core.js', 'utf8');
const spatialBaseSource = fs.readFileSync('spatial-base-map.js', 'utf8');
const spatialCaptureSource = fs.readFileSync('spatial-capture.js', 'utf8');
const transferSource = fs.readFileSync('transfer.js', 'utf8');

// 1. Stage and version validation
if (inventory.stage !== 'phase9-spatial-continuity') {
  throw new Error('Phase 9 runtime inventory stage mismatch: ' + inventory.stage);
}
if (pkg.version !== '0.9.0-alpha.11' || manifest.version !== pkg.version) {
  throw new Error('Phase 9 application version markers must be synchronized to 0.9.0-alpha.11');
}
if (!indexSource.includes("WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.11'")) {
  throw new Error('Phase 9 index.js version marker not synchronized to 0.9.0-alpha.11');
}

// 2. Canonical schema version 2 for durable spatial state
if (SCHEMA_VERSION !== 2 || SIDECAR_FORMAT_VERSION !== 1 || BUNDLE_VERSION !== 1 || ROLLBACK_JOURNAL_VERSION !== 1) {
  throw new Error('Phase 9 schemaVersion must be 2 while sidecar/bundle/journal versions remain 1');
}

// 3. Module inventory and browser-safe runtime check
for (const file of [...inventory.modules, ...(inventory.assets || []), ...(inventory.hostFiles || [])]) {
  if (!fs.existsSync(file)) throw new Error('Phase 9 inventory file missing: ' + file);
}
for (const file of inventory.modules) {
  const source = fs.readFileSync(file, 'utf8');
  if (/from\s+['"]node:|require\(['"]node:/.test(source)) {
    throw new Error('browser-safe runtime module imports Node-only API: ' + file);
  }
  await import(new URL('../' + file, import.meta.url));
}

// 4. Base map parsing validation
const sampleJson = fs.readFileSync('tests/fixtures/ternia-sample.json', 'utf8');
const baseMap = parseBaseMap(sampleJson);
if (!baseMap.id || !baseMap.digest || baseMap.locations.length < 5) {
  throw new Error('Phase 9 base map parser failed on sample fixture');
}
if (baseMap.adapter !== 'ternia_v0_9_10') {
  throw new Error('Phase 9 base map adapter mismatch: ' + baseMap.adapter);
}
const genericBase = parseBaseMap({
  name: 'Generic Fixture',
  coordinate_system: {
    north: '+y',
    east: '+x',
    unit_km: 2,
    bounds: { x_min: -10, x_max: 10, y_min: -20, y_max: 20 },
    decimal_step: 0.5,
  },
  locations: [{ name: 'Node', type: 'module', coord: [1, 2] }],
});
if (genericBase.adapter !== 'generic_v1' || genericBase.profile.unitKm !== 2) {
  throw new Error('Phase 9 generic coordinate_system was incorrectly coupled to the Ternia adapter');
}
const halmere = baseMap.locations.find(l => l.name === 'Halmere');
if (!halmere || !halmere.routeRefs.includes('North Road')) {
  throw new Error('Phase 9 base map did not associate North Road anchor with Halmere');
}

// 5. Spatial coordinate math & authority validation
const dist = straightLineDistance({ x: 0, y: 0 }, { x: 3, y: 4 }, 5);
if (dist !== 25) {
  throw new Error('Phase 9 straightLineDistance incorrect: ' + dist);
}
const dir = directionFromDelta(0, 10);
if (dir !== 'north') throw new Error('Phase 9 directionFromDelta incorrect: ' + dir);
const derived = deriveCoordinate({ x: 10, y: 20 }, { direction: 'east', distanceKm: 15, distanceMode: 'straight_line', unitKm: 5 });
if (derived?.x !== 13 || derived?.y !== 20 || derived?.authority !== 'derived') {
  throw new Error('Phase 9 deriveCoordinate incorrect');
}
if (deriveCoordinate({ x: 10, y: 20 }, { direction: 'east', distanceKm: 15, distanceMode: 'straight_line' }) !== null) {
  throw new Error('Phase 9 coordinate derivation must require an explicit unit scale');
}
if (straightLineDistance({ x: 0, y: 0 }, { x: 3, y: 4 }) !== null) {
  throw new Error('Phase 9 straight-line distance conversion must require an explicit unit scale');
}
const rotatedProfile = {
  northAxis: '+x',
  eastAxis: '-y',
  unitKm: 5,
  decimalStep: 0.1,
  bounds: null,
  trueNorthLocked: true,
};
if (directionFromDelta(2, 0, rotatedProfile) !== 'north' || directionFromDelta(0, -2, rotatedProfile) !== 'east') {
  throw new Error('Phase 9 configured Cartesian axes are not authoritative');
}

if (authorityRank('manual', true) <= authorityRank('campaign_override', false)) {
  throw new Error('Phase 9 manual locked authority must outrank campaign_override');
}
if (authorityRank('campaign_override') <= authorityRank('base_canonical')) {
  throw new Error('Phase 9 campaign_override authority must outrank base_canonical');
}
if (authorityRank('base_canonical') <= authorityRank('narrative_explicit')) {
  throw new Error('Phase 9 base_canonical authority must outrank narrative_explicit');
}

// 6. Narrative Sanitizer validation
const rawNarrative = 'The party arrives at the gate. <writer_state type="analysis">Consider opening a rift</writer_state> The gatekeeper nods.';
const sanitized = sanitizeAssistantNarration(rawNarrative);
if (sanitized !== 'The party arrives at the gate.  The gatekeeper nods.') {
  throw new Error('Phase 9 narrative sanitizer did not cleanly remove writer_state block: ' + sanitized);
}

// 7. Spatial Ephemeral Relevance Indexing validation
const mockSpatial = createSpatialState();
mockSpatial.locations = Array.from({ length: 1000 }, (_, index) => ({
  id: `wsloc_perf_${index}`,
  name: index === 333 ? 'Hidden Valley Fortress' : `Location ${index}`,
  type: index === 333 ? 'stronghold' : 'landmark',
  status: 'active',
  baseRefId: null,
  coordinate: { x: index * 0.1, y: index * 0.1, authority: 'derived', locked: false },
  context: index === 333 ? 'Secret mountain pass fortress guarded by wardens.' : `Context for place ${index}`,
  routeRefs: index === 333 ? ['North Road'] : [],
  createdAtMessage: 1,
  lastChangedMessage: 1,
  evidenceIds: [],
  notes: '',
}));
const spatialIndex = buildSpatialRelevanceIndex(mockSpatial);
const spResult = selectRelevantLocations(mockSpatial, {
  index: spatialIndex,
  recentText: 'The party approaches the Hidden Valley Fortress along the rocky trail.',
  maxLocations: 6,
});
if (!spResult.metrics.indexUsed) throw new Error('Phase 9 spatial relevance did not report indexUsed');
if (spResult.selected[0]?.location?.id !== 'wsloc_perf_333') {
  throw new Error('Phase 9 spatial indexed query did not retrieve target location');
}

// 8. UI/manual host surface and semantic separation
for (const required of [
  "actionId === 'add_location_modal'",
  "actionId === 'archive_location'",
  "actionId === 'merge_location'",
  "data-wsa-field=\"authority\"",
  "data-wsa-field=\"relativeAnchor\"",
  "data-wsa-field=\"distanceMode\"",
]) {
  const source = required.startsWith('actionId') ? indexSource : fs.readFileSync('ui.js', 'utf8');
  if (!source.includes(required)) throw new Error('Phase 9 Spatial manual surface missing: ' + required);
}
if (/kind\s*[:=]\s*['"]location['"]/i.test(indexSource)) {
  throw new Error('Phase 9 must not introduce location as a Reality Core record kind');
}

for (const required of [
  'await getChatBaseMap(chatKey, loadedState)',
  'spatialCaptureEnabled = false',
  'if (!baseRef?.id || baseMap)',
  'const coordinateChanged = fd.x !== priorX',
]) {
  if (!indexSource.includes(required)) {
    throw new Error('Phase 9 host Spatial lifecycle guard missing: ' + required);
  }
}
for (const required of [
  'preserveManualRelation',
  'preserveManualRoute',
  'preserveManualMetadata',
  "context.operation === 'capture' || context.operation === 'rebuild'",
  'provider narrative cannot mutate base canonical location',
]) {
  if (!spatialCoreSource.includes(required)) {
    throw new Error('Phase 9 manual/automatic authority reducer guard missing: ' + required);
  }
}
for (const required of [
  'supplementExplicitWorldStateHeaders',
  'explicitWorldStateLocationHeaders',
  'spatial-deterministic-header',
  'groundDirectRelationProposal',
]) {
  if (!spatialCaptureSource.includes(required)) {
    throw new Error('Phase 9 Spatial capture hardening missing: ' + required);
  }
}
if (!spatialBaseSource.includes("['generic_v1', 'ternia_v0_9_10'].includes(declaredAdapter)")) {
  throw new Error('Phase 9 stored base-map adapter identity is not constrained to known adapters');
}
if (!transferSource.includes("path: ''")) {
  throw new Error('Phase 9 foreign import must clear machine-local base-map source paths');
}

// 9. Schema 1 -> Schema 2 migration and rollback safety
const schema1State = {
  schemaVersion: 1,
  chatKey: 'test:migration',
  records: [],
  evidence: {},
  links: [],
  lineage: [],
};
const migrated = normalizeState(schema1State, { strictSchema: true });
if (migrated.schemaVersion !== 2 || !migrated.spatial || !Array.isArray(migrated.spatial.locations)) {
  throw new Error('Phase 9 schema1 migration did not produce valid schema2 spatial state');
}

console.log('World State Alpha Phase 9 validation passed: version 0.9.0-alpha.11 synchronized, schemaVersion 2 durable, spatial base map adapter verified, authority firewall validated, narrative sanitizer working, and spatial relevance indexing bounded.');

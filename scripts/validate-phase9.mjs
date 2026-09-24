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
  straightLineDistance,
} from '../spatial-core.js';
import { buildSpatialRelevanceIndex, selectRelevantLocations } from '../spatial-relevance.js';
import { normalizeState } from '../state-core.js';
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
if (!/^0\.9\.0-alpha\.\d+$/.test(pkg.version) || manifest.version !== pkg.version) {
  throw new Error('Phase 9 application version markers must be synchronized to the current 0.9 alpha');
}
if (!indexSource.includes(`WORLD_STATE_ALPHA_VERSION = '${pkg.version}'`)) {
  throw new Error('Phase 9 index.js version marker not synchronized to package.json');
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
const sampleJson = fs.readFileSync('tests/fixtures/cartesian-base-map-sample.json', 'utf8');
const baseMap = parseBaseMap(sampleJson);
if (!baseMap.id || !baseMap.digest || baseMap.locations.length < 5) {
  throw new Error('Phase 9 base map parser failed on sample fixture');
}
if ('adapter' in baseMap) {
  throw new Error('Phase 9 base maps must not expose world/version-specific adapters');
}
const genericBase = parseBaseMap({
  name: 'Generic Fixture',
  profile: {
    system: 'cartesian2d',
    northAxis: '+y',
    eastAxis: '+x',
    unitKm: 2,
    bounds: { xMin: -10, xMax: 10, yMin: -20, yMax: 20 },
    decimalStep: 0.5,
    trueNorthLocked: true,
  },
  locations: [{ name: 'Node', type: 'module', coordinate: { x: 1, y: 2 } }],
  routes: [],
});
if (genericBase.profile.unitKm !== 2) {
  throw new Error('Phase 9 generalized Cartesian base-map profile was not preserved');
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
if (/ternia|parseTerniaBaseMap|generic_v1|declaredAdapter/i.test(spatialBaseSource)) {
  throw new Error('Phase 9 base-map parser still contains world/version-specific adapter logic');
}
if (!transferSource.includes("path: ''")) {
  throw new Error('Phase 9 foreign import must clear machine-local base-map source paths');
}

// 9. Pre-1.0 current-schema-only contract
let rejectedLegacySchema = false;
try {
  normalizeState({ schemaVersion: 1, records: [], evidence: {}, links: [] }, { strictSchema: true });
} catch {
  rejectedLegacySchema = true;
}
if (!rejectedLegacySchema) {
  throw new Error('Phase 9 must reject pre-current canonical schemas during pre-1.0 development');
}

console.log(`World State Alpha Phase 9 validation passed: version ${pkg.version} synchronized, schemaVersion 2 current-only, generalized Cartesian base maps verified, authority firewall validated, narrative sanitizer working, and spatial relevance indexing bounded.`);

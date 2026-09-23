import fs from 'node:fs';
import { createState } from '../state-core.js';
import {
  WORLD_STATE_UI_LIMITS,
  WORLD_STATE_UI_MAINTENANCE_ACTIONS,
  WORLD_STATE_UI_NAMESPACE,
  buildWorldStateUiModel,
  renderWorldStatePanel,
} from '../ui.js';

const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
if (!['phase6-ui-evidence', 'phase7-coexistence-host', 'phase8-release-hardening', 'phase9-spatial-continuity'].includes(inventory.stage)) throw new Error('Phase 6 cumulative runtime inventory stage mismatch');
if (!['phase7-coexistence-host', 'phase8-release-hardening', 'phase9-spatial-continuity'].includes(inventory.stage) && inventory.hostEntrypoint !== null) throw new Error('Phase 6 UI substrate must remain host-neutral before the authorized host phase');
if (!inventory.modules.includes('ui.js')) throw new Error('Phase 6 ui.js missing from runtime inventory');
if (!Array.isArray(inventory.assets) || !inventory.assets.includes('ui.css')) throw new Error('Phase 6 ui.css missing from asset inventory');

for (const file of inventory.modules) {
  if (!fs.existsSync(file)) throw new Error('missing runtime module: ' + file);
  const text = fs.readFileSync(file, 'utf8');
  if (/from\s+['"]node:|require\(['"]node:/.test(text)) throw new Error('browser runtime module imports Node-only API: ' + file);
  if (/"scope"\s*:/.test(text)) throw new Error('runtime module contains mandatory scope field: ' + file);
  await import(new URL('../' + file, import.meta.url));
}

for (const forbidden of ['commands.js', 'bootstrap.js', 'runtime.js', 'manifest.json']) {
  if (inventory.modules.includes(forbidden) || inventory.assets?.includes(forbidden)) {
    throw new Error('Phase 6 inventory contains unauthorized host/Phase 7+ artifact: ' + forbidden);
  }
}

const ui = fs.readFileSync('ui.js', 'utf8');
const css = fs.readFileSync('ui.css', 'utf8');

for (const forbidden of [
  'reduceMutations',
  'applyManualMutation',
  'applyWorldStateImport',
  'applyWorldStateReset',
  'runManualRebuild',
  'writeSidecar',
  'dispatchWorldStateRequest',
  'generateRaw',
  'provider-routing',
  'eventSource',
  'event_types',
  'executeSlashCommands',
  'npc_state_delta',
]) {
  if (ui.includes(forbidden)) throw new Error('Phase 6 UI crossed projection/host boundary: ' + forbidden);
}

if (WORLD_STATE_UI_NAMESPACE !== 'world_state_alpha_ui') throw new Error('Phase 6 UI namespace drifted');
if (WORLD_STATE_UI_LIMITS.currentRecords !== 120
  || WORLD_STATE_UI_LIMITS.recentRecords !== 40
  || WORLD_STATE_UI_LIMITS.resolvedRecords !== 80
  || WORLD_STATE_UI_LIMITS.searchRecords !== 100
  || WORLD_STATE_UI_LIMITS.diagnostics !== 80
  || WORLD_STATE_UI_LIMITS.evidence !== 32
  || WORLD_STATE_UI_LIMITS.relations !== 24) {
  throw new Error('Phase 6 UI bounds drifted');
}

const actions = WORLD_STATE_UI_MAINTENANCE_ACTIONS.map(item => item.id).join(',');
if (actions !== 'export,import,rebuild,reset') throw new Error('Phase 6 maintenance intent surface drifted');

for (const required of [
  'data-wsa-open-rebuild',
  'data-wsa-start-rebuild',
  'data-wsa-cancel-rebuild',
  'data-wsa-mobile-more',
  'Model response JSON',
  'Rejected mutations / reasons',
  'Danger zone',
  'Atomic replacement',
  'wsa-brand-icon',
  'wsa-record-disclosure',
  'data-wsa-dismiss-rebuild',
  'wsa-rebuild-toast',
]) {
  if (!ui.includes(required)) throw new Error('Phase 6 responsive/Operations invariant missing: ' + required);
}

for (const pattern of [
  /width:\s*min\(1180px,\s*calc\(100vw - 32px\)\)/,
  /@media \(max-width:\s*1099px\) and \(min-width:\s*768px\)/,
  /@media \(max-width:\s*767px\)/,
  /@media \(max-width:\s*599px\)/,
  /\.wsa-mobile-nav\s*\{/,
  /\.wsa-rebuild-sheet\s*\{/,
  /\.wsa-operation\s*\{/,
  /width:\s*100vw/,
  /height:\s*100dvh/,
  /min-height:\s*44px/,
  /focus-visible/,
]) {
  if (!pattern.test(css)) throw new Error('Phase 6 responsive/accessibility CSS invariant missing: ' + pattern);
}

const state = createState('phase6-validate');
state.records = Array.from({ length: 1000 }, (_, index) => ({
  id: 'wsr_validate_' + index,
  kind: index % 7 === 0 ? 'development' : 'fact',
  summary: index % 10 === 0 ? 'Kesselpass freight condition ' + index : 'Unrelated condition ' + index,
  status: index % 9 === 0 ? 'resolved' : 'active',
  trend: index % 7 === 0 ? 'stable' : null,
  anchors: index % 10 === 0 ? ['Kesselpass', 'freight'] : ['topic-' + index],
  createdAtMessage: index,
  lastChangedMessage: index,
  lastEvaluatedMessage: index,
  timeAnchor: '',
  evidenceIds: [],
  causedBy: [],
  affects: [],
}));

const start = performance.now();
const model = buildWorldStateUiModel(state, { query: 'Kesselpass freight' });
const html = renderWorldStatePanel(model, { activeTab: 'search' });
const elapsed = performance.now() - start;

if (model.views.current.length !== WORLD_STATE_UI_LIMITS.currentRecords) throw new Error('Phase 6 current view is not bounded');
if (model.views.recent.length !== WORLD_STATE_UI_LIMITS.recentRecords) throw new Error('Phase 6 recent view is not bounded');
if (model.views.resolved.length > WORLD_STATE_UI_LIMITS.resolvedRecords) throw new Error('Phase 6 resolved view exceeded bound');
if (model.views.search.length > WORLD_STATE_UI_LIMITS.searchRecords) throw new Error('Phase 6 search view exceeded bound');
if (html.includes('wsr_validate_')) throw new Error('Phase 6 rendered HTML leaked raw record IDs');
if (html.length > 300000) throw new Error('Phase 6 bounded rendered UI unexpectedly large: ' + html.length);

const hostile = createState('phase6-hostile');
hostile.records = [{
  id: 'wsr_hidden',
  kind: 'fact',
  summary: '<script>bad()</script>',
  status: 'active',
  trend: null,
  anchors: ['<img src=x>'],
  createdAtMessage: 1,
  lastChangedMessage: 1,
  lastEvaluatedMessage: 1,
  timeAnchor: '',
  evidenceIds: [],
  causedBy: [],
  affects: [],
}];
const hostileHtml = renderWorldStatePanel(buildWorldStateUiModel(hostile));
if (hostileHtml.includes('<script>') || hostileHtml.includes('<img src=x>')) throw new Error('Phase 6 renderer failed to escape canonical text');
if (!hostileHtml.includes('&lt;script&gt;bad()&lt;/script&gt;')) throw new Error('Phase 6 renderer did not preserve escaped canonical text');

console.log('World State Alpha Phase 6 validation passed: 1000 records bounded; rendered search ' + html.length + ' chars in ' + Math.round(elapsed * 1000) / 1000 + ' ms.');

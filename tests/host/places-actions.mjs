// Items 3 and 8: Add place never overwrites a punctuation variant; typed coordinates are the operator's.
import { report, tick } from './harness.mjs';
import { server, setup, start } from './common.mjs';
const chat = [
  { is_user: true, name: 'User', mes: 'We look for an inn.' },
  { is_user: false, name: 'Bot', mes: 'The road bends toward the river.' },
];
const env = await setup({ chat, settings: { spatialEnabled: true } });
let state = env.branch.seedRootCheckpoint(env.core.createState(env.chatKey));
state.spatial = { ...state.spatial, locations: [
  { id: 'inn', name: 'Kings-Rest', type: 'inn', status: 'active', context: 'A roadside inn', coordinate: { x: 10, y: 20, authority: 'manual', locked: true }, evidenceIds: [], routeRefs: [] },
  { id: 'mb', name: 'Millbrook', type: 'village', status: 'active', coordinate: { x: null, y: null, authority: 'unknown', locked: false }, evidenceIds: [], routeRefs: [] },
] };
state = env.core.normalizeState(state);
state = env.branch.commitMutationBoundary(env.core.createState(env.chatKey), state, chat, 1, 'seed');
const text = env.save(state, 1);
globalThis.__extension_settings.world_state_alpha.dataFiles = { [env.chatKey]: { path: env.sidecarPath, revision: 1, checksum: JSON.parse(text).checksum } };
const { __test } = await start(env);
const answers = ['Kings Rest', 'landmark', '', '', ''];
globalThis.window = { confirm: () => true, prompt: () => answers.shift() ?? '' };
await __test.applySpatialAction('add_location_modal', {}, env.chatKey);
await tick(50);
const inn = server(env).state.spatial.locations.find(loc => loc.id === 'inn');
await __test.applySpatialAction('save_location', {
  location: { id: 'mb', name: 'Millbrook', type: 'village' },
  formData: { name: 'Millbrook', type: 'village', context: '', routeRefs: [], notes: '', x: 30, y: 40, authority: 'unknown', locked: false, relativeAnchor: '', relationId: '' },
}, env.chatKey);
await tick(50);
const mb = server(env).state.spatial.locations.find(loc => loc.id === 'mb');
report({ innName: inn.name, innType: inn.type, innLocked: inn.coordinate.locked, places: server(env).state.spatial.locations.length, millbrook: mb.coordinate, notices: env.host.notices.slice(-2) });

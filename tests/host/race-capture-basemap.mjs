// Item 2: a capture waiting on the base map must not overwrite a newer save hydrated meanwhile.
import { report, tick } from './harness.mjs';
import { server, setup, start } from './common.mjs';
const chat = [
  { is_user: true, name: 'User', mes: 'We walk to the old mill.' },
  { is_user: false, name: 'Bot', mes: 'The old mill stands silent by the river.' },
];
const env = await setup({ chat, settings: { spatialEnabled: true } });
const { storeBaseMapSource } = await env.mod('host-base-map.js');
const adapter = { uploadJsonFile: async (name, value) => { env.host.files.set('/user/files/' + name, JSON.stringify(value)); return { path: '/user/files/' + name }; } };
const stored = await storeBaseMapSource(adapter, { id: 'map-1', name: 'Map', locations: [{ id: 'mill', name: 'Old Mill', coord: [1, 2] }] });
let state = env.branch.seedRootCheckpoint(env.core.createState(env.chatKey));
state.spatial.baseMapRef = stored.pointer;
state = env.core.normalizeState(state);
const text = env.save(state, 1);
globalThis.__extension_settings.world_state_alpha.dataFiles = { [env.chatKey]: { path: env.sidecarPath, revision: 1, checksum: JSON.parse(text).checksum } };
let mapGets = 0;
let release;
env.host.hooks.onGet = async url => {
  if (url !== stored.pointer.path) return null;
  mapGets += 1;
  if (mapGets === 1) return { ok: false, status: 503, text: async () => '' };
  await new Promise(resolve => { release = resolve; });
  return null;
};
await start(env);
void env.host.eventSource.emit('MESSAGE_RECEIVED', 1);
await tick(20);
const other = env.core.normalizeState(server(env).state);
other.records.push({ id: 'wsr_other', kind: 'fact', summary: 'Another device recorded that the bridge collapsed.', status: 'active', trend: null, anchors: [], createdAtMessage: 1, lastChangedMessage: 1, lastEvaluatedMessage: 1, timeAnchor: '', evidenceIds: [], causedBy: [], affects: [] });
env.save(other, 2, 'other-device');
chat.push({ is_user: true, name: 'User', mes: 'We cross the river.' });
await env.host.eventSource.emit('MESSAGE_SENT', 2);
release?.();
await tick(150);
const final = server(env);
report({ waited: typeof release === 'function', otherRecordKept: final.state.records.some(r => r.id === 'wsr_other'), revision: final.revision });

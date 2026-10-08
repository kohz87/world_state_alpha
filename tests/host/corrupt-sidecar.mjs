// Item 11: a corrupt sidecar can be replaced by an explicit reset (or rebuild/import) from the panel.
import { report, tick } from './harness.mjs';
import { setup, start } from './common.mjs';
const chat = [
  { is_user: true, name: 'User', mes: 'We ride to the north bridge.' },
  { is_user: false, name: 'Bot', mes: 'The north bridge has collapsed into the river.' },
];
const env = await setup({ chat });
const good = env.storage.encodeSidecar({ chatKey: env.chatKey, state: env.core.createState(env.chatKey), revision: 3, appVersion: 't' });
env.host.files.set(env.sidecarPath, good.slice(0, Math.floor(good.length / 2)));
globalThis.__extension_settings.world_state_alpha.dataFiles = { [env.chatKey]: { path: env.sidecarPath, revision: 3, checksum: JSON.parse(good).checksum } };
console.error = () => {};
const { __test } = await start(env, { settle: 600 });
const blocked = Boolean(__test.hydrationErrors.get(env.chatKey));
const bootstrap = __test.bootstrapRequiredChats.has(env.chatKey);
await __test.applyMaintenanceAction('reset', {}, env.chatKey);
await tick(50);
let valid = false;
try { env.storage.decodeSidecar(env.host.files.get(env.sidecarPath), { expectedChatKey: env.chatKey }); valid = true; } catch { valid = false; }
report({ blocked, bootstrap, replacedWithValid: valid, notices: env.host.notices.slice(-3) });

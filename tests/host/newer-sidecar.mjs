// Review: a readable sidecar written by a newer World State (another device) fails closed; a reset can't replace it.
import { report, tick } from './harness.mjs';
import { setup, start } from './common.mjs';
const chat = [
  { is_user: true, name: 'User', mes: 'We ride to the north bridge.' },
  { is_user: false, name: 'Bot', mes: 'The north bridge has collapsed into the river.' },
];
const env = await setup({ chat });
const { hashText, stableStringify } = await env.mod('hash.js');
const valid = JSON.parse(env.storage.encodeSidecar({ chatKey: env.chatKey, state: env.core.createState(env.chatKey), revision: 6, appVersion: 'newer' }));
const { checksum: _old, ...payload } = { ...valid, state: { ...valid.state, schemaVersion: 99 } };
const newer = JSON.stringify({ ...payload, checksum: hashText(stableStringify(payload)) });
env.host.files.set(env.sidecarPath, newer);
globalThis.__extension_settings.world_state_alpha.dataFiles = { [env.chatKey]: { path: env.sidecarPath, revision: 6, checksum: JSON.parse(newer).checksum } };
console.error = () => {};
console.warn = () => {};
const { __test } = await start(env, { settle: 600 });
const blocked = Boolean(__test.hydrationErrors.get(env.chatKey));
try { await __test.applyMaintenanceAction('reset', {}, env.chatKey); } catch { /* refused */ }
await tick(50);
report({ blocked, corruptMarked: __test.corruptSidecars.has(env.chatKey), kept: env.host.files.get(env.sidecarPath) === newer });

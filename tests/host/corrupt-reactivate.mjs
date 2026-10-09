// alpha.61 item 17: a damaged sidecar stays recovery-required on every activation, never a load error.
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
console.warn = () => {};
const { __test } = await start(env, { settle: 600 });
const first = { error: Boolean(__test.hydrationErrors.get(env.chatKey)), required: __test.bootstrapRequiredChats.has(env.chatKey) };
await env.host.eventSource.emit('EXTENSION_SETTINGS_LOADED');
await tick(100);
await env.host.eventSource.emit('CHAT_CHANGED');
await tick(600);
const second = { error: Boolean(__test.hydrationErrors.get(env.chatKey)), required: __test.bootstrapRequiredChats.has(env.chatKey) };
report({ first, second, corruptPath: __test.corruptSidecars.get(env.chatKey) === env.sidecarPath });

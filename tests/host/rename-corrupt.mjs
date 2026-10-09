// alpha.61 review: renaming a chat whose sidecar is damaged keeps it recovery-required, without an error.
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
const before = __test.bootstrapRequiredChats.has(env.chatKey);
const files = () => [...env.host.files.keys()].filter(name => !name.includes('-ops-')).length;
const filesBefore = files();
await env.host.eventSource.emit('CHAT_RENAMED', { oldFileName: 'c1.jsonl', newFileName: 'c2.jsonl', avatarId: 'a.png' });
await tick(100);
env.host.ctx.chatId = 'c2';
await env.host.eventSource.emit('CHAT_CHANGED');
await tick(600);
report({
  before,
  newSidecars: files() - filesBefore,
  newRequired: __test.bootstrapRequiredChats.has('chat:a.png:c2'),
  errors: env.host.notices.filter(item => item.startsWith('error')),
});

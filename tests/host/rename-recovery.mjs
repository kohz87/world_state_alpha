// alpha.61 item 3: renaming a chat that still needs recovery writes no empty sidecar for the new name.
import { report, tick } from './harness.mjs';
import { setup, start } from './common.mjs';
const chat = [
  { is_user: true, name: 'User', mes: 'We ride to the north bridge.' },
  { is_user: false, name: 'Bot', mes: 'The north bridge has collapsed into the river.' },
  { is_user: true, name: 'User', mes: 'We look for a ford.' },
  { is_user: false, name: 'Bot', mes: 'They find a shallow ford downstream.' },
];
const env = await setup({ chat });
console.warn = () => {};
const { __test } = await start(env, { settle: 600 });
const before = __test.bootstrapRequiredChats.has(env.chatKey);
const filesBefore = [...env.host.files.keys()].filter(name => !name.includes('-ops-')).length;
await env.host.eventSource.emit('CHAT_RENAMED', { oldFileName: 'c1.jsonl', newFileName: 'c2.jsonl', avatarId: 'a.png' });
await tick(100);
env.host.ctx.chatId = 'c2';
await env.host.eventSource.emit('CHAT_CHANGED');
await tick(600);
const newKey = 'chat:a.png:c2';
const sidecars = [...env.host.files.keys()].filter(name => !name.includes('-ops-'));
report({
  before,
  filesBefore,
  sidecarsAfter: sidecars.length,
  newRequired: __test.bootstrapRequiredChats.has(newKey),
  newCachedRecords: __test.stateCache.get(newKey)?.records?.length ?? null,
});

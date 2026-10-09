// alpha.61 review: a chat whose sidecar became unreachable keeps its cached continuity across a rename.
import { report, tick } from './harness.mjs';
import { setup, start } from './common.mjs';
const chat = [
  { is_user: true, name: 'User', mes: 'We ride north.' },
  { is_user: false, name: 'Bot', mes: 'The north bridge has collapsed into the river.' },
];
const env = await setup({ chat });
const { core, branch } = env;
let state = branch.seedRootCheckpoint(core.createState(env.chatKey));
const lineage = branch.chatLineage(chat);
const reduced = core.reduceMutations(state, { chatKey: env.chatKey, messageId: 1, lineageKey: lineage[1].lineageKey, operation: 'capture', mutations: [
  { action: 'create', kind: 'development', summary: 'The north bridge has collapsed.', evidence: [{ claim: 'The north bridge has collapsed into the river.' }] },
] });
state = branch.commitMutationBoundary(state, reduced.state, chat, 1, 'capture', { lineage });
const text = env.save(state, 4);
globalThis.__extension_settings.world_state_alpha.dataFiles = { [env.chatKey]: { path: env.sidecarPath, revision: 4, checksum: JSON.parse(text).checksum } };
console.error = () => {};
console.warn = () => {};
const { __test } = await start(env, { settle: 600 });
const loaded = __test.stateCache.get(env.chatKey)?.records?.length || 0;
// The sidecar becomes unreachable; a freshness check keeps the cached continuity and requires recovery.
env.host.hooks.onGet = async url => (url === env.sidecarPath ? { ok: false, status: 404, text: async () => '' } : null);
await __test.refreshChatStateFromServer(env.chatKey, { reason: 'test' });
const required = __test.bootstrapRequiredChats.has(env.chatKey);
await env.host.eventSource.emit('CHAT_RENAMED', { oldFileName: 'c1.jsonl', newFileName: 'c2.jsonl', avatarId: 'a.png' });
await tick(200);
const newKey = 'chat:a.png:c2';
const { worldStateHostDeterministicPath } = await env.mod('host-storage.js');
const newPath = worldStateHostDeterministicPath(env.storage.makeSidecarPath(newKey));
const saved = env.host.files.has(newPath)
  ? env.storage.decodeSidecar(env.host.files.get(newPath), { expectedChatKey: newKey }).state.records.length
  : null;
report({ loaded, required, savedRecords: saved, cachedRecords: __test.stateCache.get(newKey)?.records?.length ?? null });

// Item 1: a sidecar that 404s while the chat loads must not later be overwritten by the empty cache.
import { report, tick } from './harness.mjs';
import { server, setup, start } from './common.mjs';
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
  { action: 'create', kind: 'fact', summary: 'The baron rules the valley.', evidence: [{ claim: 'baron' }] },
  { action: 'create', kind: 'fact', summary: 'The mill is abandoned.', evidence: [{ claim: 'mill' }] },
] });
state = branch.commitMutationBoundary(state, reduced.state, chat, 1, 'capture', { lineage });
const text = env.save(state, 7);
globalThis.__extension_settings.world_state_alpha.dataFiles = { [env.chatKey]: { path: env.sidecarPath, revision: 7, checksum: JSON.parse(text).checksum } };
let gets = 0;
env.host.hooks.onGet = async url => (url === env.sidecarPath && ++gets <= 3 ? { ok: false, status: 404, text: async () => '' } : null);
await start(env, { settle: 600 });
const afterLoad = globalThis.WorldStateAlpha.getState().records.length;
chat.push({ is_user: true, name: 'User', mes: 'We look for a ford.' });
await env.host.eventSource.emit('MESSAGE_SENT', 2);
await tick(50);
chat.push({ is_user: false, name: 'Bot', mes: 'They find a shallow ford downstream.' });
await env.host.eventSource.emit('MESSAGE_RECEIVED', 3);
await tick(200);
const final = server(env);
report({ afterLoad, cachedAfterRefresh: globalThis.WorldStateAlpha.getState().records.length, serverRecords: final.state.records.length, serverRevision: final.revision });

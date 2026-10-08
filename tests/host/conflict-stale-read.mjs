// Review: after a write conflict, a read older than the revision the conflict found is still a stale read.
import { report, tick } from './harness.mjs';
import { setup, start } from './common.mjs';
const chat = [
  { is_user: true, name: 'User', mes: 'We wait at the gate.' },
  { is_user: false, name: 'Bot', mes: 'The gate stays shut.' },
];
const env = await setup({ chat });
const root = env.branch.seedRootCheckpoint(env.core.createState(env.chatKey));
const text = env.save(root, 7);
globalThis.__extension_settings.world_state_alpha.dataFiles = { [env.chatKey]: { path: env.sidecarPath, revision: 7, checksum: JSON.parse(text).checksum } };
const staleText = env.storage.encodeSidecar({ chatKey: env.chatKey, state: root, revision: 5, appVersion: 'old' });
let armed = 0;
env.host.hooks.onGet = async url => {
  if (url !== env.sidecarPath || armed === 0) return null;
  // The conflicting write sees revision 8; every later read lags behind at revision 5.
  if (armed === 1) { armed = 2; return null; }
  return { ok: true, status: 200, text: async () => staleText, json: async () => JSON.parse(staleText) };
};
env.host.ctx.generateRaw = async () => {
  // Another device saves revision 8 while this capture waits for the model.
  env.save(root, 8, 'other');
  armed = 1;
  return JSON.stringify({ mutations: [{ action: 'create', kind: 'fact', summary: 'The gate stays shut.', anchors: ['gate'], evidence: [{ sourceMessageId: 1, claim: 'The gate stays shut.' }] }] });
};
const { __test } = await start(env);
await env.host.eventSource.emit('MESSAGE_RECEIVED', 1);
await tick(200);
const rows = __test.diagnosticStore.allRecords(env.chatKey).map(row => row.code).filter(Boolean);
report({ hydratedRevision: globalThis.WorldStateAlpha.status().hydratedRevision, armed, rows });

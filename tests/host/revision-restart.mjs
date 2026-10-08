// Item 10: after a write conflict, a sidecar restarted at a lower revision (a recovered baseline) is adopted.
import { report, tick } from './harness.mjs';
import { server, setup, start } from './common.mjs';
const chat = [
  { is_user: true, name: 'User', mes: 'We wait at the gate.' },
  { is_user: false, name: 'Bot', mes: 'The gate stays shut.' },
];
const env = await setup({ chat });
const root = env.branch.seedRootCheckpoint(env.core.createState(env.chatKey));
const text = env.save(root, 7);
globalThis.__extension_settings.world_state_alpha.dataFiles = { [env.chatKey]: { path: env.sidecarPath, revision: 7, checksum: JSON.parse(text).checksum } };
env.host.ctx.generateRaw = async () => JSON.stringify({ mutations: [{ action: 'create', kind: 'fact', summary: 'The gate stays shut.', anchors: ['gate'], evidence: [{ sourceMessageId: 1, claim: 'The gate stays shut.' }] }] });
await start(env);
// Another device lost the file and recovered a baseline: revision 1 at the same path, with one record.
const lineage = env.branch.chatLineage(chat);
const recovered = env.core.reduceMutations(root, { chatKey: env.chatKey, messageId: 1, lineageKey: lineage[1].lineageKey, operation: 'capture', mutations: [
  { action: 'create', kind: 'fact', summary: 'The watch keeps the north gate barred.', anchors: ['north gate'], evidence: [{ claim: 'The gate stays shut.' }] }] });
env.save(env.branch.commitMutationBoundary(root, recovered.state, chat, 1, 'capture', { lineage }), 1, 'recovered');
// This device captures reply 1: its write expects revision 7, conflicts, and refreshes.
await env.host.eventSource.emit('MESSAGE_RECEIVED', 1);
await tick(150);
const afterConflict = globalThis.WorldStateAlpha.status().hydratedRevision;
// The next reply is captured on the recovered baseline.
chat.push({ is_user: true, name: 'User', mes: 'We knock again.' });
await env.host.eventSource.emit('MESSAGE_SENT', 2);
chat.push({ is_user: false, name: 'Bot', mes: 'The gate stays shut.' });
env.host.ctx.generateRaw = async () => JSON.stringify({ mutations: [{ action: 'create', kind: 'fact', summary: 'Nobody answers at the gate.', anchors: ['gate'], evidence: [{ sourceMessageId: 3, claim: 'The gate stays shut.' }] }] });
await env.host.eventSource.emit('MESSAGE_RECEIVED', 3);
await tick(150);
const final = server(env);
report({ afterConflict, serverRevision: final.revision, keptRecovered: final.state.records.some(r => r.summary.includes('north gate')), records: final.state.records.length });

// Item 49: after a Full rebuild recovers a fail-closed branch, the next generation is injected again.
import { report, tick } from './harness.mjs';
import { setup, start } from './common.mjs';
const chat = [
  { is_user: true, name: 'User', mes: 'We ride to the north bridge.' },
  { is_user: false, name: 'Bot', mes: 'The north bridge has collapsed into the river.' },
];
const env = await setup({ chat });
env.host.ctx.generateRaw = async () => JSON.stringify({ mutations: [{ action: 'create', kind: 'development', summary: 'The north bridge has collapsed into the river.', anchors: ['north bridge'], evidence: [{ sourceMessageId: 1, claim: 'The north bridge has collapsed into the river.' }] }] });
const old = env.core.normalizeState({ ...env.core.createState(env.chatKey), lineage: env.branch.chatLineage([{ is_user: true, name: 'User', mes: 'An earlier version.' }, chat[1]]) });
const text = env.save(old, 1);
globalThis.__extension_settings.world_state_alpha.dataFiles = { [env.chatKey]: { path: env.sidecarPath, revision: 1, checksum: JSON.parse(text).checksum } };
const { __test } = await start(env);
const dirtyBefore = __test.branchDirtyChats.has(env.chatKey);
await __test.applyMaintenanceActionNow('rebuild', { rebuild: { mode: 'full' } }, env.chatKey);
const phase = __test.rebuildStatuses.get(env.chatKey)?.phase;
chat.push({ is_user: true, name: 'User', mes: 'We look for another way across the north bridge river.' });
env.host.prompts.length = 0;
await env.host.eventSource.emit('MESSAGE_SENT', 2);
const atGeneration = env.host.prompts.at(-1)?.text || '';
await tick(50);
report({ dirtyBefore, phase, dirtyAfter: __test.branchDirtyChats.has(env.chatKey), injectedAtGeneration: atGeneration.includes('north bridge') });

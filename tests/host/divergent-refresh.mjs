// Item 9: another device's state captured on a different branch is not injected before reconcile.
import { report, tick } from './harness.mjs';
import { setup, start } from './common.mjs';
const chat = [
  { is_user: true, name: 'User', mes: 'We wait at the gate.' },
  { is_user: false, name: 'Bot', mes: 'The gate stays shut.' },
];
const env = await setup({ chat });
const root = env.branch.seedRootCheckpoint(env.core.createState(env.chatKey));
const text = env.save(root, 1);
globalThis.__extension_settings.world_state_alpha.dataFiles = { [env.chatKey]: { path: env.sidecarPath, revision: 1, checksum: JSON.parse(text).checksum } };
const { __test } = await start(env);
const otherChat = [chat[0], { is_user: false, name: 'Bot', mes: 'The gate is smashed open by the raiders.' }];
const lineage = env.branch.chatLineage(otherChat);
const red = env.core.reduceMutations(root, { chatKey: env.chatKey, messageId: 1, lineageKey: lineage[1].lineageKey, operation: 'capture', mutations: [
  { action: 'create', kind: 'fact', summary: 'Raiders smashed the gate open.', anchors: ['gate'], evidence: [{ claim: 'The gate is smashed open by the raiders.' }] }] });
env.save(env.branch.commitMutationBoundary(root, red.state, otherChat, 1, 'capture', { lineage }), 2, 'other-device');
chat.push({ is_user: true, name: 'User', mes: 'We knock at the gate again.' });
env.host.prompts.length = 0;
await env.host.eventSource.emit('MESSAGE_SENT', 2);
const atGeneration = env.host.prompts.at(-1)?.text || '';
const dirtyAtGeneration = __test.branchDirtyChats.has(env.chatKey);
await tick(100);
report({ dirtyAtGeneration, injectedOtherBranch: atGeneration.includes('Raiders smashed the gate open') });

// Review: a refresh that finds the sidecar damaged logs it; a later readable sidecar clears the damage mark.
import { report } from './harness.mjs';
import { setup, start } from './common.mjs';
const chat = [
  { is_user: true, name: 'User', mes: 'We wait at the gate.' },
  { is_user: false, name: 'Bot', mes: 'The gate stays shut.' },
];
const env = await setup({ chat });
const root = env.branch.seedRootCheckpoint(env.core.createState(env.chatKey));
const text = env.save(root, 3);
globalThis.__extension_settings.world_state_alpha.dataFiles = { [env.chatKey]: { path: env.sidecarPath, revision: 3, checksum: JSON.parse(text).checksum } };
console.error = () => {};
const { __test } = await start(env);
env.host.files.set(env.sidecarPath, text.slice(0, 40));
const corrupt = await __test.refreshChatStateFromServer(env.chatKey, { reason: 'boundary', retryDeterministicMiss: false });
const loggedCorrupt = __test.diagnosticStore.allRecords(env.chatKey).some(row => row.code === 'WORLD_STATE_CORRUPT_SIDECAR');
const markedAfterCorrupt = __test.corruptSidecars.has(env.chatKey);
// Another device's recovery writes a readable sidecar again.
env.save(root, 1, 'recovered');
const after = await __test.refreshChatStateFromServer(env.chatKey, { reason: 'boundary', retryDeterministicMiss: false });
report({ corrupt: corrupt.outcome, loggedCorrupt, markedAfterCorrupt, after: after.outcome, markedAfterRecovery: __test.corruptSidecars.has(env.chatKey) });

// alpha.60: forfeiting a missed capture clears it from the panel without a rebuild and changes no World State.
import { report, tick } from './harness.mjs';
import { server, setup, start } from './common.mjs';

const chat = [{ is_user: false, name: 'Bot', mes: 'The road is quiet.' }];
const env = await setup({ chat, sidecar: null });
const seeded = env.branch.seedRootCheckpoint(env.core.createState(env.chatKey));
const text = env.save(seeded, 1);
globalThis.__extension_settings.world_state_alpha.dataFiles = { [env.chatKey]: { path: env.sidecarPath, revision: 1, checksum: JSON.parse(text).checksum } };
console.warn = () => {};
console.error = () => {};
const { __test } = await start(env, { settle: 300 });
const diagnostics = await env.mod('diagnostics.js');
const listed = () => diagnostics.unrecoveredCaptureFailures(__test.diagnosticStore.recoveryRows(env.chatKey)).map(item => item.messageId);

const exchange = async (user, reply, answer) => {
  chat.push({ is_user: true, name: 'User', mes: user });
  await env.host.eventSource.emit('MESSAGE_SENT', chat.length - 1);
  await tick(40);
  chat.push({ is_user: false, name: 'Bot', mes: reply });
  env.host.ctx.generateRaw = async () => answer(chat.length - 1);
  await env.host.eventSource.emit('MESSAGE_RECEIVED', chat.length - 1);
  await tick(300);
};
// Message 2 fails (not JSON); message 4 is captured.
await exchange('We ride on.', 'The north bridge has collapsed into the river.', () => 'not json at all');
await exchange('We camp.', 'The mill burns through the night.', id => JSON.stringify({ mutations: [{ action: 'create', kind: 'fact', summary: 'The mill burns through the night.', anchors: ['mill'], evidence: [{ sourceMessageId: id, claim: 'The mill burns through the night.' }] }] }));
const failedBefore = listed();
const before = server(env);

globalThis.window.confirm = () => false;
await __test.applyMaintenanceAction('forfeit_capture', { messageId: 2 }, env.chatKey);
await tick(100);
const afterDecline = listed();

globalThis.window.confirm = () => true;
await __test.applyMaintenanceAction('forfeit_capture', { messageId: 4 }, env.chatKey);
await tick(100);
const staleNotice = env.host.notices.some(notice => /no longer listed/.test(notice));

await __test.applyMaintenanceAction('forfeit_capture', { messageId: 2 }, env.chatKey);
await tick(300);
const after = server(env);
const opsFile = [...env.host.files.entries()].find(([path]) => path.includes('world-state-alpha-ops-'));
report({
  failedBefore,
  afterDecline,
  staleNotice,
  afterForfeit: listed(),
  revision: [before.revision, after.revision],
  records: [before.state.records.length, after.state.records.length],
  savedForfeit: Boolean(opsFile && /"forfeited"/.test(opsFile[1])),
  success: env.host.notices.some(notice => /forfeited\. World State is unchanged/.test(notice)),
});

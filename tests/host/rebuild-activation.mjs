// Item 50: a same-chat activation that only extends the lineage does not cancel a running rebuild.
import { report, tick } from './harness.mjs';
import { setup, start } from './common.mjs';
const chat = [];
for (let i = 0; i < 4; i += 1) {
  chat.push({ is_user: true, name: 'User', mes: 'Turn ' + i + ': we walk on.' });
  chat.push({ is_user: false, name: 'Bot', mes: 'Reply ' + i + ': the road is quiet.' });
}
const env = await setup({ chat });
let release = null;
env.host.ctx.generateRaw = async () => { await new Promise(resolve => { release = resolve; }); return '{"mutations": []}'; };
const text = env.save(env.branch.seedRootCheckpoint(env.core.createState(env.chatKey)), 1);
globalThis.__extension_settings.world_state_alpha.dataFiles = { [env.chatKey]: { path: env.sidecarPath, revision: 1, checksum: JSON.parse(text).checksum } };
const { __test } = await start(env);
const run = __test.applyMaintenanceAction('rebuild', { rebuild: { mode: 'full' } }, env.chatKey);
await tick(20);
release(); await tick(10);
chat.push({ is_user: true, name: 'User', mes: 'Turn 4: we keep going.' });
await env.host.eventSource.emit('CHAT_CHANGED');
await tick(10);
for (let i = 0; i < 8 && release; i += 1) { const r = release; release = null; r(); await tick(15); }
await run;
report({ phase: __test.rebuildStatuses.get(env.chatKey)?.phase });

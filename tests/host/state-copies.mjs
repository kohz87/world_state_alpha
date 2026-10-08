// alpha.59: counts full state copies (normalizeState / cloneState) along an ordinary capture and a user send.
// The copied runtime's state-core.js is instrumented; the repository is never modified.
import fs from 'node:fs';
import path from 'node:path';
import { createHost, prepareHost, report, tick } from './harness.mjs';

const layout = prepareHost();
process.on('exit', layout.cleanup);
const core = path.join(layout.ext, 'state-core.js');
let source = fs.readFileSync(core, 'utf8');
source = source.replace('export function normalizeState(raw,',
  'export function normalizeState(raw, options) { globalThis.__copies.normalize += 1; return normalizeStateInner(raw, options); }\nfunction normalizeStateInner(raw,');
source = source.replace('export function cloneState(state) {',
  'export function cloneState(state) { globalThis.__copies.clone += 1; return cloneStateInner(state); }\nfunction cloneStateInner(state) {');
fs.writeFileSync(core, source);
globalThis.__copies = { normalize: 0, clone: 0 };
const reset = () => Object.assign(globalThis.__copies, { normalize: 0, clone: 0 });
const take = () => ({ ...globalThis.__copies });

const chat = [{ is_user: false, name: 'Bot', mes: 'The road is quiet.' }];
const host = createHost({ chat });
globalThis.window = { confirm: () => true, prompt: () => 'note' };
globalThis.__extension_settings.world_state_alpha = {};
console.warn = () => {};
const stateCore = await import(layout.url('state-core.js'));
const branch = await import(layout.url('branch.js'));
const storage = await import(layout.url('storage.js'));
const hostStorage = await import(layout.url('host-storage.js'));
const chatKey = 'chat:a.png:c1';
const sidecarPath = hostStorage.worldStateHostDeterministicPath(storage.makeSidecarPath(chatKey));
const text = storage.encodeSidecar({ chatKey, state: branch.seedRootCheckpoint(stateCore.createState(chatKey)), revision: 1, appVersion: 'x' });
host.files.set(sidecarPath, text);
globalThis.__extension_settings.world_state_alpha.dataFiles = { [chatKey]: { path: sidecarPath, revision: 1, checksum: JSON.parse(text).checksum } };
await import(layout.url('index.js'));
await tick(5);
await host.eventSource.emit('APP_READY');
await tick(300);

const exchange = async (index, userText, botText) => {
  chat.push({ is_user: true, name: 'User', mes: userText });
  await host.eventSource.emit('MESSAGE_SENT', chat.length - 1);
  await tick(40);
  chat.push({ is_user: false, name: 'Bot', mes: botText });
  host.ctx.generateRaw = async () => JSON.stringify({ mutations: [{ action: 'create', kind: 'fact', summary: botText, anchors: ['condition ' + index], evidence: [{ sourceMessageId: chat.length - 1, claim: botText }] }] });
};
for (let index = 0; index < 4; index += 1) {
  await exchange(index, 'We walk on.', 'Condition number ' + index + ' holds in the valley.');
  await host.eventSource.emit('MESSAGE_RECEIVED', chat.length - 1);
  await tick(80);
}
await exchange(9, 'We reach the bridge.', 'The north bridge has collapsed into the river.');
reset();
await host.eventSource.emit('MESSAGE_RECEIVED', chat.length - 1);
await tick(400);
const capture = take();
const records = globalThis.WorldStateAlpha.getState().records.length;
reset();
chat.push({ is_user: true, name: 'User', mes: 'We look around.' });
await host.eventSource.emit('MESSAGE_SENT', chat.length - 1);
await tick(300);
report({ capture, send: take(), records });

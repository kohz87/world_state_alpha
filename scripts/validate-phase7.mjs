import fs from 'node:fs';
import {
  buildWorldStateChatKey,
  getWorldStateChatKey,
} from '../host-identity.js';
import {
  WORLD_STATE_HOST_FILE_PREFIX,
  createSillyTavernWorldStateStorageAdapter,
  worldStateHostFileName,
} from '../host-storage.js';
import { createState } from '../state-core.js';
import { encodeSidecar, writeSidecar } from '../storage.js';

const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

if (!['phase7-coexistence-host', 'phase8-release-hardening', 'phase9-spatial-continuity'].includes(inventory.stage)) throw new Error('Phase 7 runtime inventory stage mismatch');
if (inventory.hostEntrypoint !== 'bootstrap.js') throw new Error('Phase 7 host entrypoint must be bootstrap.js');
if (!Array.isArray(inventory.hostFiles)
  || inventory.hostFiles.join(',') !== 'bootstrap.js,index.js,manifest.json') {
  throw new Error('Phase 7 host file inventory drifted');
}
for (const file of ['host-identity.js', 'host-storage.js']) {
  if (!inventory.modules.includes(file)) throw new Error('Phase 7 browser-safe host helper missing: ' + file);
}
for (const file of [...inventory.modules, ...(inventory.assets || []), ...(inventory.hostFiles || [])]) {
  if (!fs.existsSync(file)) throw new Error('Phase 7 inventory file missing: ' + file);
}
for (const file of inventory.modules) {
  const source = fs.readFileSync(file, 'utf8');
  if (/from\s+['"]node:|require\(['"]node:/.test(source)) {
    throw new Error('browser-safe runtime module imports Node-only API: ' + file);
  }
  await import(new URL('../' + file, import.meta.url));
}

if (!['0.7.0-alpha.1', '0.8.0-alpha.1', '0.9.0-alpha.1', '0.9.0-alpha.2', '0.9.0-alpha.3'].includes(pkg.version) || manifest.version !== pkg.version) {
  throw new Error('Phase 7 application version markers are inconsistent');
}
if (manifest.display_name !== 'World State Alpha'
  || manifest.js !== 'bootstrap.js'
  || manifest.css !== 'ui.css'
  || manifest.loading_order !== 120
  || manifest.minimum_client_version !== '1.18.0') {
  throw new Error('Phase 7 SillyTavern manifest contract drifted');
}
if ((manifest.requires || []).length || (manifest.optional || []).length || (manifest.dependencies || []).length) {
  throw new Error('Phase 7 must have no installed-extension dependency');
}

const index = fs.readFileSync('index.js', 'utf8');
const bootstrap = fs.readFileSync('bootstrap.js', 'utf8');
const hostStorage = fs.readFileSync('host-storage.js', 'utf8');
const hostIdentity = fs.readFileSync('host-identity.js', 'utf8');
const hostRuntime = [index, bootstrap, hostStorage, hostIdentity].join('\n');

for (const forbidden of [
  'npc_state_delta',
  'NPCStateDelta',
  'npc-state-delta',
  'npc_state_',
  'npc-state-',
  'Ukiyo',
  'Megumin',
  "Writer's Mind",
  'MutationObserver',
  'registerSlash',
  'SlashCommand',
]) {
  if (hostRuntime.includes(forbidden)) throw new Error('Phase 7 host crossed coexistence boundary: ' + forbidden);
}
for (const required of [
  "WORLD_STATE_HOST_NAMESPACE = 'world_state_alpha'",
  "WORLD_STATE_SETTINGS_ID = 'world_state_alpha_settings'",
  "WORLD_STATE_PANEL_ROOT_ID = 'world_state_alpha_panel_root'",
  'globalThis.WorldStateAlpha = Object.freeze',
  'WORLD_STATE_PROMPT_KEY',
  'runCaptureOperation({',
  'prepareWorldStateContinuity({',
  'affectingEvidence: []',
  'detectElapsedHintFromExchange(exchange)',
  'cancelWorldStateRequests({ chatKey })',
  'reconcileBranch(state, getContext().chat || [])',
  "commitMutationBoundary(before, result.state, liveChat, messageId, 'capture'",
  "commitMutationBoundary(before, prepared.state, liveChat, messageId, 'evolution'",
  'previewWorldStateImport',
  'applyWorldStateImport',
  'previewWorldStateReset',
  'applyWorldStateReset',
  "if (actionId === 'rebuild')",
  'window.confirm',
]) {
  if (!index.includes(required)) throw new Error('Phase 7 host invariant missing: ' + required);
}
for (const event of [
  'MESSAGE_RECEIVED',
  'MESSAGE_SENT',
  'CHAT_LOADED',
  'CHAT_CHANGED',
  'CHARACTER_RENAMED',
  'CHARACTER_DELETED',
  'CHAT_RENAMED',
  'CHAT_DELETED',
  'GROUP_CHAT_DELETED',
  'MESSAGE_EDITED',
  'MESSAGE_DELETED',
  'MESSAGE_SWIPED',
  'MESSAGE_SWIPE_DELETED',
]) {
  if (!index.includes(event)) throw new Error('Phase 7 host event missing: ' + event);
}
if ((index.match(/runCaptureOperation\s*\(\s*\{/g) || []).length !== 1) {
  throw new Error('Phase 7 automatic capture must have exactly one host dispatch path');
}
if ((index.match(/runManualRebuild\s*\(/g) || []).length !== 1) {
  throw new Error('Phase 7 rebuild must remain one explicit maintenance path');
}
if ((index.match(/setExtensionPrompt\s*\(/g) || []).length !== 1) {
  throw new Error('Phase 7 host must centralize extension prompt writes');
}
if (!/if \(hydrationErrors\.has\(chatKey\)\)[\s\S]*WORLD_STATE_HYDRATION_BLOCKED/.test(index)) {
  throw new Error('Phase 7 hydration failure does not block persistence');
}
if (!/selectRelevantRecords\([\s\S]*maxRecords:\s*CAPTURE_LIMITS\.visibleRecords/.test(index)) {
  throw new Error('Phase 7 capture visibility is not locally bounded');
}
if (!hostStorage.includes('withWriterLock') || !hostStorage.includes('navigator?.locks')) {
  throw new Error('Phase 7 host sidecar writes are not serialized');
}
for (const [reason, stateExpr] of [['capture', 'result.state'], ['evolution', 'prepared.state']]) {
  const commitAt = index.indexOf("commitMutationBoundary(before, " + stateExpr + ", liveChat, messageId, '" + reason + "'");
  const persistAt = index.indexOf('await persistState(chatKey, committed)', commitAt);
  const publishAt = index.indexOf('setCachedState(chatKey, committed', persistAt);
  if (!(commitAt >= 0 && persistAt > commitAt && publishAt > persistAt)) {
    throw new Error('Phase 7 ' + reason + ' must persist before publishing canonical cache');
  }
}
if ((index.match(/await persistState\(chatKey, next\);\s*setCachedState\(chatKey, next\);/g) || []).length !== 2) {
  throw new Error('Phase 7 import/reset must persist before publishing canonical cache');
}

const alice = { chatId: 'same.jsonl', characterId: 0, characters: [{ avatar: 'alice.png' }] };
const bob = { chatId: 'same.jsonl', characterId: 0, characters: [{ avatar: 'bob.png' }] };
if (getWorldStateChatKey(alice) === getWorldStateChatKey(bob)) throw new Error('Phase 7 host identity does not owner-qualify chats');
if (getWorldStateChatKey({ chatId: 'same.jsonl' }) !== 'no-chat') throw new Error('Phase 7 incomplete chat identity must fail closed');
if (buildWorldStateChatKey('group', 'g', 'c') === buildWorldStateChatKey('chat', 'g', 'c')) {
  throw new Error('Phase 7 group and character chat identity collide');
}
if (WORLD_STATE_HOST_FILE_PREFIX !== 'world-state-alpha-'
  || worldStateHostFileName('world_state_alpha/x.json') !== 'world-state-alpha-x.json') {
  throw new Error('Phase 7 host file namespace drifted');
}

let uploaded = null;
const adapter = createSillyTavernWorldStateStorageAdapter({
  fetchFn: async (url, options = {}) => {
    if (url === '/api/files/upload') {
      uploaded = JSON.parse(options.body);
      return { ok: true, status: 200, async json() { return { path: '/user/files/world-state-alpha-x.json' }; } };
    }
    return { ok: false, status: 404, async text() { return ''; } };
  },
  headers: { 'Content-Type': 'application/json' },
});
const pointer = await writeSidecar({
  adapter,
  chatKey: 'chat:alice:test',
  state: createState('chat:alice:test'),
  appVersion: pkg.version,
});
if (pointer.path !== '/user/files/world-state-alpha-x.json' || pointer.revision !== 1) {
  throw new Error('Phase 7 sidecar host path/revision handoff failed');
}
if (!uploaded?.name?.startsWith('world-state-alpha-') || !uploaded?.data) {
  throw new Error('Phase 7 host upload namespace/payload failed');
}

const sidecar = encodeSidecar({
  chatKey: 'chat:alice:test',
  state: createState('chat:alice:test'),
  revision: 2,
});
let uploadAttempts = 0;
const conflicting = createSillyTavernWorldStateStorageAdapter({
  fetchFn: async url => {
    if (url === '/api/files/upload') {
      uploadAttempts += 1;
      return { ok: true, status: 200, async json() { return { path: '/unexpected' }; } };
    }
    return { ok: true, status: 200, async text() { return sidecar; } };
  },
});
const nextBody = encodeSidecar({
  chatKey: 'chat:alice:test',
  state: createState('chat:alice:test'),
  revision: 2,
});
const conflict = await conflicting.write({
  path: '/user/files/world-state-alpha-x.json',
  expectedRevision: 1,
  body: nextBody,
});
if (!conflict?.conflict || uploadAttempts !== 0) throw new Error('Phase 7 revision conflict did not fail before upload');

console.log('World State Alpha Phase 7 validation passed: isolated host entrypoint, owner-qualified identity, revision-checked Alpha sidecar, bounded capture/continuity lifecycle, and no cross-extension dependency.');

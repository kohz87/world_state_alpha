import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildWorldStateChatKey,
  getWorldStateChatIdentity,
  getWorldStateChatKey,
  parseWorldStateChatKey,
} from '../host-identity.js';
import {
  WORLD_STATE_HOST_FILE_PREFIX,
  createSillyTavernWorldStateStorageAdapter,
  worldStateHostDeterministicPath,
  worldStateHostFileName,
} from '../host-storage.js';
import { createState } from '../state-core.js';
import { encodeSidecar, writeSidecar } from '../storage.js';
import { withoutWebLocks } from './web-locks.mjs';

function response({ ok = true, status = 200, text = '', json = {} } = {}) {
  return {
    ok,
    status,
    async text() { return text; },
    async json() { return json; },
  };
}

test('Phase 7 owner-qualified identity distinguishes characters, groups, and no-chat contexts', () => {
  const one = {
    chatId: 'Shared Name.jsonl',
    characterId: 0,
    characters: [{ avatar: 'alice.png' }],
  };
  const two = {
    chatId: 'Shared Name.jsonl',
    characterId: 0,
    characters: [{ avatar: 'bob.png' }],
  };
  const group = {
    chatId: 'Shared Name.jsonl',
    groupId: 'group-7',
  };

  assert.equal(buildWorldStateChatKey('chat', 'alice.png', 'Shared Name.jsonl'), 'chat:alice.png:Shared%20Name');
  assert.deepEqual(parseWorldStateChatKey('chat:alice.png:Shared%20Name'), {
    key: 'chat:alice.png:Shared%20Name',
    kind: 'chat',
    ownerId: 'alice.png',
    chatId: 'Shared Name',
  });
  assert.notEqual(getWorldStateChatKey(one), getWorldStateChatKey(two));
  assert.notEqual(getWorldStateChatKey(one), getWorldStateChatKey(group));
  assert.match(getWorldStateChatKey(group), /^group:/);

  assert.deepEqual(getWorldStateChatIdentity({ characterId: 0, characters: [{ avatar: 'alice.png' }] }), {
    key: 'no-chat',
    kind: 'chat',
    ownerId: 'alice.png',
    chatId: '',
    ready: false,
  });
  assert.equal(getWorldStateChatKey({ chatId: 'chat-but-owner-not-ready' }), 'no-chat');
});

test('Phase 7 host sidecar filenames are World State-only and deterministic', () => {
  const first = worldStateHostFileName('world_state_alpha/abc123.json');
  const second = worldStateHostFileName('world_state_alpha/abc123.json');
  assert.equal(first, second);
  assert.equal(first.startsWith(WORLD_STATE_HOST_FILE_PREFIX), true);
  assert.equal(first, 'world-state-alpha-abc123.json');
  assert.equal(
    worldStateHostDeterministicPath('world_state_alpha/abc123.json'),
    '/user/files/world-state-alpha-abc123.json',
  );
  assert.doesNotMatch(first, /npc|delta/i);
});

test('SillyTavern host storage GETs pointers, uploads base64 JSON, and returns actual server path', async () => {
  const calls = [];
  let uploaded = null;
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/user/files/world-state-alpha-existing.json') {
      // Without Web Locks the write reads its own upload back.
      if (uploaded !== null) return response({ text: uploaded });
      return response({
        text: encodeSidecar({
          chatKey: 'chat:a:c',
          state: createState('chat:a:c'),
          revision: 2,
          appVersion: '0.7.0-alpha.1',
          updatedAt: '2026-09-21T00:00:00.000Z',
        }),
      });
    }
    if (url === '/api/files/upload') {
      uploaded = Buffer.from(JSON.parse(options.body).data, 'base64').toString('utf8');
      return response({ json: { path: '/user/files/world-state-alpha-existing.json' } });
    }
    throw new Error('unexpected URL ' + url);
  };

  const adapter = createSillyTavernWorldStateStorageAdapter({
    fetchFn,
    headersFn: () => ({ 'Content-Type': 'application/json', 'X-Test': 'alpha' }),
  });

  const body = encodeSidecar({
    chatKey: 'chat:a:c',
    state: createState('chat:a:c'),
    revision: 3,
    appVersion: '0.7.0-alpha.1',
    updatedAt: '2026-09-21T00:00:01.000Z',
  });
  const written = await adapter.write({
    path: '/user/files/world-state-alpha-existing.json',
    expectedRevision: 2,
    body,
  });

  assert.equal(written.path, '/user/files/world-state-alpha-existing.json');
  assert.equal(written.revision, 3);
  assert.equal(calls[0].url, '/user/files/world-state-alpha-existing.json');
  assert.equal(calls[0].options.method, 'GET');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[1].url, '/api/files/upload');
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.headers['X-Test'], 'alpha');
  const payload = JSON.parse(calls[1].options.body);
  assert.equal(payload.name, 'world-state-alpha-existing.json');
  assert.equal(typeof payload.data, 'string');
  assert.equal(payload.data.length > 20, true);
});

test('SillyTavern host storage exposes JSON upload/fetch for Spatial base-map sources', async () => {
  const path = '/user/files/world-state-alpha-basemap-test.json';
  let stored = '';

  const adapter = createSillyTavernWorldStateStorageAdapter({
    fetchFn: async (url, options = {}) => {
      if (url === '/api/files/upload' && options.method === 'POST') {
        const payload = JSON.parse(options.body);
        stored = Buffer.from(payload.data, 'base64').toString('utf8');
        return response({ json: { path } });
      }
      if (url === path && options.method === 'GET') {
        return response({ text: stored });
      }
      throw new Error('unexpected URL ' + url);
    },
  });

  const payload = {
    format: 'world_state_alpha_base_map',
    version: 1,
    digest: 'abc123',
    baseMap: { id: 'map-test', name: 'Test Map' },
  };
  const uploaded = await adapter.uploadJsonFile('world-state-alpha-basemap-test.json', payload);
  assert.equal(uploaded.path, path);
  assert.deepEqual(JSON.parse(stored), payload);
  assert.deepEqual(await adapter.fetchJsonFile(path), payload);
});

test('SillyTavern host storage detects revision conflict before upload', async () => {
  let uploads = 0;
  const current = encodeSidecar({
    chatKey: 'chat:a:c',
    state: createState('chat:a:c'),
    revision: 4,
  });
  const adapter = createSillyTavernWorldStateStorageAdapter({
    fetchFn: async (url) => {
      if (url === '/api/files/upload') uploads += 1;
      return url === '/api/files/upload'
        ? response({ json: { path: '/user/files/world-state-alpha-x.json' } })
        : response({ text: current });
    },
  });

  const next = encodeSidecar({
    chatKey: 'chat:a:c',
    state: createState('chat:a:c'),
    revision: 3,
  });
  const result = await adapter.write({
    path: '/user/files/world-state-alpha-x.json',
    expectedRevision: 2,
    body: next,
  });
  assert.deepEqual(result, { conflict: true, currentRevision: 4 });
  assert.equal(uploads, 0);
});

test('SillyTavern host storage serializes same-sidecar writers before revision check and upload', async () => {
  const path = '/user/files/world-state-alpha-race.json';
  let currentText = encodeSidecar({
    chatKey: 'chat:a:race',
    state: createState('chat:a:race'),
    revision: 0,
    appVersion: '0.7.0-alpha.1',
    updatedAt: '2026-09-21T00:00:00.000Z',
  });
  let uploads = 0;

  const fetchFn = async (url, options = {}) => {
    if (url === path && options.method === 'GET') {
      const snapshot = currentText;
      await new Promise(resolve => setTimeout(resolve, 5));
      return response({ text: snapshot });
    }
    if (url === '/api/files/upload' && options.method === 'POST') {
      uploads += 1;
      const payload = JSON.parse(options.body);
      currentText = Buffer.from(payload.data, 'base64').toString('utf8');
      return response({ json: { path } });
    }
    throw new Error('unexpected URL ' + url);
  };

  const adapter = createSillyTavernWorldStateStorageAdapter({ fetchFn });
  const bodyA = encodeSidecar({
    chatKey: 'chat:a:race',
    state: createState('chat:a:race'),
    revision: 1,
    appVersion: '0.7.0-alpha.1',
    updatedAt: '2026-09-21T00:00:01.000Z',
  });
  const bodyB = encodeSidecar({
    chatKey: 'chat:a:race',
    state: createState('chat:a:race'),
    revision: 1,
    appVersion: '0.7.0-alpha.1',
    updatedAt: '2026-09-21T00:00:02.000Z',
  });

  const results = await Promise.all([
    adapter.write({ path, expectedRevision: 0, body: bodyA }),
    adapter.write({ path, expectedRevision: 0, body: bodyB }),
  ]);

  assert.equal(uploads, 1);
  assert.equal(results.filter(item => item?.conflict === true).length, 1);
  assert.equal(results.filter(item => item?.revision === 1).length, 1);
});

test('core sidecar writer preserves the adapter-returned host path', async () => {
  const adapter = {
    async read() { return null; },
    async write({ expectedRevision }) {
      return {
        path: '/user/files/world-state-alpha-host-path.json',
        revision: expectedRevision + 1,
      };
    },
  };
  const pointer = await writeSidecar({
    adapter,
    chatKey: 'chat:owner:test',
    state: createState('chat:owner:test'),
    appVersion: '0.7.0-alpha.1',
  });
  assert.equal(pointer.path, '/user/files/world-state-alpha-host-path.json');
  assert.equal(pointer.revision, 1);
});

test('Phase 7 manifest and runtime inventory expose one isolated Alpha host entrypoint', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  assert.equal(manifest.display_name, 'World State Alpha');
  assert.match(manifest.version, /^(?:0\.7\.0-alpha\.1|0\.8\.0-alpha\.1|0\.9\.0-alpha\.\d+)$/);
  assert.equal(manifest.js, 'bootstrap.js');
  assert.equal(manifest.css, 'ui.css');
  assert.equal(manifest.loading_order, 120);
  assert.deepEqual(manifest.dependencies, []);
  assert.deepEqual(manifest.requires, []);
  assert.deepEqual(manifest.optional, []);

  assert.equal(pkg.version, manifest.version);
  assert.equal(['phase7-coexistence-host', 'phase8-release-hardening', 'phase9-spatial-continuity'].includes(inventory.stage), true);
  assert.equal(inventory.hostEntrypoint, 'bootstrap.js');
  assert.deepEqual(inventory.hostFiles, ['bootstrap.js', 'index.js', 'manifest.json']);
  assert.equal(inventory.modules.includes('host-identity.js'), true);
  assert.equal(inventory.modules.includes('host-storage.js'), true);
});

test('Phase 7 host runtime owns only World State settings DOM prompt storage and global namespaces', () => {
  const index = fs.readFileSync('index.js', 'utf8');
  const bootstrap = fs.readFileSync('bootstrap.js', 'utf8');
  const hostStorage = fs.readFileSync('host-storage.js', 'utf8');
  const css = fs.readFileSync('ui.css', 'utf8');
  const host = index + '\n' + bootstrap + '\n' + hostStorage;

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
  ]) assert.equal(host.includes(forbidden), false, 'host runtime must not contain ' + forbidden);

  assert.match(index, /WORLD_STATE_HOST_NAMESPACE\s*=\s*'world_state_alpha'/);
  assert.match(index, /WORLD_STATE_SETTINGS_ID\s*=\s*'world_state_alpha_settings'/);
  assert.match(index, /WORLD_STATE_PANEL_ROOT_ID\s*=\s*'world_state_alpha_panel_root'/);
  assert.match(index, /globalThis\.WorldStateAlpha\s*=\s*Object\.freeze/);
  assert.match(index, /WORLD_STATE_PROMPT_KEY/);
  assert.match(hostStorage, /world-state-alpha-/);
  assert.doesNotMatch(css, /npc-state-delta|npc_state_delta/);
});

test('host lifecycle wires capture continuity injection and exact branch reconciliation without fanout', () => {
  const source = fs.readFileSync('index.js', 'utf8');

  for (const event of [
    'MESSAGE_RECEIVED',
    'MESSAGE_SENT',
    'CHAT_LOADED',
    'CHAT_CHANGED',
    'CHARACTER_RENAMED',
    'CHARACTER_RENAMED_IN_PAST_CHAT',
    'CHARACTER_DELETED',
    'CHAT_RENAMED',
    'CHAT_DELETED',
    'GROUP_CHAT_DELETED',
    'MESSAGE_EDITED',
    'MESSAGE_DELETED',
    'MESSAGE_SWIPED',
    'MESSAGE_SWIPE_DELETED',
  ]) assert.match(source, new RegExp(event));

  assert.equal((source.match(/runCaptureOperation\s*\(\s*\{/g) || []).length, 1);
  assert.match(source, /selectLifecycleCandidates\([\s\S]*contextText:\s*lifecycleContext[\s\S]*maxRecords:\s*CAPTURE_LIMITS\.lifecycleVisibleRecords/);
  assert.match(source, /lifecycleSelection\.selected\.length === 1[\s\S]*lifecycleSelection\.selected\[0\]\?\.lifecycleSource === 'scene-context'[\s\S]*\[lifecycleSelection\.selected\[0\]\.record\?\.id\]/);
  assert.match(source, /boundedExchange\([\s\S]*CAPTURE_LIMITS\.lifecycleContextMessages[\s\S]*\.filter\(row => !currentExchangeIds\.has/);
  assert.match(source, /runCaptureOperation\(\{[\s\S]*visibleRecords:\s*visible,[\s\S]*lifecycleContextRecordIds,/);
  assert.match(source, /selectRelevantRecords\([\s\S]*maxRecords:\s*CAPTURE_LIMITS\.visibleRecords/);
  assert.match(source, /const visibleById = new Map\(\)[\s\S]*lifecycleVisible[\s\S]*tombstones[\s\S]*activeVisible/);
  assert.match(source, /prepareWorldStateContinuity\(\{[\s\S]*affectingEvidence:\s*\[\]/);
  assert.match(source, /resolveContinuityElapsedHint\(\{\s*exchange,/);
  assert.match(source, /cancelWorldStateRequests\(\{\s*chatKey\s*\}\)/);
  assert.match(source, /function invalidateChatOperations\(chatKey = currentChatKey\(\)\)/);
  assert.match(source, /return queueChatWork\(chatKey, \(\) => applyMaintenanceActionNow\(actionId, payload, chatKey\)\)/);
  assert.match(source, /return queueChatWork\(chatKey, \(\) => applySpatialActionNow\(actionId, payload, chatKey\)\)/);
  assert.match(source, /const baseMap = await getChatBaseMap\(chatKey, state\);\s*if \(currentChatKey\(\) !== chatKey \|\| hydrationErrors\.has\(chatKey\)\) return;/);
  assert.match(source, /const liveChat = getContext\(\)\.chat \|\| \[\];\n  let result = reconcileBranch\(state, liveChat, \{/);
  assert.match(source, /passiveCaptureMessageId:/);
  assert.match(source, /commitMutationBoundary\(before, result\.state, liveChat, messageId, 'capture'(?:,|\))/);
  assert.match(source, /commitMutationBoundary\(before, prepared\.state, liveChat, messageId, 'evolution'(?:,|\))/);

  assert.doesNotMatch(source, /Promise\.all\([^\n]*runCaptureOperation/);
  assert.doesNotMatch(source, /for\s*\([^)]*\)\s*\{[^}]*runCaptureOperation/s);
});

test('host identity/settings lifecycle preserves continuity across rename and disables stale work', () => {
  const source = fs.readFileSync('index.js', 'utf8');

  assert.match(source, /async function migrateWorldStateChatKey\(oldKey, newKey\)/);
  assert.match(source, /settings\.dataFiles\[newKey\] = committed;[\s\S]*settings\.sidecarTombstones\[oldKey\][\s\S]*delete settings\.dataFiles\[oldKey\]/);
  assert.match(source, /async function handleCharacterRenamed\(oldAvatar, newAvatar\)/);
  assert.match(source, /async function handleCharacterRenamedInPastChat\(messages, oldAvatar, newAvatar\)/);
  assert.match(source, /rebaseLineageMetadata\(/);
  assert.match(source, /async function handleCharacterDeleted\(eventData = \{\}\)/);
  assert.match(source, /async function handleChatRenamed\(eventData = \{\}\)/);
  assert.match(source, /async function handleChatDeleted\(eventData, forcedKind = 'chat'\)/);
  assert.match(source, /async function hostCharacterChatPresence\(/);
  assert.match(source, /function hostGroupChatPresence\(/);
  assert.match(source, /async function resolveDeletedWorldStateChatKey\(/);
  assert.match(source, /settings\.sidecarTombstones\[chatKey\]/);
  assert.match(source, /delete settings\.dataFiles\[chatKey\]/);
  assert.match(source, /async function neutralizeRetiredSidecar\(chatKey, pointer\)/);
  assert.match(source, /retiredPointer = await neutralizeRetiredSidecar\(chatKey, retiredPointer\)/);
  assert.match(source, /retiredSourcePointer = await neutralizeRetiredSidecar\(oldKey, sourcePointer\)/);
  assert.match(
    source,
    /function clearChatRuntimeState\(chatKey\)[\s\S]*diagnosticStore\.clear\(chatKey\);[\s\S]*rebuildStatuses\.delete\(chatKey\);/,
  );

  assert.match(source, /function invalidateChatOperations\(chatKey = currentChatKey\(\)\)[\s\S]*cancelWorldStateRequests\(\{ chatKey \}\)/);
  for (const id of [
    'world_state_alpha_enabled',
    'world_state_alpha_auto_capture',
    'world_state_alpha_inject',
    'world_state_alpha_connection_profile',
    'world_state_alpha_spatial_enabled',
    'world_state_alpha_spatial_inject',
  ]) assert.match(source, new RegExp(id));

  assert.match(
    source,
    /!liveSettings\.enabled \|\| branch\?\.failClosed \|\| !liveSettings\.inject/,
    'Spatial-only injection must not enter Reality evolution',
  );
  assert.doesNotMatch(source, /baseMapCache\.set\(cacheKey, null\)/, 'transient base-map failures must be retryable');
  assert.match(source, /settings\.spatialBaseMaps\[sourceKey\] = stored\.pointer;\s*settings\.spatialBaseMaps\[stored\.pointer\.id\] = stored\.pointer;/, 'base-map registry must index both exact digest and stable map id');
  assert.match(source, /if \(cacheKey && cacheKey !== resolvedCacheKey\) cacheBaseMap\(cacheKey, baseMap\)/, 'stable-id rebind must alias the resolved source under the campaign request key');
  assert.match(
    source,
    /settings\.spatialEnabled && state\.spatial\?\.baseMapRef\?\.id && !baseMap[\s\S]*Rebuild paused because the attached Spatial base map is unavailable/,
  );
});

test('host Coordinate Profile actions enforce base-map authority and derived-coordinate safety', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  assert.match(source, /actionId === 'save_profile'/);
  assert.match(source, /actionId === 'reset_profile'/);
  assert.match(source, /state\.spatial\?\.baseMapRef\?\.id[\s\S]*Detach it before editing the profile/);
  assert.match(source, /clearDerivedCoordinates[\s\S]*derived coordinate/);
  assert.match(source, /spatialProfile:\s*resolveSpatialProfile\(before\.spatial, baseMap\)/);
  assert.match(source, /spatialProfile:\s*resolveSpatialProfile\(state\.spatial, baseMap\)/);
  assert.match(source, /Preserved detached base-map Coordinate Profile as manual profile/);
});

test('host hydration repairs crash-window pointers and rejects stale ownership completion', () => {
  const source = fs.readFileSync('index.js', 'utf8');

  assert.match(source, /hostStorage\.deterministicPath\?\.\(makeSidecarPath\(chatKey\)\)/);
  assert.match(source, /function pointerFromPayload\(path, payload\)/);
  assert.match(source, /payload\.revision/);
  assert.match(source, /loaded\.repairPointer && loaded\.pointer/);
  assert.match(source, /settings\.dataFiles\[chatKey\] = loaded\.pointer/);
  assert.match(source, /await persistCriticalHostSettings\('recovered World State sidecar pointer'\)/);
  assert.match(source, /const ownerEpoch = ownershipEpoch\(chatKey\)/);
  assert.match(source, /assertOwnershipEpoch\(chatKey, ownerEpoch\)/);
  assert.match(source, /error\?\.code !== 'WORLD_STATE_STALE_OWNERSHIP'/);
  assert.match(source, /sidecarTombstones/);
});

test('cross-session hydration waits for host readiness, retries deterministic recovery, and never silently starts an established chat fresh', () => {
  const source = fs.readFileSync('index.js', 'utf8');

  assert.match(source, /const STARTUP_SIDECAR_RETRY_DELAYS_MS = Object\.freeze\(\[120, 240\]\)/);
  assert.match(source, /async function recoverExistingSidecarPointer\(chatKey, preferredPointer = null, \{[\s\S]*retryDeterministicMiss = false/);
  assert.match(source, /retryDeterministicMiss && deterministic[\s\S]*STARTUP_SIDECAR_RETRY_DELAYS_MS/);
  assert.match(source, /loadChatState\(chatKey\)[\s\S]*recoverExistingSidecarPointer\(chatKey, pointer, \{ retryDeterministicMiss: true(?:, readOnly: true)?(?:, reportCorrupt: true)? \}\)/);
  assert.match(source, /if \(!hostHydrationReady\)[\s\S]*WORLD_STATE_HOST_NOT_READY/);
  assert.match(source, /provisionalFreshChats\.add\(chatKey\)[\s\S]*chatHasEstablishedHistory\(chatKey\)[\s\S]*bootstrapRequiredChats\.add\(chatKey\)/);
  assert.match(source, /async function recheckProvisionalFreshHydration\(chatKey = currentChatKey\(\)\)/);
  assert.match(source, /WORLD_STATE_SESSION_REHYDRATED/);
  assert.match(source, /WORLD_STATE_BOOTSTRAP_RECOVERY_REQUIRED/);
  assert.match(source, /bootstrapRecoveryAtStart && mode !== 'full'/);
  assert.match(source, /allowBootstrapRecovery: bootstrapRecoveryAtStart && mode === 'full'/);

  const initAt = source.indexOf('async function init(');
  const safeAt = source.indexOf('async function safeInit(', initAt);
  const initBody = source.slice(initAt, safeAt);
  assert.match(initBody, /if \(hostReady\) \{[\s\S]*hostHydrationReady = true;[\s\S]*hostReadinessFallbackTimer = null;/);
  assert.match(initBody, /if \(recheckFresh\) extensionSettingsReady = true/);
  assert.match(initBody, /if \(!hostHydrationReady\) return/);
  assert.match(initBody, /await activateCurrentChat\(\)/);

  const activateAt = source.indexOf('async function activateCurrentChat()');
  const activateEnd = source.indexOf('function connectionProfileUiContext()', activateAt);
  const activateBody = source.slice(activateAt, activateEnd);
  assert.match(activateBody, /extensionSettingsReady && provisionalFreshChats\.has\(chatKey\)[\s\S]*recheckProvisionalFreshHydration\(chatKey\)/);

  assert.match(source, /function scheduleHostHydrationReadinessFallback\(\)[\s\S]*hostReadinessFallbackAttempts >= 40/);
  assert.match(source, /hostReadinessFallbackSignal\(\)[\s\S]*safeInit\(\{ hostReady: true, recheckFresh: true \}\)/);
  assert.match(source, /APP_READY[\s\S]*safeInit\(\{ hostReady: true \}\)/);
  assert.match(source, /EXTENSION_SETTINGS_LOADED[\s\S]*safeInit\(\{ hostReady: true, recheckFresh: true \}\)/);
  assert.match(source, /source: pointer\?\.path \? 'missing-sidecar' : 'fresh'/);
  assert.match(source, /baselineRecoveryWrite[\s\S]*pointer = \{ path: deterministicPath, revision: 0, checksum: '' \}/);
  assert.match(source, /applyMaintenanceActionNow[\s\S]*bootstrapRequiredChats\.has\(chatKey\) && !\['import', 'reset', 'rebuild'\]\.includes\(actionId\)/);
  assert.match(source, /applyRecordActionNow[\s\S]*bootstrapRequiredChats\.has\(chatKey\)[\s\S]*notifyBootstrapRequiredOnce\(chatKey\)/);
  assert.match(source, /applySpatialActionNow[\s\S]*bootstrapRequiredChats\.has\(chatKey\)[\s\S]*notifyBootstrapRequiredOnce\(chatKey\)/);
});

test('rebuild cancellation bypasses the per-chat writer queue while rebuild mutations remain serialized', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const start = source.indexOf('async function applyMaintenanceAction(actionId');
  const end = source.indexOf('async function applyMaintenanceActionNow', start);
  const wrapper = source.slice(start, end);
  assert.match(wrapper, /if \(actionId === 'cancel_rebuild'\)/);
  assert.match(wrapper, /rebuildAbortControllers\.get\(chatKey\)/);
  assert.match(wrapper, /rebuildController\?\.abort\(\)/);
  assert.match(wrapper, /cancelWorldStateRequests\(\{[\s\S]*operationIdPrefix: status\.operationId/);
  assert.ok(wrapper.indexOf("if (actionId === 'cancel_rebuild')") < wrapper.indexOf('return queueChatWork'));
  assert.match(wrapper, /return queueChatWork\(chatKey, \(\) => applyMaintenanceActionNow\(actionId, payload, chatKey\)\)/);

  assert.match(source, /planChronologicalRebuild\(chat, \{[\s\S]*maxBoundaries,[\s\S]*startMessageId,[\s\S]*includeHiddenMessages,[\s\S]*\}\)/);
  assert.match(source, /includeHiddenMessages = resumeParams \? resumeParams\.includeHiddenMessages : rebuildRequest\.includeHiddenMessages !== false/);
  assert.match(source, /includeHiddenMessages,/);
  assert.match(source, /startMessageId > 0[\s\S]*extendCurrentBranchFast\(chatKey\)[\s\S]*reconcileCurrentBranch\(chatKey, \{ persistRestore: true \}\)/);
  assert.match(source, /Partial rebuild cannot prove the current chat lineage safely/);
  assert.match(source, /signal: rebuildController\.signal/);
  assert.match(source, /phase: 'committing'/);
  assert.match(source, /getRuntimeInfo: \(\) => \{/);
  assert.match(source, /rebuildStatus: rebuildStatuses\.get\(chatKey\)/);
  assert.match(source, /onProgress: progress => \{/);
});

test('host manual history actions stay queued, auditable, and hidden-ID safe', () => {
  const source = fs.readFileSync('index.js', 'utf8');

  assert.match(source, /applyManualMutation,/);
  assert.match(source, /async function applyRecordAction\(actionId, payload = \{\}, expectedChatKey = currentChatKey\(\)\)/);
  assert.match(source, /return queueChatWork\(chatKey, async \(\) => \{/);
  assert.match(source, /manual lifecycle action failed safely/);
  assert.match(source, /extendCurrentBranchFast\(chatKey\)[\s\S]*reconcileCurrentBranch\(chatKey, \{ persistRestore: true \}\)/);
  assert.match(source, /branch\?\.failClosed[\s\S]*Rebuild from chat before changing history/);
  assert.ok(
    source.indexOf('extendCurrentBranchFast(chatKey)', source.indexOf('async function applyRecordActionNow'))
      < source.indexOf('const state = stateCache.get(chatKey)', source.indexOf('async function applyRecordActionNow')),
  );
  assert.match(source, /\^row-\(\\d\+\)\$/);
  assert.match(source, /record\.status !== 'active'/);
  assert.match(source, /publicRecord\?\.summary !== projectedSummary/);
  assert.match(source, /expectedCreated !== actualCreated/);
  assert.match(source, /expectedChanged !== actualChanged/);
  assert.match(source, /window\.prompt\([\s\S]*stored as manual evidence/);
  assert.match(source, /History summary:[\s\S]*record\.summary/);
  assert.match(source, /summary: historySummary/);
  assert.match(source, /window\.confirm\('Move this record to history as '/);
  assert.match(source, /applyManualMutation\(\{[\s\S]*action: actionId,[\s\S]*recordId: record\.id,[\s\S]*note: String\(note\)\.trim\(\)/);
  assert.match(source, /persistGuardedMutation\(\{[\s\S]*candidateState: result\.state,[\s\S]*recoveryState: state,[\s\S]*label: 'manual lifecycle'[\s\S]*\}\);[\s\S]*if \(persisted\.stale\)[\s\S]*setCachedState\(chatKey, result\.state\);[\s\S]*updatePrivateInjection\(\);/);
});

test('host bulk lifecycle action validates every selected record and commits one manual boundary', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const body = source.slice(source.indexOf('async function applyRecordActionNow'), source.indexOf('async function applySpatialAction('));

  assert.match(source, /applyManualLifecycleBatch,/);
  assert.match(body, /const bulk = Array\.isArray\(payload\?\.records\)/);
  assert.match(body, /publicRecords\.length > MANUAL_LIMITS\.bulkRecords/);
  // Every selected record gets the same stale/identity check as the single-record action; one stale row cancels the batch.
  assert.match(body, /for \(const publicRecord of publicRecords\)[\s\S]*seenRows\.has\(rowIndex\)[\s\S]*record\.status !== 'active'[\s\S]*publicRecord\?\.summary !== projectedSummary[\s\S]*stale = true;[\s\S]*break;/);
  assert.match(body, /selected World State records changed before the bulk action could run/);
  assert.match(body, /Their summaries stay unchanged/);
  assert.match(body, /applyManualLifecycleBatch\(\{[\s\S]*recordIds: targets\.map\(item => item\.id\),[\s\S]*note: String\(note\)\.trim\(\)/);
  assert.equal((body.match(/persistGuardedMutation\(/g) || []).length, 1);
});

test('host Recapture failed messages is a guarded From-message rebuild at the earliest unrecovered failure', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  // Listed failures are current assistant replies whose lineage still matches (another swipe's failure is not listed).
  assert.match(source, /unrecoveredCaptureFailures\(diagnosticStore\.recoveryRows\(chatKey\)\)[\s\S]{0,300}messageRole\(chat\[messageId\]\) === 'assistant'[\s\S]{0,400}lineage\[item\.messageId\]\?\.lineageKey === item\.lineageKey/);
  assert.match(source, /captureFailures: pendingCaptureFailures\(chatKey\)/);
  // The saved log is merged first, so another device's recovery is honoured.
  assert.match(source, /if \(recapture && !await mergeSavedOperationLog\(chatKey\)\) return;/);
  assert.match(source, /async function mergeSavedOperationLog\(chatKey\) \{[\s\S]{0,200}await readOperationLog\(chatKey\)[\s\S]{0,200}diagnosticStore\.merge\(chatKey, saved\)/);
  // The request must name the current earliest failure; a stale panel cannot start an arbitrary range.
  assert.match(source, /const recapture = rebuildRequest\.recaptureFailed === true && !savedResume;/);
  assert.match(source, /recaptureFailures\[0\] !== rebuildRequest\.fromMessageId\)\) \{[\s\S]{0,160}failed captures changed/);
  assert.match(source, /: recapture \? 'from' :/);
  assert.match(source, /const requestedStart = recapture\s*\? recaptureFailures\[0\]/);
  // One explicit confirmation naming the cost, before the branch sync write and any provider call.
  const rebuildBranch = source.slice(source.indexOf("if (actionId === 'rebuild') {"));
  const confirmAt = rebuildBranch.indexOf("'Recapture World State from message '");
  assert.ok(confirmAt > 0);
  assert.ok(confirmAt < rebuildBranch.indexOf('extendCurrentBranchFast(chatKey)'));
  assert.ok(confirmAt < rebuildBranch.indexOf('rebuildResumes.delete(chatKey);\n    const priorTotals'));
  // A capture whose sidecar save fails or conflicts is logged as a failure, never left looking recovered.
  assert.match(source, /outcome: 'not-saved'/);
  assert.match(source, /recordUnsaved\(error\?\.code \|\| 'WORLD_STATE_CAPTURE_PERSIST_FAILURE'/);
  assert.match(source, /if \(persisted\.conflict\) \{\s*recordUnsaved\('WORLD_STATE_REVISION_CONFLICT'/);
  // Import and reset leave a row so older failures stop being offered.
  assert.match(source, /label: 'import',\s*outcome: 'applied'/);
  assert.match(source, /label: 'reset',\s*outcome: 'applied'/);
});

test('host panel actions are bound to the chat that opened the panel', () => {
  const source = fs.readFileSync('index.js', 'utf8');

  assert.match(source, /let panelChatKey = 'no-chat'/);
  assert.match(source, /panelChatKey = chatKey;[\s\S]*getState: \(\) => \{\s*const state = stateCache\.get\(chatKey\);/);
  assert.match(source, /onMaintenanceAction: \(actionId, payload\) => applyMaintenanceAction\(actionId, payload, chatKey\)/);
  assert.match(source, /onRecordAction: \(actionId, payload\) => applyRecordAction\(actionId, payload, chatKey\)/);
  assert.match(source, /onSpatialAction: \(actionId, payload\) => applySpatialAction\(actionId, payload, chatKey\)/);
  assert.match(source, /if \(panelChatKey !== 'no-chat' && panelChatKey !== chatKey\) closeWorldStatePanel\(\)/);
  assert.match(source, /currentChatKey\(\) !== chatKey\) return;/);
});

test('MESSAGE_RECEIVED capture is backgrounded instead of blocking SillyTavern rendering', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const start = source.indexOf('function registerEvents()');
  const end = source.indexOf('async function init()', start);
  const body = source.slice(start, end);

  assert.match(body, /MESSAGE_RECEIVED[\s\S]*void handleAssistantMessage\(messageId\)\.catch/);
  assert.doesNotMatch(body, /MESSAGE_RECEIVED[^\n]*=>\s*handleAssistantMessage\(messageId\)/);
  assert.match(body, /MESSAGE_SENT[^\n]*=>\s*handleUserMessage\(messageId\)/);
});

test('live assistant capture uses the exact assistant boundary rather than a rolling prior-turn window', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const start = source.indexOf('async function handleAssistantMessage(messageId)');
  const end = source.indexOf('async function handleUserMessage(messageId)', start);
  const body = source.slice(start, end);

  assert.match(body, /assistantBoundaryExchange\(liveChat, messageId, currentState\?\.lineage\)/);
  assert.doesNotMatch(body, /boundedExchange\(liveChat, messageId, CAPTURE_LIMITS\.exchangeMessages/);
});

test('host guards the latest captured boundary against passive post-processing rewrites without masking real branch events', () => {
  const source = fs.readFileSync('index.js', 'utf8');

  assert.match(source, /const passiveCaptureRebaseCandidates = new Map\(\)/);
  assert.match(source, /passiveCaptureRebaseCandidates\.set\(chatKey, messageId\)/);
  assert.match(source, /passiveCaptureRebaseCandidates\.get\(chatKey\)/);
  assert.match(source, /passiveCaptureMessageId:/);
  assert.doesNotMatch(source, /passiveCaptureNarrationFingerprint:/);
  assert.match(source, /'passive-capture-rebase'/);
  assert.match(source, /'semantic-lineage-rebase'/);
  assert.match(source, /WORLD_STATE_PASSIVE_CAPTURE_REBASE/);
  assert.match(source, /WORLD_STATE_SEMANTIC_LINEAGE_REBASE/);
  assert.doesNotMatch(source, /lineageMetadataUpgraded/);
  assert.match(source, /WORLD_STATE_BRANCH_RECONCILED/);

  const fastStart = source.indexOf('function extendCurrentBranchFast(chatKey)');
  const fastEnd = source.indexOf('async function reconcileCurrentBranch', fastStart);
  const fastBody = source.slice(fastStart, fastEnd);
  assert.match(fastBody, /passiveCaptureRebaseCandidates\.get\(chatKey\)/);
  assert.match(fastBody, /fingerprintMessage\(current\) !== stored\.fingerprint/);
  assert.doesNotMatch(fastBody, /chatLineage\(/);

  const maintenanceStart = source.indexOf('async function applyMaintenanceActionNow');
  const maintenanceEnd = source.indexOf('async function applySpatialAction', maintenanceStart);
  const maintenanceBody = source.slice(maintenanceStart, maintenanceEnd);
  assert.match(maintenanceBody, /if \(actionId === 'import'\)[\s\S]*setCachedState\(chatKey, next\);\s*passiveCaptureRebaseCandidates\.delete\(chatKey\)/);
  assert.match(maintenanceBody, /if \(actionId === 'reset'\)[\s\S]*setCachedState\(chatKey, next\);\s*passiveCaptureRebaseCandidates\.delete\(chatKey\)/);
  assert.match(maintenanceBody, /setCachedState\(chatKey, result\.state\);\s*passiveCaptureRebaseCandidates\.delete\(chatKey\)/);

  const branchStart = source.indexOf('async function handleBranchChange(');
  const branchEnd = source.indexOf('async function activateCurrentChat()', branchStart);
  const branchBody = source.slice(branchStart, branchEnd);
  const dirtyAt = branchBody.indexOf('branchDirtyChats.add(chatKey)');
  const clearAt = branchBody.indexOf('passiveCaptureRebaseCandidates.delete(chatKey)');
  const epochAt = branchBody.indexOf('stateEpochs.set(chatKey, epoch(chatKey) + 1)');
  const reconcileAt = branchBody.indexOf('reconcileCurrentBranch(chatKey');
  assert.ok(dirtyAt >= 0 && clearAt > dirtyAt && epochAt > clearAt && reconcileAt > epochAt);
  assert.match(source, /source\.on\(events\[name\], \(\) => handleBranchChange\(name\)\)/);
  assert.match(
    source,
    /if \(persisted\.stale\) return;[\s\S]*setCachedState\(chatKey, committed[\s\S]*passiveCaptureRebaseCandidates\.set\(chatKey, messageId\)/,
    'a capture invalidated during persistence must return before publishing or reinstalling passive rewrite eligibility',
  );
});

test('recovery-required host state suppresses both Reality and Spatial private injection', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const start = source.indexOf('function updatePrivateInjection()');
  const end = source.indexOf('function extendCurrentBranchFast', start);
  const body = source.slice(start, end);
  assert.match(body, /continuityInjectionBlocked\(state, \{ branchDirty: branchDirtyChats\.has\(chatKey\) \}\)/);
  const guardAt = body.indexOf('continuityInjectionBlocked');
  const realityAt = body.indexOf('buildWorldStateInjection');
  const spatialAt = body.indexOf('buildSpatialInjection');
  assert.ok(guardAt >= 0 && realityAt > guardAt && spatialAt > guardAt);
});

test('MESSAGE_SENT prepares from committed state without awaiting provider-backed continuity queue', async () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const start = source.indexOf('async function handleUserMessage(messageId)');
  const end = source.indexOf('async function handleBranchChange(', start);
  const body = source.slice(start, end).trim();

  assert.doesNotMatch(body, /await\s+queueChatWork\(/);
  assert.match(body, /await ensureChatStateLoaded\(chatKey\);[\s\S]*updatePrivateInjection\(\);[\s\S]*void queueChatWork\(chatKey, async \(\) =>/);
  assert.match(body, /void queueChatWork\(chatKey, async \(\) =>[\s\S]*prepareWorldStateContinuity\(/);
  assert.match(body, /background continuity failed safely/);
  assert.ok(body.indexOf('updatePrivateInjection();') < body.indexOf('void queueChatWork'));

  // Execute the real handler body with a queue that never resolves. Inner queue
  // dependencies are deliberately not supplied because the queued closure must
  // not run before this handler returns.
  let injected = 0;
  let refreshed = 0;
  let queued = 0;
  let queuedWork = null;
  const factory = new Function(
    'hostHydrationReady',
    'getWorldStateSettings',
    'clearPrivatePrompt',
    'getContext',
    'messageRole',
    'messageText',
    'currentChatKey',
    'ensureChatStateLoaded',
    'refreshChatStateFromServer',
    'hydrationErrors',
    'bootstrapRequiredChats',
    'notifyBootstrapRequiredOnce',
    'updatePrivateInjection',
    'refreshPanel',
    'queueChatWork',
    'console',
    'return (' + body.replace(/^async function handleUserMessage/, 'async function') + ');',
  );
  const handler = factory(
    true,
    () => ({ enabled: true }),
    () => {},
    () => ({ chat: [{ role: 'user', content: 'Continue.' }] }),
    message => message.role,
    message => message.content,
    () => 'chat:test',
    async () => {},
    async () => ({ outcome: 'current', changed: false }),
    new Set(),
    new Set(),
    () => {},
    () => { injected += 1; },
    () => { refreshed += 1; },
    (_chatKey, work) => {
      queued += 1;
      queuedWork = work;
      return new Promise(() => {});
    },
    { error() {} },
  );

  const outcome = await Promise.race([
    handler(0).then(() => 'resolved'),
    new Promise(resolve => setTimeout(() => resolve('blocked'), 50)),
  ]);
  assert.equal(outcome, 'resolved', 'MESSAGE_SENT handler must not await a blocked provider-backed queue');
  assert.equal(injected, 1);
  assert.equal(refreshed, 1);
  assert.equal(queued, 1);
  assert.equal(typeof queuedWork, 'function');
});

test('stale in-flight mutation writes are compensated before publication', async () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const start = source.indexOf('async function persistGuardedMutation({');
  const end = source.indexOf('function setPrivatePrompt(', start);
  const body = source.slice(start, end).trim();

  assert.match(body, /committed = await persistState\(chatKey, candidateState, \{ expectedPointer: basePointer \}\)/);
  assert.match(body, /const basePointer = hydratedPointerFor\(chatKey\) \|\| pointerFor\(chatKey\)/);
  assert.match(body, /await persistState\(chatKey, recoveryState, \{ expectedPointer: committed \}\)/);
  assert.match(body, /handleServerRevisionConflict\(chatKey, error, \{ label, sourceMessageId \}\)/);
  assert.match(body, /if \(guard\(\)\) return \{ stale: false, committed \}/);
  assert.match(body, /await persistState\(chatKey, recoveryState, \{ expectedPointer: committed \}\)/);
  assert.match(body, /WORLD_STATE_STALE_WRITE_RESTORE_FAILURE/);
  assert.match(body, /WORLD_STATE_STALE_WRITE_COMPENSATED/);

  let current = true;
  let durable = 'recovery';
  const writes = [];
  const diagnostics = [];
  const factory = new Function(
    'persistState',
    'handleServerRevisionConflict',
    'hydratedPointerFor',
    'pointerFor',
    'hydrationErrors',
    'clearPrivatePrompt',
    'diagnosticStore',
    'noteCompensatedRevision',
    'return (' + body.replace(/^async function persistGuardedMutation/, 'async function') + ');',
  );
  const helper = factory(
    async (_chatKey, state) => {
      writes.push(state.value);
      durable = state.value;
      if (state.value === 'candidate') current = false;
      return { revision: writes.length };
    },
    async () => false,
    () => ({ path: '/user/files/world-state-alpha-test.json', revision: 1, checksum: 'a' }),
    () => ({ path: '/user/files/world-state-alpha-test.json', revision: 1, checksum: 'a' }),
    new Map(),
    () => {},
    { record(_chatKey, row) { diagnostics.push(row); } },
    () => {},
  );

  const result = await helper({
    chatKey: 'chat:test',
    candidateState: { value: 'candidate' },
    recoveryState: { value: 'recovery' },
    isCurrent: () => current,
    label: 'capture',
    sourceMessageId: 12,
  });

  assert.equal(result.stale, true);
  assert.equal(result.phase, 'after');
  assert.deepEqual(writes, ['candidate', 'recovery']);
  assert.equal(durable, 'recovery', 'stale candidate must not remain durable after invalidation during write');
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0].code, 'WORLD_STATE_STALE_WRITE_COMPENSATED');

  writes.length = 0;
  current = false;
  const beforeWrite = await helper({
    chatKey: 'chat:test',
    candidateState: { value: 'candidate-2' },
    recoveryState: { value: 'recovery' },
    isCurrent: () => current,
  });
  assert.equal(beforeWrite.stale, true);
  assert.equal(beforeWrite.phase, 'before');
  assert.deepEqual(writes, []);
});

test('server-authoritative freshness rechecks hydrated state at same-backend device/session boundaries', () => {
  const source = fs.readFileSync('index.js', 'utf8');

  assert.match(source, /const hydratedPointers = new Map\(\)/);
  assert.match(source, /const observedServerPointers = new Map\(\)/);
  assert.match(source, /async function refreshChatStateFromServer\(chatKey = currentChatKey\(\), \{/);
  assert.match(source, /recoverExistingSidecarPointer\(chatKey, preferredPointer, \{[\s\S]*retryDeterministicMiss/);
  assert.match(source, /sameSidecarPointer\(hydratedPointer, remotePointer\)/);
  assert.match(source, /setCachedState\(chatKey, recoveredState, \{ sourcePointer: remotePointer \}\)/);
  assert.match(source, /WORLD_STATE_SERVER_STATE_REFRESHED/);
  assert.match(source, /WORLD_STATE_HOST_CHAT_BEHIND_SIDECAR/);

  for (const reason of [
    'chat-activation',
    'user-boundary',
    'assistant-boundary',
    'continuity-boundary',
    'panel-open',
    'manual-lifecycle',
  ]) {
    assert.equal(source.includes("reason: '" + reason + "'"), true, 'missing freshness boundary ' + reason);
  }

  assert.match(source, /visibilitychange[\s\S]*visibility-resume/);
  assert.match(source, /pageshow[\s\S]*scheduleServerFreshnessRefresh\('pageshow'\)/);
  assert.match(source, /addEventListener\?\.\('focus'[\s\S]*window-focus/);
  assert.doesNotMatch(source, /setInterval\([^)]*refreshChatStateFromServer/);
});

test('cross-session revision conflict rejects stale writer and rehydrates durable server authority', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const conflictStart = source.indexOf('async function handleServerRevisionConflict(');
  const conflictEnd = source.indexOf('function scheduleServerFreshnessRefresh', conflictStart);
  const conflictBody = source.slice(conflictStart, conflictEnd);

  assert.match(conflictBody, /WORLD_STATE_REVISION_CONFLICT/);
  assert.match(conflictBody, /refreshChatStateFromServer\(chatKey, \{[\s\S]*reason: 'write-conflict'/);
  assert.match(conflictBody, /stale-writer-rejected/);

  const persistStart = source.indexOf('async function persistGuardedMutation({');
  const persistEnd = source.indexOf('function setPrivatePrompt(', persistStart);
  const persistBody = source.slice(persistStart, persistEnd);
  assert.match(persistBody, /catch \(error\) \{[\s\S]*handleServerRevisionConflict\(chatKey, error/);
  assert.match(persistBody, /return \{ stale: true, phase: 'conflict', conflict: true \}/);
});

test('newer server continuation never rolls backward to a stale local SillyTavern chat', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const reconcileStart = source.indexOf('async function reconcileCurrentBranch(');
  const reconcileEnd = source.indexOf('async function handleAssistantMessage(', reconcileStart);
  const body = source.slice(reconcileStart, reconcileEnd);

  assert.match(body, /storedLineage\.length > currentLineage\.length && lineageIsPrefix\(currentLineage, storedLineage\)/);
  assert.match(body, /branchDirtyChats\.add\(chatKey\)/);
  assert.match(body, /action: 'host-chat-behind'/);
  assert.match(body, /failClosed: true/);
  const behindAt = body.indexOf("action: 'host-chat-behind'");
  const reducerAt = body.indexOf('reconcileBranch(');
  assert.ok(behindAt >= 0 && reducerAt > behindAt, 'strict newer server continuation must fail closed before branch rollback');
});

test('debug status exposes hydrated and observed server revisions without making cache authoritative', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  assert.match(source, /hydratedRevision: Number\(hydratedPointerFor\(key\)\?\.revision \|\| 0\)/);
  assert.match(source, /observedServerRevision: Number\(observedServerPointerFor\(key\)\?\.revision \|\| 0\)/);
  assert.match(source, /loadedChats\.has\(chatKey\)[\s\S]*return stateCache\.get\(chatKey\)/);
  assert.match(source, /refreshChatStateFromServer/);
});

test('host rebuild never persists or reports success before completed outcome gate', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const actionAt = source.indexOf("if (actionId === 'rebuild')");
  const end = source.indexOf('async function applySpatialAction(', actionAt);
  const body = source.slice(actionAt, end);
  // One exact range check is taken when the run returns (alpha.54) and gates both reporting and persisting.
  assert.match(body, /const currentAtEnd = isCurrentExact\(\);/);
  const gateAt = body.indexOf("if (result.outcome !== 'completed' || !currentAtEnd)");
  const committingAt = body.indexOf("phase: 'committing'", gateAt);
  const persistAt = body.indexOf('await persistState(chatKey, result.state, {');
  const persistFailureAt = body.indexOf("outcome: 'rebuild-persist-failed'", persistAt);
  const successAt = body.indexOf("outcome: 'rebuild-completed'", persistFailureAt);
  assert.ok(gateAt >= 0 && committingAt > gateAt && persistAt > committingAt && persistFailureAt > persistAt && successAt > persistFailureAt);
  assert.match(body.slice(gateAt, committingAt), /return;/);
  assert.match(body.slice(gateAt, committingAt), /rebuild-cancelled/);
  assert.match(body, /notify\('info', 'World State Alpha rebuild started/);
  assert.match(body, /notify\([\s\S]*'success'[\s\S]*World State Alpha rebuild completed:/);
  assert.match(body, /diagnostics:\s*diagnosticStore/);
  assert.match(body, /outcome:\s*'rebuild-started'/);
  assert.match(body, /outcome:\s*'rebuild-completed'/);
  assert.match(body, /aliasRepairs/);
  assert.match(body, /current records/);
  assert.match(body, /places/);
});

test('host rebuild commit rechecks currentness around durable persistence and compensates stale writes', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const actionAt = source.indexOf("if (actionId === 'rebuild')");
  const end = source.indexOf('async function applySpatialAction(', actionAt);
  const body = source.slice(actionAt, end);
  const persistAt = body.indexOf('await persistState(chatKey, result.state, {');
  assert.ok(persistAt > 0);
  assert.ok(body.lastIndexOf('if (!isCurrentExact())', persistAt) > 0, 'currentness is checked immediately before persistence');
  const staleAfterPersistAt = body.indexOf('if (!isCurrentExact())', persistAt);
  assert.ok(staleAfterPersistAt > persistAt, 'currentness is rechecked after persistence');
  const compensateAt = body.indexOf('expectedPointer: rebuildCommitted', staleAfterPersistAt);
  assert.ok(compensateAt > staleAfterPersistAt, 'stale durable candidate is compensated with the prior canonical state using the candidate revision token');
  assert.match(body, /rebuildCommitted = await persistState\(chatKey, result\.state/);
  assert.match(body, /WORLD_STATE_REBUILD_STALE_RESTORE_FAILURE/);
  assert.match(
    body,
    /if \(bootstrapRecoveryAtStart\) \{[\s\S]*setCachedState\(chatKey, result\.state\);[\s\S]*reconcileCurrentBranch\(chatKey, \{ persistRestore: true \}\)[\s\S]*WORLD_STATE_BOOTSTRAP_REBUILD_STALE_RETAINED[\s\S]*return;/,
    'missing-baseline rebuilds retain the recovered candidate instead of compensating with emptiness',
  );
  const publishAfterCompensate = body.indexOf('setCachedState(chatKey, result.state)', compensateAt);
  assert.ok(publishAfterCompensate > compensateAt, 'ordinary stale rebuild compensation must finish before candidate publication');
});

test('host retries late lifecycle event registration without duplicate wiring', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const registerAt = source.indexOf('function registerEvents()');
  const initAt = source.indexOf('async function init(', registerAt);
  const registerBody = source.slice(registerAt, initAt);
  assert.match(registerBody, /if \(eventsRegistered\) return true/);
  assert.match(registerBody, /!source\?\.on \|\| !events\.MESSAGE_RECEIVED \|\| !events\.CHAT_CHANGED/);
  assert.match(registerBody, /function ensureEventRegistration\(\)/);
  assert.match(registerBody, /eventRegistrationRetryAttempts >= 20/);
  assert.match(registerBody, /setTimeout\(\(\) => \{[\s\S]*ensureEventRegistration\(\);[\s\S]*\}, 250\)/);
  const safeInitAt = source.indexOf('async function safeInit(', initAt);
  const initBody = source.slice(initAt, safeInitAt);
  assert.ok(initBody.indexOf('ensureEventRegistration()') >= 0);
  assert.ok(initBody.indexOf('ensureEventRegistration()') < initBody.indexOf('if (!initialized)'));
  assert.match(initBody, /if \(!hostHydrationReady\) return/);
});

test('host publishes mutated canonical state only after durable sidecar success', () => {
  const source = fs.readFileSync('index.js', 'utf8');

  for (const reason of ['capture', 'evolution']) {
    const commitAt = source.indexOf("commitMutationBoundary(before, " + (reason === 'capture' ? 'result.state' : 'prepared.state') + ", liveChat, messageId, '" + reason + "'");
    const persistAt = source.indexOf('await persistGuardedMutation({', commitAt);
    const staleAt = source.indexOf('if (persisted.stale)', persistAt);
    const publishAt = source.indexOf('setCachedState(chatKey, committed', staleAt);
    assert.ok(commitAt >= 0 && persistAt > commitAt && staleAt > persistAt && publishAt > staleAt, reason + ' must durably guard and reject stale persistence before cache publication');
  }
  for (const label of ['import', 'reset']) {
    // The queued action body (the entry point only picks the import file before queueing).
    const actionAt = source.indexOf("if (actionId === '" + label + "')", source.indexOf('async function applyMaintenanceActionNow('));
    const nextActionAt = source.indexOf("if (actionId === '", actionAt + 1);
    const actionBody = source.slice(actionAt, nextActionAt > actionAt ? nextActionAt : undefined);
    const persistAt = actionBody.indexOf('await persistState(chatKey, next, { allowBootstrapRecovery: true })');
    const publishAt = actionBody.indexOf('setCachedState(chatKey, next)');
    assert.ok(persistAt >= 0 && publishAt > persistAt, label + ' must persist before cache publication');
    assert.match(actionBody, /handleServerRevisionConflict\(chatKey, error/);
  }
  assert.match(
    source,
    /if \(changed && durableRestore\) \{[\s\S]*persistGuardedMutation\(\{[\s\S]*candidateState: result\.state,[\s\S]*recoveryState: state,[\s\S]*label: 'branch reconciliation'[\s\S]*\}\);[\s\S]*if \(persisted\.stale\)[\s\S]*return \{[\s\S]*stalePersistence: true[\s\S]*\};[\s\S]*setCachedState\(chatKey, result\.state,/,
  );
  assert.match(
    source,
    /if \(result\.outcome !== 'completed'[\s\S]*await persistState\(chatKey, result\.state, \{[\s\S]*allowBootstrapRecovery:[\s\S]*\}\);[\s\S]*setCachedState\(chatKey, result\.state\);/,
  );
  assert.match(
    source,
    /catch \(error\) \{\s*clearPrivatePrompt\(\);\s*console\.error\('\[World State Alpha\] branch reconciliation failed safely \(' \+ reason \+ '\)'/,
  );
});

test('host injection clears and writes only Alpha private continuity prompt', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  assert.equal((source.match(/setExtensionPrompt\s*\(/g) || []).length, 1);
  assert.match(source, /WORLD_STATE_PROMPT_KEY/);
  assert.match(source, /extension_prompt_types\.IN_CHAT/);
  assert.match(source, /extension_prompt_roles\.SYSTEM/);
  assert.doesNotMatch(source, /setExtensionPrompt\([^\n]*['"][^'"]*(?:npc|ukiyo|megumin)/i);
});

test('hydration and maintenance stay fail-closed and destructive actions preserve preview-confirm contracts', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  assert.match(source, /if \(hydrationErrors\.has\(chatKey\)\)[\s\S]*WORLD_STATE_HYDRATION_BLOCKED/);
  assert.match(source, /hydrationErrors\.set\(chatKey, error\)/);
  assert.match(source, /previewWorldStateImport\([\s\S]*window\.confirm\([\s\S]*applyWorldStateImport\(preview, \{ confirmed: true \}\)/);
  assert.match(source, /previewWorldStateReset\([\s\S]*window\.confirm\([\s\S]*applyWorldStateReset\(preview, \{ confirmed: true \}\)/);
  assert.match(source, /if \(actionId === 'rebuild'\)[\s\S]*window\.confirm\([\s\S]*runManualRebuild\(/);
  assert.equal((source.match(/runManualRebuild\s*\(/g) || []).length, 1);
});

test('host settings mount reuses Phase 6 panel without a second UI framework or command surface', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const css = fs.readFileSync('ui.css', 'utf8');
  assert.match(source, /#extensions_settings2/);
  assert.match(source, /#extensions_settings/);
  assert.match(source, /#extensionsMenu/);
  assert.match(source, /createWorldStateUiController\(\{/);
  assert.match(source, /panelRoot\.id\s*=\s*WORLD_STATE_PANEL_ROOT_ID/);
  assert.match(source, /document\.createElement\('div'\)/);
  assert.match(source, /extension_container world-state-alpha-settings/);
  assert.match(source, /inline-drawer-toggle inline-drawer-header world-state-alpha-settings-head/);
  assert.match(source, /inline-drawer-icon fa-solid fa-circle-chevron-down down/);
  assert.match(source, /inline-drawer-content world-state-alpha-settings-drawer/);
  assert.match(source, /world-state-alpha-settings-body/);
  assert.match(source, /world-state-alpha-settings-group/);
  assert.match(source, /world-state-alpha-field/);
  assert.doesNotMatch(source, /<summary class="world-state-alpha-settings-head"/);
  assert.match(source, /<select id="world_state_alpha_connection_profile"/);
  assert.match(source, /worldStateProfileOptions\(connectionProfileUiContext\(\), selected\)/);
  assert.match(source, /addEventListener\('focusin'/);
  assert.doesNotMatch(source, /Connection Profile ID <input/);
  assert.match(css, /world-state-alpha-settings-grid/);
  assert.match(css, /world-state-alpha-version/);
  assert.match(css, /world-state-alpha-settings-drawer/);
  assert.doesNotMatch(css, /\.world-state-alpha-settings-drawer\s*\{[^}]*display\s*:/s, 'SillyTavern must own inline-drawer-content visibility');
  assert.doesNotMatch(css, /world-state-alpha-settings-chevron/);
  assert.doesNotMatch(css, /world-state-alpha-settings[^}]*webkit-details-marker/s, 'settings drawer must not override native inline-drawer disclosure markers');
  assert.match(css, /background:\s*var\(--black50a/);
  assert.match(css, /appearance:\s*textfield/);
  assert.match(css, /#world_state_alpha_open\.world-state-alpha-open/);
  assert.doesNotMatch(source, /MutationObserver|pointerdown|pointermove|watchdog|registerSlash|SlashCommand/);
});

test('debug global is read-only and exposes no semantic mutation shortcuts', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const start = source.indexOf('globalThis.WorldStateAlpha = Object.freeze({');
  assert.ok(start >= 0);
  const debug = source.slice(start);
  assert.match(debug, /version:/);
  assert.match(debug, /open:/);
  assert.match(debug, /status:/);
  assert.match(debug, /getState:/);
  assert.match(debug, /diagnostics:/);
  for (const forbidden of ['reset:', 'import:', 'rebuild:', 'capture:', 'evolve:', 'update:']) {
    assert.equal(debug.includes(forbidden), false, 'debug global must not expose ' + forbidden);
  }
});

test('pinned Delta 1.0.35 coexistence identifiers remain disjoint from Alpha host authorities', () => {
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const index = fs.readFileSync('index.js', 'utf8');
  const hostStorage = fs.readFileSync('host-storage.js', 'utf8');

  const delta = Object.freeze({
    commit: 'd20bf1dd03f85fe32ab11abb0363ec32eaa66d03',
    version: '1.0.35',
    loadingOrder: 110,
    settingsKey: 'npc_state_delta',
    promptKey: 'npc_state_delta_live_dossier',
    settingsId: 'npc_state_delta_settings',
    globalName: 'NPCStateDelta',
    filePrefix: 'npc-state-delta-',
  });

  assert.notEqual(manifest.loading_order, delta.loadingOrder);
  assert.notEqual('world_state_alpha', delta.settingsKey);
  assert.notEqual('world_state_alpha_private_continuity', delta.promptKey);
  assert.notEqual('world_state_alpha_settings', delta.settingsId);
  assert.notEqual('WorldStateAlpha', delta.globalName);
  assert.notEqual('world-state-alpha-', delta.filePrefix);

  for (const deltaIdentifier of [
    delta.settingsKey,
    delta.promptKey,
    delta.settingsId,
    delta.globalName,
    delta.filePrefix,
  ]) {
    assert.equal(index.includes(deltaIdentifier), false, 'Alpha index must not reference Delta identifier ' + deltaIdentifier);
    assert.equal(hostStorage.includes(deltaIdentifier), false, 'Alpha storage must not reference Delta identifier ' + deltaIdentifier);
  }

  assert.equal(manifest.dependencies.includes('npc_state_delta'), false);
  assert.equal(manifest.requires.includes('npc_state_delta'), false);
  assert.equal(manifest.optional.includes('npc_state_delta'), false);
  assert.equal(delta.commit, 'd20bf1dd03f85fe32ab11abb0363ec32eaa66d03');
  assert.equal(delta.version, '1.0.35');
});

test('browser-safe host helpers contain no Node-only imports', () => {
  for (const path of ['host-identity.js', 'host-storage.js']) {
    const source = fs.readFileSync(path, 'utf8');
    assert.doesNotMatch(source, /from\s+['"]node:|require\(['"]node:/);
  }
});

test('host resolves continuity elapsed time through the shared precedence helper with incremental, lineage-bound inputs', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  // Behaviour (precedence, freshness, filters) is covered in tests/phase4-elapsed.test.js;
  // this only pins the host inputs that must not regress to scans.
  assert.match(source, /resolveContinuityElapsedHint\(\{/);
  assert.match(source, /index\.elapsedEvidenceBoundary/);
  assert.match(source, /hasActiveDevelopments: Boolean\(index\?\.backgroundDevelopmentSet\?\.size\)/);
  assert.doesNotMatch(source, /latestElapsedEvolutionBoundary\(/, 'no per-turn evidence scan in the host');
  assert.doesNotMatch(source, /detectElapsedHintFromExchange\(exchange\)\s*\|\|/, 'no bare || precedence that a non-meaningful hint could short-circuit');
});

test('branch changes resume parked branches and capture a settled swipe or edited reply once', async () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const reconcileStart = source.indexOf('async function reconcileCurrentBranch(');
  const reconcileBody = source.slice(reconcileStart, source.indexOf('async function handleAssistantMessage(', reconcileStart));
  assert.match(reconcileBody, /abandonedBranch = parkAbandonedBranch\(state, result\);/);
  assert.match(reconcileBody, /const resumed = resumeParkedBranch\(result\.state, liveChat, parks\);/);
  // The park list changes only after a non-stale durable result.
  const staleAt = reconcileBody.indexOf("action: 'stale-persist'");
  const consumeAt = reconcileBody.indexOf('parkedBranches.set(chatKey, parks.filter(park => park !== resumedPark));');
  const rememberAt = reconcileBody.indexOf('rememberParkedBranch(chatKey, abandonedBranch);');
  assert.ok(staleAt > 0 && consumeAt > staleAt && rememberAt > staleAt);
  assert.match(reconcileBody, /'parked-branch-resume', 'fail-closed'/);
  assert.match(reconcileBody, /WORLD_STATE_BRANCH_RESUMED/);
  assert.match(reconcileBody, /result\.divergence < liveChat\.length - 1/);

  const branchStart = source.indexOf('async function handleBranchChange(');
  const branchBody = source.slice(branchStart, source.indexOf('async function activateCurrentChat(', branchStart));
  assert.ok(branchBody.indexOf('clearBranchCaptureTimer(chatKey);') < branchBody.indexOf('branchDirtyChats.add(chatKey);'));
  assert.match(branchBody, /BRANCH_CAPTURE_REASONS\.has\(reason\)[\s\S]*branch\.divergence >= latestMessageId\)\) \{\n\s*scheduleBranchCapture\(chatKey\)/);
  assert.match(source, /new Set\(\['MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED', 'MESSAGE_EDITED'\]\)/);
  for (const marker of ['setCachedState(chatKey, next);\n    passiveCaptureRebaseCandidates.delete(chatKey);\n    forgetBranchContinuations(chatKey);']) {
    assert.equal(source.split(marker).length - 1, 2, 'import and reset drop parked branches');
  }

  const start = source.indexOf('function scheduleBranchCapture(chatKey) {');
  const body = source.slice(start, source.indexOf('\n}\n', start) + 2);
  const run = ({ chat, liveChat = chat }) => {
    const timers = new Map();
    const captured = [];
    let pending = null;
    const schedule = new Function(
      'clearBranchCaptureTimer', 'getContext', 'messageRole', 'messageText', 'fingerprintMessage',
      'branchCaptureTimers', 'setTimeout', 'currentChatKey', 'handleAssistantMessage', 'BRANCH_CAPTURE_DELAY_MS', 'console',
      'storyFingerprintOf', 'recordAbandonedCapture',
      'return (' + body + ');',
    )(
      key => timers.delete(key),
      () => ({ chat: pending ? liveChat : chat }),
      message => message.role,
      message => message.content,
      message => message.content,
      timers,
      callback => { pending = callback; return 1; },
      () => 'chat:test',
      async messageId => { captured.push(messageId); },
      900,
      console,
      message => message.content,
      () => {},
    );
    schedule('chat:test');
    if (pending) pending();
    return { scheduled: Boolean(pending), captured };
  };

  const existing = { role: 'assistant', content: 'An older swipe.', swipes: ['An older swipe.', 'Newer.'], swipe_id: 0 };
  assert.deepEqual(run({ chat: [{ role: 'user', content: 'Hi.' }, existing] }).captured, [1]);

  const overswipe = { role: 'assistant', content: 'Old text while generating.', swipes: ['Old text while generating.'], swipe_id: 1 };
  assert.equal(run({ chat: [{ role: 'user', content: 'Hi.' }, overswipe] }).scheduled, false);

  assert.equal(run({ chat: [{ role: 'assistant', content: 'Reply.' }, { role: 'user', content: 'Edited.' }] }).scheduled, false);

  const moved = run({
    chat: [{ role: 'user', content: 'Hi.' }, existing],
    liveChat: [{ role: 'user', content: 'Hi.' }, { ...existing, content: 'Swiped again.' }],
  });
  assert.equal(moved.scheduled, true);
  assert.deepEqual(moved.captured, [], 'a reply that changed before the delay is not captured');
});

test('a local tail delete or regenerate rolls back instead of being mistaken for a newer server sidecar', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const reconcileStart = source.indexOf('async function reconcileCurrentBranch(');
  const body = source.slice(reconcileStart, source.indexOf('async function handleAssistantMessage(', reconcileStart));
  assert.match(body, /const locallyTruncated = storedLineage\.length > 0\s*&& locallyProvenTails\.get\(chatKey\) === lineageTailKey\(storedLineage\);/);
  assert.match(body, /lineageIsPrefix\(currentLineage, storedLineage\) && !locallyTruncated\) \{/);
  assert.match(body, /if \(!result\.failClosed\) locallyProvenTails\.set\(chatKey, lineageTailKey\(result\.state\?\.lineage\)\);/);

  const fastStart = source.indexOf('function extendCurrentBranchFast(');
  const fastBody = source.slice(fastStart, source.indexOf('async function reconcileCurrentBranch(', fastStart));
  assert.match(fastBody, /if \(appended === null\) return null;[\s\S]*locallyProvenTails\.set\(chatKey, lineageTailKey\(state\.lineage\)\);/);

  assert.match(source, /localChatIsBehindState\(recoveredState, localLineage\)\s*&& locallyProvenTails\.get\(chatKey\) !== lineageTailKey\(recoveredState\.lineage\);/);

  const forgetStart = source.indexOf('function forgetBranchContinuations(');
  assert.match(source.slice(forgetStart, forgetStart + 300), /locallyProvenTails\.delete\(chatKey\)/);

  // A stored tail this session never proved (another device wrote ahead)
  // still fails closed before any rollback.
  const behindAt = body.indexOf("action: 'host-chat-behind'");
  assert.ok(behindAt >= 0 && body.indexOf('reconcileBranch(') > behindAt);
});

test('the Operations log is kept in its own per-chat server file, merged on save and carried across rename', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  assert.match(source, /createDiagnosticStore\(\{\s*limit: OPERATION_LOG_LIMIT,\s*onRecord: \(chatKey, row, \{ failuresListed = false \} = \{\}\) => scheduleOperationLogSave\(chatKey, \{\s*now: affectsCaptureRecovery\(row, \{ failuresListed \}\),\s*\}\),\s*\}\)/);
  // Rows that decide missed-capture recovery are saved at once; everything else waits for the quiet period,
  // and pending rows are flushed when the page is hidden or unloaded.
  assert.match(source, /if \(now\) \{\s*operationLogTimers\.delete\(chatKey\);\s*void saveOperationLog\(chatKey\);\s*return;\s*\}/);
  assert.match(source, /else flushAllOperationLogs\(\);/);
  assert.match(source, /addEventListener\?\.\('pagehide', \(\) => flushAllOperationLogs\(\)\)/);
  assert.match(source, /return 'world-state-alpha-ops-' \+ hashText\(String\(chatKey\)\) \+ '\.json';/);
  assert.match(source, /raw\.format !== OPERATION_LOG_FORMAT[\s\S]{0,120}raw\.chatKey !== chatKey/);
  assert.match(source, /const rows = mergeOperationRows\(server, snapshot \|\| diagnosticStore\.rowsSnapshot\(chatKey\), OPERATION_LOG_LIMIT\);/);
  assert.match(source, /return withWorldStateFileLock\(operationLogFile\(chatKey\), task\);/);
  assert.match(source, /if \(retiredOperationLogs\.has\(chatKey\)\) return false;/);
  assert.match(source, /flushOperationLog\(key\);\s*diagnosticStore\.clear\(key\);/);
  assert.match(source, /void hydrateOperationLog\(chatKey\);\s*if \(!hydratedNow\) await refreshChatStateFromServer\(chatKey, \{ reason: 'chat-activation', retryDeterministicMiss: true \}\);/);
  assert.match(source, /await retireOperationLog\(oldKey, newKey\);\s*clearChatRuntimeState\(oldKey\);/);
  assert.match(source, /await retireOperationLog\(chatKey\);\s*clearChatRuntimeState\(chatKey\);/);
  // Operation telemetry never enters the canonical sidecar payload.
  const storage = fs.readFileSync('storage.js', 'utf8');
  assert.doesNotMatch(storage, /diagnostic|operations/i);
});

test('a failed rebuild keeps an in-memory resume point that only an explicit Resume consumes', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const start = source.indexOf("if (actionId === 'rebuild')");
  const body = source.slice(start, source.indexOf('async function applySpatialAction(', start));

  // Resume is an explicit operator request that reuses the failed run's plan.
  assert.match(body, /const savedResume = rebuildRequest\.resume === true \? rebuildResumes\.get\(chatKey\) : null;/);
  // It must name the failure it answers, and a stale resume is refused before
  // reconcile, status or provider side effects.
  assert.match(body, /savedResume\.resume\.fromMessageId !== rebuildRequest\.fromMessageId/);
  assert.match(body, /There is no failed rebuild to resume at that message for this chat/);
  const staleAt = body.indexOf('rebuildSnapshotToken({ state, chat, lineage: chatLineageOnce() }) !== savedResume.resume.snapshotToken');
  assert.ok(staleAt > 0 && staleAt < body.indexOf('extendCurrentBranchFast(chatKey)') && staleAt < body.indexOf("phase: 'running'"));
  assert.match(body, /resumeParams\.bootstrapRecoveryAtStart !== bootstrapRecoveryAtStart/);
  assert.match(body, /const routeKey = stableStringify\(routeFingerprint\);[\s\S]{0,240}resumeParams\.routeKey !== routeKey/);
  assert.match(body, /':resume-' \+ savedResume\.resume\.fromMessageId/);
  assert.match(body, /result\.providerCalls = priorTotals\.providerCalls \+/);
  // Consumed only after every no-call early return (base map, planning, branch proof).
  const consumeAt = body.indexOf('rebuildResumes.delete(chatKey);\n    const priorTotals');
  assert.ok(consumeAt > body.indexOf('attached Spatial base map is unavailable') && consumeAt < body.indexOf('runManualRebuild({'));
  const cacheStart = source.indexOf('function setCachedState(');
  assert.match(source.slice(cacheStart, cacheStart + 700), /rebuildResumes\.delete\(chatKey\)/);
  assert.match(body, /resume: savedResume\?\.resume \|\| null,/);

  // Only a genuine failure that is still current leaves a resume point.
  assert.match(body, /const resumable = result\.outcome === 'failure' && !cancelledOutcome && result\.resume && currentAtEnd;/);
  assert.match(body, /rebuildResumes\.set\(chatKey, \{/);
  assert.match(body, /Use Resume from message ' \+ result\.resume\.fromMessageId/);

  // Never persisted; dropped with the chat's runtime continuations (import, reset, rebuild success, eviction).
  const forgetStart = source.indexOf('function forgetBranchContinuations(');
  assert.match(source.slice(forgetStart, forgetStart + 200), /rebuildResumes\.delete\(chatKey\)/);
  assert.match(source, /: null\)\)\(rebuildResumes\.get\(chatKey\)\),/);
  assert.doesNotMatch(fs.readFileSync('storage.js', 'utf8'), /resume/i);
});

test('a first write to a logical sidecar path is revision-checked against the deterministic file', () => withoutWebLocks(async () => {
  const logical = 'world_state_alpha/first-write.json';
  const physical = worldStateHostDeterministicPath(logical);
  const existing = encodeSidecar({ chatKey: 'chat:a:first', state: createState('chat:a:first'), revision: 3 });
  let serverText = existing;
  const calls = [];
  const adapter = createSillyTavernWorldStateStorageAdapter({
    fetchFn: async (url, options = {}) => {
      calls.push([url, options.method]);
      if (url === physical && options.method === 'GET') return serverText === null ? response({ status: 404 }) : response({ text: serverText });
      if (url === '/api/files/upload') {
        serverText = Buffer.from(JSON.parse(options.body).data, 'base64').toString('utf8');
        return response({ json: { path: physical } });
      }
      throw new Error('unexpected URL ' + url);
    },
  });
  const firstBody = encodeSidecar({ chatKey: 'chat:a:first', state: createState('chat:a:first'), revision: 1 });

  // Another device already saved revision 3: a blind first write would replace it with revision 1.
  assert.deepEqual(await adapter.write({ path: logical, expectedRevision: 0, body: firstBody }), { conflict: true, currentRevision: 3 });
  assert.deepEqual(calls, [[physical, 'GET']]);

  // With no sidecar on the server the first write goes through.
  serverText = null;
  calls.length = 0;
  const written = await adapter.write({ path: logical, expectedRevision: 0, body: firstBody });
  assert.equal(written.revision, 1);
  // Without Web Locks the upload is read back to detect a concurrent writer.
  assert.deepEqual(calls.map(call => call[0]), [physical, '/api/files/upload', physical]);
}));

test('batch-1 host guards: file pickers before the queue, Places edits from canonical state, safe renames', () => {
  const source = fs.readFileSync('index.js', 'utf8');
  const maintenanceEntry = source.slice(source.indexOf('async function applyMaintenanceAction('), source.indexOf('async function applyMaintenanceActionNow('));
  const spatialEntry = source.slice(source.indexOf('async function applySpatialAction('), source.indexOf('async function applySpatialActionNow('));
  // Import pickers open from the click, before queueChatWork, never inside the chat queue.
  assert.ok(maintenanceEntry.indexOf("actionId === 'import'") < maintenanceEntry.indexOf('queueChatWork('));
  assert.match(maintenanceEntry, /const file = await chooseImportFile\(\);[\s\S]*payload = \{ \.\.\.payload, file \};/);
  assert.ok(spatialEntry.indexOf("actionId === 'import_base_map'") < spatialEntry.indexOf('queueChatWork('));
  assert.equal((source.match(/await chooseImportFile\(\)/g) || []).length, 2);
  assert.match(source, /if \(actionId === 'import'\) \{\s*const file = payload\?\.file;/);
  assert.match(source, /if \(actionId === 'import_base_map'\) \{\s*const startEpoch = epoch\(chatKey\);\s*const file = payload\?\.file;/);

  // Lock and Save read the place's coordinate from canonical state, not the display projection.
  assert.match(source, /const currentLocationCoordinate = location => \{[\s\S]{0,120}effectiveLocations\(state\)/);
  assert.equal((source.match(/const effectiveLocations = currentState =>/g) || []).length, 1);
  assert.match(source, /const priorCoord = currentLocationCoordinate\(payload\.location\);/);
  assert.match(source, /const curCoord = currentLocationCoordinate\(payload\.location\);\s*if \(!Number\.isFinite\(curCoord\.x\) \|\| !Number\.isFinite\(curCoord\.y\)\)/);
  assert.doesNotMatch(source, /payload\.location\.coordinate \|\| \{\}/);
  // Add place refuses an existing active name instead of overwriting that place.
  assert.match(source, /if \(existingPlace\) \{\s*notify\('warning', 'A place named '/);
  // Only active campaign places are merge targets, so only they block Add (a base-map name may be reused).
  assert.match(source, /const existingPlace = \(state\.spatial\?\.locations \|\| \[\]\)\s*\.find\(item => item\.status === 'active'/);

  // Rename carries the server's (authoritative) source state and may reuse a still-retired destination.
  const migration = source.slice(source.indexOf('async function migrateWorldStateChatKey('), source.indexOf('async function migrateWorldStateChatKey(') + 6000);
  assert.match(migration, /sourceState = recoveredSource\.payload\.state;/);
  assert.doesNotMatch(migration, /if \(!sourceState\) sourceState = recoveredSource\.payload\.state;/);
  assert.match(migration, /const unchangedSinceRetired = Boolean\(destinationTombstone\) && !newPointer/);
  assert.match(migration, /if \(!unchangedSinceRetired && !empty\) \{/);
  // Empty means nothing at all: no records, places, routes, relations, profile or base map.
  assert.match(migration, /!\(spatial\.routes \|\| \[\]\)\.length && !\(spatial\.relations \|\| \[\]\)\.length\s*&& !spatial\.profile && !spatial\.baseMapRef\?\.id/);
  assert.match(migration, /pointer: destinationBase,/);
  assert.match(migration, /delete settings\.sidecarTombstones\[newKey\];/);
});

test('a retried first write that already landed is recognised, and logical and physical writes share one lock', async () => {
  const logical = 'world_state_alpha/retry.json';
  const physical = worldStateHostDeterministicPath(logical);
  const body = encodeSidecar({ chatKey: 'chat:a:retry', state: createState('chat:a:retry'), revision: 1 });
  let serverText = null;
  let uploads = 0;
  const adapter = createSillyTavernWorldStateStorageAdapter({
    fetchFn: async (url, options = {}) => {
      if (url === physical && options.method === 'GET') {
        const snapshot = serverText;
        await new Promise(resolve => setTimeout(resolve, 5));
        return snapshot === null ? response({ status: 404 }) : response({ text: snapshot });
      }
      if (url === '/api/files/upload') {
        uploads += 1;
        serverText = Buffer.from(JSON.parse(options.body).data, 'base64').toString('utf8');
        return response({ json: { path: physical } });
      }
      throw new Error('unexpected URL ' + url);
    },
  });
  assert.equal((await adapter.write({ path: logical, expectedRevision: 0, body })).revision, 1);
  // The response was lost and the same write is retried: it is reported committed, not as a conflict.
  assert.deepEqual(await adapter.write({ path: logical, expectedRevision: 0, body }), { path: physical, revision: 1 });
  assert.equal(uploads, 1);

  // A first write and a pointer write to the same file serialize: exactly one wins, the other conflicts.
  serverText = null;
  uploads = 0;
  const other = encodeSidecar({ chatKey: 'chat:a:retry', state: { ...createState('chat:a:retry'), lastCaptureMessage: 3 }, revision: 1 });
  const results = await Promise.all([
    adapter.write({ path: logical, expectedRevision: 0, body }),
    adapter.write({ path: physical, expectedRevision: 0, body: other }),
  ]);
  assert.equal(uploads, 1);
  assert.equal(results.filter(item => item.conflict).length, 1);
});

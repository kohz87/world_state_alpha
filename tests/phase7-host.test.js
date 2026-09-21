import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildWorldStateChatKey,
  getWorldStateChatIdentity,
  getWorldStateChatKey,
} from '../host-identity.js';
import {
  WORLD_STATE_HOST_FILE_PREFIX,
  createSillyTavernWorldStateStorageAdapter,
  worldStateHostFileName,
} from '../host-storage.js';
import { createState } from '../state-core.js';
import { encodeSidecar, writeSidecar } from '../storage.js';

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
  assert.doesNotMatch(first, /npc|delta/i);
});

test('SillyTavern host storage GETs pointers, uploads base64 JSON, and returns actual server path', async () => {
  const calls = [];
  const fetchFn = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/user/files/world-state-alpha-existing.json') {
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
  assert.deepEqual(result, { conflict: true });
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
  assert.equal(manifest.version, '0.7.0-alpha.1');
  assert.equal(manifest.js, 'bootstrap.js');
  assert.equal(manifest.css, 'ui.css');
  assert.equal(manifest.loading_order, 120);
  assert.deepEqual(manifest.dependencies, []);
  assert.deepEqual(manifest.requires, []);
  assert.deepEqual(manifest.optional, []);

  assert.equal(pkg.version, manifest.version);
  assert.equal(inventory.stage, 'phase7-coexistence-host');
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
    'launcher',
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
    'MESSAGE_EDITED',
    'MESSAGE_DELETED',
    'MESSAGE_SWIPED',
    'MESSAGE_SWIPE_DELETED',
  ]) assert.match(source, new RegExp(event));

  assert.equal((source.match(/runCaptureOperation\s*\(\s*\{/g) || []).length, 1);
  assert.match(source, /selectRelevantRecords\([\s\S]*maxRecords:\s*CAPTURE_LIMITS\.visibleRecords/);
  assert.match(source, /prepareWorldStateContinuity\(\{[\s\S]*affectingEvidence:\s*\[\]/);
  assert.match(source, /detectElapsedHintFromExchange\(exchange\)/);
  assert.match(source, /cancelWorldStateRequests\(\{\s*chatKey\s*\}\)/);
  assert.match(source, /reconcileBranch\(state, getContext\(\)\.chat \|\| \[\]\)/);
  assert.match(source, /commitMutationBoundary\(before, result\.state, liveChat, messageId, 'capture'\)/);
  assert.match(source, /commitMutationBoundary\(before, prepared\.state, liveChat, messageId, 'evolution'\)/);

  assert.doesNotMatch(source, /Promise\.all\([^\n]*runCaptureOperation/);
  assert.doesNotMatch(source, /for\s*\([^)]*\)\s*\{[^}]*runCaptureOperation/s);
});

test('host publishes mutated canonical state only after durable sidecar success', () => {
  const source = fs.readFileSync('index.js', 'utf8');

  assert.equal(
    (source.match(/await persistState\(chatKey, committed\);\s*setCachedState\(chatKey, committed\);/g) || []).length,
    2,
    'capture and evolution must persist before cache publication',
  );
  assert.equal(
    (source.match(/await persistState\(chatKey, next\);\s*setCachedState\(chatKey, next\);/g) || []).length,
    2,
    'import and reset must persist before cache publication',
  );
  assert.match(
    source,
    /if \(changed && durableRestore\) \{\s*await persistState\(chatKey, result\.state\);\s*setCachedState\(chatKey, result\.state\);/,
  );
  assert.match(
    source,
    /if \(result\.outcome !== 'completed'[\s\S]*await persistState\(chatKey, result\.state\);\s*setCachedState\(chatKey, result\.state\);/,
  );
  assert.match(
    source,
    /catch \(error\) \{\s*clearPrivatePrompt\(\);\s*console\.error\('\[World State Alpha\] branch reconciliation failed safely'/,
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
  assert.match(source, /#extensions_settings2/);
  assert.match(source, /#extensions_settings/);
  assert.match(source, /#extensionsMenu/);
  assert.match(source, /createWorldStateUiController\(\{/);
  assert.match(source, /panelRoot\.id\s*=\s*WORLD_STATE_PANEL_ROOT_ID/);
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

// A minimal SillyTavern host for running index.js in Node. index.js imports SillyTavern's own modules by
// relative path, so the runtime files are copied (not linked: Node resolves links to their real path) into a
// temporary public/scripts/extensions/third-party layout next to stub host modules. Each scenario runs in its
// own process, because index.js is a page-lifetime singleton.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// Internals a scenario inspects; appended to the temporary copy of index.js only, never to the repository.
const TEST_EXPORT = `
export const __test = { applyMaintenanceActionNow, applyMaintenanceAction, applySpatialAction, queueChatWork, reconcileCurrentBranch, refreshChatStateFromServer, branchDirtyChats, stateCache, hydratedPointers, bootstrapRequiredChats, rebuildStatuses, hydrationErrors, diagnosticStore };
`;

export function prepareHost() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wsa-host-'));
  const ext = path.join(root, 'public', 'scripts', 'extensions', 'third-party', 'world_state_alpha');
  fs.mkdirSync(ext, { recursive: true });
  for (const file of fs.readdirSync(REPO)) {
    if (file.endsWith('.js')) fs.copyFileSync(path.join(REPO, file), path.join(ext, file));
  }
  fs.appendFileSync(path.join(ext, 'index.js'), TEST_EXPORT);
  fs.writeFileSync(path.join(root, 'public', 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, 'public', 'scripts', 'extensions.js'),
    'export const extension_settings = globalThis.__extension_settings || (globalThis.__extension_settings = {});\n'
    + 'export function getContext() { return globalThis.__ctx; }\n');
  fs.writeFileSync(path.join(root, 'public', 'script.js'),
    'export const extension_prompt_types = { IN_CHAT: 1 };\n'
    + 'export const extension_prompt_roles = { SYSTEM: 0 };\n'
    + "export function getRequestHeaders() { return { 'Content-Type': 'application/json' }; }\n"
    + 'export async function saveSettings() { globalThis.__settingsSaves = (globalThis.__settingsSaves || 0) + 1; }\n');
  const url = file => pathToFileURL(path.join(ext, file)).href;
  return { root, ext, url, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

export function createHost({ chat = [], chatId = 'c1', avatar = 'a.png' } = {}) {
  const files = new Map();
  const hooks = { onGet: null, onUpload: null };
  const listeners = new Map();
  const eventTypes = Object.fromEntries(['APP_READY', 'EXTENSION_SETTINGS_LOADED', 'MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED',
    'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED', 'CHAT_CHANGED', 'CHAT_LOADED', 'CHARACTER_RENAMED',
    'CHARACTER_RENAMED_IN_PAST_CHAT', 'CHARACTER_DELETED', 'CHAT_RENAMED', 'CHAT_DELETED', 'GROUP_CHAT_DELETED'].map(n => [n, n]));
  const eventSource = {
    on(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
    async emit(name, ...args) { for (const fn of listeners.get(name) || []) await fn(...args); },
  };
  const prompts = [];
  const notices = [];
  const ctx = {
    chat, chatId, characterId: 0, characters: [{ avatar, name: 'Bot' }],
    eventSource, eventTypes, event_types: eventTypes,
    extensionSettings: globalThis.__extension_settings || (globalThis.__extension_settings = {}),
    setExtensionPrompt: (key, text) => prompts.push({ key, text }),
    generateRaw: async () => '{"mutations": []}',
    saveSettingsDebounced: () => {},
    getCurrentChatId: () => ctx.chatId,
  };
  globalThis.__ctx = ctx;
  globalThis.toastr = Object.fromEntries(['info', 'success', 'warning', 'error'].map(kind => [kind, message => notices.push(kind + ': ' + message)]));
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (method === 'GET') {
      if (hooks.onGet) { const r = await hooks.onGet(url); if (r) return r; }
      if (!files.has(url)) return { ok: false, status: 404, text: async () => '' };
      const text = files.get(url);
      return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
    }
    if (url === '/api/files/upload') {
      const body = JSON.parse(init.body);
      const text = Buffer.from(body.data, 'base64').toString('utf8');
      const target = '/user/files/' + body.name;
      if (hooks.onUpload) await hooks.onUpload(target, text);
      files.set(target, text);
      return { ok: true, status: 200, json: async () => ({ path: target }), text: async () => '' };
    }
    if (url === '/api/characters/chats') return { ok: true, status: 200, json: async () => [] };
    throw new Error('unexpected fetch ' + method + ' ' + url);
  };
  return { ctx, files, hooks, eventSource, prompts, notices };
}

export const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

// A scenario prints one JSON line with its observations and exits.
export function report(value) {
  process.stdout.write('\n@@RESULT ' + JSON.stringify(value) + '\n');
  process.exit(0);
}

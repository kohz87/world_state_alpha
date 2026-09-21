/* World State Alpha - minimal SillyTavern host integration. */
import { extension_settings, getContext } from '../../../extensions.js';
import {
  extension_prompt_types,
  extension_prompt_roles,
  getRequestHeaders,
} from '../../../../script.js';

import { chatLineage, commitMutationBoundary, reconcileBranch, seedRootCheckpoint } from './branch.js';
import { CAPTURE_LIMITS, runCaptureOperation } from './capture.js';
import { createDiagnosticStore } from './diagnostics.js';
import { detectElapsedHintFromExchange } from './elapsed.js';
import { prepareWorldStateContinuity } from './evolution.js';
import { stableStringify } from './hash.js';
import { getWorldStateChatIdentity, getWorldStateChatKey } from './host-identity.js';
import { createSillyTavernWorldStateStorageAdapter } from './host-storage.js';
import {
  WORLD_STATE_PROMPT_KEY,
  buildWorldStateInjection,
} from './injection.js';
import {
  applyWorldStateImport,
  applyWorldStateReset,
  prepareWorldStateExport,
  previewWorldStateImport,
  previewWorldStateReset,
} from './manual.js';
import { cancelWorldStateRequests } from './provider-routing.js';
import { runManualRebuild } from './rebuild.js';
import { selectRelevantRecords } from './relevance.js';
import { clone, createState, normalizeState } from './state-core.js';
import { readSidecar, writeSidecar } from './storage.js';
import { createWorldStateUiController } from './ui.js';

export const WORLD_STATE_ALPHA_VERSION = '0.7.0-alpha.1';
export const WORLD_STATE_HOST_NAMESPACE = 'world_state_alpha';
export const WORLD_STATE_SETTINGS_ID = 'world_state_alpha_settings';
export const WORLD_STATE_PANEL_ROOT_ID = 'world_state_alpha_panel_root';

const DEFAULTS = Object.freeze({
  schemaVersion: 1,
  enabled: true,
  autoCapture: true,
  inject: true,
  injectDepth: 1,
  injectBudgetTokens: 800,
  connectionProfile: '',
  dataFiles: {},
});

const stateCache = new Map();
const loadedChats = new Set();
const hydrationErrors = new Map();
const loadingChats = new Map();
const stateEpochs = new Map();
const chatQueues = new Map();
const diagnosticStore = createDiagnosticStore({ limit: 40 });

let activeChatKey = 'no-chat';
let initialized = false;
let eventsRegistered = false;
let settingsMountTimer = null;
let panelController = null;
let panelRoot = null;

const hostStorage = createSillyTavernWorldStateStorageAdapter({
  fetchFn: (...args) => globalThis.fetch(...args),
  headersFn: () => getRequestHeaders(),
});

function notify(level, message) {
  const toast = globalThis.toastr?.[level];
  if (typeof toast === 'function') toast(message);
  else if (level === 'error') console.error('[World State Alpha]', message);
  else console.info('[World State Alpha]', message);
}

function persistHostSettings() {
  const ctx = getContext();
  if (typeof ctx?.saveSettingsDebounced === 'function') ctx.saveSettingsDebounced();
}

export function getWorldStateSettings() {
  let settings = extension_settings[WORLD_STATE_HOST_NAMESPACE];
  let dirty = false;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    settings = structuredClone(DEFAULTS);
    extension_settings[WORLD_STATE_HOST_NAMESPACE] = settings;
    dirty = true;
  }
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (settings[key] !== undefined) continue;
    settings[key] = structuredClone(value);
    dirty = true;
  }
  settings.schemaVersion = 1;
  settings.enabled = settings.enabled !== false;
  settings.autoCapture = settings.autoCapture !== false;
  settings.inject = settings.inject !== false;
  {
    const depth = Number(settings.injectDepth);
    settings.injectDepth = Math.max(0, Math.min(20, Number.isFinite(depth) ? Math.trunc(depth) : 1));
  }
  {
    const budget = Number(settings.injectBudgetTokens);
    settings.injectBudgetTokens = Math.max(1, Math.min(2400, Number.isFinite(budget) ? Math.trunc(budget) : 800));
  }
  settings.connectionProfile = String(settings.connectionProfile || '').trim().slice(0, 160);
  if (!settings.dataFiles || typeof settings.dataFiles !== 'object' || Array.isArray(settings.dataFiles)) {
    settings.dataFiles = {};
    dirty = true;
  }
  if (dirty) persistHostSettings();
  return settings;
}

function currentChatIdentity() {
  return getWorldStateChatIdentity(getContext());
}

function currentChatKey() {
  return getWorldStateChatKey(getContext());
}

function epoch(chatKey) {
  return Number(stateEpochs.get(chatKey) || 0);
}

function setCachedState(chatKey, state) {
  const normalized = normalizeState(clone(state), { strictSchema: true, chatKey });
  stateCache.set(chatKey, normalized);
  stateEpochs.set(chatKey, epoch(chatKey) + 1);
  return normalized;
}

function getCachedState(chatKey = currentChatKey()) {
  const state = stateCache.get(chatKey);
  return state ? clone(state) : null;
}

function stateChanged(left, right) {
  return stableStringify(normalizeState(left)) !== stableStringify(normalizeState(right));
}

function pointerFor(chatKey) {
  const pointer = getWorldStateSettings().dataFiles?.[chatKey];
  return pointer && typeof pointer === 'object' ? structuredClone(pointer) : null;
}

async function persistState(chatKey, state = stateCache.get(chatKey)) {
  if (!chatKey || chatKey === 'no-chat') return null;
  if (hydrationErrors.has(chatKey)) {
    const error = new Error('World State Alpha will not write while this chat has a hydration error.');
    error.code = 'WORLD_STATE_HYDRATION_BLOCKED';
    throw error;
  }
  if (!state) throw new Error('World State Alpha has no loaded state to persist.');

  const settings = getWorldStateSettings();
  const pointer = pointerFor(chatKey);
  const committed = await writeSidecar({
    adapter: hostStorage,
    chatKey,
    state,
    pointer,
    appVersion: WORLD_STATE_ALPHA_VERSION,
  });

  settings.dataFiles[chatKey] = committed;
  persistHostSettings();
  return committed;
}

async function loadChatState(chatKey) {
  const pointer = pointerFor(chatKey);
  if (!pointer?.path) return seedRootCheckpoint(createState(chatKey));
  const payload = await readSidecar({
    adapter: hostStorage,
    pointer,
    expectedChatKey: chatKey,
  });
  if (!payload?.state) {
    const error = new Error('World State Alpha sidecar pointer exists but the sidecar is unavailable.');
    error.code = 'WORLD_STATE_SIDECAR_MISSING';
    throw error;
  }
  return normalizeState(payload.state, { strictSchema: true, chatKey });
}

async function ensureChatStateLoaded(chatKey = currentChatKey()) {
  if (!chatKey || chatKey === 'no-chat') return null;
  if (loadedChats.has(chatKey) && !hydrationErrors.has(chatKey)) return stateCache.get(chatKey);
  if (loadingChats.has(chatKey)) return loadingChats.get(chatKey);

  const loading = (async () => {
    try {
      const state = await loadChatState(chatKey);
      setCachedState(chatKey, state);
      loadedChats.add(chatKey);
      hydrationErrors.delete(chatKey);
      return stateCache.get(chatKey);
    } catch (error) {
      hydrationErrors.set(chatKey, error);
      loadedChats.delete(chatKey);
      throw error;
    } finally {
      loadingChats.delete(chatKey);
    }
  })();

  loadingChats.set(chatKey, loading);
  return loading;
}

function messageText(message) {
  if (typeof message?.mes === 'string') return message.mes;
  if (typeof message?.content === 'string') return message.content;
  if (typeof message?.text === 'string') return message.text;
  return '';
}

function messageRole(message) {
  if (message?.is_system || message?.role === 'system') return 'system';
  if (message?.is_user || message?.role === 'user') return 'user';
  return 'assistant';
}

function boundedExchange(chat, endMessageId, limit = CAPTURE_LIMITS.exchangeMessages) {
  const rows = Array.isArray(chat) ? chat : [];
  if (!Number.isInteger(endMessageId) || endMessageId < 0 || endMessageId >= rows.length) return [];
  const lineage = chatLineage(rows);
  const out = [];
  for (let index = endMessageId; index >= 0 && out.length < limit; index -= 1) {
    const message = rows[index];
    const role = messageRole(message);
    const content = messageText(message).trim();
    if (role === 'system' || !content) continue;
    out.push({
      messageId: index,
      role,
      lineageKey: lineage[index]?.lineageKey || '',
      content,
    });
  }
  return out.reverse();
}

function recentText(exchange) {
  return (Array.isArray(exchange) ? exchange : [])
    .map(row => String(row?.content || '').trim().slice(0, 3500))
    .filter(Boolean)
    .join('\n');
}

function routeSettings() {
  const profileId = getWorldStateSettings().connectionProfile;
  return profileId ? { profileId } : {};
}

function operationGuard(chatKey, sourceMessageId) {
  const startEpoch = epoch(chatKey);
  const chat = getContext().chat || [];
  const sourceLineage = chatLineage(chat)[sourceMessageId]?.lineageKey || '';
  return () => {
    if (currentChatKey() !== chatKey || epoch(chatKey) !== startEpoch) return false;
    const live = getContext().chat || [];
    return (chatLineage(live)[sourceMessageId]?.lineageKey || '') === sourceLineage;
  };
}

function queueChatWork(chatKey, task) {
  const previous = chatQueues.get(chatKey) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  chatQueues.set(chatKey, next);
  next.finally(() => {
    if (chatQueues.get(chatKey) === next) chatQueues.delete(chatKey);
  });
  return next;
}

function setPrivatePrompt(text = '', depth = 1) {
  const ctx = getContext();
  if (typeof ctx?.setExtensionPrompt !== 'function') return;
  ctx.setExtensionPrompt(
    WORLD_STATE_PROMPT_KEY,
    String(text || ''),
    extension_prompt_types.IN_CHAT,
    Math.max(0, Math.min(20, Math.trunc(Number(depth) || 0))),
    false,
    extension_prompt_roles.SYSTEM,
  );
}

function clearPrivatePrompt() {
  setPrivatePrompt('', 0);
}

function updatePrivateInjection() {
  const settings = getWorldStateSettings();
  const chatKey = currentChatKey();
  if (!settings.enabled || !settings.inject || chatKey === 'no-chat' || hydrationErrors.has(chatKey) || !loadedChats.has(chatKey)) {
    clearPrivatePrompt();
    return null;
  }
  const state = stateCache.get(chatKey);
  if (!state) {
    clearPrivatePrompt();
    return null;
  }
  const chat = getContext().chat || [];
  const end = chat.length - 1;
  const exchange = end >= 0 ? boundedExchange(chat, end, 4) : [];
  const injection = buildWorldStateInjection(state, {
    recentText: recentText(exchange),
    currentMessageId: end >= 0 ? end : null,
    budgetTokens: settings.injectBudgetTokens,
    depth: settings.injectDepth,
  });
  setPrivatePrompt(injection.text, injection.descriptor.depth);
  return injection;
}

async function reconcileCurrentBranch(chatKey, { persistRestore = false } = {}) {
  const state = await ensureChatStateLoaded(chatKey);
  if (!state || currentChatKey() !== chatKey) return null;
  const result = reconcileBranch(state, getContext().chat || []);
  const changed = stateChanged(state, result.state);
  const durableRestore = persistRestore
    && ['rollback-journal', 'exact-checkpoint', 'fail-closed'].includes(result.action);

  if (changed && durableRestore) {
    await persistState(chatKey, result.state);
    setCachedState(chatKey, result.state);
  } else if (changed) {
    setCachedState(chatKey, result.state);
  }
  return result;
}

async function handleAssistantMessage(messageId) {
  const settings = getWorldStateSettings();
  if (!settings.enabled || !settings.autoCapture) return;
  const ctx = getContext();
  const chat = ctx.chat || [];
  if (!Number.isInteger(messageId) || messageId < 0 || messageId >= chat.length) return;
  const message = chat[messageId];
  if (messageRole(message) !== 'assistant' || !messageText(message).trim()) return;

  const chatKey = currentChatKey();
  if (chatKey === 'no-chat') return;

  await queueChatWork(chatKey, async () => {
    await ensureChatStateLoaded(chatKey);
    if (currentChatKey() !== chatKey || hydrationErrors.has(chatKey)) return;
    const branch = await reconcileCurrentBranch(chatKey, { persistRestore: true });
    if (branch?.failClosed) {
      updatePrivateInjection();
      refreshPanel();
      return;
    }

    const liveChat = getContext().chat || [];
    if (messageId >= liveChat.length || messageRole(liveChat[messageId]) !== 'assistant') return;
    const exchange = boundedExchange(liveChat, messageId);
    const lineage = chatLineage(liveChat);
    const sourceLineageKey = lineage[messageId]?.lineageKey || '';
    if (!sourceLineageKey) return;

    const before = stateCache.get(chatKey);
    const visible = selectRelevantRecords(before, {
      recentText: recentText(exchange),
      currentMessageId: messageId,
      maxRecords: CAPTURE_LIMITS.visibleRecords,
    }).selected.map(item => item.record);

    const isCurrent = operationGuard(chatKey, messageId);
    const result = await runCaptureOperation({
      ctx: getContext(),
      state: before,
      exchange,
      visibleRecords: visible,
      loreText: '',
      chatKey,
      sourceMessageId: messageId,
      sourceLineageKey,
      route: routeSettings(),
      operationId: 'capture:' + messageId + ':' + epoch(chatKey),
      isCurrent,
      diagnostics: diagnosticStore,
    });

    if (!isCurrent() || result.outcome === 'stale' || result.outcome === 'skipped') return;
    const committed = commitMutationBoundary(before, result.state, liveChat, messageId, 'capture');
    await persistState(chatKey, committed);
    setCachedState(chatKey, committed);
    updatePrivateInjection();
    refreshPanel();
  });
}

async function handleUserMessage(messageId) {
  const settings = getWorldStateSettings();
  if (!settings.enabled) {
    clearPrivatePrompt();
    return;
  }
  const chat = getContext().chat || [];
  if (!Number.isInteger(messageId) || messageId < 0 || messageId >= chat.length) return;
  if (messageRole(chat[messageId]) !== 'user' || !messageText(chat[messageId]).trim()) return;

  const chatKey = currentChatKey();
  if (chatKey === 'no-chat') return;

  await queueChatWork(chatKey, async () => {
    await ensureChatStateLoaded(chatKey);
    if (currentChatKey() !== chatKey || hydrationErrors.has(chatKey)) return;
    const branch = await reconcileCurrentBranch(chatKey, { persistRestore: true });
    if (branch?.failClosed || !getWorldStateSettings().inject) {
      updatePrivateInjection();
      refreshPanel();
      return;
    }

    const liveChat = getContext().chat || [];
    const exchange = boundedExchange(liveChat, messageId);
    const lineage = chatLineage(liveChat);
    const sourceLineageKey = lineage[messageId]?.lineageKey || '';
    const elapsedHint = detectElapsedHintFromExchange(exchange);
    const before = stateCache.get(chatKey);
    const isCurrent = operationGuard(chatKey, messageId);

    const prepared = await prepareWorldStateContinuity({
      ctx: getContext(),
      state: before,
      recentText: recentText(exchange),
      loreText: '',
      currentMessageId: messageId,
      exchange,
      elapsedHint,
      affectingEvidence: [],
      budgetTokens: getWorldStateSettings().injectBudgetTokens,
      depth: getWorldStateSettings().injectDepth,
      chatKey,
      sourceMessageId: messageId,
      sourceLineageKey,
      route: routeSettings(),
      operationId: 'continuity:' + messageId + ':' + epoch(chatKey),
      isCurrent,
      diagnostics: diagnosticStore,
    });

    if (!isCurrent()) return;
    if (stateChanged(before, prepared.state)) {
      const committed = commitMutationBoundary(before, prepared.state, liveChat, messageId, 'evolution');
      await persistState(chatKey, committed);
      setCachedState(chatKey, committed);
    }
    setPrivatePrompt(prepared.injection?.text || '', prepared.injection?.descriptor?.depth ?? getWorldStateSettings().injectDepth);
    refreshPanel();
  });
}

async function handleBranchChange() {
  const chatKey = currentChatKey();
  if (chatKey === 'no-chat') {
    clearPrivatePrompt();
    return;
  }
  cancelWorldStateRequests({ chatKey });
  await queueChatWork(chatKey, async () => {
    try {
      await ensureChatStateLoaded(chatKey);
      if (currentChatKey() !== chatKey) return;
      await reconcileCurrentBranch(chatKey, { persistRestore: true });
      updatePrivateInjection();
      refreshPanel();
    } catch (error) {
      clearPrivatePrompt();
      console.error('[World State Alpha] branch reconciliation failed safely', error);
    }
  });
}

async function activateCurrentChat() {
  const previousKey = activeChatKey;
  const identity = currentChatIdentity();
  activeChatKey = identity.key;
  if (previousKey && previousKey !== 'no-chat' && previousKey !== activeChatKey) {
    cancelWorldStateRequests({ chatKey: previousKey });
  }

  if (!identity.ready || activeChatKey === 'no-chat') {
    clearPrivatePrompt();
    refreshPanel();
    return;
  }

  try {
    await ensureChatStateLoaded(activeChatKey);
    if (currentChatKey() !== activeChatKey) return;
    await reconcileCurrentBranch(activeChatKey, { persistRestore: true });
    updatePrivateInjection();
    refreshPanel();
  } catch (error) {
    clearPrivatePrompt();
    console.error('[World State Alpha] chat hydration failed; durable state was not overwritten.', error);
    notify('error', 'World State Alpha could not load this chat state. Existing durable data was preserved.');
    refreshPanel();
  }
}

function syncSettingsControls() {
  const settings = getWorldStateSettings();
  const root = globalThis.document?.getElementById?.(WORLD_STATE_SETTINGS_ID);
  if (!root) return;
  const assignChecked = (id, value) => {
    const input = root.querySelector('#' + id);
    if (input) input.checked = Boolean(value);
  };
  const assignValue = (id, value) => {
    const input = root.querySelector('#' + id);
    if (input) input.value = String(value ?? '');
  };
  assignChecked('world_state_alpha_enabled', settings.enabled);
  assignChecked('world_state_alpha_auto_capture', settings.autoCapture);
  assignChecked('world_state_alpha_inject', settings.inject);
  assignValue('world_state_alpha_inject_depth', settings.injectDepth);
  assignValue('world_state_alpha_inject_budget', settings.injectBudgetTokens);
  assignValue('world_state_alpha_connection_profile', settings.connectionProfile);
}

function buildSettingsCard() {
  const section = document.createElement('section');
  section.id = WORLD_STATE_SETTINGS_ID;
  section.className = 'world-state-alpha-settings';
  section.innerHTML = [
    '<div class="world-state-alpha-settings-head"><strong>World State Alpha</strong><span>v' + WORLD_STATE_ALPHA_VERSION + '</span></div>',
    '<label><input id="world_state_alpha_enabled" type="checkbox"> Enable World State Alpha</label>',
    '<label><input id="world_state_alpha_auto_capture" type="checkbox"> Capture established world changes</label>',
    '<label><input id="world_state_alpha_inject" type="checkbox"> Inject private world continuity</label>',
    '<label>Injection depth <input id="world_state_alpha_inject_depth" type="number" min="0" max="20" step="1"></label>',
    '<label>Injection budget <input id="world_state_alpha_inject_budget" type="number" min="1" max="2400" step="1"></label>',
    '<label>Connection Profile ID <input id="world_state_alpha_connection_profile" type="text" autocomplete="off" placeholder="Default host route"></label>',
    '<button id="world_state_alpha_open" type="button" class="menu_button">Open World State</button>',
  ].join('');
  return section;
}

function attachSettingsPanel() {
  if (!globalThis.document) return false;
  if (document.getElementById(WORLD_STATE_SETTINGS_ID)) return true;
  const host = document.querySelector('#extensions_settings2')
    || document.querySelector('#extensions_settings')
    || document.querySelector('#extensionsMenu');
  if (!host) return false;
  host.appendChild(buildSettingsCard());
  syncSettingsControls();
  return true;
}

function scheduleSettingsMount() {
  if (attachSettingsPanel()) return;
  if (settingsMountTimer) clearInterval(settingsMountTimer);
  let attempts = 0;
  settingsMountTimer = setInterval(() => {
    attempts += 1;
    if (attachSettingsPanel() || attempts >= 40) {
      clearInterval(settingsMountTimer);
      settingsMountTimer = null;
    }
  }, 250);
}

function bindSettingsEvents() {
  if (!globalThis.document?.addEventListener) return;
  document.addEventListener('change', event => {
    const target = event.target;
    if (!target?.id?.startsWith('world_state_alpha_')) return;
    const settings = getWorldStateSettings();
    if (target.id === 'world_state_alpha_enabled') settings.enabled = Boolean(target.checked);
    else if (target.id === 'world_state_alpha_auto_capture') settings.autoCapture = Boolean(target.checked);
    else if (target.id === 'world_state_alpha_inject') settings.inject = Boolean(target.checked);
    else if (target.id === 'world_state_alpha_inject_depth') settings.injectDepth = Math.max(0, Math.min(20, Math.trunc(Number(target.value) || 0)));
    else if (target.id === 'world_state_alpha_inject_budget') settings.injectBudgetTokens = Math.max(1, Math.min(2400, Math.trunc(Number(target.value) || 800)));
    else if (target.id === 'world_state_alpha_connection_profile') settings.connectionProfile = String(target.value || '').trim().slice(0, 160);
    else return;
    persistHostSettings();
    syncSettingsControls();
    updatePrivateInjection();
    refreshPanel();
  });

  document.addEventListener('click', event => {
    if (event.target?.id === 'world_state_alpha_open') void openWorldStatePanel();
  });
}

function closeWorldStatePanel() {
  panelController?.destroy?.();
  panelController = null;
  panelRoot?.remove?.();
  panelRoot = null;
}

function refreshPanel() {
  panelController?.refresh?.();
}

function downloadText(filename, textValue) {
  const blob = new Blob([String(textValue || '')], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function chooseImportFile() {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.style.display = 'none';
    const finish = value => {
      input.remove();
      resolve(value);
    };
    input.addEventListener('change', () => finish(input.files?.[0] || null), { once: true });
    input.addEventListener('cancel', () => finish(null), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

async function applyMaintenanceAction(actionId) {
  const chatKey = currentChatKey();
  if (chatKey === 'no-chat') return;
  await ensureChatStateLoaded(chatKey);
  if (hydrationErrors.has(chatKey) || currentChatKey() !== chatKey) return;
  const state = stateCache.get(chatKey);

  if (actionId === 'export') {
    const prepared = prepareWorldStateExport(state);
    downloadText('world-state-alpha-' + Date.now() + '.json', prepared.text);
    notify('success', 'World State Alpha export prepared.');
    return;
  }

  if (actionId === 'import') {
    const file = await chooseImportFile();
    if (!file || currentChatKey() !== chatKey) return;
    const text = await file.text();
    const preview = previewWorldStateImport(text, { targetChatKey: chatKey });
    if (!window.confirm('Import this World State bundle into the current chat? Existing World State records will be replaced after confirmation.')) return;
    const next = seedRootCheckpoint(applyWorldStateImport(preview, { confirmed: true }));
    await persistState(chatKey, next);
    setCachedState(chatKey, next);
    updatePrivateInjection();
    refreshPanel();
    return;
  }

  if (actionId === 'reset') {
    const preview = previewWorldStateReset(state, { chatKey });
    if (!window.confirm('Reset World State Alpha for this chat? This replaces the current World State after confirmation.')) return;
    const next = seedRootCheckpoint(applyWorldStateReset(preview, { confirmed: true }));
    await persistState(chatKey, next);
    setCachedState(chatKey, next);
    updatePrivateInjection();
    refreshPanel();
    return;
  }

  if (actionId === 'rebuild') {
    if (!window.confirm('Rebuild World State Alpha from this chat chronology? This is an explicit provider-backed recovery operation.')) return;
    const chat = getContext().chat || [];
    const sourceMessageId = Math.max(0, chat.length - 1);
    const startEpoch = epoch(chatKey);
    const startLineage = stableStringify(chatLineage(chat));
    const isCurrent = () => currentChatKey() === chatKey
      && epoch(chatKey) === startEpoch
      && stableStringify(chatLineage(getContext().chat || [])) === startLineage;
    const result = await runManualRebuild({
      ctx: getContext(),
      state,
      chat,
      chatKey,
      route: routeSettings(),
      operationId: 'rebuild:' + sourceMessageId + ':' + startEpoch,
      isCurrent,
    });
    if (result.outcome !== 'completed' || !isCurrent()) {
      notify('error', 'World State Alpha rebuild did not complete; canonical state was left unchanged.');
      return;
    }
    await persistState(chatKey, result.state);
    setCachedState(chatKey, result.state);
    updatePrivateInjection();
    refreshPanel();
    notify('success', 'World State Alpha rebuild completed.');
  }
}

export async function openWorldStatePanel() {
  const chatKey = currentChatKey();
  if (chatKey === 'no-chat') {
    notify('warning', 'Open a chat before opening World State Alpha.');
    return false;
  }
  try {
    await ensureChatStateLoaded(chatKey);
  } catch {
    notify('error', 'World State Alpha cannot open this chat until its durable state can be loaded safely.');
    return false;
  }

  if (panelController && panelRoot?.isConnected) {
    panelController.refresh();
    return true;
  }

  closeWorldStatePanel();
  panelRoot = document.createElement('div');
  panelRoot.id = WORLD_STATE_PANEL_ROOT_ID;
  document.body.appendChild(panelRoot);
  panelController = createWorldStateUiController({
    root: panelRoot,
    getState: () => getCachedState(currentChatKey()) || createState(currentChatKey()),
    getDiagnostics: () => diagnosticStore.records(currentChatKey()),
    onMaintenanceAction: actionId => applyMaintenanceAction(actionId),
    onClose: closeWorldStatePanel,
  });
  return true;
}

function registerEvents() {
  if (eventsRegistered) return;
  const ctx = getContext();
  const events = ctx?.eventTypes || ctx?.event_types || {};
  const source = ctx?.eventSource;
  if (!source?.on) return;
  eventsRegistered = true;

  if (events.MESSAGE_RECEIVED) source.on(events.MESSAGE_RECEIVED, messageId => handleAssistantMessage(messageId));
  if (events.MESSAGE_SENT) source.on(events.MESSAGE_SENT, messageId => handleUserMessage(messageId));
  if (events.CHAT_LOADED) source.on(events.CHAT_LOADED, () => activateCurrentChat());
  if (events.CHAT_CHANGED) source.on(events.CHAT_CHANGED, () => activateCurrentChat());

  for (const name of ['MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED']) {
    if (events[name]) source.on(events[name], () => handleBranchChange());
  }
}

async function init() {
  if (initialized) {
    scheduleSettingsMount();
    return;
  }
  initialized = true;
  getWorldStateSettings();
  bindSettingsEvents();
  registerEvents();
  scheduleSettingsMount();
  await activateCurrentChat();
  console.log('[World State Alpha] v' + WORLD_STATE_ALPHA_VERSION + ' loaded');
}

async function safeInit() {
  try {
    await init();
  } catch (error) {
    initialized = false;
    console.error('[World State Alpha] initialization failed safely', error);
  }
}

if (globalThis.document?.readyState === 'loading') {
  globalThis.document.addEventListener('DOMContentLoaded', safeInit, { once: true });
} else {
  queueMicrotask(safeInit);
}

try {
  const ctx = getContext();
  const events = ctx?.eventTypes || ctx?.event_types || {};
  if (ctx?.eventSource?.on) {
    if (events.APP_READY) ctx.eventSource.on(events.APP_READY, safeInit);
    if (events.EXTENSION_SETTINGS_LOADED) ctx.eventSource.on(events.EXTENSION_SETTINGS_LOADED, safeInit);
  }
} catch (error) {
  console.debug('[World State Alpha] lifecycle bootstrap will rely on DOM ready.', error);
}

globalThis.WorldStateAlpha = Object.freeze({
  version: WORLD_STATE_ALPHA_VERSION,
  open: openWorldStatePanel,
  status: () => {
    const key = currentChatKey();
    return Object.freeze({
      chatReady: key !== 'no-chat' && loadedChats.has(key) && !hydrationErrors.has(key),
      hydrationError: hydrationErrors.get(key)?.message || null,
      panelOpen: Boolean(panelRoot?.isConnected),
      diagnostics: diagnosticStore.records(key).length,
    });
  },
  getState: () => {
    const value = getCachedState(currentChatKey());
    return value ? clone(value) : null;
  },
  diagnostics: () => diagnosticStore.records(currentChatKey()),
});

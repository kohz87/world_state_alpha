/* World State Alpha - minimal SillyTavern host integration. */
import { extension_settings, getContext } from '../../../extensions.js';
import {
  extension_prompt_types,
  extension_prompt_roles,
  getRequestHeaders,
} from '../../../../script.js';

import { chatLineage, commitMutationBoundary, extendChatLineage, fingerprintMessage, reconcileBranch, seedRootCheckpoint } from './branch.js';
import { CAPTURE_LIMITS, runCaptureOperation } from './capture.js';
import { createDiagnosticStore } from './diagnostics.js';
import { detectElapsedHintFromExchange } from './elapsed.js';
import { prepareWorldStateContinuity } from './evolution.js';
import { stableStringify } from './hash.js';
import { getWorldStateChatIdentity, getWorldStateChatKey } from './host-identity.js';
import { createSillyTavernWorldStateStorageAdapter } from './host-storage.js';
import { storeBaseMapSource, loadBaseMapSource } from './host-base-map.js';
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
import { cancelWorldStateRequests, worldStateProfileOptions } from './provider-routing.js';
import { runManualRebuild } from './rebuild.js';
import { buildRelevanceIndex, selectRelevantRecords, updateRelevanceIndex } from './relevance.js';
import { buildSpatialRelevanceIndex, selectRelevantLocations, updateSpatialRelevanceIndex } from './spatial-relevance.js';
import { buildSpatialInjection } from './spatial-injection.js';
import { applySpatialManualMutation, inspectSpatialLocation, querySpatialLocations } from './spatial-manual.js';
import { resolveEffectiveLocations } from './spatial-core.js';
import { clone, createState, normalizeState } from './state-core.js';
import { readSidecar, writeSidecar } from './storage.js';
import { createWorldStateUiController } from './ui.js';

export const WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.1';
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
  spatialEnabled: false,
  spatialInject: true,
  spatialInjectBudgetTokens: 500,
  spatialBaseMaps: {},
});

const stateCache = new Map();
const relevanceIndices = new Map();
const spatialRelevanceIndices = new Map();
const baseMapCache = new Map();
const loadedChats = new Set();
const hydrationErrors = new Map();
const loadingChats = new Map();
const stateEpochs = new Map();
const chatQueues = new Map();
const branchDirtyChats = new Set();
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

  // Phase 9 Spatial settings
  settings.spatialEnabled = Boolean(settings.spatialEnabled);
  settings.spatialInject = settings.spatialInject !== false;
  {
    const sBudget = Number(settings.spatialInjectBudgetTokens);
    settings.spatialInjectBudgetTokens = Math.max(1, Math.min(2400, Number.isFinite(sBudget) ? Math.trunc(sBudget) : 500));
  }
  if (!settings.spatialBaseMaps || typeof settings.spatialBaseMaps !== 'object' || Array.isArray(settings.spatialBaseMaps)) {
    settings.spatialBaseMaps = {};
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

function getRelevanceIndex(chatKey, state) {
  if (!chatKey || chatKey === 'no-chat' || !state) return null;
  if (relevanceIndices.has(chatKey)) return relevanceIndices.get(chatKey);
  const index = buildRelevanceIndex(state);
  relevanceIndices.set(chatKey, index);
  return index;
}

function resetRelevanceIndex(chatKey, state) {
  if (!chatKey || chatKey === 'no-chat' || !state) {
    relevanceIndices.delete(chatKey);
    return null;
  }
  const index = buildRelevanceIndex(state);
  relevanceIndices.set(chatKey, index);
  return index;
}

function baseMapCacheKey(ref) {
  if (!ref || typeof ref !== 'object' || !ref.id) return '';
  const digest = String(ref.digest || '').trim();
  const path = String(ref.path || '').trim();
  return digest ? ref.id + ':' + digest : (path ? ref.id + ':' + path : ref.id);
}

async function getChatBaseMap(chatKey, state) {
  if (!chatKey || chatKey === 'no-chat' || !state) return null;
  const ref = state?.spatial?.baseMapRef;
  if (!ref?.id) return null;
  const cacheKey = baseMapCacheKey(ref);
  if (cacheKey && baseMapCache.has(cacheKey)) return baseMapCache.get(cacheKey);

  const settings = getWorldStateSettings();
  // A campaign-owned pointer with a path/digest wins over the optional host
  // convenience registry. This prevents a later import using the same logical
  // map id from silently switching another campaign's source geography.
  const pointer = ref.path
    ? ref
    : (settings.spatialBaseMaps?.[ref.digest]
      || settings.spatialBaseMaps?.[cacheKey]
      || settings.spatialBaseMaps?.[ref.id]
      || ref);
  try {
    const baseMap = await loadBaseMapSource(hostStorage, pointer);
    if (baseMap) {
      baseMapCache.set(baseMapCacheKey(pointer) || cacheKey, baseMap);
      return baseMap;
    }
    if (cacheKey) baseMapCache.set(cacheKey, null);
  } catch (error) {
    if (cacheKey) baseMapCache.set(cacheKey, null);
    console.warn('[World State Alpha] failed to load base map for chat', chatKey, error);
  }
  return null;
}

function getSpatialRelevanceIndex(chatKey, spatialState, baseMap) {
  if (!chatKey || chatKey === 'no-chat' || !spatialState) return null;
  if (spatialRelevanceIndices.has(chatKey)) return spatialRelevanceIndices.get(chatKey);
  const index = buildSpatialRelevanceIndex(spatialState, baseMap);
  spatialRelevanceIndices.set(chatKey, index);
  return index;
}

function resetSpatialRelevanceIndex(chatKey, spatialState, baseMap) {
  if (!chatKey || chatKey === 'no-chat' || !spatialState) {
    spatialRelevanceIndices.delete(chatKey);
    return null;
  }
  const index = buildSpatialRelevanceIndex(spatialState, baseMap);
  spatialRelevanceIndices.set(chatKey, index);
  return index;
}

function epoch(chatKey) {
  return Number(stateEpochs.get(chatKey) || 0);
}

function setCachedState(chatKey, state, { indexMode = 'rebuild', indexDelta = null, spatialIndexDelta = null } = {}) {
  const normalized = normalizeState(clone(state), { strictSchema: true, chatKey });
  stateCache.set(chatKey, normalized);
  stateEpochs.set(chatKey, epoch(chatKey) + 1);

  if (indexMode === 'delta') {
    const index = relevanceIndices.get(chatKey);
    if (index) updateRelevanceIndex(index, indexDelta || {});
    else resetRelevanceIndex(chatKey, normalized);

    const spIndex = spatialRelevanceIndices.get(chatKey);
    const baseMap = baseMapCache.get(baseMapCacheKey(normalized.spatial?.baseMapRef)) || null;
    if (spIndex) updateSpatialRelevanceIndex(spIndex, spatialIndexDelta || {});
    else resetSpatialRelevanceIndex(chatKey, normalized.spatial, baseMap);
  } else if (indexMode !== 'preserve') {
    resetRelevanceIndex(chatKey, normalized);
    const baseMap = baseMapCache.get(baseMapCacheKey(normalized.spatial?.baseMapRef)) || null;
    resetSpatialRelevanceIndex(chatKey, normalized.spatial, baseMap);
  }
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
      const loadedState = stateCache.get(chatKey);
      if (loadedState?.spatial?.baseMapRef?.id) {
        const baseMap = await getChatBaseMap(chatKey, loadedState);
        if (baseMap) resetSpatialRelevanceIndex(chatKey, loadedState.spatial, baseMap);
      }
      loadedChats.add(chatKey);
      hydrationErrors.delete(chatKey);
      return loadedState;
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

function boundedExchange(chat, endMessageId, limit = CAPTURE_LIMITS.exchangeMessages, knownLineage = null) {
  const rows = Array.isArray(chat) ? chat : [];
  if (!Number.isInteger(endMessageId) || endMessageId < 0 || endMessageId >= rows.length) return [];
  const lineage = Array.isArray(knownLineage) && knownLineage.length > endMessageId
    ? knownLineage
    : chatLineage(rows);
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
  const sourceFingerprint = Number.isInteger(sourceMessageId) && chat[sourceMessageId]
    ? fingerprintMessage(chat[sourceMessageId])
    : '';
  return () => {
    if (currentChatKey() !== chatKey || epoch(chatKey) !== startEpoch || !sourceFingerprint) return false;
    const live = getContext().chat || [];
    return Boolean(live[sourceMessageId] && fingerprintMessage(live[sourceMessageId]) === sourceFingerprint);
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
  if (!settings.enabled || (!settings.inject && !settings.spatialInject) || chatKey === 'no-chat' || hydrationErrors.has(chatKey) || !loadedChats.has(chatKey)) {
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
  const exchange = end >= 0 ? boundedExchange(chat, end, 4, state.lineage) : [];
  const sceneText = recentText(exchange);

  let realityText = '';
  if (settings.inject) {
    const index = getRelevanceIndex(chatKey, state);
    const injection = buildWorldStateInjection(state, {
      index,
      recentText: sceneText,
      currentMessageId: end >= 0 ? end : null,
      budgetTokens: settings.injectBudgetTokens,
      depth: settings.injectDepth,
    });
    realityText = injection.text;
  }

  let spatialText = '';
  if (settings.spatialEnabled && settings.spatialInject) {
    const baseRef = state.spatial?.baseMapRef;
    const baseMap = baseMapCache.get(baseMapCacheKey(baseRef)) || null;
    // If a campaign declares a base authority but that source is unavailable,
    // omit Spatial injection rather than presenting a partial generated-only map.
    if (!baseRef?.id || baseMap) {
      const spIndex = getSpatialRelevanceIndex(chatKey, state.spatial, baseMap);
      const spInjection = buildSpatialInjection(state.spatial, {
        baseMap,
        index: spIndex,
        recentText: sceneText,
        budgetTokens: settings.spatialInjectBudgetTokens,
      });
      spatialText = spInjection.text;
    }
  }

  const combined = [realityText, spatialText].filter(Boolean).join('\n\n');
  if (combined) {
    setPrivatePrompt(combined, settings.injectDepth);
  } else {
    clearPrivatePrompt();
  }
  return { text: combined };
}

function extendCurrentBranchFast(chatKey) {
  if (branchDirtyChats.has(chatKey)) return null;
  const state = stateCache.get(chatKey);
  if (state?.recoveryRequired) return null;
  if (!state || currentChatKey() !== chatKey) return null;
  const chat = getContext().chat || [];
  const appended = extendChatLineage(state.lineage, chat);
  if (appended === null) return null;
  if (appended.length) {
    state.lineage.push(...appended);
    state.recoveryRequired = null;
    stateEpochs.set(chatKey, epoch(chatKey) + 1);
  }
  return {
    state,
    divergence: appended.length ? state.lineage.length - appended.length : -1,
    action: appended.length ? 'forward-extension' : 'same',
    exactRestored: true,
    failClosed: false,
  };
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
    // Forward lineage extension changes chronology only; canonical relevance data is unchanged.
    setCachedState(chatKey, result.state, { indexMode: 'preserve' });
  }
  if (result.failClosed) branchDirtyChats.add(chatKey);
  else branchDirtyChats.delete(chatKey);
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
    const branch = extendCurrentBranchFast(chatKey)
      || await reconcileCurrentBranch(chatKey, { persistRestore: true });
    if (branch?.failClosed) {
      updatePrivateInjection();
      refreshPanel();
      return;
    }

    const liveChat = getContext().chat || [];
    if (messageId >= liveChat.length || messageRole(liveChat[messageId]) !== 'assistant') return;
    const currentState = stateCache.get(chatKey);
    const exchange = boundedExchange(liveChat, messageId, CAPTURE_LIMITS.exchangeMessages, currentState?.lineage);
    const sourceLineageKey = currentState?.lineage?.[messageId]?.lineageKey || '';
    if (!sourceLineageKey) return;

    const before = stateCache.get(chatKey);
    const index = getRelevanceIndex(chatKey, before);
    const visible = selectRelevantRecords(before, {
      index,
      recentText: recentText(exchange),
      currentMessageId: messageId,
      maxRecords: CAPTURE_LIMITS.visibleRecords,
    }).selected.map(item => item.record);

    let visibleLocations = [];
    let baseMap = null;
    let spatialCaptureEnabled = Boolean(settings.spatialEnabled);
    if (spatialCaptureEnabled) {
      baseMap = await getChatBaseMap(chatKey, before);
      if (before.spatial?.baseMapRef?.id && !baseMap) {
        spatialCaptureEnabled = false;
      } else {
        const spIndex = getSpatialRelevanceIndex(chatKey, before.spatial, baseMap);
        const spRel = selectRelevantLocations(before.spatial, {
          baseMap,
          index: spIndex,
          recentText: recentText(exchange),
          maxLocations: 6,
        });
        visibleLocations = spRel.selected.map(item => item.location);
      }
    }

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
      spatialEnabled: spatialCaptureEnabled,
      visibleLocations,
      baseMap,
      spatialProfile: before.spatial?.profile,
    });

    if (!isCurrent() || result.outcome === 'stale' || result.outcome === 'skipped') return;
    const committed = commitMutationBoundary(before, result.state, liveChat, messageId, 'capture', { lineage: before.lineage });
    await persistState(chatKey, committed);
    setCachedState(chatKey, committed, {
      indexMode: 'delta',
      indexDelta: result.indexDelta,
      spatialIndexDelta: result.spatial?.indexDelta,
    });
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
    const branch = extendCurrentBranchFast(chatKey)
      || await reconcileCurrentBranch(chatKey, { persistRestore: true });
    if (branch?.failClosed || (!getWorldStateSettings().inject && !getWorldStateSettings().spatialInject)) {
      updatePrivateInjection();
      refreshPanel();
      return;
    }

    const liveChat = getContext().chat || [];
    const currentState = stateCache.get(chatKey);
    const exchange = boundedExchange(liveChat, messageId, CAPTURE_LIMITS.exchangeMessages, currentState?.lineage);
    const sourceLineageKey = currentState?.lineage?.[messageId]?.lineageKey || '';
    const elapsedHint = detectElapsedHintFromExchange(exchange);
    const before = stateCache.get(chatKey);
    const index = getRelevanceIndex(chatKey, before);
    const isCurrent = operationGuard(chatKey, messageId);

    const prepared = await prepareWorldStateContinuity({
      ctx: getContext(),
      state: before,
      index,
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

    if (!isCurrent()) {
      resetRelevanceIndex(chatKey, before);
      return;
    }
    if (stateChanged(before, prepared.state)) {
      const committed = commitMutationBoundary(before, prepared.state, liveChat, messageId, 'evolution', { lineage: before.lineage });
      try {
        await persistState(chatKey, committed);
      } catch (error) {
        resetRelevanceIndex(chatKey, before);
        throw error;
      }
      setCachedState(chatKey, committed, { indexMode: 'preserve' });
    }
    updatePrivateInjection();
    refreshPanel();
  });
}

async function handleBranchChange() {
  const chatKey = currentChatKey();
  if (chatKey === 'no-chat') {
    clearPrivatePrompt();
    return;
  }
  branchDirtyChats.add(chatKey);
  stateEpochs.set(chatKey, epoch(chatKey) + 1);
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

function connectionProfileUiContext() {
  const ctx = getContext();
  return {
    extensionSettings: extension_settings,
    ConnectionManagerRequestService: ctx?.ConnectionManagerRequestService,
  };
}

function syncConnectionProfileControl(root, selected) {
  const select = root?.querySelector?.('#world_state_alpha_connection_profile');
  if (!select) return;
  const doc = select.ownerDocument || globalThis.document;
  if (!doc?.createElement) return;
  const options = worldStateProfileOptions(connectionProfileUiContext(), selected);
  select.replaceChildren();
  for (const item of options) {
    const option = doc.createElement('option');
    option.value = item.id;
    option.textContent = item.name;
    select.appendChild(option);
  }
  select.value = String(selected || '');
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
  syncConnectionProfileControl(root, settings.connectionProfile);
  assignChecked('world_state_alpha_spatial_enabled', settings.spatialEnabled);
  assignChecked('world_state_alpha_spatial_inject', settings.spatialInject);
  assignValue('world_state_alpha_spatial_inject_budget', settings.spatialInjectBudgetTokens);
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
    '<label>Connection profile <select id="world_state_alpha_connection_profile" title="Choose a SillyTavern Connection Profile for World State requests"></select></label>',
    '<hr style="border:0;border-top:1px solid rgba(255,255,255,0.1);margin:4px 0;">',
    '<label><input id="world_state_alpha_spatial_enabled" type="checkbox"> Enable Spatial Continuity (Phase 9)</label>',
    '<label><input id="world_state_alpha_spatial_inject" type="checkbox"> Inject spatial continuity</label>',
    '<label>Spatial inject budget <input id="world_state_alpha_spatial_inject_budget" type="number" min="1" max="2400" step="1"></label>',
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
  document.addEventListener('focusin', event => {
    if (event.target?.id !== 'world_state_alpha_connection_profile') return;
    const root = document.getElementById(WORLD_STATE_SETTINGS_ID);
    if (root) syncConnectionProfileControl(root, getWorldStateSettings().connectionProfile);
  });
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
    else if (target.id === 'world_state_alpha_spatial_enabled') settings.spatialEnabled = Boolean(target.checked);
    else if (target.id === 'world_state_alpha_spatial_inject') settings.spatialInject = Boolean(target.checked);
    else if (target.id === 'world_state_alpha_spatial_inject_budget') settings.spatialInjectBudgetTokens = Math.max(1, Math.min(2400, Math.trunc(Number(target.value) || 500)));
    else return;
    persistHostSettings();
    syncSettingsControls();

    const spatialToggle = target.id === 'world_state_alpha_spatial_enabled'
      || target.id === 'world_state_alpha_spatial_inject';
    if (spatialToggle && (settings.spatialEnabled || settings.spatialInject)) {
      const chatKey = currentChatKey();
      const state = stateCache.get(chatKey);
      if (chatKey !== 'no-chat' && state?.spatial?.baseMapRef?.id) {
        void getChatBaseMap(chatKey, state).then(baseMap => {
          if (baseMap && currentChatKey() === chatKey) {
            resetSpatialRelevanceIndex(chatKey, state.spatial, baseMap);
          }
          updatePrivateInjection();
          refreshPanel();
        });
        return;
      }
    }

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
    if (next.spatial?.baseMapRef?.id) {
      const reboundBaseMap = await getChatBaseMap(chatKey, stateCache.get(chatKey));
      if (reboundBaseMap) {
        resetSpatialRelevanceIndex(chatKey, stateCache.get(chatKey).spatial, reboundBaseMap);
      }
    }
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
    const settings = getWorldStateSettings();
    const baseMap = await getChatBaseMap(chatKey, state);
    const result = await runManualRebuild({
      ctx: getContext(),
      state,
      chat,
      chatKey,
      route: routeSettings(),
      operationId: 'rebuild:' + sourceMessageId + ':' + startEpoch,
      isCurrent,
      spatialEnabled: Boolean(settings.spatialEnabled),
      baseMap,
      spatialProfile: state.spatial?.profile,
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

async function applySpatialAction(actionId, payload = {}) {
  const chatKey = currentChatKey();
  if (chatKey === 'no-chat') return;
  await ensureChatStateLoaded(chatKey);
  if (hydrationErrors.has(chatKey) || currentChatKey() !== chatKey) return;
  const state = stateCache.get(chatKey);
  const baseMap = await getChatBaseMap(chatKey, state);
  const chat = getContext().chat || [];
  const messageId = chat.length ? chat.length - 1 : null;

  const persistSpatialState = async (nextState, message) => {
    await persistState(chatKey, nextState);
    setCachedState(chatKey, nextState);
    updatePrivateInjection();
    refreshPanel();
    if (message) notify('success', message);
  };

  const applySequence = (initialState, steps) => {
    let working = initialState;
    const combined = [];
    for (const step of steps) {
      const res = applySpatialManualMutation({
        state: working,
        chat,
        chatKey,
        messageId,
        mutation: step.mutation,
        note: step.note,
        baseMap,
      });
      if (res.outcome !== 'applied') {
        return { outcome: 'rejected', state: initialState, rejected: res.rejected || [] };
      }
      working = res.state;
      combined.push(...(res.applied || []));
    }
    return { outcome: 'applied', state: working, applied: combined };
  };

  const effectiveLocations = currentState => resolveEffectiveLocations(currentState.spatial, baseMap);
  const findEffectiveByName = (currentState, name) => {
    const needle = String(name || '').trim().toLowerCase();
    if (!needle) return null;
    return effectiveLocations(currentState).find(loc => loc.name.toLowerCase() === needle) || null;
  };

  if (actionId === 'add_location_modal') {
    const name = window.prompt('Location name:');
    if (!name?.trim()) return;
    const type = window.prompt('Location type (e.g. inn, hamlet, ford, ruin):', 'landmark') || 'landmark';
    const xRaw = window.prompt('Coordinate X (leave blank if unknown):', '');
    const yRaw = window.prompt('Coordinate Y (leave blank if unknown):', '');
    const context = window.prompt('Region / context (optional):', '') || '';
    const x = xRaw !== null && xRaw.trim() !== '' ? Number(xRaw) : null;
    const y = yRaw !== null && yRaw.trim() !== '' ? Number(yRaw) : null;
    if ((x !== null) !== (y !== null) || (x !== null && (!Number.isFinite(x) || !Number.isFinite(y)))) {
      notify('error', 'Provide both X and Y as numbers, or leave both blank.');
      return;
    }
    const res = applySpatialManualMutation({
      state,
      chat,
      chatKey,
      messageId,
      mutation: {
        action: 'upsert_location',
        name: name.trim(),
        type: type.trim() || 'landmark',
        context: context.trim(),
        coordinate: {
          x,
          y,
          authority: x === null ? 'unknown' : 'manual',
          locked: x !== null,
        },
      },
      note: 'Manually added location',
      baseMap,
    });
    if (res.outcome === 'applied') {
      await persistSpatialState(res.state, 'Added location ' + name.trim());
    } else {
      notify('error', 'Location was not added: ' + (res.rejected?.[0]?.reason || 'rejected'));
    }
    return;
  }

  if (actionId === 'create_override' && payload.location) {
    const res = applySpatialManualMutation({
      state,
      chat,
      chatKey,
      messageId,
      mutation: {
        action: 'upsert_location',
        locationId: payload.location.id,
        name: payload.location.name,
        type: payload.location.type,
        context: payload.location.context,
        routeRefs: payload.location.routeRefs,
        notes: 'Campaign override',
        createOverride: true,
      },
      note: 'Created campaign override',
      baseMap,
    });
    if (res.outcome === 'applied') {
      await persistSpatialState(res.state, 'Created campaign override for ' + payload.location.name);
    }
    return;
  }

  if (actionId === 'save_location' && payload.location) {
    const fd = payload.formData || {};
    if ((fd.x !== null) !== (fd.y !== null)
      || (fd.x !== null && (!Number.isFinite(fd.x) || !Number.isFinite(fd.y)))) {
      notify('error', 'Provide both X and Y as numbers, or leave both blank.');
      return;
    }

    const targetId = payload.location.overrideId || payload.location.id;
    const priorCoord = payload.location.coordinate || {};
    const priorX = Number.isFinite(priorCoord.x) ? priorCoord.x : null;
    const priorY = Number.isFinite(priorCoord.y) ? priorCoord.y : null;
    const nextLocked = Boolean(fd.locked && fd.x !== null);
    const nextAuthority = fd.authority || (fd.x === null ? 'unknown' : 'manual');
    const coordinateChanged = fd.x !== priorX
      || fd.y !== priorY
      || nextLocked !== Boolean(priorCoord.locked)
      || nextAuthority !== String(priorCoord.authority || 'unknown');

    const locationMutation = {
      action: 'upsert_location',
      locationId: targetId,
      name: fd.name || payload.location.name,
      type: fd.type || payload.location.type,
      context: fd.context,
      routeRefs: fd.routeRefs,
      notes: fd.notes,
    };
    if (coordinateChanged) {
      locationMutation.coordinate = {
        x: fd.x,
        y: fd.y,
        authority: nextAuthority,
        locked: nextLocked,
      };
    }

    const steps = [{
      mutation: locationMutation,
      note: 'Manual location update',
    }];

    const relationId = String(fd.relationId || '').trim();
    const anchorName = String(fd.relativeAnchor || '').trim();
    if (relationId) {
      steps.push({
        mutation: { action: 'delete_relation', relationId },
        note: 'Replaced spatial relation',
      });
    }

    if (anchorName) {
      const afterLocation = applySequence(state, steps.slice(0, 1));
      if (afterLocation.outcome !== 'applied') {
        notify('error', 'Location update rejected.');
        return;
      }
      const anchor = findEffectiveByName(afterLocation.state, anchorName);
      if (!anchor) {
        notify('error', 'Relative anchor not found: ' + anchorName);
        return;
      }
      const selectedEffectiveId = payload.location.id;
      if (anchor.id === selectedEffectiveId) {
        notify('error', 'A location cannot be relative to itself.');
        return;
      }
      steps.push({
        mutation: {
          action: 'upsert_relation',
          fromId: anchor.id,
          toId: selectedEffectiveId,
          direction: fd.direction || '',
          distanceKm: Number.isFinite(fd.distanceKm) ? fd.distanceKm : null,
          distanceMode: fd.distanceMode || 'unspecified',
          notes: 'Manual relative position',
        },
        note: 'Updated spatial relation',
      });
    }

    const res = applySequence(state, steps);
    if (res.outcome === 'applied') {
      await persistSpatialState(res.state, 'Saved location ' + (fd.name || payload.location.name));
    } else {
      notify('error', 'Spatial update rejected: ' + (res.rejected?.[0]?.reason || 'invalid edit'));
    }
    return;
  }

  if (actionId === 'toggle_lock' && payload.location) {
    const curCoord = payload.location.coordinate || {};
    const nextLocked = !curCoord.locked;
    const res = applySpatialManualMutation({
      state,
      chat,
      chatKey,
      messageId,
      mutation: {
        action: 'upsert_location',
        locationId: payload.location.overrideId || payload.location.id,
        name: payload.location.name,
        coordinate: {
          ...curCoord,
          locked: nextLocked,
          authority: curCoord.authority || 'manual',
        },
      },
      note: nextLocked ? 'Locked coordinates' : 'Unlocked coordinates',
      baseMap,
    });
    if (res.outcome === 'applied') {
      await persistSpatialState(res.state, (nextLocked ? 'Locked' : 'Unlocked') + ' coordinates for ' + payload.location.name);
    }
    return;
  }

  if (actionId === 'archive_location' && payload.location) {
    if (!window.confirm('Archive this campaign location? It will stop appearing in normal spatial retrieval.')) return;
    const targetId = payload.location.overrideId || payload.location.id;
    const res = applySpatialManualMutation({
      state,
      chat,
      chatKey,
      messageId,
      mutation: { action: 'archive_location', locationId: targetId },
      note: 'Archived campaign location',
      baseMap,
    });
    if (res.outcome === 'applied') {
      await persistSpatialState(res.state, 'Archived location ' + payload.location.name);
    }
    return;
  }

  if (actionId === 'merge_location' && payload.location) {
    const sourceId = payload.location.overrideId || payload.location.id;
    const candidates = state.spatial.locations.filter(loc => loc.status === 'active' && loc.id !== sourceId);
    if (!candidates.length) {
      notify('warning', 'No other campaign location is available to merge into.');
      return;
    }
    const targetName = window.prompt(
      'Merge this duplicate into which campaign location?\n' + candidates.slice(0, 12).map(loc => '- ' + loc.name).join('\n'),
      '',
    );
    if (!targetName?.trim()) return;
    const target = candidates.find(loc => loc.name.toLowerCase() === targetName.trim().toLowerCase());
    if (!target) {
      notify('error', 'Merge target not found among campaign locations.');
      return;
    }
    if (!window.confirm('Merge "' + payload.location.name + '" into "' + target.name + '"? The source will be archived.')) return;
    const res = applySpatialManualMutation({
      state,
      chat,
      chatKey,
      messageId,
      mutation: { action: 'merge_locations', sourceId, targetId: target.id },
      note: 'Merged accidental duplicate into ' + target.name,
      baseMap,
    });
    if (res.outcome === 'applied') {
      await persistSpatialState(res.state, 'Merged duplicate into ' + target.name);
    }
    return;
  }

  if (actionId === 'delete_location' && payload.location) {
    const label = payload.location.isOverridden
      ? 'Delete this campaign override? The read-only base location will become visible again.'
      : 'Delete this campaign location?';
    if (!window.confirm(label)) return;
    const targetId = payload.location.overrideId || payload.location.id;
    const res = applySpatialManualMutation({
      state,
      chat,
      chatKey,
      messageId,
      mutation: { action: 'delete_location', locationId: targetId },
      note: 'Deleted campaign location',
      baseMap,
    });
    if (res.outcome === 'applied') {
      await persistSpatialState(res.state, 'Deleted location ' + payload.location.name);
    }
    return;
  }

  if (actionId === 'import_base_map') {
    const startEpoch = epoch(chatKey);
    const file = await chooseImportFile();
    if (!file || currentChatKey() !== chatKey || epoch(chatKey) !== startEpoch) return;
    const rawText = await file.text();
    if (currentChatKey() !== chatKey || epoch(chatKey) !== startEpoch) return;
    let stored;
    try {
      stored = await storeBaseMapSource(hostStorage, rawText);
    } catch (err) {
      notify('error', 'Failed to parse base map: ' + err.message);
      return;
    }
    // Uploading an immutable source may finish after navigation. In that case
    // leave the harmless source file unattached and mutate no campaign/settings state.
    if (currentChatKey() !== chatKey || epoch(chatKey) !== startEpoch) return;
    const settings = getWorldStateSettings();
    const sourceKey = stored.pointer.digest || baseMapCacheKey(stored.pointer);
    settings.spatialBaseMaps[sourceKey] = stored.pointer;
    persistHostSettings();
    baseMapCache.set(baseMapCacheKey(stored.pointer), stored.baseMap);

    const steps = [
      {
        mutation: { action: 'set_profile', profile: stored.baseMap.profile },
        note: 'Adopted base-map spatial profile',
      },
      {
        mutation: { action: 'set_base_map_ref', baseMapRef: stored.pointer },
        note: 'Attached base map ' + stored.baseMap.name,
      },
    ];
    const res = applySequence(state, steps);
    if (res.outcome === 'applied') {
      await persistSpatialState(res.state, 'Base map attached: ' + stored.baseMap.name);
    }
    return;
  }

  if (actionId === 'detach_base_map') {
    if (!window.confirm('Detach base map from this campaign? Campaign locations will be preserved.')) return;
    const res = applySpatialManualMutation({
      state,
      chat,
      chatKey,
      messageId,
      mutation: { action: 'set_base_map_ref', baseMapRef: null },
      note: 'Detached base map',
    });
    if (res.outcome === 'applied') {
      await persistSpatialState(res.state);
      notify('info', 'Base map detached.');
    }
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
    getBaseMap: () => {
      const ref = stateCache.get(currentChatKey())?.spatial?.baseMapRef;
      return baseMapCache.get(baseMapCacheKey(ref)) || null;
    },
    getDiagnostics: () => diagnosticStore.records(currentChatKey()),
    onMaintenanceAction: actionId => applyMaintenanceAction(actionId),
    onSpatialAction: (actionId, payload) => applySpatialAction(actionId, payload),
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

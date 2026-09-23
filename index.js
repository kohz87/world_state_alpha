/* World State Alpha - minimal SillyTavern host integration. */
import { extension_settings, getContext } from '../../../extensions.js';
import {
  extension_prompt_types,
  extension_prompt_roles,
  getRequestHeaders,
  saveSettings,
} from '../../../../script.js';

import { chatLineage, commitMutationBoundary, extendChatLineage, fingerprintMessage, rebaseLineageMetadata, reconcileBranch, seedRootCheckpoint } from './branch.js';
import { CAPTURE_LIMITS, runCaptureOperation } from './capture.js';
import { createDiagnosticStore } from './diagnostics.js';
import { detectElapsedHintFromExchange } from './elapsed.js';
import { prepareWorldStateContinuity } from './evolution.js';
import { stableStringify } from './hash.js';
import { buildWorldStateChatKey, getWorldStateChatIdentity, getWorldStateChatKey, parseWorldStateChatKey } from './host-identity.js';
import { createSillyTavernWorldStateStorageAdapter } from './host-storage.js';
import { storeBaseMapSource, loadBaseMapSource } from './host-base-map.js';
import {
  WORLD_STATE_PROMPT_KEY,
  buildWorldStateInjection,
  continuityInjectionBlocked,
} from './injection.js';
import {
  applyWorldStateImport,
  applyWorldStateReset,
  prepareWorldStateExport,
  previewWorldStateImport,
  previewWorldStateReset,
} from './manual.js';
import { cancelWorldStateRequests, worldStateProfileOptions } from './provider-routing.js';
import { planChronologicalRebuild, REBUILD_LIMITS, runManualRebuild } from './rebuild.js';
import { buildRelevanceIndex, selectRelevantRecords, selectRelevantTombstones, updateRelevanceIndex } from './relevance.js';
import { buildSpatialRelevanceIndex, selectRelevantLocations, updateSpatialRelevanceIndex } from './spatial-relevance.js';
import { buildSpatialInjection } from './spatial-injection.js';
import { applySpatialManualMutation, inspectSpatialLocation, querySpatialLocations } from './spatial-manual.js';
import { resolveEffectiveLocations } from './spatial-core.js';
import { clone, createState, normalizeState } from './state-core.js';
import { makeSidecarPath, readSidecar, writeSidecar } from './storage.js';
import { createWorldStateUiController } from './ui.js';

export const WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.11';
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
  sidecarTombstones: {},
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
const ownershipEpochs = new Map();
const chatQueues = new Map();
const branchDirtyChats = new Set();
const chatCacheTouches = new Map();
const baseMapCacheTouches = new Map();
const pendingCharacterRenames = new Map();
const deleteRetryTimers = new Map();
const diagnosticStore = createDiagnosticStore({ limit: 80 });
const rebuildStatuses = new Map();

const CHAT_CACHE_LIMIT = 6;
const BASE_MAP_CACHE_LIMIT = 8;
const CHARACTER_RENAME_CONTEXT_LIMIT = 8;
const DELETE_OWNERSHIP_RETRY_MS = 1000;
let cacheTouchSequence = 0;

let activeChatKey = 'no-chat';
let initialized = false;
let eventsRegistered = false;
let settingsMountTimer = null;
let panelController = null;
let panelRoot = null;
let panelChatKey = 'no-chat';

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

async function persistHostSettingsNow() {
  if (typeof saveSettings === 'function') {
    await saveSettings();
    return;
  }
  const ctx = getContext();
  const pending = ctx?.saveSettingsDebounced?.();
  if (pending && typeof pending.then === 'function') await pending;
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
  if (!settings.sidecarTombstones || typeof settings.sidecarTombstones !== 'object' || Array.isArray(settings.sidecarTombstones)) {
    settings.sidecarTombstones = {};
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

function ownershipEpoch(chatKey) {
  return Number(ownershipEpochs.get(String(chatKey || '')) || 0);
}

function bumpOwnershipEpoch(chatKey) {
  const key = String(chatKey || '');
  if (!key || key === 'no-chat') return 0;
  const next = ownershipEpoch(key) + 1;
  ownershipEpochs.set(key, next);
  loadingChats.delete(key);
  return next;
}

function assertOwnershipEpoch(chatKey, expectedEpoch) {
  if (ownershipEpoch(chatKey) === Number(expectedEpoch || 0)) return;
  const error = new Error('World State Alpha ownership changed while hydration was in flight.');
  error.code = 'WORLD_STATE_STALE_OWNERSHIP';
  throw error;
}

function touchChatCache(chatKey) {
  const key = String(chatKey || '');
  if (!key || key === 'no-chat') return;
  cacheTouchSequence += 1;
  chatCacheTouches.set(key, cacheTouchSequence);
}

function touchBaseMapCache(cacheKey) {
  const key = String(cacheKey || '');
  if (!key) return;
  cacheTouchSequence += 1;
  baseMapCacheTouches.set(key, cacheTouchSequence);
}

function cacheBaseMap(cacheKey, baseMap) {
  const key = String(cacheKey || '');
  if (!key || !baseMap) return;
  baseMapCache.set(key, baseMap);
  touchBaseMapCache(key);
  while (baseMapCache.size > BASE_MAP_CACHE_LIMIT) {
    const candidate = [...baseMapCache.keys()]
      .sort((a, b) => Number(baseMapCacheTouches.get(a) || 0) - Number(baseMapCacheTouches.get(b) || 0))[0];
    if (!candidate) break;
    baseMapCache.delete(candidate);
    baseMapCacheTouches.delete(candidate);
  }
}

function getCachedBaseMap(ref) {
  const key = baseMapCacheKey(ref);
  if (!key || !baseMapCache.has(key)) return null;
  touchBaseMapCache(key);
  return baseMapCache.get(key) || null;
}

function forgetCachedChat(chatKey) {
  const key = String(chatKey || '');
  if (!key || key === 'no-chat') return false;
  if (key === currentChatKey() || key === activeChatKey || key === panelChatKey) return false;
  if (loadingChats.has(key) || chatQueues.has(key)) return false;
  cancelWorldStateRequests({ chatKey: key });
  stateCache.delete(key);
  relevanceIndices.delete(key);
  spatialRelevanceIndices.delete(key);
  loadedChats.delete(key);
  hydrationErrors.delete(key);
  branchDirtyChats.delete(key);
  chatCacheTouches.delete(key);
  diagnosticStore.clear(key);
  rebuildStatuses.delete(key);
  return true;
}

function evictDormantChatStates(activeKey = currentChatKey()) {
  while (stateCache.size > CHAT_CACHE_LIMIT) {
    const candidate = [...stateCache.keys()]
      .filter(key => key !== activeKey)
      .sort((a, b) => Number(chatCacheTouches.get(a) || 0) - Number(chatCacheTouches.get(b) || 0))
      .find(key => key !== currentChatKey() && key !== activeChatKey && key !== panelChatKey
        && !loadingChats.has(key) && !chatQueues.has(key));
    if (!candidate || !forgetCachedChat(candidate)) break;
  }
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
  if (cacheKey && baseMapCache.has(cacheKey)) {
    const cached = baseMapCache.get(cacheKey);
    if (cached) {
      touchBaseMapCache(cacheKey);
      return cached;
    }
    // Do not negatively cache a transient base-map read failure.
    baseMapCache.delete(cacheKey);
    baseMapCacheTouches.delete(cacheKey);
  }

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
      cacheBaseMap(baseMapCacheKey(pointer) || cacheKey, baseMap);
      return baseMap;
    }
  } catch (error) {
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

function invalidateChatOperations(chatKey = currentChatKey()) {
  if (!chatKey || chatKey === 'no-chat') return;
  stateEpochs.set(chatKey, epoch(chatKey) + 1);
  cancelWorldStateRequests({ chatKey });
}

function setCachedState(chatKey, state, { indexMode = 'rebuild', indexDelta = null, spatialIndexDelta = null } = {}) {
  const normalized = normalizeState(clone(state), { strictSchema: true, chatKey });
  stateCache.set(chatKey, normalized);
  touchChatCache(chatKey);
  stateEpochs.set(chatKey, epoch(chatKey) + 1);

  if (indexMode === 'delta') {
    const index = relevanceIndices.get(chatKey);
    if (index) updateRelevanceIndex(index, indexDelta || {});
    else resetRelevanceIndex(chatKey, normalized);

    const spIndex = spatialRelevanceIndices.get(chatKey);
    const baseMap = getCachedBaseMap(normalized.spatial?.baseMapRef);
    if (spIndex) updateSpatialRelevanceIndex(spIndex, spatialIndexDelta || {});
    else resetSpatialRelevanceIndex(chatKey, normalized.spatial, baseMap);
  } else if (indexMode !== 'preserve') {
    resetRelevanceIndex(chatKey, normalized);
    const baseMap = getCachedBaseMap(normalized.spatial?.baseMapRef);
    resetSpatialRelevanceIndex(chatKey, normalized.spatial, baseMap);
  }
  return normalized;
}

function getCachedState(chatKey = currentChatKey()) {
  const state = stateCache.get(chatKey);
  if (state) touchChatCache(chatKey);
  return state ? clone(state) : null;
}

function stateChanged(left, right) {
  return stableStringify(normalizeState(left)) !== stableStringify(normalizeState(right));
}

function pointerFor(chatKey) {
  const pointer = getWorldStateSettings().dataFiles?.[chatKey];
  return pointer && typeof pointer === 'object' ? structuredClone(pointer) : null;
}

function tombstoneFor(chatKey) {
  const value = getWorldStateSettings().sidecarTombstones?.[chatKey];
  return value && typeof value === 'object' ? structuredClone(value) : null;
}

function pointerFromPayload(path, payload) {
  if (!path || !payload?.state) return null;
  return {
    path: String(path),
    revision: Math.max(0, Math.trunc(Number(payload.revision) || 0)),
    checksum: String(payload.checksum || ''),
  };
}

async function recoverExistingSidecarPointer(chatKey, preferredPointer = null) {
  const deterministicPath = hostStorage.deterministicPath?.(makeSidecarPath(chatKey)) || '';
  const candidates = [
    preferredPointer?.path ? String(preferredPointer.path) : '',
    deterministicPath,
  ].filter((path, index, rows) => path && rows.indexOf(path) === index);

  for (const path of candidates) {
    const payload = await readSidecar({
      adapter: hostStorage,
      pointer: { path },
      expectedChatKey: chatKey,
    });
    if (payload?.state) return { pointer: pointerFromPayload(path, payload), payload };
  }
  return null;
}

async function persistCriticalHostSettings(label) {
  try {
    await persistHostSettingsNow();
    return true;
  } catch (error) {
    console.warn('[World State Alpha] could not synchronously persist ' + label + '; deterministic sidecar recovery remains available.', error);
    persistHostSettings();
    return false;
  }
}

async function neutralizeRetiredSidecar(chatKey, pointer) {
  if (!pointer?.path) return null;
  const emptyState = seedRootCheckpoint(createState(chatKey));
  return writeSidecar({
    adapter: hostStorage,
    chatKey,
    state: emptyState,
    pointer,
    appVersion: WORLD_STATE_ALPHA_VERSION,
  });
}

async function persistState(chatKey, state = stateCache.get(chatKey)) {
  if (!chatKey || chatKey === 'no-chat') return null;
  if (hydrationErrors.has(chatKey)) {
    const error = new Error('World State Alpha will not write while this chat has a hydration error.');
    error.code = 'WORLD_STATE_HYDRATION_BLOCKED';
    throw error;
  }
  if (!state) throw new Error('World State Alpha has no loaded state to persist.');

  const ownerEpoch = ownershipEpoch(chatKey);
  const settings = getWorldStateSettings();
  const existingSettingsPointer = pointerFor(chatKey);
  const tombstone = tombstoneFor(chatKey);
  let pointer = existingSettingsPointer;

  // A recreated chat may intentionally replace a retired sidecar. Recover only
  // its revision/checksum as the write predecessor; never resurrect its state.
  if (!pointer && tombstone) {
    pointer = tombstone.pointer?.path ? structuredClone(tombstone.pointer) : null;
    const recovered = await recoverExistingSidecarPointer(chatKey, pointer);
    assertOwnershipEpoch(chatKey, ownerEpoch);
    if (recovered?.pointer) pointer = recovered.pointer;
  }

  const committed = await writeSidecar({
    adapter: hostStorage,
    chatKey,
    state,
    pointer,
    appVersion: WORLD_STATE_ALPHA_VERSION,
  });
  assertOwnershipEpoch(chatKey, ownerEpoch);

  settings.dataFiles[chatKey] = committed;
  if (settings.sidecarTombstones?.[chatKey]) delete settings.sidecarTombstones[chatKey];

  if (!existingSettingsPointer?.path || tombstone) {
    await persistCriticalHostSettings('World State sidecar ownership');
  } else {
    // Revision drift after a crash is self-repairing during hydration, so
    // ordinary revision advancement can stay on the host's debounced path.
    persistHostSettings();
  }
  return committed;
}

async function loadChatState(chatKey) {
  const settings = getWorldStateSettings();
  const pointer = pointerFor(chatKey);
  const tombstone = tombstoneFor(chatKey);

  if (tombstone) {
    return {
      state: seedRootCheckpoint(createState(chatKey)),
      pointer: null,
      repairPointer: false,
      tombstoned: true,
    };
  }

  const recovered = await recoverExistingSidecarPointer(chatKey, pointer);
  if (!recovered) {
    if (pointer?.path) {
      const error = new Error('World State Alpha sidecar pointer exists but the sidecar is unavailable.');
      error.code = 'WORLD_STATE_SIDECAR_MISSING';
      throw error;
    }
    return {
      state: seedRootCheckpoint(createState(chatKey)),
      pointer: null,
      repairPointer: false,
      tombstoned: false,
    };
  }

  const actualPointer = recovered.pointer;
  const repairPointer = !pointer?.path
    || pointer.path !== actualPointer.path
    || Number(pointer.revision || 0) !== actualPointer.revision
    || String(pointer.checksum || '') !== actualPointer.checksum;

  return {
    state: normalizeState(recovered.payload.state, { strictSchema: true, chatKey }),
    pointer: actualPointer,
    repairPointer,
    tombstoned: false,
  };
}

function clearChatRuntimeState(chatKey) {
  if (!chatKey || chatKey === 'no-chat') return;
  cancelWorldStateRequests({ chatKey });
  stateCache.delete(chatKey);
  relevanceIndices.delete(chatKey);
  spatialRelevanceIndices.delete(chatKey);
  loadedChats.delete(chatKey);
  hydrationErrors.delete(chatKey);
  loadingChats.delete(chatKey);
  branchDirtyChats.delete(chatKey);
  chatCacheTouches.delete(chatKey);
  diagnosticStore.clear(chatKey);
}
async function migrateWorldStateChatKey(oldKey, newKey) {
  if (!oldKey || oldKey === 'no-chat' || !newKey || newKey === 'no-chat' || oldKey === newKey) return true;

  const oldOwnerEpoch = bumpOwnershipEpoch(oldKey);
  const newOwnerEpoch = bumpOwnershipEpoch(newKey);
  invalidateChatOperations(oldKey);
  invalidateChatOperations(newKey);

  const pendingOldWork = chatQueues.get(oldKey);
  if (pendingOldWork) await pendingOldWork.catch(() => {});
  assertOwnershipEpoch(oldKey, oldOwnerEpoch);
  assertOwnershipEpoch(newKey, newOwnerEpoch);

  const settings = getWorldStateSettings();
  const oldPointer = settings.dataFiles?.[oldKey] || null;
  const newPointer = settings.dataFiles?.[newKey] || null;
  if (newPointer || settings.sidecarTombstones?.[newKey]) {
    console.warn('[World State Alpha] identity migration refused because the destination already has World State ownership:', newKey);
    return false;
  }

  const destinationOrphan = await recoverExistingSidecarPointer(newKey, null);
  assertOwnershipEpoch(oldKey, oldOwnerEpoch);
  assertOwnershipEpoch(newKey, newOwnerEpoch);
  if (destinationOrphan?.payload?.state) {
    console.warn('[World State Alpha] identity migration refused because the destination deterministic sidecar already exists:', newKey);
    return false;
  }

  let sourceState = stateCache.get(oldKey) || null;
  let sourcePointer = oldPointer;
  const recoveredSource = await recoverExistingSidecarPointer(oldKey, oldPointer);
  assertOwnershipEpoch(oldKey, oldOwnerEpoch);
  if (recoveredSource?.payload?.state) {
    sourcePointer = recoveredSource.pointer;
    if (!sourceState) sourceState = recoveredSource.payload.state;
  }

  if (!sourceState) {
    if (oldPointer) {
      console.warn('[World State Alpha] identity migration could not load the source sidecar:', oldKey);
      return false;
    }
    return true;
  }

  const migrated = normalizeState(clone(sourceState), { strictSchema: true, chatKey: oldKey });
  migrated.chatKey = newKey;
  const committed = await writeSidecar({
    adapter: hostStorage,
    chatKey: newKey,
    state: migrated,
    pointer: null,
    appVersion: WORLD_STATE_ALPHA_VERSION,
  });
  assertOwnershipEpoch(oldKey, oldOwnerEpoch);
  assertOwnershipEpoch(newKey, newOwnerEpoch);

  let retiredSourcePointer = sourcePointer;
  if (sourcePointer?.path) {
    try {
      retiredSourcePointer = await neutralizeRetiredSidecar(oldKey, sourcePointer);
      assertOwnershipEpoch(oldKey, oldOwnerEpoch);
    } catch (error) {
      console.warn('[World State Alpha] renamed source sidecar could not be neutralized; durable ownership tombstone remains authoritative.', error);
    }
  }

  settings.dataFiles[newKey] = committed;
  settings.sidecarTombstones[oldKey] = {
    reason: 'renamed',
    pointer: retiredSourcePointer ? structuredClone(retiredSourcePointer) : null,
  };
  delete settings.dataFiles[oldKey];
  await persistCriticalHostSettings('renamed World State ownership');

  const wasLoaded = loadedChats.has(oldKey);
  clearChatRuntimeState(oldKey);
  setCachedState(newKey, migrated);
  if (wasLoaded) loadedChats.add(newKey);
  hydrationErrors.delete(newKey);
  if (activeChatKey === oldKey) activeChatKey = newKey;
  if (panelChatKey === oldKey) closeWorldStatePanel();
  return true;
}

function characterOwnerKeyPrefix(ownerId) {
  const probe = buildWorldStateChatKey('chat', ownerId, '__world_state_probe__');
  const splitAt = probe.lastIndexOf(':');
  return splitAt >= 0 ? probe.slice(0, splitAt + 1) : '';
}

function rememberCharacterRename(oldAvatar, newAvatar) {
  const ctx = getContext();
  const oldName = String(
    ctx?.characters?.find?.(item => String(item?.avatar || '') === String(oldAvatar || ''))?.name
      || ctx?.character?.name
      || '',
  ).trim();
  if (!oldName) return;
  pendingCharacterRenames.set(String(oldAvatar || ''), {
    oldAvatar: String(oldAvatar || ''),
    newAvatar: String(newAvatar || ''),
    oldName,
  });
  while (pendingCharacterRenames.size > CHARACTER_RENAME_CONTEXT_LIMIT) {
    pendingCharacterRenames.delete(pendingCharacterRenames.keys().next().value);
  }
}

async function handleCharacterRenamed(oldAvatar, newAvatar) {
  rememberCharacterRename(oldAvatar, newAvatar);

  const oldPrefix = characterOwnerKeyPrefix(oldAvatar);
  const newPrefix = characterOwnerKeyPrefix(newAvatar);
  if (!oldPrefix || !newPrefix || oldPrefix === newPrefix) return;

  const settings = getWorldStateSettings();
  const keys = new Set([
    ...Object.keys(settings.dataFiles || {}),
    ...stateCache.keys(),
  ]);
  for (const oldKey of keys) {
    if (!oldKey.startsWith(oldPrefix)) continue;
    const newKey = newPrefix + oldKey.slice(oldPrefix.length);
    try {
      const migrated = await migrateWorldStateChatKey(oldKey, newKey);
      if (!migrated) notify('error', 'World State Alpha could not migrate one renamed character chat safely.');
    } catch (error) {
      console.error('[World State Alpha] character rename migration failed safely', error);
      notify('error', 'World State Alpha could not migrate renamed character continuity safely.');
    }
  }
}

function renamedGroupMessage(message, newAvatar) {
  if (!message || message.is_user || message.is_system) return false;
  if (String(message.original_avatar || '') === String(newAvatar || '')) return true;
  const forceAvatar = String(message.force_avatar || '');
  return Boolean(forceAvatar && forceAvatar.includes(encodeURIComponent(String(newAvatar || ''))));
}

function stateLineageMatchesPrefix(state, lineage) {
  const stored = Array.isArray(state?.lineage) ? state.lineage : [];
  if (!stored.length || stored.length > lineage.length) return false;
  return stored.every((entry, index) => entry?.lineageKey === lineage[index]?.lineageKey);
}

async function handleCharacterRenamedInPastChat(messages, oldAvatar, newAvatar) {
  if (!Array.isArray(messages) || !messages.length) return;
  const renameContext = pendingCharacterRenames.get(String(oldAvatar || ''));
  const oldName = String(renameContext?.oldName || '').trim();
  const newName = String(
    getContext()?.characters?.find?.(item => String(item?.avatar || '') === String(newAvatar || ''))?.name
      || '',
  ).trim();
  if (!oldName || !newName || oldName === newName) return;

  // SillyTavern's past-chat payload may include the persisted chat header,
  // while getContext().chat and Alpha lineage never do.
  const renamedMessages = messages.filter(message => !Object.hasOwn(message || {}, 'chat_metadata'));
  if (!renamedMessages.length) return;
  const isGroupEvent = renamedMessages.some(message => renamedGroupMessage(message, newAvatar));
  const previousMessages = structuredClone(renamedMessages);
  let affected = 0;
  for (let index = 0; index < previousMessages.length; index += 1) {
    const current = renamedMessages[index];
    const prior = previousMessages[index];
    if (!prior || prior.is_user || prior.is_system || String(prior.name || '') !== newName) continue;
    if (isGroupEvent && !renamedGroupMessage(current, newAvatar)) continue;
    prior.name = oldName;
    affected += 1;
  }
  if (!affected) return;

  const previousLineage = chatLineage(previousMessages);
  const nextLineage = chatLineage(renamedMessages);
  const settings = getWorldStateSettings();
  const directPrefix = characterOwnerKeyPrefix(newAvatar);
  const candidates = new Set([
    ...Object.keys(settings.dataFiles || {}),
    ...stateCache.keys(),
  ]);
  const matches = [];

  for (const chatKey of candidates) {
    if (settings.sidecarTombstones?.[chatKey]) continue;
    if (isGroupEvent ? !chatKey.startsWith('group:') : !chatKey.startsWith(directPrefix)) continue;

    let candidateState = stateCache.get(chatKey) || null;
    let candidatePointer = pointerFor(chatKey);
    if (!candidateState) {
      try {
        const recovered = await recoverExistingSidecarPointer(chatKey, candidatePointer);
        if (recovered?.payload?.state) {
          candidateState = recovered.payload.state;
          candidatePointer = recovered.pointer;
        }
      } catch (error) {
        console.warn('[World State Alpha] past-chat rename lineage probe skipped one sidecar:', chatKey, error);
        continue;
      }
    }
    if (!candidateState || !stateLineageMatchesPrefix(candidateState, previousLineage)) continue;
    matches.push({ chatKey, pointer: candidatePointer, wasLoaded: loadedChats.has(chatKey) });
  }

  if (matches.length !== 1) {
    if (matches.length > 1) {
      console.warn('[World State Alpha] past-chat rename matched multiple continuity states; lineage migration was preserved fail-closed.');
    }
    return;
  }

  const { chatKey } = matches[0];
  const ownerEpoch = bumpOwnershipEpoch(chatKey);
  invalidateChatOperations(chatKey);

  await queueChatWork(chatKey, async () => {
    assertOwnershipEpoch(chatKey, ownerEpoch);
    const currentSettings = getWorldStateSettings();
    let currentState = stateCache.get(chatKey) || null;
    let actualPointer = pointerFor(chatKey);
    const recovered = await recoverExistingSidecarPointer(chatKey, actualPointer);
    assertOwnershipEpoch(chatKey, ownerEpoch);
    if (recovered?.payload?.state) {
      actualPointer = recovered.pointer;
      if (!currentState) currentState = recovered.payload.state;
    }
    if (!currentState || !stateLineageMatchesPrefix(currentState, previousLineage)) return;

    const length = currentState.lineage.length;
    const rebased = rebaseLineageMetadata(
      currentState,
      previousLineage.slice(0, length),
      nextLineage.slice(0, length),
    );
    const committed = await writeSidecar({
      adapter: hostStorage,
      chatKey,
      state: rebased,
      pointer: actualPointer,
      appVersion: WORLD_STATE_ALPHA_VERSION,
    });
    assertOwnershipEpoch(chatKey, ownerEpoch);

    currentSettings.dataFiles[chatKey] = committed;
    await persistCriticalHostSettings('past-chat rename lineage');
    if (matches[0].wasLoaded || stateCache.has(chatKey)) {
      setCachedState(chatKey, rebased);
      loadedChats.add(chatKey);
    }
    if (currentChatKey() === chatKey) {
      updatePrivateInjection();
      refreshPanel();
    }
  });
}

async function handleCharacterDeleted(eventData = {}) {
  const avatar = String(eventData?.character?.avatar || eventData?.avatar || '').trim();
  const prefix = characterOwnerKeyPrefix(avatar);
  if (!prefix) return;

  pendingCharacterRenames.delete(avatar);
  const settings = getWorldStateSettings();
  const keys = new Set([
    ...Object.keys(settings.dataFiles || {}),
    ...stateCache.keys(),
  ]);
  for (const chatKey of keys) {
    if (!chatKey.startsWith(prefix)) continue;
    await removeWorldStateChatOwnership(chatKey, 'character-deleted');
  }
}

async function handleChatRenamed(eventData = {}) {
  const oldChatId = String(eventData?.oldFileName || '').replace(/\.jsonl$/i, '').trim();
  const newChatId = String(eventData?.newFileName || '').replace(/\.jsonl$/i, '').trim();
  if (!oldChatId || !newChatId || oldChatId === newChatId) return;

  const hasGroup = eventData?.groupId !== undefined
    && eventData?.groupId !== null
    && String(eventData.groupId).trim() !== '';
  const identity = currentChatIdentity();
  const kind = hasGroup ? 'group' : 'chat';
  const ownerId = hasGroup
    ? String(eventData.groupId).trim()
    : String(eventData?.avatarId || identity.ownerId || '').trim();
  if (!ownerId) return;

  const oldKey = buildWorldStateChatKey(kind, ownerId, oldChatId);
  const newKey = buildWorldStateChatKey(kind, ownerId, newChatId);
  try {
    const migrated = await migrateWorldStateChatKey(oldKey, newKey);
    if (!migrated) {
      notify('error', 'World State Alpha could not migrate the renamed chat because the destination already has continuity data.');
      return;
    }
    if (currentChatKey() === newKey) await activateCurrentChat();
  } catch (error) {
    console.error('[World State Alpha] chat rename migration failed safely', error);
    notify('error', 'World State Alpha could not migrate renamed chat continuity safely.');
  }
}

function matchingWorldStateChatKeys(kind, chatId) {
  if (!['chat', 'group'].includes(kind)) return [];
  const probe = buildWorldStateChatKey(kind, '__world_state_owner_probe__', chatId);
  const splitAt = probe.indexOf(':', probe.indexOf(':') + 1);
  const suffix = splitAt >= 0 ? probe.slice(splitAt) : '';
  if (!suffix) return [];

  const settings = getWorldStateSettings();
  const keys = new Set([
    ...Object.keys(settings.dataFiles || {}),
    ...stateCache.keys(),
  ]);
  return [...keys].filter(key => key.startsWith(kind + ':') && key.endsWith(suffix));
}

async function hostCharacterChatPresence(ownerId, rawId) {
  const owner = String(ownerId || '').trim();
  const id = String(rawId || '').replace(/\.jsonl$/i, '').trim();
  if (!owner || !id || typeof globalThis.fetch !== 'function') return null;
  try {
    const response = await globalThis.fetch('/api/characters/chats', {
      method: 'POST',
      headers: getRequestHeaders(),
      body: JSON.stringify({ avatar_url: owner, simple: true }),
    });
    if (!response?.ok) return null;
    const data = typeof response.json === 'function' ? await response.json() : null;
    if (!data || typeof data !== 'object') return null;
    const chats = Array.isArray(data) ? data : Object.values(data);
    return chats.some(item => String(item?.file_name ?? item?.fileName ?? item?.name ?? '')
      .replace(/\.jsonl$/i, '').trim() === id);
  } catch (error) {
    console.debug('[World State Alpha] character chat ownership probe failed:', owner, id, error);
    return null;
  }
}

function hostGroupChatPresence(ownerId, rawId) {
  const owner = String(ownerId || '').trim();
  const id = String(rawId || '').replace(/\.jsonl$/i, '').trim();
  const groups = getContext()?.groups;
  if (!owner || !id || !Array.isArray(groups)) return null;
  const group = groups.find(item => String(item?.id ?? '').trim() === owner);
  if (!group) return false;
  const chats = [
    ...(Array.isArray(group.chats) ? group.chats : []),
    group.chat_id,
  ].map(value => String(value ?? '').replace(/\.jsonl$/i, '').trim()).filter(Boolean);
  return chats.includes(id);
}

async function resolveDeletedWorldStateChatKey(chatId, kind, explicitOwnerId = '') {
  const id = String(chatId || '').replace(/\.jsonl$/i, '').trim();
  if (!id || !['chat', 'group'].includes(kind)) return '';
  const owner = String(explicitOwnerId || '').trim();
  if (owner) return buildWorldStateChatKey(kind, owner, id);

  const candidates = matchingWorldStateChatKeys(kind, id);
  if (!candidates.length) return '';

  const presence = [];
  for (const chatKey of candidates) {
    const parsed = parseWorldStateChatKey(chatKey);
    if (!parsed) continue;
    const value = kind === 'group'
      ? hostGroupChatPresence(parsed.ownerId, id)
      : await hostCharacterChatPresence(parsed.ownerId, id);
    presence.push({ chatKey, value });
  }

  if (presence.some(item => item.value === null)) {
    console.warn('[World State Alpha] delete ownership could not be proven; continuity was preserved fail-closed:', kind, id);
    return '';
  }
  const removed = presence.filter(item => item.value === false);
  if (removed.length === 1 && presence.length === candidates.length) return removed[0].chatKey;

  console.warn('[World State Alpha] delete ownership remained ambiguous; continuity was preserved fail-closed:', kind, id);
  return '';
}

async function removeWorldStateChatOwnership(chatKey, reason = 'chat-deleted') {
  if (!chatKey || chatKey === 'no-chat') return false;

  const ownerEpoch = bumpOwnershipEpoch(chatKey);
  invalidateChatOperations(chatKey);
  const pending = chatQueues.get(chatKey);
  if (pending) await pending.catch(() => {});
  assertOwnershipEpoch(chatKey, ownerEpoch);

  const settings = getWorldStateSettings();
  let retiredPointer = pointerFor(chatKey);
  try {
    const recovered = await recoverExistingSidecarPointer(chatKey, retiredPointer);
    assertOwnershipEpoch(chatKey, ownerEpoch);
    if (recovered?.pointer) retiredPointer = recovered.pointer;
  } catch (error) {
    console.warn('[World State Alpha] retiring chat ownership without refreshed sidecar metadata:', chatKey, error);
  }

  if (retiredPointer?.path) {
    try {
      retiredPointer = await neutralizeRetiredSidecar(chatKey, retiredPointer);
      assertOwnershipEpoch(chatKey, ownerEpoch);
    } catch (error) {
      console.warn('[World State Alpha] retired sidecar could not be neutralized; settings tombstone will remain authoritative.', error);
    }
  }

  settings.sidecarTombstones[chatKey] = {
    reason: String(reason || 'chat-deleted'),
    pointer: retiredPointer ? structuredClone(retiredPointer) : null,
  };
  delete settings.dataFiles[chatKey];
  await persistCriticalHostSettings('retired World State ownership');

  clearChatRuntimeState(chatKey);
  if (activeChatKey === chatKey) {
    activeChatKey = 'no-chat';
    clearPrivatePrompt();
  }
  if (panelChatKey === chatKey) closeWorldStatePanel();
  return true;
}

function scheduleDeleteOwnershipRetry(chatId, kind) {
  const key = kind + ':' + String(chatId || '');
  if (deleteRetryTimers.has(key)) return;
  const timer = setTimeout(() => {
    deleteRetryTimers.delete(key);
    void handleChatDeleted({ chatId, __worldStateRetry: true }, kind).catch(error => {
      console.warn('[World State Alpha] delayed delete ownership resolution failed safely:', error);
    });
  }, DELETE_OWNERSHIP_RETRY_MS);
  deleteRetryTimers.set(key, timer);
}

async function handleChatDeleted(eventData, forcedKind = 'chat') {
  const deletedChatId = String(
    typeof eventData === 'string'
      ? eventData
      : (eventData?.chatId || eventData?.fileName || eventData?.oldFileName || ''),
  ).replace(/\.jsonl$/i, '').trim();
  if (!deletedChatId) return;

  const eventObject = eventData && typeof eventData === 'object' ? eventData : null;
  const kind = forcedKind === 'group' || eventObject?.groupId ? 'group' : 'chat';
  const explicitOwnerId = kind === 'group'
    ? String(eventObject?.groupId || '').trim()
    : String(eventObject?.avatarId || eventObject?.avatar || '').trim();

  const resolved = await resolveDeletedWorldStateChatKey(deletedChatId, kind, explicitOwnerId);
  if (resolved) {
    await removeWorldStateChatOwnership(resolved, kind === 'group' ? 'group-chat-deleted' : 'chat-deleted');
    return;
  }

  if (!eventObject?.__worldStateRetry && matchingWorldStateChatKeys(kind, deletedChatId).length) {
    // Whole-group deletion in SillyTavern 1.18 can emit before its in-memory
    // group list is refreshed. Retry once after the host settles, without guessing.
    scheduleDeleteOwnershipRetry(deletedChatId, kind);
  }
}

async function ensureChatStateLoaded(chatKey = currentChatKey()) {
  if (!chatKey || chatKey === 'no-chat') return null;
  if (loadedChats.has(chatKey) && !hydrationErrors.has(chatKey)) {
    touchChatCache(chatKey);
    return stateCache.get(chatKey);
  }
  if (loadingChats.has(chatKey)) return loadingChats.get(chatKey);

  const ownerEpoch = ownershipEpoch(chatKey);
  let loading;
  loading = (async () => {
    try {
      const loaded = await loadChatState(chatKey);
      assertOwnershipEpoch(chatKey, ownerEpoch);

      if (loaded.repairPointer && loaded.pointer) {
        const settings = getWorldStateSettings();
        settings.dataFiles[chatKey] = loaded.pointer;
        await persistCriticalHostSettings('recovered World State sidecar pointer');
        assertOwnershipEpoch(chatKey, ownerEpoch);
      }

      setCachedState(chatKey, loaded.state);
      const loadedState = stateCache.get(chatKey);
      if (loadedState?.spatial?.baseMapRef?.id) {
        const baseMap = await getChatBaseMap(chatKey, loadedState);
        assertOwnershipEpoch(chatKey, ownerEpoch);
        if (baseMap) resetSpatialRelevanceIndex(chatKey, loadedState.spatial, baseMap);
      }
      assertOwnershipEpoch(chatKey, ownerEpoch);
      loadedChats.add(chatKey);
      hydrationErrors.delete(chatKey);
      touchChatCache(chatKey);
      return loadedState;
    } catch (error) {
      if (error?.code !== 'WORLD_STATE_STALE_OWNERSHIP') hydrationErrors.set(chatKey, error);
      loadedChats.delete(chatKey);
      throw error;
    } finally {
      if (loadingChats.get(chatKey) === loading) loadingChats.delete(chatKey);
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
  if (!state || continuityInjectionBlocked(state, { branchDirty: branchDirtyChats.has(chatKey) })) {
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
    const baseMap = getCachedBaseMap(baseRef);
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
    const liveSettings = getWorldStateSettings();
    if (!liveSettings.enabled || !liveSettings.autoCapture) return;
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
    const captureText = recentText(exchange);
    const activeVisible = selectRelevantRecords(before, {
      index,
      recentText: captureText,
      currentMessageId: messageId,
      maxRecords: CAPTURE_LIMITS.visibleRecords,
    }).selected.map(item => item.record);
    const tombstones = selectRelevantTombstones(index, {
      recentText: captureText,
      currentMessageId: messageId,
      maxRecords: 2,
      candidateCap: 32,
    }).selected.map(item => item.record);
    const activeSlots = Math.max(0, CAPTURE_LIMITS.visibleRecords - tombstones.length);
    const visible = [...activeVisible.slice(0, activeSlots), ...tombstones];

    let visibleLocations = [];
    let baseMap = null;
    let spatialCaptureEnabled = Boolean(liveSettings.spatialEnabled);
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

  // Prepare this generation from the last durably committed state only.
  // Provider-backed evolution remains serialized on the chat writer queue,
  // but completes in the background for later injections.
  await ensureChatStateLoaded(chatKey);
  if (currentChatKey() !== chatKey || hydrationErrors.has(chatKey)) return;
  updatePrivateInjection();
  refreshPanel();

  void queueChatWork(chatKey, async () => {
    await ensureChatStateLoaded(chatKey);
    if (currentChatKey() !== chatKey || hydrationErrors.has(chatKey)) return;
    if (!getWorldStateSettings().enabled) {
      clearPrivatePrompt();
      return;
    }
    const branch = extendCurrentBranchFast(chatKey)
      || await reconcileCurrentBranch(chatKey, { persistRestore: true });
    // Reality evolution belongs to Reality injection only. Spatial-only
    // injection is local retrieval and must never trigger a Reality provider call.
    const liveSettings = getWorldStateSettings();
    if (!liveSettings.enabled || branch?.failClosed || !liveSettings.inject) {
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
  }).catch(error => {
    console.error('[World State Alpha] background continuity failed safely', error);
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
  const chatKey = identity.key;
  activeChatKey = chatKey;

  if (panelChatKey !== 'no-chat' && panelChatKey !== chatKey) closeWorldStatePanel();
  if (previousKey && previousKey !== 'no-chat' && previousKey !== chatKey) {
    cancelWorldStateRequests({ chatKey: previousKey });
  }

  if (!identity.ready || chatKey === 'no-chat') {
    clearPrivatePrompt();
    refreshPanel();
    return;
  }

  try {
    await ensureChatStateLoaded(chatKey);
    if (currentChatKey() !== chatKey) return;
    await reconcileCurrentBranch(chatKey, { persistRestore: true });
    if (currentChatKey() !== chatKey) return;
    updatePrivateInjection();
    refreshPanel();
    evictDormantChatStates(chatKey);
  } catch (error) {
    if (currentChatKey() !== chatKey) return;
    if (error?.code === 'WORLD_STATE_STALE_OWNERSHIP') {
      void activateCurrentChat();
      return;
    }
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
  const section = document.createElement('div');
  section.id = WORLD_STATE_SETTINGS_ID;
  section.className = 'extension_container world-state-alpha-settings';
  section.innerHTML = [
    '<div class="inline-drawer">',
    '<div class="inline-drawer-toggle inline-drawer-header world-state-alpha-settings-head">',
    '<b>World State Alpha <span class="world-state-alpha-version">v' + WORLD_STATE_ALPHA_VERSION + '</span></b>',
    '<div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>',
    '</div>',
    '<div class="inline-drawer-content world-state-alpha-settings-drawer">',
    '<div class="world-state-alpha-settings-body">',
    '<div class="world-state-alpha-settings-group">',
    '<div class="world-state-alpha-settings-group-head"><strong>Continuity</strong><span>Capture and inject established world state.</span></div>',
    '<label class="world-state-alpha-toggle"><input id="world_state_alpha_enabled" type="checkbox"><span>Enable World State Alpha</span></label>',
    '<label class="world-state-alpha-toggle"><input id="world_state_alpha_auto_capture" type="checkbox"><span>Capture established world changes</span></label>',
    '<label class="world-state-alpha-toggle"><input id="world_state_alpha_inject" type="checkbox"><span>Inject private world continuity</span></label>',
    '<div class="world-state-alpha-settings-grid">',
    '<label class="world-state-alpha-field"><span>Injection depth</span><input id="world_state_alpha_inject_depth" type="number" min="0" max="20" step="1"></label>',
    '<label class="world-state-alpha-field"><span>Injection budget</span><input id="world_state_alpha_inject_budget" type="number" min="1" max="2400" step="1"></label>',
    '</div>',
    '<label class="world-state-alpha-field"><span>Connection profile</span><select id="world_state_alpha_connection_profile" title="Choose a SillyTavern Connection Profile for World State requests"></select></label>',
    '</div>',
    '<div class="world-state-alpha-settings-group">',
    '<div class="world-state-alpha-settings-group-head"><strong>Spatial continuity</strong><span>Optional place, route, and map continuity.</span></div>',
    '<label class="world-state-alpha-toggle"><input id="world_state_alpha_spatial_enabled" type="checkbox"><span>Enable Spatial Continuity (Phase 9)</span></label>',
    '<label class="world-state-alpha-toggle"><input id="world_state_alpha_spatial_inject" type="checkbox"><span>Inject spatial continuity</span></label>',
    '<label class="world-state-alpha-field"><span>Spatial injection budget</span><input id="world_state_alpha_spatial_inject_budget" type="number" min="1" max="2400" step="1"></label>',
    '</div>',
    '<button id="world_state_alpha_open" type="button" class="menu_button world-state-alpha-open">Open World State</button>',
    '</div>',
    '</div>',
    '</div>',
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

    if ([
      'world_state_alpha_enabled',
      'world_state_alpha_auto_capture',
      'world_state_alpha_inject',
      'world_state_alpha_connection_profile',
      'world_state_alpha_spatial_enabled',
      'world_state_alpha_spatial_inject',
    ].includes(target.id)) {
      invalidateChatOperations();
    }

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
  panelChatKey = 'no-chat';
}

function refreshPanel() {
  if (panelChatKey !== 'no-chat' && currentChatKey() !== panelChatKey) {
    closeWorldStatePanel();
    return;
  }
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

async function applyMaintenanceAction(actionId, payload = {}, expectedChatKey = currentChatKey()) {
  const chatKey = String(expectedChatKey || '');
  if (!chatKey || chatKey === 'no-chat' || currentChatKey() !== chatKey) return;

  // Cancellation is control-plane only: it must not sit behind the provider-backed
  // rebuild it is intended to abort. Canonical mutation/persistence remains on
  // the per-chat writer queue.
  if (actionId === 'cancel_rebuild') {
    const status = rebuildStatuses.get(chatKey);
    if (!status?.operationId || !['running', 'cancelling'].includes(status.phase)) return;
    const cancelled = cancelWorldStateRequests({
      chatKey,
      operationIdPrefix: status.operationId,
    });
    rebuildStatuses.set(chatKey, {
      ...status,
      phase: 'cancelling',
      detail: cancelled
        ? 'Cancellation requested; waiting for the active provider call to stop safely.'
        : 'Cancellation requested; no active provider call is currently in flight.',
    });
    refreshPanel();
    notify('info', 'World State Alpha rebuild cancellation requested.');
    return;
  }

  return queueChatWork(chatKey, () => applyMaintenanceActionNow(actionId, payload, chatKey));
}

async function applyMaintenanceActionNow(actionId, payload, chatKey) {
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
    if (currentChatKey() !== chatKey) return;
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
    rebuildStatuses.delete(chatKey);
    await persistState(chatKey, next);
    setCachedState(chatKey, next);
    updatePrivateInjection();
    refreshPanel();
    return;
  }

  if (actionId === 'rebuild') {
    const chat = getContext().chat || [];
    const rebuildRequest = payload?.rebuild && typeof payload.rebuild === 'object' ? payload.rebuild : {};
    if (!payload?.rebuild
      && !window.confirm('Rebuild World State Alpha from this chat chronology? This is an explicit provider-backed recovery operation.')) return;

    const mode = ['full', 'last', 'from'].includes(rebuildRequest.mode) ? rebuildRequest.mode : 'full';
    const numeric = (value, fallback, min, max) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return Math.max(min, Math.min(max, Math.trunc(number)));
    };
    const maxBoundaries = numeric(
      rebuildRequest.maxBoundaries,
      REBUILD_LIMITS.maxBoundaries,
      1,
      4096,
    );
    const lastMessages = numeric(rebuildRequest.lastMessages, 20, 1, Math.max(1, chat.length));
    const requestedStart = numeric(rebuildRequest.startMessageId, 0, 0, Math.max(0, chat.length - 1));
    const startMessageId = mode === 'last'
      ? Math.max(0, chat.length - lastMessages)
      : mode === 'from'
        ? requestedStart
        : 0;

    let rebuildPlan;
    try {
      rebuildPlan = planChronologicalRebuild(chat, { maxBoundaries, startMessageId });
    } catch (error) {
      const detail = String(error?.message || error || 'rebuild planning failed').slice(0, 320);
      notify('error', 'World State Alpha rebuild could not start: ' + detail);
      return;
    }

    const sourceMessageId = Math.max(0, chat.length - 1);
    const totalBoundaries = rebuildPlan.metrics.assistantBoundaries;
    const startEpoch = epoch(chatKey);
    const startLineage = stableStringify(chatLineage(chat));
    const operationId = 'rebuild:' + sourceMessageId + ':' + startEpoch + ':' + startMessageId;
    const isCurrent = () => currentChatKey() === chatKey
      && epoch(chatKey) === startEpoch
      && stableStringify(chatLineage(getContext().chat || [])) === startLineage;
    const settings = getWorldStateSettings();
    const baseMap = await getChatBaseMap(chatKey, state);
    if (!isCurrent()) return;
    if (settings.spatialEnabled && state.spatial?.baseMapRef?.id && !baseMap) {
      notify('error', 'Rebuild paused because the attached Spatial base map is unavailable. Reattach or restore the base map first.');
      return;
    }

    const rangeLabel = startMessageId > 0 ? 'message ' + startMessageId + ' to current' : 'full chat';
    rebuildStatuses.set(chatKey, {
      phase: 'running',
      operationId,
      mode,
      startMessageId,
      maxBoundaries,
      processedBoundaries: 0,
      totalBoundaries,
      currentMessageId: null,
      providerCalls: 0,
      applied: 0,
      rejected: 0,
      currentRecords: (state.records || []).filter(record => record?.status === 'active').length,
      places: resolveEffectiveLocations(state.spatial, baseMap).length,
      startedAt: Date.now(),
      detail: 'Rebuilding ' + rangeLabel + '. Canonical state will be replaced only after full success.',
    });

    diagnosticStore.record(chatKey, {
      operationId,
      label: 'rebuild',
      sourceMessageId,
      outcome: 'rebuild-started',
      totalBoundaries,
      detail: 'Explicit chronological rebuild started from ' + rangeLabel + '; canonical state will change only after full success.',
    });
    refreshPanel();
    notify('info', 'World State Alpha rebuild started (' + totalBoundaries + ' assistant boundaries, ' + rangeLabel + ').');

    let result;
    try {
      result = await runManualRebuild({
        ctx: getContext(),
        state,
        chat,
        chatKey,
        route: routeSettings(),
        operationId,
        isCurrent,
        diagnostics: diagnosticStore,
        maxBoundaries,
        startMessageId,
        spatialEnabled: Boolean(settings.spatialEnabled),
        baseMap,
        spatialProfile: state.spatial?.profile,
        onProgress: progress => {
          const previous = rebuildStatuses.get(chatKey) || {};
          rebuildStatuses.set(chatKey, {
            ...previous,
            phase: 'running',
            ...progress,
            applied: Number(previous.applied || 0) + Number(progress.boundaryApplied || 0),
            rejected: Number(previous.rejected || 0) + Number(progress.boundaryRejected || 0),
            detail: 'Processed message ' + progress.messageId + ' (' + progress.processedBoundaries + '/' + progress.totalBoundaries + ' boundaries).',
          });
          refreshPanel();
        },
      });
    } catch (error) {
      const detail = String(error?.message || error || 'unexpected rebuild failure').slice(0, 320);
      rebuildStatuses.set(chatKey, {
        ...(rebuildStatuses.get(chatKey) || {}),
        phase: 'failed',
        detail,
        completedAt: Date.now(),
      });
      diagnosticStore.record(chatKey, {
        operationId,
        label: 'rebuild',
        sourceMessageId,
        outcome: 'rebuild-failed',
        code: error?.code || 'WORLD_STATE_REBUILD_EXCEPTION',
        detail,
        totalBoundaries,
      });
      refreshPanel();
      notify('error', 'World State Alpha rebuild failed: ' + detail + ' Canonical state was left unchanged.');
      return;
    }

    const receipts = Array.isArray(result.receipts) ? result.receipts : [];
    const applied = receipts.reduce((sum, item) => sum + (Number(item?.applied) || 0), 0);
    const rejected = receipts.reduce((sum, item) => sum + (Number(item?.rejected) || 0), 0);
    const aliasRepairs = receipts.reduce((sum, item) => sum + (Number(item?.aliasRepairs) || 0), 0);
    const failedReceipt = receipts.slice().reverse().find(item => item?.messageId === result.failedBoundary) || receipts.at(-1) || null;
    const firstRejection = failedReceipt?.rejections?.[0];
    const failureDetail = String(
      result.errorMessage
      || firstRejection?.reason
      || result.errorCode
      || result.outcome
      || 'rebuild did not complete',
    ).slice(0, 320);

    if (result.outcome !== 'completed' || !isCurrent()) {
      rebuildStatuses.set(chatKey, {
        ...(rebuildStatuses.get(chatKey) || {}),
        phase: result.outcome === 'stale' ? 'cancelled' : 'failed',
        detail: failureDetail,
        processedBoundaries: result.processedBoundaries || 0,
        totalBoundaries: result.plan?.assistantBoundaries ?? totalBoundaries,
        providerCalls: result.providerCalls || 0,
        applied,
        rejected,
        completedAt: Date.now(),
      });
      diagnosticStore.record(chatKey, {
        operationId,
        label: 'rebuild',
        sourceMessageId: Number.isInteger(result.failedBoundary) ? result.failedBoundary : sourceMessageId,
        outcome: 'rebuild-failed',
        code: result.errorCode || (isCurrent() ? 'WORLD_STATE_REBUILD_INCOMPLETE' : 'WORLD_STATE_REBUILD_STALE'),
        detail: failureDetail,
        providerCalls: result.providerCalls || 0,
        applied,
        rejected,
        aliasRepairs,
        processedBoundaries: result.processedBoundaries || 0,
        totalBoundaries: result.plan?.assistantBoundaries ?? totalBoundaries,
      });
      refreshPanel();
      const atBoundary = Number.isInteger(result.failedBoundary) ? ' at message ' + result.failedBoundary : '';
      notify('error', 'World State Alpha rebuild failed' + atBoundary + ': ' + failureDetail + '. Canonical state was left unchanged.');
      return;
    }

    try {
      await persistState(chatKey, result.state);
    } catch (error) {
      const detail = String(error?.message || error || 'persistence failure').slice(0, 320);
      rebuildStatuses.set(chatKey, {
        ...(rebuildStatuses.get(chatKey) || {}),
        phase: 'failed',
        detail,
        processedBoundaries: result.processedBoundaries || 0,
        totalBoundaries: result.plan?.assistantBoundaries ?? totalBoundaries,
        providerCalls: result.providerCalls || 0,
        applied,
        rejected,
        completedAt: Date.now(),
      });
      diagnosticStore.record(chatKey, {
        operationId,
        label: 'rebuild',
        sourceMessageId,
        outcome: 'rebuild-persist-failed',
        code: error?.code || 'WORLD_STATE_REBUILD_PERSIST_FAILURE',
        detail,
        providerCalls: result.providerCalls || 0,
        applied,
        rejected,
        aliasRepairs,
        processedBoundaries: result.processedBoundaries || 0,
        totalBoundaries: result.plan?.assistantBoundaries ?? totalBoundaries,
      });
      refreshPanel();
      notify('error', 'World State Alpha rebuild finished extraction but could not persist it: ' + detail + '. Canonical state was left unchanged.');
      return;
    }

    setCachedState(chatKey, result.state);
    const currentCount = (result.state.records || []).filter(record => record?.status === 'active').length;
    const placeCount = resolveEffectiveLocations(result.state.spatial, baseMap).length;
    rebuildStatuses.set(chatKey, {
      ...(rebuildStatuses.get(chatKey) || {}),
      phase: 'completed',
      detail: 'Rebuild completed and persisted.',
      processedBoundaries: result.processedBoundaries || 0,
      totalBoundaries: result.plan?.assistantBoundaries ?? totalBoundaries,
      providerCalls: result.providerCalls || 0,
      applied,
      rejected,
      currentRecords: currentCount,
      places: placeCount,
      completedAt: Date.now(),
    });
    diagnosticStore.record(chatKey, {
      operationId,
      label: 'rebuild',
      sourceMessageId,
      outcome: 'rebuild-completed',
      code: aliasRepairs ? 'WORLD_STATE_REBUILD_ALIAS_REPAIRED' : '',
      detail: 'Rebuild completed and persisted: ' + currentCount + ' current records, ' + placeCount + ' places.',
      providerCalls: result.providerCalls || 0,
      applied,
      rejected,
      aliasRepairs,
      processedBoundaries: result.processedBoundaries || 0,
      totalBoundaries: result.plan?.assistantBoundaries ?? totalBoundaries,
    });
    updatePrivateInjection();
    refreshPanel();
    notify(
      'success',
      'World State Alpha rebuild completed: '
        + (result.processedBoundaries || 0) + '/' + (result.plan?.assistantBoundaries ?? totalBoundaries)
        + ' boundaries, ' + currentCount + ' current records, ' + placeCount + ' places.'
        + (aliasRepairs ? ' Repaired ' + aliasRepairs + ' provider field alias' + (aliasRepairs === 1 ? '.' : 'es.') : ''),
    );
  }
}

async function applySpatialAction(actionId, payload = {}, expectedChatKey = currentChatKey()) {
  const chatKey = String(expectedChatKey || '');
  if (!chatKey || chatKey === 'no-chat' || currentChatKey() !== chatKey) return;
  return queueChatWork(chatKey, () => applySpatialActionNow(actionId, payload, chatKey));
}

async function applySpatialActionNow(actionId, payload, chatKey) {
  await ensureChatStateLoaded(chatKey);
  if (hydrationErrors.has(chatKey) || currentChatKey() !== chatKey) return;
  const state = stateCache.get(chatKey);
  const baseMap = await getChatBaseMap(chatKey, state);
  if (currentChatKey() !== chatKey || hydrationErrors.has(chatKey)) return;
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
    cacheBaseMap(baseMapCacheKey(stored.pointer), stored.baseMap);

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
    if (currentChatKey() === chatKey) {
      notify('error', 'World State Alpha cannot open this chat until its durable state can be loaded safely.');
    }
    return false;
  }
  if (currentChatKey() !== chatKey) return false;

  if (panelController && panelRoot?.isConnected && panelChatKey === chatKey) {
    panelController.refresh();
    return true;
  }

  closeWorldStatePanel();
  panelChatKey = chatKey;
  panelRoot = document.createElement('div');
  panelRoot.id = WORLD_STATE_PANEL_ROOT_ID;
  document.body.appendChild(panelRoot);
  panelController = createWorldStateUiController({
    root: panelRoot,
    getState: () => getCachedState(chatKey) || createState(chatKey),
    getBaseMap: () => getCachedBaseMap(stateCache.get(chatKey)?.spatial?.baseMapRef),
    getDiagnostics: () => diagnosticStore.records(chatKey),
    getRuntimeInfo: () => {
      const chat = getContext().chat || [];
      return {
        chatMessages: chat.length,
        assistantBoundaries: chat.filter(message => messageRole(message) === 'assistant' && messageText(message).trim()).length,
        defaultRebuildBoundaries: REBUILD_LIMITS.maxBoundaries,
        maxRebuildBoundaries: 4096,
        spatialEnabled: Boolean(getWorldStateSettings().spatialEnabled),
        rebuildStatus: rebuildStatuses.get(chatKey) ? clone(rebuildStatuses.get(chatKey)) : null,
      };
    },
    onMaintenanceAction: (actionId, payload) => applyMaintenanceAction(actionId, payload, chatKey),
    onSpatialAction: (actionId, payload) => applySpatialAction(actionId, payload, chatKey),
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

  if (events.MESSAGE_RECEIVED) {
    source.on(events.MESSAGE_RECEIVED, messageId => {
      // Capture is serialized in Alpha's per-chat queue, but it must not hold
      // SillyTavern's awaited MESSAGE_RECEIVED render/save pipeline open.
      void handleAssistantMessage(messageId).catch(error => {
        console.error('[World State Alpha] background capture failed safely', error);
      });
    });
  }
  if (events.MESSAGE_SENT) source.on(events.MESSAGE_SENT, messageId => handleUserMessage(messageId));
  if (events.CHAT_LOADED) source.on(events.CHAT_LOADED, () => activateCurrentChat());
  if (events.CHAT_CHANGED) source.on(events.CHAT_CHANGED, () => activateCurrentChat());
  if (events.CHARACTER_RENAMED) source.on(events.CHARACTER_RENAMED, (oldAvatar, newAvatar) => handleCharacterRenamed(oldAvatar, newAvatar));
  if (events.CHARACTER_RENAMED_IN_PAST_CHAT) {
    source.on(events.CHARACTER_RENAMED_IN_PAST_CHAT, (messages, oldAvatar, newAvatar) =>
      handleCharacterRenamedInPastChat(messages, oldAvatar, newAvatar));
  }
  if (events.CHARACTER_DELETED) source.on(events.CHARACTER_DELETED, eventData => handleCharacterDeleted(eventData));
  if (events.CHAT_RENAMED) source.on(events.CHAT_RENAMED, eventData => handleChatRenamed(eventData));
  if (events.CHAT_DELETED) source.on(events.CHAT_DELETED, eventData => handleChatDeleted(eventData));
  if (events.GROUP_CHAT_DELETED) source.on(events.GROUP_CHAT_DELETED, eventData => handleChatDeleted(eventData, 'group'));

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

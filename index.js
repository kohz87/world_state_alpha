/* World State Alpha - minimal SillyTavern host integration. */
import { extension_settings, getContext } from '../../../extensions.js';
import {
  extension_prompt_types,
  extension_prompt_roles,
  getRequestHeaders,
  saveSettings,
} from '../../../../script.js';

import { chatLineage, commitMutationBoundary, contentLineageKey, contentLineageKeys, earliestPartialRebuildStart, extendChatLineage, fingerprintMessage, parkAbandonedBranch, rebaseLineageMetadata, reconcileBranch, relinkParkedBranches, resumeParkedBranch, seedRootCheckpoint } from './branch.js';
import { assistantBoundaryExchange, boundedExchangeText, CAPTURE_LIMITS, hiddenConversationRole, isNarratorMessage, normalizeCaptureExchange, runCaptureOperation } from './capture.js';
import { affectsCaptureRecovery, createDiagnosticStore, mergeOperationRows, unrecoveredCaptureFailures } from './diagnostics.js';
import { resolveContinuityElapsedHint } from './elapsed.js';
import { prepareWorldStateContinuity } from './evolution.js';
import { hashText, stableStringify } from './hash.js';
import { buildWorldStateChatKey, getWorldStateChatIdentity, getWorldStateChatKey, parseWorldStateChatKey } from './host-identity.js';
import { createSillyTavernWorldStateStorageAdapter, withWorldStateFileLock } from './host-storage.js';
import { storeBaseMapSource, loadBaseMapSource } from './host-base-map.js';
import {
  WORLD_STATE_PROMPT_KEY,
  buildWorldStateInjection,
  continuityInjectionBlocked,
} from './injection.js';
import {
  MANUAL_LIMITS,
  applyManualLifecycleBatch,
  applyManualMutation,
  applyWorldStateImport,
  applyWorldStateReset,
  prepareWorldStateExport,
  previewWorldStateImport,
  previewWorldStateReset,
} from './manual.js';
import { cancelWorldStateRequests, worldStateProfileOptions, worldStateRouteFingerprint } from './provider-routing.js';
import { planChronologicalRebuild, REBUILD_LIMITS, rebuildSnapshotToken, runManualRebuild } from './rebuild.js';
import { buildRelevanceIndex, selectLifecycleCandidates, selectRelevantRecords, selectRelevantTombstones, updateRelevanceIndex } from './relevance.js';
import { buildSpatialRelevanceIndex, selectRelevantLocations, updateSpatialRelevanceIndex } from './spatial-relevance.js';
import { buildSpatialInjection } from './spatial-injection.js';
import { applySpatialManualMutation } from './spatial-manual.js';
import { normalizeSpatialProfile, placeNameKey, resolveEffectiveLocations, resolveSpatialProfile } from './spatial-core.js';
import { clone, createState, HISTORY_FIELDS, normalizeState } from './state-core.js';
import { makeSidecarPath, readSidecar, writeSidecar } from './storage.js';
import { createWorldStateUiController } from './ui.js';
import { mountWorldStateLauncher } from './launcher.js';

export const WORLD_STATE_ALPHA_VERSION = '0.9.0-alpha.55';
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
  showLauncher: true,
});

const stateCache = new Map();
const relevanceIndices = new Map();
// Chats whose saved sidecar could not be read: chat key -> that file's path, replaceable by a recovery write.
const corruptSidecars = new Map();
// Counts canonical state replacements per chat (not lineage-only extensions): what a running rebuild compares.
const canonicalGenerations = new Map();
const spatialRelevanceIndices = new Map();
const baseMapCache = new Map();
const loadedChats = new Set();
const hydrationErrors = new Map();
const loadingChats = new Map();
const hydrationSources = new Map();
const hydratedPointers = new Map();
const observedServerPointers = new Map();
const provisionalFreshChats = new Set();
const bootstrapRequiredChats = new Set();
const bootstrapWarnings = new Set();
const stateEpochs = new Map();
const ownershipEpochs = new Map();
const chatQueues = new Map();
const activationQueues = new Map();
// Host chat events per chat (edits, swipes, deletes, sends), so a cached proof knows the chat may have changed.
const chatEventCounts = new Map();
const branchDirtyChats = new Set();
const passiveCaptureRebaseCandidates = new Map();
// In-memory only: abandoned branches (swipes, deletes, regenerations) that can
// be resumed exactly if the same messages come back, and pending captures for
// an existing swipe or edited reply that no generation will announce.
const parkedBranches = new Map();
const branchCaptureTimers = new Map();
// Tail lineage key of the last branch this session proved against its own
// loaded chat. A stored state ending at that tail, with the chat now shorter,
// was truncated here (delete/regenerate), not written ahead by another device.
const locallyProvenTails = new Map();
const chatCacheTouches = new Map();
const baseMapCacheTouches = new Map();
const pendingCharacterRenames = new Map();
const deleteRetryTimers = new Map();
const OPERATION_LOG_LIMIT = 80;
const diagnosticStore = createDiagnosticStore({
  limit: OPERATION_LOG_LIMIT,
  onRecord: (chatKey, row) => scheduleOperationLogSave(chatKey, {
    now: affectsCaptureRecovery(row, { failuresListed: capturesFailedBefore(chatKey) }),
  }),
});
const rebuildStatuses = new Map();
// In-memory only: where a failed rebuild can be resumed by the operator.
const rebuildResumes = new Map();
const rebuildAbortControllers = new Map();

const CHAT_CACHE_LIMIT = 6;
const PARKED_BRANCH_LIMIT = 8;
const BRANCH_CAPTURE_DELAY_MS = 900;
const BASE_MAP_CACHE_LIMIT = 8;
const CHARACTER_RENAME_CONTEXT_LIMIT = 8;
const DELETE_OWNERSHIP_RETRY_MS = 1000;
const STARTUP_SIDECAR_RETRY_DELAYS_MS = Object.freeze([120, 240]);
const BOOTSTRAP_NOTICE_DELAY_MS = 5000;
const SERVER_FRESHNESS_RESUME_DEBOUNCE_MS = 150;
let cacheTouchSequence = 0;

let activeChatKey = 'no-chat';
let initialized = false;
let hostHydrationReady = false;
let extensionSettingsReady = false;
let hostReadinessFallbackTimer = null;
let hostReadinessFallbackAttempts = 0;
let loadedLogWritten = false;
let eventsRegistered = false;
let eventRegistrationRetryTimer = null;
let eventRegistrationRetryAttempts = 0;
let settingsMountTimer = null;
let serverFreshnessResumeTimer = null;
let panelController = null;
let panelRoot = null;
let floatingLauncher = null;
let panelChatKey = 'no-chat';

const hostStorage = createSillyTavernWorldStateStorageAdapter({
  fetchFn: (...args) => globalThis.fetch(...args),
  headersFn: () => getRequestHeaders(),
});

// Operations log persistence. The log is non-canonical telemetry, so it lives
// in its own small per-chat server file (never the World State sidecar) and is
// written read-merge-write after a short quiet period, so reloads and other
// devices keep it without two browsers overwriting each other's entries.
const OPERATION_LOG_FORMAT = 'world_state_alpha_operations';
const OPERATION_LOG_VERSION = 1;
const OPERATION_LOG_SAVE_DELAY_MS = 1500;
const OPERATION_LOG_SAVE_RETRIES = 3;
const OPERATION_LOG_TEXT_CHARS = 6000;
const operationLogLoads = new Map();
// Chats whose saved log has merged into this session (a missing log counts).
const operationLogsHydrated = new Set();
const operationLogTimers = new Map();
// Rows a save gave up on (the saved log stayed unreadable) after their chat
// left the cache; merged back the next time that chat's log loads or saves.
const unsavedOperationRows = new Map();
let captureAttemptSeq = 0;
// Identities whose log was emptied by chat deletion; late rows for them are
// never written back. Reopening that identity starts a new log.
const retiredOperationLogs = new Set();

function operationLogFile(chatKey) {
  return 'world-state-alpha-ops-' + hashText(String(chatKey)) + '.json';
}

async function readOperationLog(chatKey) {
  const raw = await hostStorage.fetchJsonFile(hostStorage.deterministicPath(operationLogFile(chatKey)));
  if (!raw || raw.format !== OPERATION_LOG_FORMAT || raw.version !== OPERATION_LOG_VERSION
    || raw.chatKey !== chatKey || !Array.isArray(raw.operations)) return [];
  return raw.operations;
}

// A missing or corrupt log merges as empty. Any other read failure (offline,
// HTTP 5xx, 403) throws, so a save never replaces rows other sessions wrote
// with this session's rows alone.
async function readOperationLogForMerge(chatKey) {
  try {
    return await readOperationLog(chatKey);
  } catch (error) {
    if (error?.code === 'WORLD_STATE_JSON_INVALID') return [];
    throw error;
  }
}

function restoreUnsavedOperationRows(chatKey) {
  const parked = unsavedOperationRows.get(chatKey);
  if (!parked) return;
  unsavedOperationRows.delete(chatKey);
  diagnosticStore.merge(chatKey, parked);
  scheduleOperationLogSave(chatKey);
}

function hydrateOperationLog(chatKey) {
  if (!chatKey || chatKey === 'no-chat') return Promise.resolve();
  if (!operationLogLoads.has(chatKey)) {
    const load = readOperationLog(chatKey)
      .then(rows => {
        operationLogsHydrated.add(chatKey);
        if (rows.length) diagnosticStore.merge(chatKey, rows);
        restoreUnsavedOperationRows(chatKey);
        if (panelChatKey === chatKey) refreshPanel();
      })
      .catch(error => {
        // Retried on the next hydration or save, so other sessions' rows still load;
        // a newer load started meanwhile is kept.
        if (operationLogLoads.get(chatKey) === load) operationLogLoads.delete(chatKey);
        restoreUnsavedOperationRows(chatKey);
        console.warn('[World State Alpha] saved Operations log could not be loaded; new operations are still recorded.', error);
      });
    operationLogLoads.set(chatKey, load);
  }
  return operationLogLoads.get(chatKey);
}

// Another device or tab may have recovered (or added) missed captures since this
// session loaded the saved log; opening the panel merges it again (rate-limited).
const OPERATION_LOG_REFRESH_MS = 3000;
const operationLogRefreshedAt = new Map();

async function refreshOperationLogFromServer(chatKey) {
  if (!chatKey || chatKey === 'no-chat' || retiredOperationLogs.has(chatKey)) return;
  const now = Date.now();
  if (now - (operationLogRefreshedAt.get(chatKey) || 0) < OPERATION_LOG_REFRESH_MS) return;
  operationLogRefreshedAt.set(chatKey, now);
  try {
    const rows = await readOperationLog(chatKey);
    if (!rows.length || currentChatKey() !== chatKey) return;
    diagnosticStore.merge(chatKey, rows);
    if (panelChatKey === chatKey) refreshPanel();
  } catch (error) {
    console.warn('[World State Alpha] saved Operations log could not be refreshed; the panel shows this session\'s rows.', error);
  }
}

// Same cross-tab (Web Locks) + in-process writer lock the sidecar uses.
function queueOperationLogWrite(chatKey, task) {
  return withWorldStateFileLock(operationLogFile(chatKey), task);
}

function operationLogBody(chatKey, operations) {
  return {
    format: OPERATION_LOG_FORMAT,
    version: OPERATION_LOG_VERSION,
    chatKey,
    updatedAt: new Date().toISOString(),
    operations: operations.map(row => ({
      ...row,
      responseJson: String(row.responseJson || '').slice(0, OPERATION_LOG_TEXT_CHARS),
      rejectionsJson: String(row.rejectionsJson || '').slice(0, OPERATION_LOG_TEXT_CHARS),
    })),
  };
}

// A save that could not complete (the saved log was unreadable, or the upload
// failed) is retried, never written over other sessions' rows. A cached chat's
// retry is an ordinary pending timer, so leaving the chat or hiding the page
// flushes it; rows that still cannot be saved are parked until that chat's log
// next loads or saves.
function postponeOperationLogSave(chatKey, snapshot, attempt) {
  const delay = OPERATION_LOG_SAVE_DELAY_MS * (attempt + 2);
  if (attempt >= OPERATION_LOG_SAVE_RETRIES) {
    const rows = snapshot || diagnosticStore.allRecords(chatKey);
    unsavedOperationRows.set(chatKey, mergeOperationRows(unsavedOperationRows.get(chatKey) || [], rows, OPERATION_LOG_LIMIT));
    return;
  }
  if (snapshot) {
    setTimeout(() => void saveOperationLog(chatKey, snapshot, attempt + 1), delay);
    return;
  }
  if (operationLogTimers.has(chatKey)) return;
  operationLogTimers.set(chatKey, setTimeout(() => {
    operationLogTimers.delete(chatKey);
    void saveOperationLog(chatKey, null, attempt + 1);
  }, delay));
}

// `snapshot` saves rows of a chat leaving the cache without re-hydrating it.
// Resolves true once the rows are on the server.
function saveOperationLog(chatKey, snapshot = null, attempt = 0) {
  return queueOperationLogWrite(chatKey, async () => {
    try {
      return await saveOperationLogLocked(chatKey, snapshot, attempt);
    } catch (error) {
      console.warn('[World State Alpha] Operations log save failed unexpectedly; retrying.', error);
      postponeOperationLogSave(chatKey, snapshot, attempt);
      return false;
    }
  });
}

async function saveOperationLogLocked(chatKey, snapshot, attempt) {
  if (retiredOperationLogs.has(chatKey)) return false;
  let server;
  try {
    server = await readOperationLogForMerge(chatKey);
  } catch (error) {
    console.warn('[World State Alpha] saved Operations log could not be read; saving it later so rows from other sessions are kept.', error);
    postponeOperationLogSave(chatKey, snapshot, attempt);
    return false;
  }
  if (!snapshot && !operationLogLoads.has(chatKey)) {
    diagnosticStore.merge(chatKey, server);
    operationLogLoads.set(chatKey, Promise.resolve());
    operationLogsHydrated.add(chatKey);
  }
  const parked = unsavedOperationRows.get(chatKey);
  if (!snapshot && parked) diagnosticStore.merge(chatKey, parked);
  const rows = mergeOperationRows(server, snapshot || diagnosticStore.allRecords(chatKey), OPERATION_LOG_LIMIT);
  try {
    await hostStorage.uploadJsonFile(operationLogFile(chatKey), operationLogBody(chatKey, rows));
  } catch (error) {
    console.warn('[World State Alpha] Operations log could not be saved; retrying, and the rows stay in this session meanwhile.', error);
    postponeOperationLogSave(chatKey, snapshot, attempt);
    return false;
  }
  if (!snapshot) unsavedOperationRows.delete(chatKey);
  return true;
}

function scheduleOperationLogSave(chatKey, { now = false } = {}) {
  if (!hostHydrationReady || !chatKey || chatKey === 'no-chat' || retiredOperationLogs.has(chatKey)) return;
  clearTimeout(operationLogTimers.get(chatKey));
  if (now) {
    operationLogTimers.delete(chatKey);
    void saveOperationLog(chatKey);
    return;
  }
  operationLogTimers.set(chatKey, setTimeout(() => {
    operationLogTimers.delete(chatKey);
    void saveOperationLog(chatKey);
  }, OPERATION_LOG_SAVE_DELAY_MS));
}

// A chat leaving the cache keeps its pending rows: save that snapshot now.
function flushOperationLog(chatKey) {
  if (!operationLogTimers.has(chatKey)) return;
  clearTimeout(operationLogTimers.get(chatKey));
  operationLogTimers.delete(chatKey);
  void saveOperationLog(chatKey, diagnosticStore.allRecords(chatKey));
}

// Best-effort save of every pending Operations log before the page is hidden or unloaded.
function flushAllOperationLogs() {
  for (const chatKey of [...operationLogTimers.keys()]) flushOperationLog(chatKey);
}

// Rename carries the log to the new owner; delete leaves an empty log so a
// later chat reusing the same identity never shows the retired history.
// Where a renamed chat's log now lives: renames can chain (A to B to C) before
// an earlier retirement has finished.
const operationLogSuccessors = new Map();

function liveOperationLogKey(chatKey) {
  let key = chatKey;
  const seen = new Set();
  while (retiredOperationLogs.has(key) && operationLogSuccessors.has(key) && !seen.has(key)) {
    seen.add(key);
    key = operationLogSuccessors.get(key);
  }
  return key;
}

function retireOperationLog(chatKey, successorKey = '', attempt = 0) {
  clearTimeout(operationLogTimers.get(chatKey));
  operationLogTimers.delete(chatKey);
  retiredOperationLogs.add(chatKey);
  if (successorKey) {
    operationLogSuccessors.set(chatKey, successorKey);
    // A rename target is live again (renaming back reuses a retired identity).
    retiredOperationLogs.delete(successorKey);
  }
  // Rows parked after a failed save follow a rename and are dropped with a deleted chat.
  const parked = attempt === 0 ? unsavedOperationRows.get(chatKey) || [] : [];
  unsavedOperationRows.delete(chatKey);
  const retry = () => {
    if (attempt >= OPERATION_LOG_SAVE_RETRIES) return;
    setTimeout(() => {
      if (retiredOperationLogs.has(chatKey)) void retireOperationLog(chatKey, successorKey, attempt + 1);
    }, OPERATION_LOG_SAVE_DELAY_MS * (attempt + 2));
  };
  // Never hold the old log's lock while saving the new one: two renames in opposite directions would
  // otherwise wait on each other forever.
  return (async () => {
    try {
      if (successorKey) {
        const server = await queueOperationLogWrite(chatKey, () => readOperationLogForMerge(chatKey).catch(error => {
          console.warn('[World State Alpha] renamed chat\'s Operations log could not be read; retrying before it is cleared.', error);
          return null;
        }));
        const rows = mergeOperationRows(mergeOperationRows(server || [], parked, OPERATION_LOG_LIMIT), diagnosticStore.allRecords(chatKey), OPERATION_LOG_LIMIT);
        // The old log is cleared only once the live owner's log durably holds its rows; otherwise both
        // are kept (a failed save retries on its own) and the retirement is retried.
        const target = liveOperationLogKey(successorKey);
        if (rows.length && !retiredOperationLogs.has(target)) {
          diagnosticStore.merge(target, rows);
          if (!await saveOperationLog(target)) {
            retry();
            return;
          }
        }
        if (server === null) {
          retry();
          return;
        }
      }
      await queueOperationLogWrite(chatKey, () => hostStorage.uploadJsonFile(operationLogFile(chatKey), operationLogBody(chatKey, [])));
    } catch (error) {
      console.warn('[World State Alpha] retired Operations log could not be cleared.', error);
    }
  })();
}

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
  settings.showLauncher = settings.showLauncher !== false;
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
  rebuildAbortControllers.get(key)?.abort();
  rebuildAbortControllers.delete(key);
  cancelWorldStateRequests({ chatKey: key });
  stateCache.delete(key);
  relevanceIndices.delete(key);
  spatialRelevanceIndices.delete(key);
  loadedChats.delete(key);
  hydrationErrors.delete(key);
  hydratedPointers.delete(key);
  observedServerPointers.delete(key);
  branchDirtyChats.delete(key);
  passiveCaptureRebaseCandidates.delete(key);
  forgetBranchContinuations(key);
  chatCacheTouches.delete(key);
  flushOperationLog(key);
  diagnosticStore.clear(key);
  operationLogLoads.delete(key);
  operationLogsHydrated.delete(key);
  rebuildStatuses.delete(key);
  return true;
}

function clearBranchCaptureTimer(chatKey) {
  const timer = branchCaptureTimers.get(chatKey);
  if (timer !== undefined) clearTimeout(timer);
  branchCaptureTimers.delete(chatKey);
}

function forgetBranchContinuations(chatKey) {
  rebuildResumes.delete(chatKey);
  parkedBranches.delete(chatKey);
  clearBranchCaptureTimer(chatKey);
  locallyProvenTails.delete(chatKey);
}

function lineageTailKey(lineage) {
  return Array.isArray(lineage) && lineage.length ? String(lineage[lineage.length - 1]?.lineageKey || '') : 'root';
}

function rememberParkedBranch(chatKey, park) {
  if (!park) return;
  // Only the chat being played parks branches; drop any other chat's.
  for (const key of [...parkedBranches.keys()]) {
    if (key !== chatKey) parkedBranches.delete(key);
  }
  const parks = (parkedBranches.get(chatKey) || []).filter(item =>
    item.baseMessageId !== park.baseMessageId || item.firstLineageKey !== park.firstLineageKey);
  parks.push(park);
  parkedBranches.set(chatKey, parks.slice(-PARKED_BRANCH_LIMIT));
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
      const resolvedCacheKey = baseMapCacheKey(pointer) || cacheKey;
      cacheBaseMap(resolvedCacheKey, baseMap);
      if (cacheKey && cacheKey !== resolvedCacheKey) cacheBaseMap(cacheKey, baseMap);
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

// After a rejected or abandoned write, every derived index must describe the
// state that is cached now: the prior state after local compensation, or the
// newer server state a revision conflict just hydrated, never the discarded base.
function resetIndexesFromCache(chatKey) {
  const current = stateCache.get(chatKey) || null;
  resetRelevanceIndex(chatKey, current);
  resetSpatialRelevanceIndex(chatKey, current?.spatial || null, getCachedBaseMap(current?.spatial?.baseMapRef));
}

// Hide-insensitive keys by current lineage key (a pure function of it), so a
// re-rendered panel does not re-hash the chat. Bounded; cleared when full.
const contentLineageKeyMemo = new Map();
const CONTENT_LINEAGE_MEMO_LIMIT = 256;

// Keys for the given messages of the current chat, verified against the
// stored lineage in one pass; only messages not already memoized are hashed.
function currentContentLineageKeys(chat, lineage, messageIds) {
  const missing = messageIds.filter(id => lineage[id]?.lineageKey && !contentLineageKeyMemo.has(lineage[id].lineageKey));
  if (missing.length) {
    const computed = contentLineageKeys(chat, missing, lineage);
    if (contentLineageKeyMemo.size + missing.length > CONTENT_LINEAGE_MEMO_LIMIT) contentLineageKeyMemo.clear();
    for (const id of missing) contentLineageKeyMemo.set(lineage[id].lineageKey, computed.get(id) || '');
  }
  return new Map(messageIds.map(id => [id, lineage[id]?.lineageKey ? contentLineageKeyMemo.get(lineage[id].lineageKey) || '' : '']));
}

// Live captures that failed and were never recovered, limited to messages that
// are still assistant replies (hidden or not) on the current chat.
// Operations-log derived only. A failure recorded on another swipe or an
// abandoned branch is not listed: its lineage key must match the message's key
// on the current branch, or, after hiding/unhiding a message, its
// hide-insensitive key must.
function pendingCaptureFailures(chatKey) {
  const chat = getContext().chat || [];
  const lineage = stateCache.get(chatKey)?.lineage || [];
  const listed = unrecoveredCaptureFailures(diagnosticStore.recoveryRows(chatKey))
    .filter(({ messageId }) => messageId < chat.length
      && (messageRole(chat[messageId]) === 'assistant' || hiddenConversationRole(chat[messageId]) === 'assistant')
      && messageText(chat[messageId]).trim());
  const direct = item => !item.lineageKey || lineage[item.messageId]?.lineageKey === item.lineageKey;
  const needKeys = [...new Set(listed.filter(item => !direct(item) && item.contentLineageKey).map(item => item.messageId))];
  const currentKeys = needKeys.length ? currentContentLineageKeys(chat, lineage, needKeys) : new Map();
  const ids = listed
    .filter(item => direct(item) || Boolean(item.contentLineageKey && currentKeys.get(item.messageId) === item.contentLineageKey))
    .map(item => item.messageId);
  return [...new Set(ids)].sort((a, b) => a - b);
}

// Whether a failure was listed before the row just recorded, so its recovery is saved at once.
function capturesFailedBefore(chatKey) {
  const rows = diagnosticStore.recoveryRows(chatKey);
  return unrecoveredCaptureFailures(rows.slice(0, -1)).length > 0;
}

// Bumped only by explicit invalidation (settings, ownership changes), never by branch events or new
// canonical state, so a manual rebuild can tell "the operator kept playing" from "start over".
const operationInvalidations = new Map();

function invalidateChatOperations(chatKey = currentChatKey()) {
  if (!chatKey || chatKey === 'no-chat') return;
  operationInvalidations.set(chatKey, (operationInvalidations.get(chatKey) || 0) + 1);
  stateEpochs.set(chatKey, epoch(chatKey) + 1);
  cancelWorldStateRequests({ chatKey });
}

function setCachedState(chatKey, state, {
  indexMode = 'rebuild',
  indexDelta = null,
  spatialIndexDelta = null,
  sourcePointer = undefined,
  // A forward lineage extension of the same canonical state (the chat grew): it is not new canonical state.
  lineageOnly = false,
} = {}) {
  if (!lineageOnly) canonicalGenerations.set(chatKey, (canonicalGenerations.get(chatKey) || 0) + 1);
  // Any new canonical state makes a failed rebuild's resume point stale.
  rebuildResumes.delete(chatKey);
  const normalized = normalizeState(state, { strictSchema: true, chatKey });
  stateCache.set(chatKey, normalized);
  const hydratedPointer = sourcePointer === undefined ? pointerFor(chatKey) : sourcePointer;
  if (hydratedPointer?.path) hydratedPointers.set(chatKey, structuredClone(hydratedPointer));
  else hydratedPointers.delete(chatKey);
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

// History entries are frozen and shared between copies, so an unchanged entry is the same object; only an
// entry that is not is stringified. Stringifying every checkpoint snapshot and undo patch of both states
// took most of a second per turn at a few hundred records.
function sameHistoryEntries(left = [], right = []) {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index] && stableStringify(left[index]) !== stableStringify(right[index])) return false;
  }
  return true;
}

function stateChanged(left, right) {
  const a = normalizeState(left);
  const b = normalizeState(right);
  const rest = state => Object.fromEntries(Object.entries(state).filter(([key]) => !HISTORY_FIELDS.includes(key)));
  if (stableStringify(rest(a)) !== stableStringify(rest(b))) return true;
  return !HISTORY_FIELDS.every(key => sameHistoryEntries(a[key], b[key]));
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

function waitForMs(delayMs) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, Number(delayMs) || 0)));
}

async function recoverExistingSidecarPointer(chatKey, preferredPointer = null, {
  retryDeterministicMiss = false,
  reportCorrupt = false,
} = {}) {
  const deterministicPath = hostStorage.deterministicPath?.(makeSidecarPath(chatKey)) || '';
  const preferredPath = preferredPointer?.path ? String(preferredPointer.path) : '';
  const candidates = [];
  if (preferredPath) candidates.push({ path: preferredPath, source: 'settings-pointer' });
  if (deterministicPath && deterministicPath !== preferredPath) {
    candidates.push({ path: deterministicPath, source: 'deterministic' });
  }
  if (deterministicPath && deterministicPath === preferredPath && candidates.length) {
    candidates[0].deterministic = true;
  }

  for (const candidate of candidates) {
    const deterministic = candidate.deterministic === true || candidate.path === deterministicPath;
    const delays = retryDeterministicMiss && deterministic
      ? [0, ...STARTUP_SIDECAR_RETRY_DELAYS_MS]
      : [0];

    for (let attempt = 0; attempt < delays.length; attempt += 1) {
      if (delays[attempt] > 0) await waitForMs(delays[attempt]);
      let payload;
      try {
        payload = await readSidecar({
          adapter: hostStorage,
          pointer: { path: candidate.path },
          expectedChatKey: chatKey,
        });
      } catch (error) {
        // Load and refresh treat a damaged file (not JSON, or a checksum that no longer matches) like a
        // missing one: the chat waits for an explicit recovery that may replace it. A readable file this
        // version cannot use (a newer World State's) and every other caller still fail closed.
        if (reportCorrupt && error?.damaged === true) return { corrupt: true, path: candidate.path, error };
        throw error;
      }
      if (payload?.state) {
        return {
          pointer: pointerFromPayload(candidate.path, payload),
          payload,
          source: candidate.source,
          attempts: attempt + 1,
        };
      }
      if (!deterministic) break;
    }
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

async function persistState(chatKey, state = stateCache.get(chatKey), {
  allowBootstrapRecovery = false,
  expectedPointer = undefined,
} = {}) {
  if (!chatKey || chatKey === 'no-chat') return null;
  if (bootstrapRequiredChats.has(chatKey) && !allowBootstrapRecovery) {
    const error = new Error('World State Alpha found established chat history without a durable sidecar. Run Full chat rebuild, import, or explicit reset before writing new continuity.');
    error.code = 'WORLD_STATE_BOOTSTRAP_RECOVERY_REQUIRED';
    throw error;
  }
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
  const baselineRecoveryWrite = allowBootstrapRecovery && bootstrapRequiredChats.has(chatKey);
  const hydratedPointer = hydratedPointerFor(chatKey);
  let pointer = expectedPointer === undefined
    ? (hydratedPointer?.path ? hydratedPointer : existingSettingsPointer)
    : expectedPointer;

  if (baselineRecoveryWrite) {
    const deterministicPath = hostStorage.deterministicPath?.(makeSidecarPath(chatKey)) || '';
    if (!deterministicPath) {
      const error = new Error('World State Alpha cannot establish a recovery baseline without a deterministic host sidecar path.');
      error.code = 'WORLD_STATE_BOOTSTRAP_PATH_UNAVAILABLE';
      throw error;
    }
    // The old settings pointer may refer to a revision that does not exist on
    // this backend. Use the physical deterministic target at revision 0 so the
    // host adapter performs a last-moment existence check before upload. A
    // concurrently appearing sidecar therefore conflicts instead of being
    // overwritten by the recovery candidate.
    pointer = { path: deterministicPath, revision: 0, checksum: '' };
  }

  // A recreated chat may intentionally replace a retired sidecar. Recover only
  // its revision/checksum as the write predecessor; never resurrect its state.
  if (!pointer && tombstone) {
    pointer = tombstone.pointer?.path ? structuredClone(tombstone.pointer) : null;
    const recovered = await recoverExistingSidecarPointer(chatKey, pointer, { retryDeterministicMiss: true });
    assertOwnershipEpoch(chatKey, ownerEpoch);
    if (recovered?.pointer) pointer = recovered.pointer;
  }

  const committed = await writeSidecar({
    adapter: hostStorage,
    chatKey,
    state,
    pointer,
    appVersion: WORLD_STATE_ALPHA_VERSION,
    // Only an explicit recovery (Full rebuild, import, reset) may replace a damaged sidecar, and only the
    // file recorded as damaged.
    replaceCorrupt: baselineRecoveryWrite ? corruptSidecars.get(chatKey) || '' : '',
  });
  assertOwnershipEpoch(chatKey, ownerEpoch);
  corruptSidecars.delete(chatKey);

  settings.dataFiles[chatKey] = committed;
  observedServerPointers.set(chatKey, structuredClone(committed));
  if (settings.sidecarTombstones?.[chatKey]) delete settings.sidecarTombstones[chatKey];
  provisionalFreshChats.delete(chatKey);
  bootstrapRequiredChats.delete(chatKey);
  bootstrapWarnings.delete(chatKey);
  hydrationSources.set(chatKey, existingSettingsPointer?.path ? 'persisted' : 'persisted-new-sidecar');

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
  const pointer = pointerFor(chatKey);
  const tombstone = tombstoneFor(chatKey);

  if (tombstone) {
    return {
      state: seedRootCheckpoint(createState(chatKey)),
      pointer: null,
      repairPointer: false,
      tombstoned: true,
      source: 'tombstone',
    };
  }

  const recovered = await recoverExistingSidecarPointer(chatKey, pointer, { retryDeterministicMiss: true, reportCorrupt: true });
  if (recovered?.corrupt) {
    return {
      state: seedRootCheckpoint(createState(chatKey)),
      pointer: pointer?.path ? structuredClone(pointer) : null,
      repairPointer: false,
      tombstoned: false,
      source: 'corrupt-sidecar',
      corruptPath: recovered.path,
      corruptReason: String(recovered.error?.message || 'unreadable sidecar'),
    };
  }
  if (!recovered) {
    return {
      state: seedRootCheckpoint(createState(chatKey)),
      pointer: pointer?.path ? structuredClone(pointer) : null,
      repairPointer: false,
      tombstoned: false,
      source: pointer?.path ? 'missing-sidecar' : 'fresh',
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
    source: recovered.source || 'sidecar',
  };
}

function clearChatRuntimeState(chatKey) {
  if (!chatKey || chatKey === 'no-chat') return;
  rebuildAbortControllers.get(chatKey)?.abort();
  rebuildAbortControllers.delete(chatKey);
  cancelWorldStateRequests({ chatKey });
  stateCache.delete(chatKey);
  relevanceIndices.delete(chatKey);
  spatialRelevanceIndices.delete(chatKey);
  loadedChats.delete(chatKey);
  hydrationErrors.delete(chatKey);
  loadingChats.delete(chatKey);
  hydrationSources.delete(chatKey);
  hydratedPointers.delete(chatKey);
  observedServerPointers.delete(chatKey);
  provisionalFreshChats.delete(chatKey);
  bootstrapRequiredChats.delete(chatKey);
  bootstrapWarnings.delete(chatKey);
  branchDirtyChats.delete(chatKey);
  corruptSidecars.delete(chatKey);
  passiveCaptureRebaseCandidates.delete(chatKey);
  forgetBranchContinuations(chatKey);
  chatCacheTouches.delete(chatKey);
  diagnosticStore.clear(chatKey);
  operationLogLoads.delete(chatKey);
  operationLogsHydrated.delete(chatKey);
  rebuildStatuses.delete(chatKey);
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

  // The destination identity now names this very chat. Whatever is stored there may be replaced only when
  // it holds nothing to protect: still exactly what a rename retired (for example renaming a chat back to
  // its earlier name), or an empty state (SillyTavern activates the renamed chat before the rename event,
  // which can already have saved an empty state for it). Any other destination data is never overwritten.
  const destinationTombstone = settings.sidecarTombstones?.[newKey] || null;
  const destinationOrphan = await recoverExistingSidecarPointer(newKey, newPointer || destinationTombstone?.pointer || null);
  assertOwnershipEpoch(oldKey, oldOwnerEpoch);
  assertOwnershipEpoch(newKey, newOwnerEpoch);
  let destinationBase = null;
  if (destinationOrphan?.payload?.state) {
    const orphanState = destinationOrphan.payload.state;
    const retiredRevision = Number(destinationTombstone?.pointer?.revision);
    const unchangedSinceRetired = Boolean(destinationTombstone) && !newPointer
      && Number.isInteger(retiredRevision) && Number(destinationOrphan.pointer?.revision) === retiredRevision;
    const spatial = orphanState.spatial || {};
    const empty = !(orphanState.records || []).length
      && !(spatial.locations || []).length && !(spatial.routes || []).length && !(spatial.relations || []).length
      && !spatial.profile && !spatial.baseMapRef?.id;
    if (!unchangedSinceRetired && !empty) {
      console.warn('[World State Alpha] identity migration refused because the destination already has World State continuity:', newKey);
      return false;
    }
    destinationBase = destinationOrphan.pointer;
  } else if (newPointer) {
    console.warn('[World State Alpha] identity migration refused because the destination ownership could not be read:', newKey);
    return false;
  }

  let sourceState = stateCache.get(oldKey) || null;
  let sourcePointer = oldPointer;
  const recoveredSource = await recoverExistingSidecarPointer(oldKey, oldPointer);
  assertOwnershipEpoch(oldKey, oldOwnerEpoch);
  if (recoveredSource?.payload?.state) {
    sourcePointer = recoveredSource.pointer;
    // The server sidecar is authoritative: another device may have saved a newer revision than this
    // session's cache, and the rename must carry that continuity rather than retire it.
    sourceState = recoveredSource.payload.state;
  }

  if (!sourceState) {
    if (oldPointer) {
      console.warn('[World State Alpha] identity migration could not load the source sidecar:', oldKey);
      return false;
    }
    return true;
  }

  const migrated = normalizeState(sourceState, { strictSchema: true, chatKey: oldKey });
  migrated.chatKey = newKey;
  const committed = await writeSidecar({
    adapter: hostStorage,
    chatKey: newKey,
    state: migrated,
    pointer: destinationBase,
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
  delete settings.sidecarTombstones[newKey];
  settings.sidecarTombstones[oldKey] = {
    reason: 'renamed',
    pointer: retiredSourcePointer ? structuredClone(retiredSourcePointer) : null,
  };
  delete settings.dataFiles[oldKey];
  await persistCriticalHostSettings('renamed World State ownership');

  const wasLoaded = loadedChats.has(oldKey);
  await retireOperationLog(oldKey, newKey);
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
  if (!hostHydrationReady) return false;
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
  if (!hostHydrationReady) return false;
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
      // The server sidecar is authoritative and its revision is the one written against: never pair
      // this session's possibly older cache with another device's newer revision token.
      currentState = recovered.payload.state;
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
  if (!hostHydrationReady) return false;
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
  if (!hostHydrationReady) return false;
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
  renameTargets.set(newKey, (renameTargets.get(newKey) || 0) + 1);
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
  } finally {
    const pending = (renameTargets.get(newKey) || 1) - 1;
    if (pending > 0) renameTargets.set(newKey, pending);
    else renameTargets.delete(newKey);
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

  await retireOperationLog(chatKey);
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
  if (!hostHydrationReady) return false;
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
  if (!hostHydrationReady) {
    const error = new Error('World State Alpha deferred hydration until SillyTavern host settings/storage are ready.');
    error.code = 'WORLD_STATE_HOST_NOT_READY';
    throw error;
  }
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

      // The empty stand-in for a sidecar that could not be read is not that revision: it records no hydrated
      // pointer, so a later read of the real sidecar is adopted rather than taken as already current.
      const standIn = loaded.source === 'missing-sidecar' || loaded.source === 'corrupt-sidecar';
      setCachedState(chatKey, loaded.state, { sourcePointer: standIn ? null : loaded.pointer });
      if (loaded.pointer?.path && !standIn) observedServerPointers.set(chatKey, structuredClone(loaded.pointer));
      else observedServerPointers.delete(chatKey);
      hydrationSources.set(chatKey, loaded.source || 'unknown');
      if (loaded.source === 'corrupt-sidecar') {
        corruptSidecars.set(chatKey, loaded.corruptPath);
        diagnosticStore.record(chatKey, {
          operationId: 'hydrate:corrupt',
          label: 'hydration',
          sourceMessageId: null,
          outcome: 'corrupt-sidecar',
          code: 'WORLD_STATE_CORRUPT_SIDECAR',
          detail: 'The saved World State file could not be read (' + loaded.corruptReason.slice(0, 160) + '). Nothing is written until a Full chat rebuild, an import or a reset replaces it.',
          providerCalls: 0,
        });
      } else {
        corruptSidecars.delete(chatKey);
      }
      if (loaded.source === 'fresh' || standIn) {
        provisionalFreshChats.add(chatKey);
        if (standIn || chatHasEstablishedHistory(chatKey)) {
          bootstrapRequiredChats.add(chatKey);
        }
      } else {
        provisionalFreshChats.delete(chatKey);
        bootstrapRequiredChats.delete(chatKey);
        bootstrapWarnings.delete(chatKey);
      }

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

      if (loaded.source === 'deterministic') {
        diagnosticStore.record(chatKey, {
          operationId: 'hydrate:deterministic',
          label: 'hydration',
          sourceMessageId: null,
          outcome: 'recovered',
          code: 'WORLD_STATE_DETERMINISTIC_SIDECAR_RECOVERED',
          detail: 'Recovered durable World State from the deterministic sidecar path without relying on the session settings pointer.',
          providerCalls: 0,
        });
      }
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

function chatHasEstablishedHistory(chatKey = currentChatKey()) {
  if (!chatKey || chatKey === 'no-chat' || currentChatKey() !== chatKey) return false;
  const chat = getContext().chat || [];
  let assistantBoundaries = 0;
  let meaningfulMessages = 0;
  for (const message of chat) {
    const role = messageRole(message);
    const content = messageText(message).trim();
    if (role === 'system' || !content) continue;
    meaningfulMessages += 1;
    if (role === 'assistant') assistantBoundaries += 1;
  }
  return (assistantBoundaries >= 1 && meaningfulMessages >= 2) || meaningfulMessages >= 4;
}

async function recheckProvisionalFreshHydration(chatKey = currentChatKey()) {
  if (!chatKey || chatKey === 'no-chat' || !provisionalFreshChats.has(chatKey)) return false;
  const ownerEpoch = ownershipEpoch(chatKey);
  const pointer = pointerFor(chatKey);
  try {
    const recovered = await recoverExistingSidecarPointer(chatKey, pointer, { retryDeterministicMiss: true });
    assertOwnershipEpoch(chatKey, ownerEpoch);

    if (!recovered) {
      provisionalFreshChats.delete(chatKey);
      if (pointer?.path) {
        hydrationSources.set(chatKey, 'missing-sidecar');
        bootstrapRequiredChats.add(chatKey);
      } else {
        hydrationSources.set(chatKey, 'fresh-confirmed');
        if (chatHasEstablishedHistory(chatKey)) bootstrapRequiredChats.add(chatKey);
        else bootstrapRequiredChats.delete(chatKey);
      }
      return false;
    }

    const settings = getWorldStateSettings();
    settings.dataFiles[chatKey] = recovered.pointer;
    await persistCriticalHostSettings('session-recovered World State sidecar pointer');
    assertOwnershipEpoch(chatKey, ownerEpoch);

    const recoveredState = normalizeState(recovered.payload.state, { strictSchema: true, chatKey });
    setCachedState(chatKey, recoveredState, { sourcePointer: recovered.pointer });
    observedServerPointers.set(chatKey, structuredClone(recovered.pointer));
    loadedChats.add(chatKey);
    hydrationErrors.delete(chatKey);
    provisionalFreshChats.delete(chatKey);
    bootstrapRequiredChats.delete(chatKey);
    bootstrapWarnings.delete(chatKey);
    hydrationSources.set(chatKey, 'settings-recheck:' + (recovered.source || 'sidecar'));
    touchChatCache(chatKey);

    diagnosticStore.record(chatKey, {
      operationId: 'hydrate:settings-recheck',
      label: 'hydration',
      sourceMessageId: null,
      outcome: 'recovered',
      code: 'WORLD_STATE_SESSION_REHYDRATED',
      detail: 'Recovered durable continuity after SillyTavern finished loading extension settings/storage.',
      providerCalls: 0,
    });
    return true;
  } catch (error) {
    if (error?.code !== 'WORLD_STATE_STALE_OWNERSHIP') hydrationErrors.set(chatKey, error);
    loadedChats.delete(chatKey);
    throw error;
  }
}


function sidecarPointerToken(pointer) {
  if (!pointer?.path) return '';
  return [
    String(pointer.path),
    Math.max(0, Math.trunc(Number(pointer.revision) || 0)),
    String(pointer.checksum || ''),
  ].join('|');
}

function sameSidecarPointer(left, right) {
  return sidecarPointerToken(left) === sidecarPointerToken(right);
}

function hydratedPointerFor(chatKey) {
  const pointer = hydratedPointers.get(String(chatKey || ''));
  return pointer?.path ? structuredClone(pointer) : null;
}

function observedServerPointerFor(chatKey) {
  const pointer = observedServerPointers.get(String(chatKey || ''));
  return pointer?.path ? structuredClone(pointer) : null;
}

function lineageIsPrefix(prefix = [], full = []) {
  const left = Array.isArray(prefix) ? prefix : [];
  const right = Array.isArray(full) ? full : [];
  if (left.length > right.length) return false;
  return left.every((entry, index) => entry?.lineageKey === right[index]?.lineageKey);
}

// The adopted state's lineage is not a prefix of this chat, nor this chat of it: it was captured on another branch.
function localChatDivergesFromState(state, localLineage) {
  const storedLineage = Array.isArray(state?.lineage) ? state.lineage : [];
  if (!storedLineage.length) return false;
  return !lineageIsPrefix(storedLineage, localLineage) && !lineageIsPrefix(localLineage, storedLineage);
}

function localChatIsBehindState(state, localLineage) {
  const storedLineage = Array.isArray(state?.lineage) ? state.lineage : [];
  return storedLineage.length > localLineage.length && lineageIsPrefix(localLineage, storedLineage);
}

// A chat with a sidecar pointer keeps the short retry schedule (a just-written sidecar may not be visible
// yet, and one miss would mark it missing). A chat with no pointer reads once on ordinary boundaries: the
// retries only delayed every send of a chat that has no sidecar. Activation and conflict recovery retry.
async function refreshChatStateFromServer(chatKey = currentChatKey(), {
  reason = 'boundary',
  retryDeterministicMiss = null,
  // After a write conflict: the revision that write found on the server, when known.
  conflictRevision = null,
} = {}) {
  if (!chatKey || chatKey === 'no-chat' || !hostHydrationReady) {
    return { outcome: 'skipped', changed: false };
  }

  await ensureChatStateLoaded(chatKey);
  if (hydrationErrors.has(chatKey)) {
    return { outcome: 'blocked', changed: false };
  }

  const ownerEpoch = ownershipEpoch(chatKey);
  const startStateEpoch = epoch(chatKey);
  const startSettingsPointer = pointerFor(chatKey);
  const startHydratedPointer = hydratedPointerFor(chatKey);
  const preferredPointer = startSettingsPointer?.path ? startSettingsPointer : startHydratedPointer;
  const startSettingsToken = sidecarPointerToken(startSettingsPointer);

  const recovered = await recoverExistingSidecarPointer(chatKey, preferredPointer, {
    retryDeterministicMiss: retryDeterministicMiss ?? Boolean(preferredPointer?.path),
    reportCorrupt: true,
  });
  assertOwnershipEpoch(chatKey, ownerEpoch);

  if (epoch(chatKey) !== startStateEpoch
    || sidecarPointerToken(pointerFor(chatKey)) !== startSettingsToken) {
    return { outcome: 'raced', changed: false };
  }

  if (recovered?.corrupt) {
    // Same as a missing sidecar: keep what is cached, write nothing until an explicit recovery replaces it.
    // The cache no longer stands for a server revision: a damaged file is replaced only by a baseline that
    // restarts at revision 1, so a later readable file is adopted rather than ignored as an older read.
    corruptSidecars.set(chatKey, recovered.path);
    observedServerPointers.delete(chatKey);
    hydratedPointers.delete(chatKey);
    bootstrapRequiredChats.add(chatKey);
    branchDirtyChats.add(chatKey);
    hydrationSources.set(chatKey, 'server-corrupt:' + reason);
    diagnosticStore.record(chatKey, {
      operationId: 'freshness:corrupt:' + reason + ':' + Date.now(),
      label: 'hydration',
      sourceMessageId: null,
      outcome: 'corrupt-sidecar',
      code: 'WORLD_STATE_CORRUPT_SIDECAR',
      detail: 'The saved World State file could not be read during a ' + reason + ' freshness check ('
        + String(recovered.error?.message || 'unreadable sidecar').slice(0, 160)
        + '). Cached state was kept; nothing is written until a Full chat rebuild, an import or a reset replaces it.',
      providerCalls: 0,
    });
    if (currentChatKey() === chatKey) {
      clearPrivatePrompt();
      notifyBootstrapRequiredOnce(chatKey);
    }
    return { outcome: 'corrupt', changed: false };
  }

  if (!recovered?.payload?.state) {
    observedServerPointers.delete(chatKey);
    if (preferredPointer?.path) {
      bootstrapRequiredChats.add(chatKey);
      branchDirtyChats.add(chatKey);
      hydrationSources.set(chatKey, 'server-missing:' + reason);
      if (currentChatKey() === chatKey) {
        clearPrivatePrompt();
        notifyBootstrapRequiredOnce(chatKey);
      }
      diagnosticStore.record(chatKey, {
        operationId: 'freshness:missing:' + reason + ':' + Date.now(),
        label: 'hydration',
        sourceMessageId: null,
        outcome: 'server-missing',
        code: 'WORLD_STATE_SERVER_SIDECAR_MISSING',
        detail: 'The previously hydrated server sidecar was not reachable during a ' + reason + ' freshness check. Cached state was preserved but cannot be used for new writes until durable authority is recovered.',
        providerCalls: 0,
      });
      return { outcome: 'missing', changed: false };
    }
    return { outcome: 'no-sidecar', changed: false };
  }

  const remotePointer = recovered.pointer;
  observedServerPointers.set(chatKey, structuredClone(remotePointer));
  // The file read back is a readable sidecar again.
  corruptSidecars.delete(chatKey);
  const hydratedPointer = hydratedPointerFor(chatKey);

  // A read older than the working copy is ignored as a stale read, except right after this session's write
  // conflicted on the revision now read (or a newer one): the remembered revision is gone, and the file was
  // started over (a baseline restarted at revision 1). A read older than what the conflict saw stays stale.
  const conflictConfirmsRead = reason === 'write-conflict'
    && Number.isInteger(conflictRevision)
    && Number(remotePointer?.revision || 0) >= conflictRevision;
  if (hydratedPointer?.path
    && !conflictConfirmsRead
    && remotePointer?.path === hydratedPointer.path
    && Number(remotePointer.revision || 0) < Number(hydratedPointer.revision || 0)) {
    diagnosticStore.record(chatKey, {
      operationId: 'freshness:older-read:' + reason + ':' + Date.now(),
      label: 'hydration',
      sourceMessageId: null,
      outcome: 'stale-read',
      code: 'WORLD_STATE_SERVER_REVISION_REGRESSION_IGNORED',
      detail: 'Ignored a server freshness read that reported an older revision than the hydrated working copy.',
      providerCalls: 0,
    });
    return { outcome: 'raced', changed: false };
  }

  const settings = getWorldStateSettings();
  const settingsPointer = pointerFor(chatKey);
  const pointerNeedsRepair = !sameSidecarPointer(settingsPointer, remotePointer);
  if (pointerNeedsRepair) {
    settings.dataFiles[chatKey] = structuredClone(remotePointer);
    persistHostSettings();
  }

  if (sameSidecarPointer(hydratedPointer, remotePointer)) {
    provisionalFreshChats.delete(chatKey);
    bootstrapRequiredChats.delete(chatKey);
    bootstrapWarnings.delete(chatKey);
    hydrationSources.set(chatKey, 'server-current:' + reason);
    touchChatCache(chatKey);
    return {
      outcome: 'current',
      changed: false,
      revision: Number(remotePointer.revision || 0),
    };
  }

  const previousRevision = Number(hydratedPointer?.revision || 0);
  const recoveredState = normalizeState(recovered.payload.state, { strictSchema: true, chatKey });
  cancelWorldStateRequests({ chatKey });
  setCachedState(chatKey, recoveredState, { sourcePointer: remotePointer });
  loadedChats.add(chatKey);
  hydrationErrors.delete(chatKey);
  provisionalFreshChats.delete(chatKey);
  bootstrapRequiredChats.delete(chatKey);
  bootstrapWarnings.delete(chatKey);
  hydrationSources.set(chatKey, 'server-refresh:' + reason);
  touchChatCache(chatKey);

  // Our own last proven branch coming back from the server is not "ahead":
  // the shorter local chat was truncated here and reconciliation rolls it back.
  // The open chat's lineage is fingerprinted once for both checks.
  const localLineage = currentChatKey() === chatKey ? chatLineage(getContext().chat || []) : null;
  const hostChatBehind = localLineage !== null && localChatIsBehindState(recoveredState, localLineage)
    && locallyProvenTails.get(chatKey) !== lineageTailKey(recoveredState.lineage);
  // State captured on a branch this chat does not have (another device swiped or edited) is not injected
  // until reconciliation has decided what belongs to this branch.
  const branchDiverged = localLineage !== null && !hostChatBehind && localChatDivergesFromState(recoveredState, localLineage);
  if (hostChatBehind || branchDiverged) {
    branchDirtyChats.add(chatKey);
    clearPrivatePrompt();
  }

  diagnosticStore.record(chatKey, {
    operationId: 'freshness:refresh:' + reason + ':' + Date.now(),
    label: 'hydration',
    sourceMessageId: null,
    outcome: hostChatBehind ? 'server-refreshed-chat-behind' : 'server-refreshed',
    code: hostChatBehind
      ? 'WORLD_STATE_HOST_CHAT_BEHIND_SIDECAR'
      : 'WORLD_STATE_SERVER_STATE_REFRESHED',
    detail: 'Refreshed the working copy from server revision '
      + previousRevision + ' to ' + Number(remotePointer.revision || 0)
      + (hostChatBehind
        ? '; the local SillyTavern chat is behind that durable state, so continuity remains fail-closed until the chat catches up.'
        : '.'),
    providerCalls: 0,
  });

  return {
    outcome: hostChatBehind ? 'chat-behind' : 'refreshed',
    changed: true,
    revision: Number(remotePointer.revision || 0),
    chatBehind: hostChatBehind,
  };
}

async function handleServerRevisionConflict(chatKey, error, {
  label = 'mutation',
  sourceMessageId = null,
} = {}) {
  if (error?.code !== 'WORLD_STATE_REVISION_CONFLICT') return false;
  let refreshOutcome = 'unknown';
  try {
    const refreshed = await refreshChatStateFromServer(chatKey, {
      reason: 'write-conflict',
      retryDeterministicMiss: true,
      conflictRevision: Number.isInteger(error?.currentRevision) ? error.currentRevision : null,
    });
    refreshOutcome = refreshed?.outcome || 'unknown';
  } catch (refreshError) {
    const blocked = new Error(
      'World State Alpha detected a newer server writer during ' + label
      + ' but could not safely hydrate that durable state: '
      + String(refreshError?.message || refreshError || 'unknown refresh failure').slice(0, 240),
    );
    blocked.code = 'WORLD_STATE_CONFLICT_REHYDRATION_FAILURE';
    hydrationErrors.set(chatKey, blocked);
    clearPrivatePrompt();
    throw blocked;
  }

  diagnosticStore.record(chatKey, {
    operationId: 'revision-conflict:' + label + ':' + Date.now(),
    label: 'persistence',
    sourceMessageId: Number.isInteger(sourceMessageId) ? sourceMessageId : null,
    outcome: 'stale-writer-rejected',
    code: 'WORLD_STATE_REVISION_CONFLICT',
    detail: 'Rejected a stale ' + label + ' write because another session advanced the server sidecar. Freshness result: ' + refreshOutcome + '.',
    providerCalls: 0,
  });
  if (currentChatKey() === chatKey) {
    updatePrivateInjection();
    refreshPanel();
  }
  return true;
}

function scheduleServerFreshnessRefresh(reason = 'resume') {
  if (!hostHydrationReady || !globalThis.setTimeout) return;
  if (serverFreshnessResumeTimer !== null) clearTimeout(serverFreshnessResumeTimer);
  serverFreshnessResumeTimer = setTimeout(() => {
    serverFreshnessResumeTimer = null;
    const chatKey = currentChatKey();
    if (!chatKey || chatKey === 'no-chat') return;
    void queueChatWork(chatKey, async () => {
      try {
        await ensureChatStateLoaded(chatKey);
        if (currentChatKey() !== chatKey) return;
        await refreshChatStateFromServer(chatKey, { reason });
        if (currentChatKey() !== chatKey) return;
        if (bootstrapRequiredChats.has(chatKey)) {
          notifyBootstrapRequiredOnce(chatKey);
          clearPrivatePrompt();
          refreshPanel();
          return;
        }
        await reconcileCurrentBranch(chatKey, { persistRestore: true });
        if (currentChatKey() !== chatKey) return;
        updatePrivateInjection();
        refreshPanel();
      } catch (error) {
        if (currentChatKey() !== chatKey) return;
        clearPrivatePrompt();
        console.error('[World State Alpha] server freshness refresh failed safely (' + reason + ')', error);
        refreshPanel();
      }
    });
  }, SERVER_FRESHNESS_RESUME_DEBOUNCE_MS);
}

// SillyTavern reloads a renamed chat (and activation finds no sidecar under the new name) before it
// announces the rename. The warning waits a moment, and a rename that has started for this chat cancels it.
// Every later boundary (send, capture, panel) still warns at once, so the delay costs nothing in play.
const renameTargets = new Map();
function scheduleBootstrapNotice(chatKey) {
  if (!globalThis.setTimeout) return notifyBootstrapRequiredOnce(chatKey);
  setTimeout(() => {
    if (currentChatKey() !== chatKey || renameTargets.has(chatKey) || !bootstrapRequiredChats.has(chatKey)) return;
    notifyBootstrapRequiredOnce(chatKey);
  }, BOOTSTRAP_NOTICE_DELAY_MS);
}

function notifyBootstrapRequiredOnce(chatKey = currentChatKey()) {
  if (!chatKey || chatKey === 'no-chat' || !bootstrapRequiredChats.has(chatKey) || bootstrapWarnings.has(chatKey)) return;
  bootstrapWarnings.add(chatKey);
  notify(
    'warning',
    'World State Alpha found existing chat history but no durable sidecar. Automatic continuity is paused to avoid starting from scratch. Run Full chat rebuild, import a World State bundle, or explicitly reset to establish a new baseline.',
  );
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

// `knownLineage === false` builds the rows without lineage keys (the injection view, which discards them):
// computing them for the user's new message re-hashed the whole chat on every send.
function boundedExchange(chat, endMessageId, limit = CAPTURE_LIMITS.exchangeMessages, knownLineage = null) {
  const rows = Array.isArray(chat) ? chat : [];
  if (!Number.isInteger(endMessageId) || endMessageId < 0 || endMessageId >= rows.length) return [];
  const lineage = knownLineage === false
    ? []
    : Array.isArray(knownLineage) && knownLineage.length > endMessageId
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

// The relevance view of an exchange: bounded like capture's exchange, never a per-message prefix.
function recentText(exchange) {
  return boundedExchangeText((Array.isArray(exchange) ? exchange : []).map(row => row?.content));
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
  // Cleanup must not re-raise: the caller handles the task's own failure.
  const cleanup = () => {
    if (chatQueues.get(chatKey) === next) chatQueues.delete(chatKey);
  };
  next.then(cleanup, cleanup);
  return next;
}

function noteChatEvent() {
  const chatKey = currentChatKey();
  chatEventCounts.set(chatKey, (chatEventCounts.get(chatKey) || 0) + 1);
}

function serializeActivation(chatKey, task) {
  const previous = activationQueues.get(chatKey) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  activationQueues.set(chatKey, next);
  const cleanup = () => {
    if (activationQueues.get(chatKey) === next) activationQueues.delete(chatKey);
  };
  next.then(cleanup, cleanup);
  return next;
}

function chatHeadGuard(chatKey) {
  const startEpoch = epoch(chatKey);
  const startLineage = stableStringify(chatLineage(getContext().chat || []));
  return () => currentChatKey() === chatKey
    && epoch(chatKey) === startEpoch
    && stableStringify(chatLineage(getContext().chat || [])) === startLineage;
}

async function persistGuardedMutation({
  chatKey,
  candidateState,
  recoveryState,
  isCurrent,
  label = 'mutation',
  sourceMessageId = null,
} = {}) {
  if (!chatKey || chatKey === 'no-chat') return { stale: true, phase: 'before' };
  const guard = typeof isCurrent === 'function' ? isCurrent : () => true;
  if (!guard()) return { stale: true, phase: 'before' };

  const basePointer = hydratedPointerFor(chatKey) || pointerFor(chatKey);
  let committed;
  try {
    committed = await persistState(chatKey, candidateState, { expectedPointer: basePointer });
  } catch (error) {
    if (await handleServerRevisionConflict(chatKey, error, { label, sourceMessageId })) {
      return { stale: true, phase: 'conflict', conflict: true };
    }
    throw error;
  }
  if (guard()) return { stale: false, committed };

  try {
    if (!recoveryState) throw new Error('No authoritative recovery state was available.');
    await persistState(chatKey, recoveryState, { expectedPointer: committed });
  } catch (restoreError) {
    const detail = String(restoreError?.message || restoreError || 'stale write compensation failed').slice(0, 320);
    const blocked = new Error('World State Alpha blocked this chat after a stale ' + label + ' write could not be compensated: ' + detail);
    blocked.code = 'WORLD_STATE_STALE_WRITE_RESTORE_FAILURE';
    hydrationErrors.set(chatKey, blocked);
    clearPrivatePrompt();
    throw blocked;
  }

  diagnosticStore.record(chatKey, {
    operationId: 'stale-write:' + label + ':' + Date.now(),
    label: 'persistence',
    sourceMessageId: Number.isInteger(sourceMessageId) ? sourceMessageId : null,
    outcome: 'stale-write-compensated',
    code: 'WORLD_STATE_STALE_WRITE_COMPENSATED',
    detail: 'A ' + label + ' sidecar write became stale while in flight and was compensated before publication.',
    providerCalls: 0,
  });
  return { stale: true, phase: 'after', committed };
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
  if (!hostHydrationReady || !settings.enabled || (!settings.inject && !settings.spatialInject) || chatKey === 'no-chat' || hydrationErrors.has(chatKey) || !loadedChats.has(chatKey) || bootstrapRequiredChats.has(chatKey)) {
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
  const exchange = end >= 0 ? boundedExchange(chat, end, 4, false) : [];
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

  // The suffix fast path normally verifies only the stored tail. While a
  // freshly captured boundary is eligible for passive rewrite protection,
  // also verify that exact older boundary in O(1) so a delayed host rewrite
  // cannot hide behind an unchanged newer tail.
  const passiveCaptureMessageId = passiveCaptureRebaseCandidates.get(chatKey);
  if (Number.isInteger(passiveCaptureMessageId)) {
    const stored = state.lineage?.[passiveCaptureMessageId];
    const current = chat[passiveCaptureMessageId];
    if (stored && current && fingerprintMessage(current) !== stored.fingerprint) return null;
  }

  const appended = extendChatLineage(state.lineage, chat);
  if (appended === null) return null;
  if (appended.length) {
    state.lineage.push(...appended);
    state.recoveryRequired = null;
    stateEpochs.set(chatKey, epoch(chatKey) + 1);
  }
  locallyProvenTails.set(chatKey, lineageTailKey(state.lineage));
  return {
    state,
    divergence: appended.length ? state.lineage.length - appended.length : -1,
    action: appended.length ? 'forward-extension' : 'same',
    exactRestored: true,
    failClosed: false,
  };
}

// A whole-state replacement (Full rebuild, import, reset) is proven against this chat right away, so a
// branch left dirty by the failure it recovers does not keep the next generation uninjected.
async function settleReplacedBranch(chatKey) {
  if (currentChatKey() !== chatKey) return;
  try {
    await reconcileCurrentBranch(chatKey, { persistRestore: true });
  } catch (error) {
    console.warn('[World State Alpha] branch check after a state replacement failed; the next chat event retries it.', error);
  }
}

async function reconcileCurrentBranch(chatKey, { persistRestore = false } = {}) {
  const state = await ensureChatStateLoaded(chatKey);
  if (!state || currentChatKey() !== chatKey) return null;

  const currentLineage = chatLineage(getContext().chat || []);
  const storedLineage = Array.isArray(state.lineage) ? state.lineage : [];
  // A stored branch this session already proved against its own chat that is
  // now longer than the chat was truncated locally and rolls back normally.
  const locallyTruncated = storedLineage.length > 0
    && locallyProvenTails.get(chatKey) === lineageTailKey(storedLineage);
  if (storedLineage.length > currentLineage.length && lineageIsPrefix(currentLineage, storedLineage) && !locallyTruncated) {
    const wasDirty = branchDirtyChats.has(chatKey);
    branchDirtyChats.add(chatKey);
    clearPrivatePrompt();
    if (!wasDirty) {
      diagnosticStore.record(chatKey, {
        operationId: 'branch:host-chat-behind:' + Date.now(),
        label: 'branch',
        sourceMessageId: currentLineage.length ? currentLineage.length - 1 : null,
        outcome: 'fail-closed',
        code: 'WORLD_STATE_HOST_CHAT_BEHIND_SIDECAR',
        detail: 'The durable server sidecar contains a strict continuation of the currently loaded SillyTavern chat. World State will not roll that newer server state backward; reopen/reload the chat so the host history catches up.',
        providerCalls: 0,
      });
    }
    return {
      state,
      divergence: currentLineage.length,
      action: 'host-chat-behind',
      exactRestored: false,
      failClosed: true,
      hostChatBehind: true,
    };
  }

  const passiveCaptureMessageId = passiveCaptureRebaseCandidates.get(chatKey);
  const liveChat = getContext().chat || [];
  let result = reconcileBranch(state, liveChat, {
    passiveCaptureMessageId: Number.isInteger(passiveCaptureMessageId) ? passiveCaptureMessageId : null,
  });
  let abandonedBranch = null;
  let resumedPark = null;
  let parks = parkedBranches.get(chatKey) || [];
  if (!result.failClosed) {
    // Rows before the first real change were only rebased (hide/unhide, narration-equivalent rewrites):
    // parked branches based in that prefix move onto the new lineage keys first, so a hide and a swipe
    // back reconciled together still resume.
    const provenPrefix = ['passive-capture-rebase', 'semantic-lineage-rebase'].includes(result.action)
      ? Math.min(state.lineage?.length || 0, result.state.lineage?.length || 0)
      : ['rollback-journal', 'exact-checkpoint'].includes(result.action) ? Number(result.divergence) || 0 : 0;
    if (provenPrefix > 0 && parks.length) parks = relinkParkedBranches(parks, state.lineage, result.state.lineage, provenPrefix);
    // Keep what an abandoned suffix established, and if the current messages
    // are exactly a branch abandoned earlier (e.g. swiping back to a captured
    // reply), resume that branch's exact state instead of losing it. The park
    // list only changes once this result is durably accepted below.
    abandonedBranch = parkAbandonedBranch(state, result);
    const resumed = resumeParkedBranch(result.state, liveChat, parks);
    if (resumed) {
      resumedPark = parks[resumed.parkIndex];
      result = { ...result, state: resumed.state, action: 'parked-branch-resume', rolledBackBy: result.action };
    }
  }
  const changed = stateChanged(state, result.state);
  const passiveRebase = result.action === 'passive-capture-rebase';
  const semanticRebase = result.action === 'semantic-lineage-rebase';
  const lineageRebase = passiveRebase || semanticRebase;
  const durableRestore = persistRestore
    && ['rollback-journal', 'exact-checkpoint', 'parked-branch-resume', 'fail-closed', 'passive-capture-rebase', 'semantic-lineage-rebase'].includes(result.action);

  if (changed && durableRestore) {
    const branchIsCurrent = chatHeadGuard(chatKey);
    const persisted = await persistGuardedMutation({
      chatKey,
      candidateState: result.state,
      recoveryState: state,
      isCurrent: branchIsCurrent,
      label: 'branch reconciliation',
      sourceMessageId: result.divergence,
    });
    if (persisted.stale) {
      branchDirtyChats.add(chatKey);
      return {
        ...result,
        action: 'stale-persist',
        exactRestored: false,
        failClosed: true,
        stalePersistence: true,
      };
    }
    setCachedState(chatKey, result.state, { indexMode: lineageRebase ? 'preserve' : 'rebuild' });
  } else if (changed) {
    // Forward lineage extension and passive lineage rebases change chronology
    // metadata only; canonical relevance data is unchanged.
    setCachedState(chatKey, result.state, { indexMode: 'preserve', lineageOnly: result.action === 'forward-extension' });
  }
  if (parks.length || parkedBranches.has(chatKey)) parkedBranches.set(chatKey, parks.filter(park => park !== resumedPark));
  rememberParkedBranch(chatKey, abandonedBranch);

  if (lineageRebase) {
    passiveCaptureRebaseCandidates.delete(chatKey);
    const count = Array.isArray(result.rebasedMessageIds) ? result.rebasedMessageIds.length : 1;
    diagnosticStore.record(chatKey, {
      operationId: 'branch-rebase:' + result.divergence,
      label: 'branch',
      sourceMessageId: result.divergence,
      outcome: 'rebased',
      code: semanticRebase ? 'WORLD_STATE_SEMANTIC_LINEAGE_REBASE' : 'WORLD_STATE_PASSIVE_CAPTURE_REBASE',
      detail: semanticRebase
        ? 'Preserved canonical state while rebasing ' + count + ' narration-equivalent or hidden/unhidden message' + (count === 1 ? '.' : 's.')
        : 'Preserved canonical state while rebasing a passively rewritten latest captured assistant boundary.',
      providerCalls: 0,
    });
  } else if (!['same', 'forward-extension'].includes(result.action)) {
    passiveCaptureRebaseCandidates.delete(chatKey);
    const beforeRecords = Array.isArray(state?.records) ? state.records.length : 0;
    const afterRecords = Array.isArray(result.state?.records) ? result.state.records.length : 0;
    const resumedBranch = result.action === 'parked-branch-resume';
    diagnosticStore.record(chatKey, {
      operationId: 'branch:' + result.action + ':' + result.divergence,
      label: 'branch',
      sourceMessageId: result.divergence,
      outcome: result.action,
      code: result.failClosed
        ? 'WORLD_STATE_BRANCH_FAIL_CLOSED'
        : (resumedBranch ? 'WORLD_STATE_BRANCH_RESUMED' : 'WORLD_STATE_BRANCH_RECONCILED'),
      detail: (resumedBranch
        ? 'Returned to a previously captured branch at message ' + result.divergence + '; restored its exact state without a new capture'
        : 'Branch reconciliation at message ' + result.divergence)
        + ' (current record count ' + beforeRecords + ' → ' + afterRecords + ').',
      providerCalls: 0,
    });
    // Swipes, tail deletes, and edits of the latest reply are recaptured or
    // resumed; a change further back leaves later messages without their
    // World State, and only an explicit rebuild can recapture them.
    if (abandonedBranch && !resumedBranch && result.divergence < liveChat.length - 1) {
      notify(
        'warning',
        'World State rolled back to message #' + Math.max(0, result.divergence - 1)
          + ' because an earlier message changed. What later messages had established was set aside; use Rebuild from chat → Last messages to recapture it.',
      );
    }
  }

  if (result.failClosed) branchDirtyChats.add(chatKey);
  else branchDirtyChats.delete(chatKey);
  if (!result.failClosed) locallyProvenTails.set(chatKey, lineageTailKey(result.state?.lineage));
  return result;
}

async function handleAssistantMessage(messageId) {
  if (!hostHydrationReady) return;
  const settings = getWorldStateSettings();
  if (!settings.enabled || !settings.autoCapture) return;
  const ctx = getContext();
  const chat = ctx.chat || [];
  if (!Number.isInteger(messageId) || messageId < 0 || messageId >= chat.length) return;
  const message = chat[messageId];
  if (messageRole(message) !== 'assistant' || isNarratorMessage(message) || !messageText(message).trim()) return;

  const chatKey = currentChatKey();
  if (chatKey === 'no-chat') return;

  // Until capture itself starts, a thrown step (a failed server read, a failed branch restore) would drop
  // the reply with only a console message; it is recorded as a missed capture instead.
  let captureStarted = false;
  const startFingerprint = storyFingerprintOf(message);
  await queueChatWork(chatKey, async () => {
    try {
      await captureAssistantBoundary(chatKey, messageId, () => { captureStarted = true; });
    } catch (error) {
      if (!captureStarted) recordCaptureStartFailure(chatKey, messageId, startFingerprint, error);
      throw error;
    }
  });
}

// A message's story version (hiding aside), as capture compares it.
function storyFingerprintOf(message) {
  return fingerprintMessage({ ...message, is_system: false });
}

function recordCaptureStartFailure(chatKey, messageId, startFingerprint, error) {
  const settings = getWorldStateSettings();
  if (currentChatKey() !== chatKey || !settings.enabled || !settings.autoCapture) return;
  const chat = getContext().chat || [];
  if (messageId >= chat.length || messageRole(chat[messageId]) !== 'assistant' || isNarratorMessage(chat[messageId])) return;
  // Swiped or edited while the capture waited: that version is gone, and the new one is captured on its own.
  if (storyFingerprintOf(chat[messageId]) !== startFingerprint) return;
  const prefix = chat.slice(0, messageId + 1);
  diagnosticStore.record(chatKey, {
    operationId: 'capture:' + messageId + ':not-started:' + Date.now(),
    label: 'capture',
    sourceMessageId: messageId,
    lineageKey: chatLineage(prefix)[messageId]?.lineageKey || '',
    contentLineageKey: contentLineageKey(prefix, messageId),
    outcome: 'not-started',
    code: error?.code || 'WORLD_STATE_CAPTURE_NOT_STARTED',
    detail: 'Capture could not start: ' + String(error?.message || error || 'unexpected error').slice(0, 240),
  });
}

async function captureAssistantBoundary(chatKey, messageId, markStarted) {
  await ensureChatStateLoaded(chatKey);
  if (currentChatKey() !== chatKey || hydrationErrors.has(chatKey)) return;
  await refreshChatStateFromServer(chatKey, { reason: 'assistant-boundary' });
  if (currentChatKey() !== chatKey || hydrationErrors.has(chatKey)) return;
  if (bootstrapRequiredChats.has(chatKey)) {
    notifyBootstrapRequiredOnce(chatKey);
    clearPrivatePrompt();
    refreshPanel();
    return;
  }
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
  if (messageId >= liveChat.length || messageRole(liveChat[messageId]) !== 'assistant' || isNarratorMessage(liveChat[messageId])) return;
  const currentState = stateCache.get(chatKey);
  // Match rebuild's exact assistant-boundary semantics. A rolling window
  // includes the previous assistant turn and can bias capture toward stale
  // already-seen material instead of the newly completed exchange.
  const exchange = assistantBoundaryExchange(liveChat, messageId, currentState?.lineage);
  const sourceLineageKey = currentState?.lineage?.[messageId]?.lineageKey || '';
  if (!sourceLineageKey) return;
  // The hide-insensitive key is hashed only for rows that can list or clear a
  // missed capture, from the messages as they were when this capture began
  // (a chat switch replaces the live chat's contents).
  const captureMessages = liveChat.slice(0, messageId + 1);
  // Fingerprints at capture start: an in-place edit since then yields no key rather than a newer chat's.
  const captureLineage = (currentState?.lineage || []).slice(0, messageId + 1);
  const captureOperationId = 'capture:' + messageId + ':' + epoch(chatKey) + ':' + (captureAttemptSeq += 1);
  const storyFingerprint = storyFingerprintOf;
  const sourceStoryFingerprint = storyFingerprint(liveChat[messageId]);
  let captureContentKey = null;
  const sourceContentLineageKey = outcome => {
    const settled = outcome === 'applied' || outcome === 'no-change';
    // Until the saved log has loaded, a failure it holds is unknown, so a success still carries its key.
    if (settled && operationLogsHydrated.has(chatKey) && !unrecoveredCaptureFailures(diagnosticStore.recoveryRows(chatKey))
      .some(failure => failure.messageId === messageId)) return '';
    if (captureContentKey === null) captureContentKey = contentLineageKey(captureMessages, messageId, captureLineage);
    return captureContentKey;
  };

  const before = stateCache.get(chatKey);
  // Created before any wait (the base map below): a newer state hydrated meanwhile makes this capture stale.
  const isCurrent = operationGuard(chatKey, messageId);
  const index = getRelevanceIndex(chatKey, before);
  const captureText = recentText(normalizeCaptureExchange(exchange));
  const currentExchangeIds = new Set(exchange.map(row => row?.messageId).filter(Number.isInteger));
  const lifecycleContext = recentText(normalizeCaptureExchange(
    boundedExchange(
      liveChat,
      messageId,
      CAPTURE_LIMITS.lifecycleContextMessages,
      currentState?.lineage,
    ).filter(row => !currentExchangeIds.has(row?.messageId)),
  ));
  const lifecycleSelection = selectLifecycleCandidates(before, {
    index,
    currentText: captureText,
    contextText: lifecycleContext,
    currentMessageId: messageId,
    maxRecords: CAPTURE_LIMITS.lifecycleVisibleRecords,
  });
  const lifecycleVisible = lifecycleSelection.selected.map(item => item.record);
  const lifecycleContextRecordIds = lifecycleSelection.selected.length === 1
    && lifecycleSelection.selected[0]?.lifecycleSource === 'scene-context'
    ? [lifecycleSelection.selected[0].record?.id].filter(Boolean)
    : [];
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

  const visibleById = new Map();
  for (const record of lifecycleVisible) {
    if (record?.id && !visibleById.has(record.id)) visibleById.set(record.id, record);
  }
  for (const record of tombstones) {
    if (visibleById.size >= CAPTURE_LIMITS.visibleRecords) break;
    if (record?.id && !visibleById.has(record.id)) visibleById.set(record.id, record);
  }
  for (const record of activeVisible) {
    if (visibleById.size >= CAPTURE_LIMITS.visibleRecords) break;
    if (record?.id && !visibleById.has(record.id)) visibleById.set(record.id, record);
  }
  const visible = [...visibleById.values()].slice(0, CAPTURE_LIMITS.visibleRecords);

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
        recentText: captureText,
        maxLocations: 6,
      });
      visibleLocations = spRel.selected.map(item => item.location);
    }
  }

  markStarted();
  const result = await runCaptureOperation({
    ctx: getContext(),
    state: before,
    exchange,
    visibleRecords: visible,
    lifecycleContextRecordIds,
    loreText: '',
    chatKey,
    sourceMessageId: messageId,
    sourceLineageKey,
    sourceContentLineageKey,
    route: routeSettings(),
    operationId: captureOperationId,
    isCurrent,
    diagnostics: diagnosticStore,
    spatialEnabled: spatialCaptureEnabled,
    visibleLocations,
    baseMap,
    spatialProfile: resolveSpatialProfile(before.spatial, baseMap),
  });

  // The capture row above is written before the sidecar save; if the result is dropped or that save
  // fails, record the boundary as a failure so the Operations log never shows a lost capture as recovered.
  const recordUnsaved = (code, detail) => diagnosticStore.record(chatKey, {
    operationId: 'capture:' + messageId + ':unsaved:' + Date.now(),
    label: 'capture',
    sourceMessageId: messageId,
    lineageKey: sourceLineageKey,
    contentLineageKey: sourceContentLineageKey('not-saved'),
    outcome: 'not-saved',
    code,
    detail,
  });
  // A capture whose own message was swiped, edited or deleted (hiding aside) has nothing to recover:
  // that version is gone and the new one is captured on its own, so settle its row instead.
  const messageSuperseded = () => {
    if (currentChatKey() !== chatKey) return false;
    const live = (getContext().chat || [])[messageId];
    return !live || storyFingerprint(live) !== sourceStoryFingerprint;
  };
  const recordSuperseded = () => diagnosticStore.record(chatKey, {
    // The attempt's own id: it settles this attempt only.
    operationId: captureOperationId,
    label: 'capture',
    sourceMessageId: messageId,
    lineageKey: sourceLineageKey,
    outcome: 'superseded',
    code: 'WORLD_STATE_CAPTURE_SUPERSEDED',
    detail: 'The message changed before its capture finished; nothing to recover for that version.',
  });
  const recordAbandoned = detail => (messageSuperseded()
    ? recordSuperseded()
    : recordUnsaved('WORLD_STATE_CAPTURE_STALE', detail));
  if (result.outcome === 'skipped') return;
  if (result.outcome !== 'applied' && result.outcome !== 'no-change' && messageSuperseded()) {
    recordSuperseded();
    return;
  }
  if (result.outcome === 'stale') return;
  if (!isCurrent()) {
    if (result.outcome === 'applied') recordAbandoned('Capture was discarded because the chat changed before it was saved.');
    return;
  }
  const committed = commitMutationBoundary(before, result.state, liveChat, messageId, 'capture', { lineage: before.lineage });
  let persisted;
  try {
    persisted = await persistGuardedMutation({
      chatKey,
      candidateState: committed,
      recoveryState: before,
      isCurrent,
      label: 'capture',
      sourceMessageId: messageId,
    });
  } catch (error) {
    recordUnsaved(error?.code || 'WORLD_STATE_CAPTURE_PERSIST_FAILURE', 'Capture could not be saved: ' + String(error?.message || error).slice(0, 240));
    throw error;
  }
  if (persisted.conflict) {
    recordUnsaved('WORLD_STATE_REVISION_CONFLICT', 'Capture was discarded because another session saved newer World State first.');
  } else if (persisted.stale) {
    // Not written, or written and then compensated back to the prior state.
    recordAbandoned('Capture was discarded because the chat changed while it was being saved.');
  }
  // Capture never changes the shared index before this point, and a conflict already re-hydrated it.
  if (persisted.stale) return;
  setCachedState(chatKey, committed, {
    indexMode: 'delta',
    indexDelta: result.indexDelta,
    spatialIndexDelta: result.spatial?.indexDelta,
  });
  // The host may still normalize the just-received assistant message after
  // this background capture finishes. Remember only this latest captured
  // boundary so an unannounced presentation-only rewrite can rebase lineage
  // metadata instead of being mistaken for a branch rollback.
  passiveCaptureRebaseCandidates.set(chatKey, messageId);
  updatePrivateInjection();
  refreshPanel();
}

async function handleUserMessage(messageId) {
  if (!hostHydrationReady) return;
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
  await refreshChatStateFromServer(chatKey, { reason: 'user-boundary' });
  if (currentChatKey() !== chatKey || hydrationErrors.has(chatKey)) return;
  if (bootstrapRequiredChats.has(chatKey)) {
    notifyBootstrapRequiredOnce(chatKey);
    clearPrivatePrompt();
    refreshPanel();
    return;
  }
  updatePrivateInjection();
  refreshPanel();

  void queueChatWork(chatKey, async () => {
    await ensureChatStateLoaded(chatKey);
    if (currentChatKey() !== chatKey || hydrationErrors.has(chatKey)) return;
    await refreshChatStateFromServer(chatKey, { reason: 'continuity-boundary' });
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
    const before = stateCache.get(chatKey);
    const index = getRelevanceIndex(chatKey, before);
    // An explicit meaningful skip ("two days later") wins; otherwise narrated
    // day steps since the last recorded elapsed catch-up may add up to one.
    const elapsedHint = resolveContinuityElapsedHint({
      exchange,
      chat: liveChat,
      messageId,
      sinceMessageId: Number.isInteger(index?.elapsedEvidenceBoundary) ? index.elapsedEvidenceBoundary : -1,
      // Saved lineage only: without it the detector fails closed (no chat scan).
      lineage: before?.lineage,
      hasActiveDevelopments: Boolean(index?.backgroundDevelopmentSet?.size),
    });
    const isCurrent = operationGuard(chatKey, messageId);
    // Background selection advances these two fields on the shared index before evolution answers.
    const backgroundBefore = index
      ? { backgroundCursor: index.backgroundCursor, backgroundElapsedBoundary: index.backgroundElapsedBoundary }
      : null;

    let prepared;
    try {
      prepared = await prepareWorldStateContinuity({
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
        // The shared index feeds the next prompt outside this queue: publish evolution only once saved.
        publishIndex: false,
      });
    } catch (error) {
      resetIndexesFromCache(chatKey);
      throw error;
    }

    // Background selection advanced the index's catch-up cursor/boundary: whenever the result is not
    // saved, rebuild the index from the state cached now so that catch-up is retried, never skipped.
    if (!isCurrent()) {
      resetIndexesFromCache(chatKey);
      return;
    }
    if (stateChanged(before, prepared.state)) {
      const committed = commitMutationBoundary(before, prepared.state, liveChat, messageId, 'evolution', { lineage: before.lineage });
      let persisted;
      try {
        persisted = await persistGuardedMutation({
          chatKey,
          candidateState: committed,
          recoveryState: before,
          isCurrent,
          label: 'evolution',
          sourceMessageId: messageId,
        });
      } catch (error) {
        resetIndexesFromCache(chatKey);
        throw error;
      }
      if (persisted.stale) {
        resetIndexesFromCache(chatKey);
        return;
      }
      const indexDelta = prepared.evolution?.indexDelta;
      setCachedState(chatKey, committed, indexDelta
        ? { indexMode: 'delta', indexDelta, spatialIndexDelta: {} }
        : { indexMode: 'rebuild' });
    } else if (prepared.evolution?.outcome !== 'skipped' && backgroundBefore && relevanceIndices.get(chatKey) === index) {
      // Evolution ran but changed nothing (it failed, or was answered without a usable result): only the
      // background cursor and boundary it advanced on the shared index are put back, so a later turn
      // retries that catch-up; the rest of the index still matches the unchanged state.
      Object.assign(index, backgroundBefore);
    }
    updatePrivateInjection();
    refreshPanel();
  }).catch(error => {
    console.error('[World State Alpha] background continuity failed safely', error);
  });
}

async function handleBranchChange(reason = 'branch') {
  if (!hostHydrationReady) return;
  const chatKey = currentChatKey();
  if (chatKey === 'no-chat') {
    clearPrivatePrompt();
    return;
  }
  clearBranchCaptureTimer(chatKey);
  branchDirtyChats.add(chatKey);
  passiveCaptureRebaseCandidates.delete(chatKey);
  stateEpochs.set(chatKey, epoch(chatKey) + 1);
  // A running manual rebuild judges a branch change itself: one outside its range leaves it valid.
  cancelWorldStateRequests({ chatKey, exceptOperationIdPrefix: 'rebuild:' });
  const work = queueChatWork(chatKey, async () => {
    try {
      await ensureChatStateLoaded(chatKey);
      if (currentChatKey() !== chatKey) return;
      await refreshChatStateFromServer(chatKey, { reason: 'branch-change' });
      if (currentChatKey() !== chatKey) return;
      if (bootstrapRequiredChats.has(chatKey)) {
        notifyBootstrapRequiredOnce(chatKey);
        clearPrivatePrompt();
        refreshPanel();
        return;
      }
      const branch = await reconcileCurrentBranch(chatKey, { persistRestore: true });
      updatePrivateInjection();
      refreshPanel();
      // Only a change at the latest reply is recaptured here; an edit further
      // back rolls later messages away and is left to an explicit rebuild.
      const latestMessageId = (getContext().chat || []).length - 1;
      if (branch && !branch.failClosed && BRANCH_CAPTURE_REASONS.has(reason) && currentChatKey() === chatKey
        && (branch.divergence === -1 || branch.divergence >= latestMessageId)) {
        scheduleBranchCapture(chatKey);
      }
    } catch (error) {
      clearPrivatePrompt();
      console.error('[World State Alpha] branch reconciliation failed safely (' + reason + ')', error);
    }
  });
  // SillyTavern waits for this event before it swipes, regenerates or saves an edit. Behind a running
  // rebuild the reconcile would hold that for the whole rebuild: the branch is already marked dirty, so
  // the prompt carries no World State until the queued reconcile runs after the rebuild.
  if (rebuildAbortControllers.has(chatKey)) {
    updatePrivateInjection();
    void work;
    return;
  }
  await work;
}

// A swipe to an already generated reply, a swipe deletion, or an edit of the
// latest reply changes the visible reply without MESSAGE_RECEIVED. Capture it
// once the operator settles on it (browsing swipes cancels the pending one);
// capture itself skips a boundary whose resumed state already holds it.
function scheduleBranchCapture(chatKey) {
  clearBranchCaptureTimer(chatKey);
  const chat = getContext().chat || [];
  const messageId = chat.length - 1;
  const message = chat[messageId];
  if (messageId < 0 || messageRole(message) !== 'assistant' || !messageText(message).trim()) return;
  // Overswiping emits MESSAGE_SWIPED before generating into a new slot; that
  // reply is captured by MESSAGE_RECEIVED when it completes.
  if (Array.isArray(message.swipes) && Number.isInteger(message.swipe_id) && message.swipe_id >= message.swipes.length) return;
  const fingerprint = fingerprintMessage(message);
  branchCaptureTimers.set(chatKey, setTimeout(() => {
    branchCaptureTimers.delete(chatKey);
    if (currentChatKey() !== chatKey) return;
    const live = getContext().chat || [];
    if (live.length - 1 !== messageId || fingerprintMessage(live[messageId]) !== fingerprint) return;
    void handleAssistantMessage(messageId).catch(error => {
      console.error('[World State Alpha] branch capture failed safely', error);
    });
  }, BRANCH_CAPTURE_DELAY_MS));
}

const BRANCH_CAPTURE_REASONS = new Set(['MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED', 'MESSAGE_EDITED']);

async function activateCurrentChat() {
  const previousKey = activeChatKey;
  const identity = currentChatIdentity();
  const chatKey = identity.key;
  activeChatKey = chatKey;

  if (panelChatKey !== 'no-chat' && panelChatKey !== chatKey) closeWorldStatePanel();
  if (previousKey && previousKey !== 'no-chat' && previousKey !== chatKey) {
    cancelWorldStateRequests({ chatKey: previousKey });
  }

  if (!hostHydrationReady || !identity.ready || chatKey === 'no-chat') {
    clearPrivatePrompt();
    refreshPanel();
    return;
  }

  try {
    if (extensionSettingsReady && provisionalFreshChats.has(chatKey)) {
      await recheckProvisionalFreshHydration(chatKey);
      if (currentChatKey() !== chatKey) return;
    }
    // A chat hydrated by this activation was just read from the server (with retries): reading it again
    // at once only repeated the download, or the retry waits of a chat with no sidecar.
    const hydratedNow = !loadedChats.has(chatKey);
    await ensureChatStateLoaded(chatKey);
    if (currentChatKey() !== chatKey) return;
    retiredOperationLogs.delete(chatKey);
    void hydrateOperationLog(chatKey);
    if (!hydratedNow) await refreshChatStateFromServer(chatKey, { reason: 'chat-activation', retryDeterministicMiss: true });
    if (currentChatKey() !== chatKey) return;
    if (bootstrapRequiredChats.has(chatKey)) {
      scheduleBootstrapNotice(chatKey);
      clearPrivatePrompt();
      refreshPanel();
      evictDormantChatStates(chatKey);
      return;
    }
    // One activation reconcile at a time per chat: overlapping load events (CHAT_CHANGED with CHAT_LOADED,
    // or the start-up paths) never race one restore write against another from the same cache. It does not
    // wait on the writer queue, so a long rebuild never holds back the reloaded chat's prompt and panel.
    await serializeActivation(chatKey, async () => {
      if (currentChatKey() !== chatKey) return;
      await reconcileCurrentBranch(chatKey, { persistRestore: true });
    });
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
  assignChecked('world_state_alpha_show_launcher', settings.showLauncher);
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
    '<label class="world-state-alpha-toggle"><input id="world_state_alpha_show_launcher" type="checkbox"><span>Show floating World State button (drag to move)</span></label>',
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
    else if (target.id === 'world_state_alpha_show_launcher') {
      settings.showLauncher = Boolean(target.checked);
      persistHostSettings();
      syncSettingsControls();
      syncFloatingLauncher();
      return;
    }
    else return;

    // Settings that change provider work cancel it; the injection-only toggles change only the next prompt.
    if ([
      'world_state_alpha_enabled',
      'world_state_alpha_auto_capture',
      'world_state_alpha_connection_profile',
      'world_state_alpha_spatial_enabled',
    ].includes(target.id)) {
      invalidateChatOperations();
    }

    persistHostSettings();
    syncSettingsControls();
    if (target.id === 'world_state_alpha_enabled') syncFloatingLauncher();

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

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleServerFreshnessRefresh('visibility-resume');
    // Backgrounding (common on phones and tablets) may be the last chance to save pending log rows.
    else flushAllOperationLogs();
  });
  globalThis.addEventListener?.('pagehide', () => flushAllOperationLogs());
  globalThis.addEventListener?.('pageshow', () => scheduleServerFreshnessRefresh('pageshow'));
  globalThis.addEventListener?.('focus', () => scheduleServerFreshnessRefresh('window-focus'));
}

// One World-State-owned floating button, mounted on init and on setting change.
// Nothing polls or observes the DOM for it; SillyTavern leaves our body child alone.
// The button is optional chrome: a failure here must never block hydration.
function syncFloatingLauncher() {
  try {
    if (!globalThis.document?.body) return;
    const settings = getWorldStateSettings();
    const wanted = settings.showLauncher !== false && settings.enabled !== false;
    if (wanted && floatingLauncher?.element?.isConnected) return;
    floatingLauncher?.destroy();
    floatingLauncher = wanted
      ? mountWorldStateLauncher({ onOpen: () => void openWorldStatePanel() })
      : null;
  } catch (error) {
    floatingLauncher = null;
    console.warn('[World State Alpha] floating button unavailable', error);
  }
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
    const rebuildController = rebuildAbortControllers.get(chatKey);
    rebuildController?.abort();
    const cancelled = cancelWorldStateRequests({
      chatKey,
      operationIdPrefix: status.operationId,
    });
    rebuildStatuses.set(chatKey, {
      ...status,
      phase: 'cancelling',
      detail: cancelled
        ? 'Cancellation requested; waiting for the active provider call to stop safely.'
        : rebuildController
          ? 'Cancellation requested; rebuild will stop before another boundary or canonical replacement.'
          : 'Cancellation requested; no active rebuild controller or provider call remains.',
    });
    refreshPanel();
    notify('info', 'World State Alpha rebuild cancellation requested.');
    return;
  }

  // Open the file picker straight from the click, before queueing: behind other chat work the browser's
  // user activation can expire, the picker then never opens and never settles, and the chat queue would
  // wait on it forever.
  if (actionId === 'import') {
    const file = await chooseImportFile();
    if (!file || currentChatKey() !== chatKey) return;
    payload = { ...payload, file };
  }

  return queueChatWork(chatKey, () => applyMaintenanceActionNow(actionId, payload, chatKey))
    .catch(error => actionFailed('World State maintenance (' + actionId + ')', error, chatKey));
}

// A panel action that throws (an unreadable import, a failed save) tells the operator instead of failing
// silently with only a console error.
function actionFailed(label, error, chatKey) {
  console.error('[World State Alpha] ' + label + ' failed safely', error);
  if (currentChatKey() === chatKey) {
    notify('error', label + ' failed: ' + String(error?.message || 'unexpected error').replace(/^World State Alpha:\s*/u, '').slice(0, 240));
    refreshPanel();
  }
  return false;
}

async function applyMaintenanceActionNow(actionId, payload, chatKey) {
  await ensureChatStateLoaded(chatKey);
  if (hydrationErrors.has(chatKey) || currentChatKey() !== chatKey) return;
  await refreshChatStateFromServer(chatKey, { reason: 'maintenance-' + actionId });
  if (hydrationErrors.has(chatKey) || currentChatKey() !== chatKey) return;
  if (bootstrapRequiredChats.has(chatKey) && !['import', 'reset', 'rebuild'].includes(actionId)) {
    notifyBootstrapRequiredOnce(chatKey);
    return;
  }
  let state = stateCache.get(chatKey);

  if (actionId === 'export') {
    const prepared = prepareWorldStateExport(state);
    downloadText('world-state-alpha-' + Date.now() + '.json', prepared.text);
    notify('success', 'World State Alpha export prepared.');
    return;
  }

  if (actionId === 'import') {
    const file = payload?.file;
    if (!file || currentChatKey() !== chatKey) return;
    const text = await file.text();
    if (currentChatKey() !== chatKey) return;
    const preview = previewWorldStateImport(text, { targetChatKey: chatKey });
    if (!window.confirm('Import this World State bundle into the current chat? Existing World State records will be replaced after confirmation.')) return;
    const next = seedRootCheckpoint(applyWorldStateImport(preview, { confirmed: true }));
    try {
      await persistState(chatKey, next, { allowBootstrapRecovery: true });
    } catch (error) {
      if (await handleServerRevisionConflict(chatKey, error, { label: 'import' })) {
        notify('info', 'World State import was cancelled because another session updated the server state first.');
        return;
      }
      throw error;
    }
    setCachedState(chatKey, next);
    passiveCaptureRebaseCandidates.delete(chatKey);
    forgetBranchContinuations(chatKey);
    diagnosticStore.record(chatKey, {
      label: 'import',
      outcome: 'applied',
      sourceMessageId: Math.max(0, (getContext().chat || []).length - 1),
      detail: 'World State bundle imported and persisted; earlier failed captures no longer apply.',
    });
    if (next.spatial?.baseMapRef?.id) {
      const reboundBaseMap = await getChatBaseMap(chatKey, stateCache.get(chatKey));
      if (reboundBaseMap) {
        resetSpatialRelevanceIndex(chatKey, stateCache.get(chatKey).spatial, reboundBaseMap);
      }
    }
    await settleReplacedBranch(chatKey);
    updatePrivateInjection();
    refreshPanel();
    return;
  }

  if (actionId === 'reset') {
    const preview = previewWorldStateReset(state, { chatKey });
    if (!window.confirm('Reset World State Alpha for this chat? This replaces the current World State after confirmation.')) return;
    const next = seedRootCheckpoint(applyWorldStateReset(preview, { confirmed: true }));
    rebuildStatuses.delete(chatKey);
    try {
      await persistState(chatKey, next, { allowBootstrapRecovery: true });
    } catch (error) {
      if (await handleServerRevisionConflict(chatKey, error, { label: 'reset' })) {
        notify('info', 'World State reset was cancelled because another session updated the server state first.');
        return;
      }
      throw error;
    }
    setCachedState(chatKey, next);
    passiveCaptureRebaseCandidates.delete(chatKey);
    forgetBranchContinuations(chatKey);
    diagnosticStore.record(chatKey, {
      label: 'reset',
      outcome: 'applied',
      sourceMessageId: Math.max(0, (getContext().chat || []).length - 1),
      detail: 'World State reset and persisted; earlier failed captures no longer apply.',
    });
    await settleReplacedBranch(chatKey);
    updatePrivateInjection();
    refreshPanel();
    return;
  }

  if (actionId === 'rebuild') {
    const rebuildRequest = payload?.rebuild && typeof payload.rebuild === 'object' ? payload.rebuild : {};
    // The rebuild works on the chat as it is now (a resume on the exact range of the failed run):
    // messages the operator adds meanwhile are captured live after it, never pulled into it.
    // Resume re-sends the failed boundary's unmodified request with the same
    // plan; it never feeds the malformed reply back to the model.
    // It must name the failure it answers, so a duplicate click can never
    // consume a newer failure's resume point without a fresh decision.
    const savedResume = rebuildRequest.resume === true ? rebuildResumes.get(chatKey) : null;
    const liveAtStart = getContext().chat || [];
    const chat = Number.isInteger(savedResume?.params?.chatLength)
      ? liveAtStart.slice(0, savedResume.params.chatLength)
      : liveAtStart.slice();
    if (!payload?.rebuild
      && !window.confirm('Rebuild World State Alpha from this chat chronology? This is an explicit provider-backed recovery operation.')) return;

    const refuseResume = message => {
      rebuildResumes.delete(chatKey);
      notify('error', message);
      refreshPanel();
    };
    if (rebuildRequest.resume === true) {
      if (!savedResume || savedResume.resume.fromMessageId !== rebuildRequest.fromMessageId) {
        notify('error', 'There is no failed rebuild to resume at that message for this chat. Start a new rebuild.');
        refreshPanel();
        return;
      }
      // Refuse a stale resume before any reconcile, status, or provider side effect.
      if (rebuildSnapshotToken({ state, chat }) !== savedResume.resume.snapshotToken) {
        refuseResume('The chat or World State changed since the rebuild failed, so it cannot resume. Start a new rebuild.');
        return;
      }
    }
    const resumeParams = savedResume?.params || null;

    // Recapture failed messages is a From-message rebuild that starts at the
    // earliest unrecovered live capture failure. The request must name that
    // exact message, so a stale panel can never start an arbitrary range.
    const recapture = rebuildRequest.recaptureFailed === true && !savedResume;
    if (recapture) {
      // Another device may already have recovered these; merge the saved log first.
      const saved = await readOperationLog(chatKey).catch(() => []);
      if (currentChatKey() !== chatKey) return;
      if (saved.length) diagnosticStore.merge(chatKey, saved);
    }
    const recaptureFailures = recapture ? pendingCaptureFailures(chatKey) : [];
    if (recapture && (!recaptureFailures.length || recaptureFailures[0] !== rebuildRequest.fromMessageId)) {
      notify('error', 'The failed captures changed since the panel was drawn. Review the panel and try again.');
      refreshPanel();
      return;
    }

    const mode = resumeParams
      ? resumeParams.mode
      : recapture ? 'from' : (['full', 'last', 'from'].includes(rebuildRequest.mode) ? rebuildRequest.mode : 'full');
    const bootstrapRecoveryAtStart = bootstrapRequiredChats.has(chatKey);
    // The route a resume must keep is the one the failed run started on: the same profile with the same
    // settings and model (or the same host model), and the same output cap.
    const routeFingerprint = worldStateRouteFingerprint(getContext(), routeSettings());
    const routeKey = stableStringify(routeFingerprint);
    if (resumeParams && (resumeParams.bootstrapRecoveryAtStart !== bootstrapRecoveryAtStart
      || resumeParams.spatialEnabled !== Boolean(getWorldStateSettings().spatialEnabled)
      || resumeParams.routeKey !== routeKey)) {
      refuseResume('World State settings or the connection profile changed since the rebuild failed, so it cannot resume without mixing models. Start a new rebuild.');
      return;
    }
    if (bootstrapRecoveryAtStart && mode !== 'full') {
      notify('error', 'This chat has no durable World State baseline. Use Full chat rebuild, import, or explicit reset; partial rebuild cannot safely recover missing continuity.');
      return;
    }
    const numeric = (value, fallback, min, max) => {
      const number = Number(value);
      if (!Number.isFinite(number)) return fallback;
      return Math.max(min, Math.min(max, Math.trunc(number)));
    };
    const maxBoundaries = resumeParams ? resumeParams.maxBoundaries : numeric(
      rebuildRequest.maxBoundaries,
      REBUILD_LIMITS.maxBoundaries,
      1,
      4096,
    );
    const lastMessages = numeric(rebuildRequest.lastMessages, 20, 1, Math.max(1, chat.length));
    const requestedStart = recapture
      ? recaptureFailures[0]
      : numeric(rebuildRequest.startMessageId, 0, 0, Math.max(0, chat.length - 1));
    const includeHiddenMessages = resumeParams ? resumeParams.includeHiddenMessages : rebuildRequest.includeHiddenMessages !== false;
    const startMessageId = resumeParams
      ? resumeParams.startMessageId
      : mode === 'last'
        ? Math.max(0, chat.length - lastMessages)
        : mode === 'from'
          ? requestedStart
          : 0;

    // Confirm a recapture before anything is written, the branch sync included.
    if (recapture) {
      let preview;
      try {
        preview = planChronologicalRebuild(chat, { maxBoundaries, startMessageId, includeHiddenMessages });
      } catch (error) {
        notify('error', 'World State Alpha recapture could not start: ' + String(error?.message || error).slice(0, 320));
        return;
      }
      const replies = preview.metrics.assistantBoundaries;
      const listed = recaptureFailures.slice(0, 8).join(', ') + (recaptureFailures.length > 8 ? ', …' : '');
      if (!window.confirm(
        'Recapture World State from message ' + startMessageId + '?\n\n'
          + recaptureFailures.length + ' live capture' + (recaptureFailures.length === 1 ? '' : 's') + ' failed (message'
          + (recaptureFailures.length === 1 ? ' ' : 's ') + listed + '). This re-reads '
          + replies + ' assistant repl' + (replies === 1 ? 'y' : 'ies')
          + ' from message ' + startMessageId + ' to the latest with your capture model. The current World State stays unchanged unless every reply succeeds.',
      )) return;
    }

    if (startMessageId > 0) {
      // A full reconcile, not the tail-only fast path: hiding or unhiding an earlier message changes
      // the prefix this rebuild must prove without touching the latest message.
      const branch = await reconcileCurrentBranch(chatKey, { persistRestore: true });
      if (currentChatKey() !== chatKey) return;
      if (branch?.failClosed) {
        notify(
          'error',
          'Partial rebuild cannot prove the current chat lineage safely. Use Full chat to recover the canonical base.',
        );
        updatePrivateInjection();
        refreshPanel();
        return;
      }
      state = stateCache.get(chatKey);
    }

    let rebuildPlan;
    try {
      rebuildPlan = planChronologicalRebuild(chat, {
        maxBoundaries,
        startMessageId,
        includeHiddenMessages,
      });
    } catch (error) {
      const detail = String(error?.message || error || 'rebuild planning failed').slice(0, 320);
      notify('error', 'World State Alpha rebuild could not start: ' + detail);
      return;
    }

    const sourceMessageId = Math.max(0, chat.length - 1);
    const totalBoundaries = rebuildPlan.metrics.assistantBoundaries;
    const startEpoch = epoch(chatKey);
    const startLineage = chatLineage(chat);
    const startTailKey = startLineage.length ? startLineage[startLineage.length - 1].lineageKey : '';
    const operationId = 'rebuild:' + sourceMessageId + ':' + startEpoch + ':' + startMessageId
      + (savedResume ? ':resume-' + savedResume.resume.fromMessageId + '-' + Date.now().toString(36) : '');
    // Messages added after the rebuilt range (the operator keeps playing) leave it intact: lineage keys
    // chain, so an unchanged key at the start's last message proves the whole range unchanged. Any swipe,
    // edit or delete inside it still stops the rebuild. New replies are captured live once it is saved.
    // It stops for a chat switch, an explicit invalidation (settings), new canonical state (another
    // device's save), or any change inside its range; branch events after the range do not stop it.
    const startInvalidations = operationInvalidations.get(chatKey) || 0;
    const startGeneration = canonicalGenerations.get(chatKey) || 0;
    // The range proof hashes the chat up to the rebuilt range. The run checks currentness several times per
    // boundary, so the proof is reused until a host chat event (edit, swipe, delete, send) or a second passes
    // (a hide has no event) and a chat shorter than the range is caught at once; the host's own checks before
    // saving and reporting are always exact.
    let rangeProof = { at: -Infinity, events: -1, current: true };
    const rangeCurrent = exact => {
      if (currentChatKey() !== chatKey || (operationInvalidations.get(chatKey) || 0) !== startInvalidations) return false;
      // New canonical state (another device's save, a branch restore) stops it; the chat growing does not.
      if ((canonicalGenerations.get(chatKey) || 0) !== startGeneration) return false;
      const liveChat = getContext().chat || [];
      if (liveChat.length < startLineage.length) return false;
      const now = Date.now();
      const events = chatEventCounts.get(chatKey) || 0;
      if (!exact && events === rangeProof.events && now - rangeProof.at < 1000) return rangeProof.current;
      const live = chatLineage(liveChat.slice(0, startLineage.length));
      rangeProof = { at: now, events, current: !startTailKey || live[startLineage.length - 1]?.lineageKey === startTailKey };
      return rangeProof.current;
    };
    const isCurrent = () => rangeCurrent(false);
    const isCurrentExact = () => rangeCurrent(true);
    const settings = getWorldStateSettings();
    const baseMap = await getChatBaseMap(chatKey, state);
    if (!isCurrentExact()) return;
    if (settings.spatialEnabled && state.spatial?.baseMapRef?.id && !baseMap) {
      notify('error', 'Rebuild paused because the attached Spatial base map is unavailable. Reattach or restore the base map first.');
      return;
    }

    // A new run or a resume consumes the previous resume point only now,
    // after every no-call early return above has had its chance to refuse.
    rebuildResumes.delete(chatKey);
    const priorTotals = savedResume?.totals || { applied: 0, rejected: 0, aliasRepairs: 0, providerCalls: 0 };

    rebuildAbortControllers.get(chatKey)?.abort();
    const rebuildController = new AbortController();
    rebuildAbortControllers.set(chatKey, rebuildController);

    const rangeLabel = (startMessageId > 0 ? 'message ' + startMessageId + ' to current' : 'full chat')
      + (savedResume ? ', resuming at message ' + savedResume.resume.fromMessageId : '');
    rebuildStatuses.set(chatKey, {
      phase: 'running',
      operationId,
      mode,
      startMessageId,
      maxBoundaries,
      includeHiddenMessages,
      hiddenMessagesIncluded: rebuildPlan.metrics.hiddenMessagesIncluded || 0,
      hiddenAssistantBoundaries: rebuildPlan.metrics.hiddenAssistantBoundaries || 0,
      processedBoundaries: savedResume ? savedResume.resume.processedBoundaries : 0,
      totalBoundaries,
      currentMessageId: null,
      providerCalls: priorTotals.providerCalls,
      applied: priorTotals.applied,
      rejected: priorTotals.rejected,
      currentRecords: (state.records || []).filter(record => record?.status === 'active').length,
      places: resolveEffectiveLocations(state.spatial, baseMap).length,
      startedAt: Date.now(),
      detail: 'Rebuilding ' + rangeLabel
        + (includeHiddenMessages
          ? ' with eligible hidden roleplay virtually included (' + (rebuildPlan.metrics.hiddenMessagesIncluded || 0) + ' hidden messages, ' + (rebuildPlan.metrics.hiddenAssistantBoundaries || 0) + ' hidden assistant boundaries).'
          : ' with hidden messages excluded.')
        + ' Canonical state will be replaced only after full success.',
    });

    diagnosticStore.record(chatKey, {
      operationId,
      label: 'rebuild',
      sourceMessageId,
      outcome: 'rebuild-started',
      totalBoundaries,
      hiddenMessagesIncluded: rebuildPlan.metrics.hiddenMessagesIncluded || 0,
      hiddenAssistantBoundaries: rebuildPlan.metrics.hiddenAssistantBoundaries || 0,
      detail: 'Explicit chronological rebuild started from ' + rangeLabel
        + (includeHiddenMessages ? ' with eligible hidden roleplay virtually included' : ' with hidden messages excluded')
        + '; canonical state will change only after full success.',
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
        // A profile edited after this check still fails closed: every boundary must match this signature.
        route: routeFingerprint.signature ? { ...routeSettings(), signature: routeFingerprint.signature } : routeSettings(),
        operationId,
        signal: rebuildController.signal,
        isCurrent,
        diagnostics: diagnosticStore,
        maxBoundaries,
        startMessageId,
        includeHiddenMessages,
        spatialEnabled: Boolean(settings.spatialEnabled),
        baseMap,
        spatialProfile: resolveSpatialProfile(state.spatial, baseMap),
        resume: savedResume?.resume || null,
        onProgress: progress => {
          const previous = rebuildStatuses.get(chatKey) || {};
          rebuildStatuses.set(chatKey, {
            ...previous,
            phase: 'running',
            ...progress,
            providerCalls: priorTotals.providerCalls + Number(progress.providerCalls || 0),
            applied: Number(previous.applied || 0) + Number(progress.boundaryApplied || 0),
            rejected: Number(previous.rejected || 0) + Number(progress.boundaryRejected || 0),
            detail: 'Processed message ' + progress.messageId + ' (' + progress.processedBoundaries + '/' + progress.totalBoundaries + ' boundaries).',
          });
          refreshPanel();
        },
      });
    } catch (error) {
      if (rebuildAbortControllers.get(chatKey) === rebuildController) rebuildAbortControllers.delete(chatKey);
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

    if (rebuildAbortControllers.get(chatKey) === rebuildController) rebuildAbortControllers.delete(chatKey);

    const receipts = Array.isArray(result.receipts) ? result.receipts : [];
    // A resumed run reports the whole rebuild: earlier segments plus this one.
    result.providerCalls = priorTotals.providerCalls + (Number(result.providerCalls) || 0);
    const applied = priorTotals.applied + receipts.reduce((sum, item) => sum + (Number(item?.applied) || 0), 0);
    const rejected = priorTotals.rejected + receipts.reduce((sum, item) => sum + (Number(item?.rejected) || 0), 0);
    const aliasRepairs = priorTotals.aliasRepairs + receipts.reduce((sum, item) => sum + (Number(item?.aliasRepairs) || 0), 0);
    const failedReceipt = receipts.slice().reverse().find(item => item?.messageId === result.failedBoundary) || receipts.at(-1) || null;
    const firstRejection = failedReceipt?.rejections?.[0];
    const failureDetail = String(
      result.errorMessage
      || firstRejection?.reason
      || result.errorCode
      || result.outcome
      || 'rebuild did not complete',
    ).slice(0, 320);

    const cancelledOutcome = result.outcome === 'stale'
      || result.outcome === 'cancelled'
      || result.errorCode === 'WORLD_STATE_ROUTE_CANCELLED';
    // One exact range check for this synchronous stretch (each one re-fingerprints the whole range); the
    // check after the save's await is made again.
    const currentAtEnd = isCurrentExact();
    const resumable = result.outcome === 'failure' && !cancelledOutcome && result.resume && currentAtEnd;
    if (resumable) {
      rebuildResumes.set(chatKey, {
        resume: result.resume,
        totals: { applied, rejected, aliasRepairs, providerCalls: result.providerCalls },
        params: {
          mode,
          startMessageId,
          maxBoundaries,
          includeHiddenMessages,
          bootstrapRecoveryAtStart,
          spatialEnabled: Boolean(settings.spatialEnabled),
          routeKey,
          totalBoundaries: result.plan?.assistantBoundaries ?? totalBoundaries,
          chatLength: chat.length,
        },
      });
    }
    if (result.outcome !== 'completed' || !currentAtEnd) {
      rebuildStatuses.set(chatKey, {
        ...(rebuildStatuses.get(chatKey) || {}),
        phase: cancelledOutcome ? 'cancelled' : 'failed',
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
        outcome: cancelledOutcome ? 'rebuild-cancelled' : 'rebuild-failed',
        code: result.errorCode || (currentAtEnd ? 'WORLD_STATE_REBUILD_INCOMPLETE' : 'WORLD_STATE_REBUILD_STALE'),
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
      notify(
        cancelledOutcome ? 'info' : 'error',
        cancelledOutcome
          ? 'World State Alpha rebuild cancelled' + atBoundary + '. Canonical state was left unchanged.'
          : 'World State Alpha rebuild failed' + atBoundary + ': ' + failureDetail + '. Canonical state was left unchanged.'
            + (resumable ? ' Use Resume from message ' + result.resume.fromMessageId + ' to continue without redoing earlier messages.' : ''),
      );
      return;
    }

    rebuildStatuses.set(chatKey, {
      ...(rebuildStatuses.get(chatKey) || {}),
      phase: 'committing',
      detail: 'Extraction completed; persisting the rebuilt candidate atomically.',
    });
    refreshPanel();

    let rebuildCommitted = null;
    try {
      rebuildCommitted = await persistState(chatKey, result.state, {
        allowBootstrapRecovery: bootstrapRecoveryAtStart && mode === 'full',
      });
    } catch (error) {
      if (await handleServerRevisionConflict(chatKey, error, {
        label: 'rebuild',
        sourceMessageId,
      })) {
        const detail = 'Rebuild candidate was rejected because another session advanced the server state; the latest durable state was rehydrated.';
        rebuildStatuses.set(chatKey, {
          ...(rebuildStatuses.get(chatKey) || {}),
          phase: 'cancelled',
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
          outcome: 'rebuild-cancelled',
          code: 'WORLD_STATE_REVISION_CONFLICT',
          detail,
          providerCalls: result.providerCalls || 0,
          applied,
          rejected,
          aliasRepairs,
          processedBoundaries: result.processedBoundaries || 0,
          totalBoundaries: result.plan?.assistantBoundaries ?? totalBoundaries,
        });
        refreshPanel();
        notify('info', detail);
        return;
      }
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

    if (!isCurrentExact()) {
      if (bootstrapRecoveryAtStart) {
        setCachedState(chatKey, result.state);
        passiveCaptureRebaseCandidates.delete(chatKey);
        forgetBranchContinuations(chatKey);
        let reconcileDetail = 'Recovered baseline was retained because no prior durable baseline existed.';
        try {
          if (currentChatKey() === chatKey) {
            const reconciled = await reconcileCurrentBranch(chatKey, { persistRestore: true });
            reconcileDetail = reconciled?.failClosed
              ? 'Recovered baseline was retained and the changed branch failed closed for explicit recovery.'
              : 'Recovered baseline was retained and reconciled against the latest chat branch.';
          }
        } catch (reconcileError) {
          const detail = String(reconcileError?.message || reconcileError || 'post-recovery reconciliation failed').slice(0, 320);
          const blocked = new Error('World State Alpha preserved the recovered baseline but could not reconcile the changed branch: ' + detail);
          blocked.code = 'WORLD_STATE_BOOTSTRAP_REBUILD_RECONCILE_FAILURE';
          hydrationErrors.set(chatKey, blocked);
          reconcileDetail = blocked.message;
        }

        rebuildStatuses.set(chatKey, {
          ...(rebuildStatuses.get(chatKey) || {}),
          phase: hydrationErrors.has(chatKey) ? 'failed' : 'cancelled',
          detail: reconcileDetail,
          completedAt: Date.now(),
        });
        diagnosticStore.record(chatKey, {
          operationId,
          label: 'rebuild',
          sourceMessageId,
          outcome: hydrationErrors.has(chatKey) ? 'rebuild-persist-failed' : 'rebuild-cancelled',
          code: hydrationErrors.has(chatKey)
            ? 'WORLD_STATE_BOOTSTRAP_REBUILD_RECONCILE_FAILURE'
            : 'WORLD_STATE_BOOTSTRAP_REBUILD_STALE_RETAINED',
          detail: reconcileDetail,
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
          hydrationErrors.has(chatKey) ? 'error' : 'info',
          'World State Alpha Full rebuild became stale during persistence. ' + reconcileDetail,
        );
        return;
      }

      try {
        await persistState(chatKey, state, {
          allowBootstrapRecovery: true,
          expectedPointer: rebuildCommitted,
        });
      } catch (restoreError) {
        const detail = String(restoreError?.message || restoreError || 'stale rebuild compensation failed').slice(0, 320);
        const blocked = new Error('World State Alpha blocked this chat after a stale rebuild write could not be compensated: ' + detail);
        blocked.code = 'WORLD_STATE_REBUILD_STALE_RESTORE_FAILURE';
        hydrationErrors.set(chatKey, blocked);
        rebuildStatuses.set(chatKey, {
          ...(rebuildStatuses.get(chatKey) || {}),
          phase: 'failed',
          detail: blocked.message,
          completedAt: Date.now(),
        });
        diagnosticStore.record(chatKey, {
          operationId,
          label: 'rebuild',
          sourceMessageId,
          outcome: 'rebuild-persist-failed',
          code: blocked.code,
          detail: blocked.message,
          providerCalls: result.providerCalls || 0,
          applied,
          rejected,
          aliasRepairs,
          processedBoundaries: result.processedBoundaries || 0,
          totalBoundaries: result.plan?.assistantBoundaries ?? totalBoundaries,
        });
        clearPrivatePrompt();
        refreshPanel();
        notify('error', blocked.message);
        return;
      }

      rebuildStatuses.set(chatKey, {
        ...(rebuildStatuses.get(chatKey) || {}),
        phase: 'cancelled',
        detail: 'Rebuild became stale during persistence; the previous canonical state was restored.',
        completedAt: Date.now(),
      });
      diagnosticStore.record(chatKey, {
        operationId,
        label: 'rebuild',
        sourceMessageId,
        outcome: 'rebuild-cancelled',
        code: 'WORLD_STATE_REBUILD_STALE',
        detail: 'Rebuild became stale during persistence; the previous canonical state was restored before publication.',
        providerCalls: result.providerCalls || 0,
        applied,
        rejected,
        aliasRepairs,
        processedBoundaries: result.processedBoundaries || 0,
        totalBoundaries: result.plan?.assistantBoundaries ?? totalBoundaries,
      });
      refreshPanel();
      notify('info', 'World State Alpha rebuild became stale during persistence. Previous canonical state was restored.');
      return;
    }

    setCachedState(chatKey, result.state);
    passiveCaptureRebaseCandidates.delete(chatKey);
    forgetBranchContinuations(chatKey);
    const currentCount = (result.state.records || []).filter(record => record?.status === 'active').length;
    const placeCount = resolveEffectiveLocations(result.state.spatial, baseMap).length;
    rebuildStatuses.set(chatKey, {
      ...(rebuildStatuses.get(chatKey) || {}),
      phase: 'completed',
      detail: 'Rebuild completed and persisted.'
        + (includeHiddenMessages && (result.plan?.hiddenMessagesIncluded || 0) > 0
          ? ' Included ' + result.plan.hiddenMessagesIncluded + ' hidden roleplay message' + (result.plan.hiddenMessagesIncluded === 1 ? '.' : 's.')
          : ''),
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
      hiddenMessagesIncluded: result.plan?.hiddenMessagesIncluded || 0,
      hiddenAssistantBoundaries: result.plan?.hiddenAssistantBoundaries || 0,
    });
    await settleReplacedBranch(chatKey);
    updatePrivateInjection();
    refreshPanel();
    notify(
      'success',
      'World State Alpha rebuild completed: '
        + (result.processedBoundaries || 0) + '/' + (result.plan?.assistantBoundaries ?? totalBoundaries)
        + ' boundaries, ' + currentCount + ' current records, ' + placeCount + ' places.'
        + (aliasRepairs ? ' Repaired ' + aliasRepairs + ' provider field alias' + (aliasRepairs === 1 ? '.' : 'es.') : ''),
    );
    for (const warning of Array.isArray(result.warnings) ? result.warnings : []) {
      diagnosticStore.record(chatKey, {
        operationId: operationId + ':warning',
        label: 'rebuild',
        sourceMessageId,
        outcome: 'warning',
        code: warning.code,
        detail: String(warning.message || '').slice(0, 320),
      });
      notify('warning', 'World State Alpha: ' + warning.message);
    }
  }
}

async function applyRecordAction(actionId, payload = {}, expectedChatKey = currentChatKey()) {
  const chatKey = String(expectedChatKey || '');
  if (!chatKey || chatKey === 'no-chat' || currentChatKey() !== chatKey) return;
  if (!['resolve', 'supersede'].includes(actionId)) return;
  return queueChatWork(chatKey, async () => {
    try {
      return await applyRecordActionNow(actionId, payload, chatKey);
    } catch (error) {
      console.error('[World State Alpha] manual lifecycle action failed safely', error);
      if (currentChatKey() === chatKey) {
        notify('error', 'Manual lifecycle correction failed: ' + String(error?.message || 'unexpected error'));
        refreshPanel();
      }
      return null;
    }
  });
}

async function applyRecordActionNow(actionId, payload, chatKey) {
  await ensureChatStateLoaded(chatKey);
  if (hydrationErrors.has(chatKey) || currentChatKey() !== chatKey) return;
  await refreshChatStateFromServer(chatKey, { reason: 'manual-lifecycle' });
  if (hydrationErrors.has(chatKey) || currentChatKey() !== chatKey) return;
  if (bootstrapRequiredChats.has(chatKey)) {
    notifyBootstrapRequiredOnce(chatKey);
    return;
  }

  const branch = extendCurrentBranchFast(chatKey)
    || await reconcileCurrentBranch(chatKey, { persistRestore: true });
  if (currentChatKey() !== chatKey) return;
  if (branch?.failClosed) {
    notify(
      'warning',
      'Manual lifecycle correction was blocked because World State cannot prove the current chat branch. Rebuild from chat before changing history.',
    );
    updatePrivateInjection();
    refreshPanel();
    return;
  }

  const actionIsCurrent = chatHeadGuard(chatKey);
  const state = stateCache.get(chatKey);
  const bulk = Array.isArray(payload?.records);
  const publicRecords = bulk
    ? payload.records
    : (payload?.record && typeof payload.record === 'object' ? [payload.record] : []);
  if (bulk && (!publicRecords.length || publicRecords.length > MANUAL_LIMITS.bulkRecords)) {
    notify('warning', 'Select between 1 and ' + MANUAL_LIMITS.bulkRecords + ' records for a bulk lifecycle correction.');
    return;
  }
  const targets = [];
  const seenRows = new Set();
  let stale = !publicRecords.length;
  for (const publicRecord of publicRecords) {
    const keyMatch = /^row-(\d+)$/.exec(String(publicRecord?.key || ''));
    const rowIndex = keyMatch ? Number(keyMatch[1]) : -1;
    const record = Number.isInteger(rowIndex) && rowIndex >= 0 ? state?.records?.[rowIndex] : null;
    const projectedSummary = String(record?.summary || '').trim().slice(0, 700);
    const expectedCreated = Number.isInteger(publicRecord?.createdAtMessage) ? publicRecord.createdAtMessage : null;
    const actualCreated = Number.isInteger(record?.createdAtMessage) ? record.createdAtMessage : null;
    const expectedChanged = Number.isInteger(publicRecord?.lastChangedMessage) ? publicRecord.lastChangedMessage : null;
    const actualChanged = Number.isInteger(record?.lastChangedMessage) ? record.lastChangedMessage : null;
    if (!record
      || seenRows.has(rowIndex)
      || record.status !== 'active'
      || publicRecord?.status !== 'active'
      || publicRecord?.kind !== record.kind
      || publicRecord?.summary !== projectedSummary
      || expectedCreated !== actualCreated
      || expectedChanged !== actualChanged) {
      stale = true;
      break;
    }
    seenRows.add(rowIndex);
    targets.push(record);
  }

  if (stale) {
    notify(
      'warning',
      bulk
        ? 'The selected World State records changed before the bulk action could run. Reselect them and try again.'
        : 'That World State record changed before the manual action could run. Reopen it and try again.',
    );
    refreshPanel();
    return;
  }
  const record = targets[0];

  const chat = getContext().chat || [];
  if (!chat.length) {
    notify('warning', 'A manual lifecycle correction needs an existing chat message to own the change.');
    return;
  }
  const messageId = chat.length - 1;
  const outcomeLabel = actionId === 'resolve' ? 'resolved' : 'superseded';
  const subject = bulk ? targets.length + ' records' : 'this record';
  const note = window.prompt(
    'Why should ' + subject + ' be marked ' + outcomeLabel + '?\nThis note will be stored as manual evidence.',
    '',
  );
  if (note === null) return;
  if (!String(note).trim()) {
    notify('warning', 'A short reason is required for a manual lifecycle correction.');
    return;
  }

  let historySummary = '';
  if (bulk) {
    const previews = targets.slice(0, 5).map(item => {
      const text = String(item.summary || '').trim();
      return '- ' + (text.length > 100 ? text.slice(0, 97) + '...' : text);
    });
    const more = targets.length > previews.length ? '\n...and ' + (targets.length - previews.length) + ' more' : '';
    if (!window.confirm(
      'Move ' + targets.length + ' records to history as ' + outcomeLabel + '?\nTheir summaries stay unchanged.\n\n'
        + previews.join('\n') + more,
    )) return;
  } else {
    const historySummaryInput = window.prompt(
      'History summary:\nEdit this if the current wording will be misleading after it is marked ' + outcomeLabel + '.',
      record.summary,
    );
    if (historySummaryInput === null) return;
    historySummary = String(historySummaryInput).trim() || record.summary;

    const preview = historySummary.length > 180 ? historySummary.slice(0, 177) + '...' : historySummary;
    if (!window.confirm('Move this record to history as ' + outcomeLabel + '?\n\n' + preview)) return;
  }

  const result = bulk
    ? applyManualLifecycleBatch({
      state,
      chat,
      chatKey,
      messageId,
      action: actionId,
      recordIds: targets.map(item => item.id),
      note: String(note).trim(),
    })
    : applyManualMutation({
      state,
      chat,
      chatKey,
      messageId,
      mutation: {
        action: actionId,
        recordId: record.id,
        summary: historySummary,
      },
      note: String(note).trim(),
    });

  if (result.outcome !== 'applied') {
    notify('error', 'Manual lifecycle correction was rejected: ' + (result.rejected?.[0]?.reason || 'invalid change'));
    return;
  }

  const persisted = await persistGuardedMutation({
    chatKey,
    candidateState: result.state,
    recoveryState: state,
    isCurrent: actionIsCurrent,
    label: 'manual lifecycle',
    sourceMessageId: messageId,
  });
  if (persisted.stale) {
    notify('info', 'Manual lifecycle change was cancelled because the chat branch changed before it could be committed.');
    return;
  }
  setCachedState(chatKey, result.state);
  passiveCaptureRebaseCandidates.delete(chatKey);
  updatePrivateInjection();
  refreshPanel();
  notify(
    'success',
    bulk
      ? 'Moved ' + targets.length + ' World State records to history as ' + outcomeLabel + '.'
      : 'Moved World State record to history as ' + outcomeLabel + '.',
  );
}

async function applySpatialAction(actionId, payload = {}, expectedChatKey = currentChatKey()) {
  const chatKey = String(expectedChatKey || '');
  if (!chatKey || chatKey === 'no-chat' || currentChatKey() !== chatKey) return;
  // Same as Import: pick the base-map file before queueing, never from inside the chat queue.
  if (actionId === 'import_base_map') {
    const file = await chooseImportFile();
    if (!file || currentChatKey() !== chatKey) return;
    payload = { ...payload, file };
  }
  return queueChatWork(chatKey, () => applySpatialActionNow(actionId, payload, chatKey))
    .catch(error => actionFailed('Places edit', error, chatKey));
}

async function applySpatialActionNow(actionId, payload, chatKey) {
  await ensureChatStateLoaded(chatKey);
  if (hydrationErrors.has(chatKey) || currentChatKey() !== chatKey) return;
  await refreshChatStateFromServer(chatKey, { reason: 'spatial-' + actionId });
  if (hydrationErrors.has(chatKey) || currentChatKey() !== chatKey) return;
  if (bootstrapRequiredChats.has(chatKey)) {
    notifyBootstrapRequiredOnce(chatKey);
    return;
  }
  const branch = extendCurrentBranchFast(chatKey)
    || await reconcileCurrentBranch(chatKey, { persistRestore: true });
  if (currentChatKey() !== chatKey) return;
  if (branch?.failClosed) {
    notify('warning', 'Spatial edit was blocked because World State cannot prove the current chat branch. Rebuild from chat before editing Places.');
    updatePrivateInjection();
    refreshPanel();
    return;
  }
  const actionIsCurrent = chatHeadGuard(chatKey);
  const state = stateCache.get(chatKey);
  const baseMap = await getChatBaseMap(chatKey, state);
  if (currentChatKey() !== chatKey || hydrationErrors.has(chatKey)) return;
  const chat = getContext().chat || [];
  const messageId = chat.length ? chat.length - 1 : null;

  // The panel's place projection carries display fields only; coordinates come from canonical state
  // (the effective location, base map included), never from the click payload.
  const effectiveLocations = currentState => resolveEffectiveLocations(currentState.spatial, baseMap);
  const currentLocationCoordinate = location => {
    const effective = effectiveLocations(state)
      .find(item => item.id === location?.id || (location?.overrideId && item.overrideId === location.overrideId));
    return effective?.coordinate ? { ...effective.coordinate } : {};
  };

  const persistSpatialState = async (nextState, message) => {
    const persisted = await persistGuardedMutation({
      chatKey,
      candidateState: nextState,
      recoveryState: state,
      isCurrent: actionIsCurrent,
      label: 'spatial edit',
      sourceMessageId: messageId,
    });
    if (persisted.stale) {
      notify('info', 'Spatial edit was cancelled because the chat branch changed before it could be committed.');
      return false;
    }
    setCachedState(chatKey, nextState);
    updatePrivateInjection();
    refreshPanel();
    if (message) notify('success', message);
    return true;
  };

  // `stepBaseMap` is the map the steps apply against (attaching a base map passes the new one).
  const applySequence = (initialState, steps, stepBaseMap = baseMap) => {
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
        baseMap: stepBaseMap,
      });
      if (res.outcome !== 'applied') {
        return { outcome: 'rejected', state: initialState, rejected: res.rejected || [] };
      }
      working = res.state;
      combined.push(...(res.applied || []));
    }
    return { outcome: 'applied', state: working, applied: combined };
  };

  // Names are compared as capture and the reducer compare them (case, punctuation and spacing folded).
  const findEffectiveByName = (currentState, name) => {
    const needle = placeNameKey(name);
    if (!needle) return null;
    return effectiveLocations(currentState)
      .find(loc => loc.status !== 'archived' && placeNameKey(loc.name) === needle) || null;
  };

  const derivedCoordinateLocations = currentState =>
    (currentState?.spatial?.locations || []).filter(location =>
      location?.coordinate?.authority === 'derived'
        && Number.isFinite(location.coordinate.x)
        && Number.isFinite(location.coordinate.y)
    );

  const profileMathSignature = profile => stableStringify(profile ? {
    system: profile.system || 'cartesian2d',
    northAxis: profile.northAxis || '+y',
    eastAxis: profile.eastAxis || '+x',
    unitKm: Number.isFinite(profile.unitKm) ? profile.unitKm : null,
    bounds: profile.bounds || null,
    decimalStep: Number.isFinite(profile.decimalStep) ? profile.decimalStep : 0.1,
  } : null);

  const applyManualProfile = async (profile, label) => {
    if (state.spatial?.baseMapRef?.id) {
      notify('warning', 'Coordinate Profile is defined by the attached base map. Detach it before editing the profile.');
      return;
    }

    const currentProfile = resolveSpatialProfile(state.spatial, null);
    const mathChanged = profileMathSignature(currentProfile) !== profileMathSignature(profile);
    const derived = derivedCoordinateLocations(state);
    const clearDerivedCoordinates = mathChanged && derived.length > 0;
    if (clearDerivedCoordinates) {
      const confirmed = window.confirm(
        'Changing this Coordinate Profile invalidates ' + derived.length + ' derived coordinate' +
        (derived.length === 1 ? '' : 's') +
        '. Continue? Those derived coordinates will be cleared to unknown so they can be rebuilt safely.',
      );
      if (!confirmed) return;
    }

    const res = applySpatialManualMutation({
      state,
      chat,
      chatKey,
      messageId,
      mutation: {
        action: 'set_profile',
        profile,
        clearDerivedCoordinates,
      },
      note: label,
      baseMap: null,
    });
    if (res.outcome === 'applied') {
      return await persistSpatialState(
        res.state,
        clearDerivedCoordinates
          ? label + ' and cleared ' + derived.length + ' stale derived coordinate' + (derived.length === 1 ? '' : 's')
          : label,
      );
    } else {
      notify('error', 'Coordinate Profile update was rejected: ' + (res.rejected?.[0]?.reason || 'invalid profile'));
    }
  };

  if (actionId === 'save_profile') {
    let profile;
    try {
      profile = normalizeSpatialProfile(payload.profileData, { strict: true });
    } catch (error) {
      notify('error', 'Invalid Coordinate Profile: ' + String(error?.message || error));
      return;
    }
    return await applyManualProfile(profile, 'Saved manual Coordinate Profile');
  }

  if (actionId === 'reset_profile') {
    const reset = normalizeSpatialProfile({
      system: 'cartesian2d',
      northAxis: '+y',
      eastAxis: '+x',
      unitKm: null,
      bounds: null,
      decimalStep: 0.1,
      trueNorthLocked: true,
    }, { strict: true });
    // true only once the reset is saved: a declined or failed reset keeps the operator's typed values.
    return await applyManualProfile(reset, 'Reset manual Coordinate Profile');
  }

  if (actionId === 'add_location_modal') {
    const name = window.prompt('Location name:');
    if (!name?.trim()) return;
    // The reducer consolidates a nameless-id upsert onto an active campaign place with the same name, so
    // adding that name would silently overwrite its type, context and coordinates. Refuse instead (a
    // base-map name is never merged into, so a campaign place may still share it).
    const existingPlace = (state.spatial?.locations || [])
      .find(item => item.status === 'active' && placeNameKey(item.name) === placeNameKey(name));
    if (existingPlace) {
      notify('warning', 'A place named ' + existingPlace.name + ' already exists. Open it in Places to edit it instead.');
      return;
    }
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
    } else {
      notify('error', 'Campaign override was not created: ' + (res.rejected?.[0]?.reason || 'rejected'));
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
    const priorCoord = currentLocationCoordinate(payload.location);
    const priorX = Number.isFinite(priorCoord.x) ? priorCoord.x : null;
    const priorY = Number.isFinite(priorCoord.y) ? priorCoord.y : null;
    const nextLocked = Boolean(fd.locked && fd.x !== null);
    // A position the operator typed is theirs: the Authority select still showing the place's previous label
    // (or a label that cannot hold a position) does not make it rank below derivation or narration.
    const positionTyped = fd.x !== null && (fd.x !== priorX || fd.y !== priorY);
    let nextAuthority = fd.authority || (fd.x === null ? 'unknown' : 'manual');
    if (fd.x !== null && (['unknown', 'relative'].includes(nextAuthority)
      || (positionTyped && nextAuthority === String(priorCoord.authority || 'unknown')))) nextAuthority = 'manual';
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

    let relationId = String(fd.relationId || '').trim();
    let anchorName = String(fd.relativeAnchor || '').trim();
    // The form shows the place's first relation. Left as it was, that relation is kept untouched, even when
    // its other place is archived (which a name lookup would no longer find).
    const shownRelation = payload.location.primaryRelation || {};
    const sameNumber = (left, right) => (Number.isFinite(left) ? left : null) === (Number.isFinite(right) ? right : null);
    const keptAnchor = relationId && shownRelation.anchorId && anchorName === String(shownRelation.anchorName || '').trim()
      ? shownRelation.anchorId
      : '';
    if (keptAnchor && (fd.direction || '') === (shownRelation.direction || '')
      && sameNumber(fd.distanceKm, shownRelation.distanceKm)
      && (fd.distanceMode || 'unspecified') === (shownRelation.distanceMode || 'unspecified')) {
      relationId = '';
      anchorName = '';
    }
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
      const anchor = keptAnchor ? { id: keptAnchor } : findEffectiveByName(afterLocation.state, anchorName);
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
      // The panel leaves edit mode (dropping the draft) only once the save is committed.
      return await persistSpatialState(res.state, 'Saved location ' + (fd.name || payload.location.name));
    }
    notify('error', 'Spatial update rejected: ' + (res.rejected?.[0]?.reason || 'invalid edit'));
    return false;
  }

  if (actionId === 'toggle_lock' && payload.location) {
    const curCoord = currentLocationCoordinate(payload.location);
    if (!Number.isFinite(curCoord.x) || !Number.isFinite(curCoord.y)) {
      notify('error', 'This place has no coordinates to lock.');
      return;
    }
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
    } else {
      notify('error', 'Coordinate lock change rejected: ' + (res.rejected?.[0]?.reason || 'invalid edit'));
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
    } else {
      notify('error', 'Archive rejected: ' + (res.rejected?.[0]?.reason || 'invalid archive'));
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
    const normalName = placeNameKey;
    const sameName = (left, right) => normalName(left) === normalName(right);
    const suggested = [...new Set((Array.isArray(payload.mergeSuggestions) ? payload.mergeSuggestions : [])
      .map(item => candidates.find(loc => loc.id === item?.id))
      .filter(Boolean))];
    const listed = [...new Set([...suggested, ...candidates])].slice(0, 12);
    const targetName = window.prompt(
      'Merge "' + payload.location.name + '" into which campaign location? Its routes, evidence, and relations move to the target and it is archived.\n' +
        listed.map(loc => '- ' + loc.name + (suggested.includes(loc) ? '  (possible duplicate)' : '')).join('\n') +
        (candidates.length > listed.length ? '\n…and ' + (candidates.length - listed.length) + ' more (type the exact name)' : ''),
      suggested[0]?.name || '',
    );
    if (!targetName?.trim()) return;
    const target = suggested.find(loc => sameName(loc.name, targetName))
      || candidates.find(loc => sameName(loc.name, targetName));
    if (!target) {
      notify('error', 'Merge target not found among active campaign locations: ' + targetName.trim());
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
    } else {
      notify('error', 'Merge rejected: ' + (res.rejected?.[0]?.reason || 'invalid merge'));
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
    } else {
      notify('error', 'Delete rejected: ' + (res.rejected?.[0]?.reason || 'invalid delete'));
    }
    return;
  }

  if (actionId === 'import_base_map') {
    const startEpoch = epoch(chatKey);
    const file = payload?.file;
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
    settings.spatialBaseMaps[stored.pointer.id] = stored.pointer;
    persistHostSettings();
    cacheBaseMap(baseMapCacheKey(stored.pointer), stored.baseMap);

    const priorProfile = resolveSpatialProfile(state.spatial, null);
    const nextProfile = stored.baseMap.profile ? normalizeSpatialProfile(stored.baseMap.profile, { strict: true }) : null;
    const profileMathChanged = profileMathSignature(priorProfile) !== profileMathSignature(nextProfile);
    const derived = derivedCoordinateLocations(state);
    const clearDerivedCoordinates = profileMathChanged && derived.length > 0;
    if (clearDerivedCoordinates && !window.confirm(
      'This base map uses a different Coordinate Profile. Attaching it will clear ' + derived.length +
      ' derived coordinate' + (derived.length === 1 ? '' : 's') + ' so stale geometry cannot survive. Continue?',
    )) return;

    const steps = [
      {
        mutation: {
          action: 'set_profile',
          profile: nextProfile,
          clearDerivedCoordinates,
        },
        note: 'Adopted base-map Coordinate Profile',
      },
      {
        mutation: { action: 'set_base_map_ref', baseMapRef: stored.pointer },
        note: 'Attached base map ' + stored.baseMap.name,
      },
    ];
    const res = applySequence(state, steps, stored.baseMap);
    if (res.outcome === 'applied') {
      await persistSpatialState(res.state, 'Base map attached: ' + stored.baseMap.name);
    } else {
      notify('error', 'Base map was not attached: ' + (res.rejected?.[0]?.reason || 'rejected'));
    }
    return;
  }

  if (actionId === 'detach_base_map') {
    if (!window.confirm('Detach base map from this campaign? Campaign locations will be preserved and the current base-map Coordinate Profile will become the manual profile.')) return;
    const steps = [];
    if (baseMap) {
      steps.push({
        mutation: { action: 'set_profile', profile: resolveSpatialProfile(state.spatial, baseMap) },
        note: 'Preserved detached base-map Coordinate Profile as manual profile',
      });
    }
    steps.push({
      mutation: { action: 'set_base_map_ref', baseMapRef: null },
      note: 'Detached base map',
    });
    const res = applySequence(state, steps);
    if (res.outcome === 'applied') {
      await persistSpatialState(res.state);
      notify('info', 'Base map detached. Coordinate Profile is now manual.');
    } else {
      notify('error', 'Base map was not detached: ' + (res.rejected?.[0]?.reason || 'rejected'));
    }
  }
}

export async function openWorldStatePanel() {
  if (!hostHydrationReady) {
    notify('warning', 'World State Alpha is waiting for SillyTavern settings/storage to finish loading.');
    return false;
  }
  const chatKey = currentChatKey();
  if (chatKey === 'no-chat') {
    notify('warning', 'Open a chat before opening World State Alpha.');
    return false;
  }
  try {
    await ensureChatStateLoaded(chatKey);
    await refreshChatStateFromServer(chatKey, { reason: 'panel-open' });
    void refreshOperationLogFromServer(chatKey);
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
    // The panel only reads it (its model is built from a private copy), so the cached state is passed as is.
    getState: () => {
      const state = stateCache.get(chatKey);
      if (state) touchChatCache(chatKey);
      return state || createState(chatKey);
    },
    getChatKey: () => chatKey,
    getBaseMap: () => getCachedBaseMap(stateCache.get(chatKey)?.spatial?.baseMapRef),
    getDiagnostics: () => diagnosticStore.records(chatKey),
    getRuntimeInfo: () => {
      const chat = getContext().chat || [];
      return {
        chatMessages: chat.length,
        earliestPartialStart: earliestPartialRebuildStart(stateCache.get(chatKey)),
        assistantBoundaries: chat.filter(message => messageRole(message) === 'assistant' && messageText(message).trim()).length,
        defaultRebuildBoundaries: REBUILD_LIMITS.maxBoundaries,
        maxRebuildBoundaries: 4096,
        spatialEnabled: Boolean(getWorldStateSettings().spatialEnabled),
        hostHydrationReady,
        hydrationSource: hydrationSources.get(chatKey) || '',
        bootstrapRequired: bootstrapRequiredChats.has(chatKey),
        rebuildStatus: rebuildStatuses.get(chatKey) ? clone(rebuildStatuses.get(chatKey)) : null,
        captureFailures: pendingCaptureFailures(chatKey),
        rebuildResume: (saved => (saved
          ? {
            messageId: saved.resume.fromMessageId,
            processedBoundaries: saved.resume.processedBoundaries,
            totalBoundaries: saved.params.totalBoundaries,
          }
          : null))(rebuildResumes.get(chatKey)),
      };
    },
    onMaintenanceAction: (actionId, payload) => applyMaintenanceAction(actionId, payload, chatKey),
    onRecordAction: (actionId, payload) => applyRecordAction(actionId, payload, chatKey),
    onSpatialAction: (actionId, payload) => applySpatialAction(actionId, payload, chatKey),
    onClose: closeWorldStatePanel,
  });
  return true;
}

function registerEvents() {
  if (eventsRegistered) return true;
  const ctx = getContext();
  const events = ctx?.eventTypes || ctx?.event_types || {};
  const source = ctx?.eventSource;
  if (!source?.on || !events.MESSAGE_RECEIVED || !events.CHAT_CHANGED) return false;
  eventsRegistered = true;

  // Counted first: SillyTavern runs listeners in order and waits on each, and a later handler can wait
  // behind a running rebuild whose cached range proof this count invalidates.
  for (const name of ['MESSAGE_SENT', 'MESSAGE_RECEIVED', 'MESSAGE_EDITED', 'MESSAGE_DELETED', 'MESSAGE_SWIPED', 'MESSAGE_SWIPE_DELETED']) {
    if (events[name]) source.on(events[name], () => noteChatEvent());
  }

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
    if (events[name]) source.on(events[name], () => handleBranchChange(name));
  }
  return true;
}

function ensureEventRegistration() {
  if (registerEvents()) {
    eventRegistrationRetryAttempts = 0;
    if (eventRegistrationRetryTimer !== null) {
      clearTimeout(eventRegistrationRetryTimer);
      eventRegistrationRetryTimer = null;
    }
    return true;
  }
  if (eventRegistrationRetryTimer !== null || eventRegistrationRetryAttempts >= 20) return false;
  eventRegistrationRetryAttempts += 1;
  eventRegistrationRetryTimer = setTimeout(() => {
    eventRegistrationRetryTimer = null;
    ensureEventRegistration();
  }, 250);
  return false;
}

async function init({ hostReady = false, recheckFresh = false } = {}) {
  ensureEventRegistration();
  if (hostReady) {
    hostHydrationReady = true;
    if (hostReadinessFallbackTimer !== null) {
      clearInterval(hostReadinessFallbackTimer);
      hostReadinessFallbackTimer = null;
    }
  }
  if (recheckFresh) extensionSettingsReady = true;

  if (!initialized) {
    initialized = true;
    bindSettingsEvents();
  }

  // DOM ready is intentionally shell-only. Hydration waits for APP_READY or
  // EXTENSION_SETTINGS_LOADED so an early /user/files miss cannot be accepted
  // as a new campaign and cached for the rest of the browser session.
  if (!hostHydrationReady) return;

  getWorldStateSettings();
  scheduleSettingsMount();
  syncFloatingLauncher();

  await activateCurrentChat();

  if (!loadedLogWritten) {
    loadedLogWritten = true;
    console.log('[World State Alpha] v' + WORLD_STATE_ALPHA_VERSION + ' loaded');
  }
}

function hostReadinessFallbackSignal() {
  if (!globalThis.document?.querySelector) return false;
  return Boolean(
    document.querySelector('#extensions_settings2')
    || document.querySelector('#extensions_settings')
    || document.querySelector('#extensionsMenu')
  );
}

function scheduleHostHydrationReadinessFallback() {
  if (hostHydrationReady || hostReadinessFallbackTimer !== null || !globalThis.document) return;
  hostReadinessFallbackAttempts = 0;
  hostReadinessFallbackTimer = setInterval(() => {
    hostReadinessFallbackAttempts += 1;
    if (hostReadinessFallbackSignal()) {
      clearInterval(hostReadinessFallbackTimer);
      hostReadinessFallbackTimer = null;
      void safeInit({ hostReady: true, recheckFresh: true });
      return;
    }
    if (hostReadinessFallbackAttempts >= 40) {
      clearInterval(hostReadinessFallbackTimer);
      hostReadinessFallbackTimer = null;
      console.warn('[World State Alpha] SillyTavern host readiness was not observed; canonical hydration remains paused.');
    }
  }, 250);
}

async function safeInit(options = {}) {
  try {
    await init(options);
  } catch (error) {
    console.error('[World State Alpha] initialization/hydration failed safely', error);
    clearPrivatePrompt();
    refreshPanel();
  }
}

function bootstrapFromDomReady() {
  void safeInit();
  scheduleHostHydrationReadinessFallback();
}

if (globalThis.document?.readyState === 'loading') {
  globalThis.document.addEventListener('DOMContentLoaded', bootstrapFromDomReady, { once: true });
} else {
  queueMicrotask(bootstrapFromDomReady);
}

try {
  const ctx = getContext();
  const events = ctx?.eventTypes || ctx?.event_types || {};
  if (ctx?.eventSource?.on) {
    if (events.APP_READY) {
      ctx.eventSource.on(events.APP_READY, () => void safeInit({ hostReady: true }));
    }
    if (events.EXTENSION_SETTINGS_LOADED) {
      ctx.eventSource.on(
        events.EXTENSION_SETTINGS_LOADED,
        () => void safeInit({ hostReady: true, recheckFresh: true }),
      );
    }
  }
} catch (error) {
  console.debug('[World State Alpha] lifecycle bootstrap will rely on DOM ready and registered chat events.', error);
}

globalThis.WorldStateAlpha = Object.freeze({
  version: WORLD_STATE_ALPHA_VERSION,
  open: openWorldStatePanel,
  status: () => {
    const key = currentChatKey();
    return Object.freeze({
      hostHydrationReady,
      extensionSettingsReady,
      chatReady: key !== 'no-chat' && loadedChats.has(key) && !hydrationErrors.has(key),
      hydrationError: hydrationErrors.get(key)?.message || null,
      hydrationSource: hydrationSources.get(key) || '',
      hydratedRevision: Number(hydratedPointerFor(key)?.revision || 0),
      observedServerRevision: Number(observedServerPointerFor(key)?.revision || 0),
      provisionalFresh: provisionalFreshChats.has(key),
      bootstrapRequired: bootstrapRequiredChats.has(key),
      panelOpen: Boolean(panelRoot?.isConnected),
      diagnostics: diagnosticStore.records(key).length,
    });
  },
  // A private deep copy (getCachedState already copies; copying it again doubled the cost).
  getState: () => getCachedState(currentChatKey()),
  diagnostics: () => diagnosticStore.records(currentChatKey()),
});

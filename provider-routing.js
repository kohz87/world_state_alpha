export const WORLD_STATE_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
export const WORLD_STATE_OUTPUT_TOKENS_MIN = 128;
export const WORLD_STATE_OUTPUT_TOKENS_MAX = 12000;

const inflight = new Map();
let sequence = 0;

export function normalizeWorldStateMaxOutputTokens(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.max(WORLD_STATE_OUTPUT_TOKENS_MIN, Math.min(WORLD_STATE_OUTPUT_TOKENS_MAX, Math.round(number)));
}

export function selectedWorldStateProfileId(ctx) {
  const value = ctx?.extensionSettings?.world_state_alpha?.connectionProfile;
  return typeof value === 'string' ? value.trim() : '';
}

export function worldStateProfileOptions(ctx, selected = selectedWorldStateProfileId(ctx)) {
  const options = [{ id: '', name: 'Use current roleplay connection' }];
  const service = ctx?.ConnectionManagerRequestService;
  const profiles = ctx?.extensionSettings?.connectionManager?.profiles;
  if (!connectionManagerDisabled(ctx) && Array.isArray(profiles)) {
    for (const profile of profiles) {
      if (typeof profile?.id !== 'string' || !profile.id.trim()) continue;
      try {
        if (typeof service?.isProfileSupported === 'function' && !service.isProfileSupported(profile)) continue;
      } catch {
        continue;
      }
      if (!options.some(option => option.id === profile.id)) {
        options.push({ id: profile.id, name: String(profile.name || profile.id) });
      }
    }
  }
  if (selected && !options.some(option => option.id === selected)) {
    options.push({ id: selected, name: `Unavailable profile (${selected})` });
  }
  return options;
}

export function configuredWorldStateMaxOutputTokens(ctx) {
  return normalizeWorldStateMaxOutputTokens(ctx?.extensionSettings?.world_state_alpha?.maxOutputTokens);
}

export function worldStateRoutingError(message, code = 'WORLD_STATE_PROFILE_UNAVAILABLE') {
  const error = new Error(`World State Alpha: ${message}`);
  error.name = 'WorldStateRoutingError';
  error.code = code;
  return error;
}

export function isWorldStateRoutingError(error) {
  return error?.name === 'WorldStateRoutingError';
}

function stoppedError(timeout = false) {
  return worldStateRoutingError(
    timeout ? 'The World State request timed out.' : 'The World State request was cancelled or became stale.',
    timeout ? 'WORLD_STATE_ROUTE_TIMEOUT' : 'WORLD_STATE_ROUTE_CANCELLED',
  );
}

function connectionManagerDisabled(ctx) {
  return ctx?.extensionSettings?.disabledExtensions?.includes?.('connection-manager') === true;
}

async function profileService(ctx) {
  if (connectionManagerDisabled(ctx)) {
    throw worldStateRoutingError('Connection Profiles is disabled; no fallback was used.');
  }
  if (typeof ctx?.ConnectionManagerRequestService?.sendRequest === 'function') {
    return ctx.ConnectionManagerRequestService;
  }
  try {
    const { ConnectionManagerRequestService } = await import('../../shared.js');
    if (typeof ConnectionManagerRequestService?.sendRequest === 'function') return ConnectionManagerRequestService;
  } catch {
    // Normalize host API availability without copying credentials or changing host settings.
  }
  throw worldStateRoutingError('Connection Manager request service is unavailable; no fallback was used.');
}

function profileSignature(profile) {
  const canonical = value => Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
      : value;
  return JSON.stringify(canonical(profile));
}

function requestMessages(options) {
  const messages = [];
  if (options.systemPrompt) messages.push({ role: 'system', content: String(options.systemPrompt) });
  messages.push({ role: 'user', content: String(options.prompt ?? '') });
  if (options.prefill) messages.push({ role: 'assistant', content: String(options.prefill) });
  return messages;
}

function receipt(record, outcome, code, finishedAt = Date.now()) {
  return {
    requestId: record.id,
    label: record.label,
    route: record.route,
    profileId: record.profileId,
    dispatched: record.sent,
    outcome,
    code,
    requestedResponseLength: record.requestedResponseLength,
    effectiveResponseLength: record.effectiveResponseLength,
    outputOverrideConfigured: record.outputOverrideConfigured,
    durationMs: Math.max(0, finishedAt - record.startedAt),
  };
}

export async function dispatchWorldStateRequest(ctx, options = {}, scope = {}) {
  const route = scope.route || {
    profileId: scope.profileId === undefined ? selectedWorldStateProfileId(ctx) : scope.profileId,
  };
  const profileId = String(route.profileId || '').trim();
  if (route.maxOutputTokens === undefined) route.maxOutputTokens = configuredWorldStateMaxOutputTokens(ctx);
  const configuredMax = normalizeWorldStateMaxOutputTokens(route.maxOutputTokens);
  const requestedResponseLength = Math.max(1, Math.round(Number(options.responseLength) || 2048));
  const effectiveResponseLength = configuredMax || requestedResponseLength;
  const routedOptions = configuredMax ? { ...options, responseLength: effectiveResponseLength } : options;

  const record = {
    id: ++sequence,
    label: String(scope.label || 'world state request').slice(0, 120),
    route: profileId ? 'profile' : 'default',
    profileId,
    chatKey: String(scope.chatKey || ''),
    operationId: scope.operationId ?? null,
    requestedResponseLength,
    effectiveResponseLength,
    outputOverrideConfigured: configuredMax > 0,
    startedAt: Date.now(),
    sent: false,
  };

  const controller = new AbortController();
  let stop = null;
  let rejectStop;
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  void stopped.catch(() => {});

  const cancel = (timeout = false) => {
    if (stop) return;
    stop = stoppedError(timeout);
    rejectStop(stop);
    controller.abort(stop);
  };
  const onAbort = () => cancel(scope.signal?.reason?.code === 'WORLD_STATE_ROUTE_TIMEOUT');
  const assertCurrent = () => {
    if (scope.signal?.aborted) onAbort();
    if (!stop && typeof scope.isCurrent === 'function' && !scope.isCurrent()) cancel(false);
    if (stop) throw stop;
  };

  const timeoutMs = Math.max(1, Math.min(30 * 60 * 1000, Number(scope.timeoutMs) || WORLD_STATE_REQUEST_TIMEOUT_MS));
  const remainingMs = Number.isFinite(scope.deadline) ? Math.min(timeoutMs, scope.deadline - Date.now()) : timeoutMs;
  let timer = null;
  inflight.set(record.id, { record, cancel, controller });
  scope.signal?.addEventListener?.('abort', onAbort, { once: true });
  if (remainingMs <= 0) cancel(true);
  else timer = setTimeout(() => cancel(true), remainingMs);

  try {
    assertCurrent();
    let invoke;
    let verifyProfile = () => {};

    if (!profileId) {
      if (typeof ctx?.generateRaw !== 'function') {
        throw worldStateRoutingError('Host generateRaw() is unavailable.', 'WORLD_STATE_DEFAULT_UNAVAILABLE');
      }
      invoke = configuredMax ? () => ctx.generateRaw(routedOptions) : () => ctx.generateRaw(options);
    } else {
      const service = await Promise.race([profileService(ctx), stopped]);
      assertCurrent();
      let profile;
      try {
        profile = typeof service.getProfile === 'function'
          ? service.getProfile(profileId)
          : ctx?.extensionSettings?.connectionManager?.profiles?.find(item => item?.id === profileId);
      } catch {
        profile = null;
      }
      if (!profile || String(profile.id || '') !== profileId) {
        throw worldStateRoutingError(`Selected profile "${profileId}" is missing; no fallback was used.`);
      }
      let supported = true;
      try {
        if (typeof service.isProfileSupported === 'function') supported = service.isProfileSupported(profile);
      } catch {
        supported = false;
      }
      if (!supported) throw worldStateRoutingError('Selected profile is not supported for text generation; no fallback was used.');

      const signature = profileSignature(profile);
      if (route.signature !== undefined && route.signature !== signature) {
        throw worldStateRoutingError('Selected profile changed during the operation.', 'WORLD_STATE_PROFILE_CHANGED');
      }
      route.signature = signature;
      verifyProfile = () => {
        let current = null;
        try {
          current = typeof service.getProfile === 'function'
            ? service.getProfile(profileId)
            : ctx?.extensionSettings?.connectionManager?.profiles?.find(item => item?.id === profileId);
        } catch {
          current = null;
        }
        if (connectionManagerDisabled(ctx) || !current || profileSignature(current) !== signature) {
          throw worldStateRoutingError('Selected profile changed or disappeared during the operation.', 'WORLD_STATE_PROFILE_CHANGED');
        }
      };
      invoke = () => service.sendRequest(profileId, requestMessages(routedOptions), effectiveResponseLength, {
        stream: false,
        signal: controller.signal,
        extractData: true,
        includePreset: true,
        includeInstruct: true,
      });
    }

    assertCurrent();
    record.sent = true;
    const response = await Promise.race([invoke(), stopped]);
    assertCurrent();
    verifyProfile();

    let value = response;
    if (profileId) value = typeof response === 'string' ? response : response?.content;
    if (typeof value !== 'string') {
      throw worldStateRoutingError('Provider returned no text content.', 'WORLD_STATE_PROVIDER_RESPONSE');
    }
    return { text: value, receipt: receipt(record, 'success', '') };
  } catch (cause) {
    const error = stop || (isWorldStateRoutingError(cause)
      ? cause
      : cause?.name === 'AbortError'
        ? stoppedError(false)
        : profileId
          ? worldStateRoutingError('Connection Profile request failed; no fallback was used.', 'WORLD_STATE_PROFILE_REQUEST_FAILED')
          : cause);
    const code = String(error?.code || 'PROVIDER_ERROR');
    error.receipt = receipt(
      record,
      code === 'WORLD_STATE_ROUTE_TIMEOUT' ? 'timeout'
        : code === 'WORLD_STATE_ROUTE_CANCELLED' ? 'cancelled'
          : 'failure',
      code,
    );
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    scope.signal?.removeEventListener?.('abort', onAbort);
    inflight.delete(record.id);
  }
}

export function cancelWorldStateRequests({ chatKey, operationId, timedOut = false } = {}) {
  let count = 0;
  for (const entry of inflight.values()) {
    if (chatKey !== undefined && entry.record.chatKey !== chatKey) continue;
    if (operationId !== undefined && entry.record.operationId !== operationId) continue;
    if (entry.controller.signal.aborted) continue;
    entry.cancel(timedOut);
    count += 1;
  }
  return count;
}

export function worldStateInflightCount() {
  return inflight.size;
}

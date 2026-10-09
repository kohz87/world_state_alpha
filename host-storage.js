import { decodeSidecar } from './storage.js';

export const WORLD_STATE_HOST_FILE_PREFIX = 'world-state-alpha-';

const writerQueues = new Map();

async function withInProcessWriterLock(key, task) {
  const previous = writerQueues.get(key) || Promise.resolve();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const queued = previous.catch(() => {}).then(() => gate);
  writerQueues.set(key, queued);
  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (writerQueues.get(key) === queued) writerQueues.delete(key);
  }
}

function webLocksAvailable() {
  return typeof globalThis.navigator?.locks?.request === 'function';
}

async function withWriterLock(key, task) {
  const lockName = 'world-state-alpha-sidecar:' + worldStateHostFileName(key);
  const locks = globalThis.navigator?.locks;
  if (locks && typeof locks.request === 'function') {
    return locks.request(lockName, { mode: 'exclusive' }, () => withInProcessWriterLock(lockName, task));
  }
  return withInProcessWriterLock(lockName, task);
}

// Serializes read-modify-write of one World State file across tabs (Web Locks)
// and within this page.
export function withWorldStateFileLock(path, task) {
  return withWriterLock(path, task);
}

function text(value) {
  return String(value ?? '').trim();
}

function bytesToBase64(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const chunkSize = 0x8000;
  const parts = [];
  for (let offset = 0; offset < input.length; offset += chunkSize) {
    const chunk = input.subarray(offset, Math.min(offset + chunkSize, input.length));
    parts.push(String.fromCharCode.apply(null, chunk));
  }
  return globalThis.btoa(parts.join(''));
}

export function worldStateHostFileName(path) {
  const logical = text(path);
  const leaf = (logical.split('/').pop() || 'state.json')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 160) || 'state.json';
  return leaf.startsWith(WORLD_STATE_HOST_FILE_PREFIX)
    ? leaf
    : WORLD_STATE_HOST_FILE_PREFIX + leaf;
}

export function worldStateHostDeterministicPath(path) {
  return '/user/files/' + worldStateHostFileName(path);
}

function isLogicalPath(path) {
  return /^world_state_alpha\//.test(text(path));
}

function headersValue(headers, headersFn) {
  const value = typeof headersFn === 'function' ? headersFn() : headers;
  return value && typeof value === 'object' ? value : {};
}

// A request that never got an HTTP answer (connection reset, offline) is retryable: a save retried this way
// finds its own body already on the server when the upload landed and only the response was lost.
async function reach(fetchFn, url, init) {
  try {
    return await fetchFn(url, init);
  } catch (cause) {
    if (cause?.name === 'AbortError') throw cause;
    const error = new Error('World State Alpha could not reach the server: ' + String(cause?.message || cause || 'network error') + '.');
    error.cause = cause;
    error.code = 'WORLD_STATE_NETWORK_ERROR';
    error.retryable = true;
    throw error;
  }
}

// Every request and its body read finish within a deadline the extension sets, so a request that never
// settles cannot hold a writer lock (and every save queued behind it) open. On expiry the request is aborted
// and the error is retryable: an upload's outcome is then unknown, and the retry reads the file back first
// (an upload that landed is recognised by its own body, never written twice).
export const WORLD_STATE_STORAGE_DEADLINES = Object.freeze({ readMs: 30000, uploadMs: 60000 });

async function withDeadline(ms, label, operation) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const expired = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller?.abort();
      const error = new Error('World State Alpha ' + label + ' did not finish within ' + Math.round(ms / 1000) + ' seconds.');
      error.code = 'WORLD_STATE_STORAGE_TIMEOUT';
      error.retryable = true;
      error.outcomeUnknown = label === 'file write';
      reject(error);
    }, ms);
  });
  const work = operation(controller?.signal);
  // A late settlement after the deadline is ignored (never an unhandled rejection).
  work.catch(() => {});
  try {
    return await Promise.race([work, expired]);
  } finally {
    clearTimeout(timer);
  }
}

async function readResponse(response) {
  if (response?.status === 404) return null;
  if (!response?.ok) {
    const error = new Error('World State Alpha sidecar read failed with HTTP ' + (response?.status || 'error') + '.');
    error.status = Number(response?.status || 0);
    error.retryable = [408, 425, 429].includes(error.status) || error.status >= 500;
    throw error;
  }
  return typeof response.text === 'function' ? response.text() : '';
}

export function createSillyTavernWorldStateStorageAdapter({
  fetchFn = globalThis.fetch,
  headers = {},
  headersFn = undefined,
  deadlines = WORLD_STATE_STORAGE_DEADLINES,
} = {}) {
  if (typeof fetchFn !== 'function') throw new Error('fetch() is unavailable for World State Alpha sidecar persistence.');
  const readMs = Math.max(1, Number(deadlines?.readMs) || WORLD_STATE_STORAGE_DEADLINES.readMs);
  const uploadMs = Math.max(1, Number(deadlines?.uploadMs) || WORLD_STATE_STORAGE_DEADLINES.uploadMs);

  // The request and its body read share one deadline.
  function read(path) {
    const target = text(path);
    if (!target || isLogicalPath(target)) return Promise.resolve(null);
    return withDeadline(readMs, 'file read', async signal => {
      const response = await reach(fetchFn, target, { method: 'GET', cache: 'no-store', ...(signal ? { signal } : {}) });
      return readResponse(response);
    });
  }

  function uploadTextFile(filename, body) {
    return withDeadline(uploadMs, 'file write', signal => uploadTextFileNow(filename, body, signal));
  }

  async function uploadTextFileNow(filename, body, signal) {
    const targetName = worldStateHostFileName(filename);
    const data = bytesToBase64(new TextEncoder().encode(String(body ?? '')));
    const response = await reach(fetchFn, '/api/files/upload', {
      method: 'POST',
      headers: headersValue(headers, headersFn),
      body: JSON.stringify({
        name: targetName,
        data,
      }),
      ...(signal ? { signal } : {}),
    });

    if (!response?.ok) {
      const detail = typeof response?.text === 'function' ? await response.text() : '';
      const error = new Error('World State Alpha file write failed' + (detail ? ': ' + detail : '') + '.');
      error.status = Number(response?.status || 0);
      error.retryable = [408, 425, 429].includes(error.status) || error.status >= 500 || !error.status;
      throw error;
    }

    const result = typeof response.json === 'function' ? await response.json() : {};
    const committedPath = text(result?.path);
    if (!committedPath) throw new Error('World State Alpha file endpoint returned no path.');
    return { path: committedPath };
  }

  async function uploadJsonFile(filename, value) {
    return uploadTextFile(filename, JSON.stringify(value));
  }

  async function fetchJsonFile(path) {
    const raw = await read(path);
    if (raw === null) return null;
    try {
      return JSON.parse(raw);
    } catch (cause) {
      const error = new Error('World State Alpha JSON file is invalid.');
      error.cause = cause;
      error.code = 'WORLD_STATE_JSON_INVALID';
      error.retryable = false;
      throw error;
    }
  }

  async function write({ path, expectedRevision = 0, body, replaceCorrupt = '' } = {}) {
    const target = text(path);
    if (!target) throw new Error('World State Alpha sidecar path is required.');

    // A logical path (a chat's first write, before it has a pointer) uploads to the same deterministic
    // file another device or tab may already have written, so it is locked and revision-checked as that
    // physical file: never overwrite an existing sidecar blindly.
    // The file the upload replaces is always the sanitized name under /user/files/, so the revision check
    // reads exactly that file, whatever form the pointer path took.
    const physical = worldStateHostDeterministicPath(target);
    return withWriterLock(physical, async () => {
      const expected = Math.max(0, Math.trunc(Number(expectedRevision) || 0));
      const decoded = decodeSidecar(body, { readOnly: true });

      const currentText = await read(physical);
      let current = null;
      if (currentText !== null) {
        try {
          // Another chat's file is never replaced, whatever its revision (a wrong pointer fails closed).
          current = decodeSidecar(currentText, { readOnly: true, expectedChatKey: decoded.chatKey });
        } catch (error) {
          // A recovery baseline (revision 1) may replace a damaged file, only the one recorded as damaged.
          if (!(replaceCorrupt && worldStateHostDeterministicPath(replaceCorrupt) === physical && expected === 0 && error?.damaged === true)) {
            error.retryable = false;
            throw error;
          }
        }
      }
      if (current === null) {
        if (expected !== 0) return { conflict: true, currentRevision: 0 };
      } else {
        // A retry of a write that already landed (its response was lost) finds exactly this body.
        if (Number(current.revision || 0) === expected + 1 && current.checksum === decoded.checksum) {
          return { path: physical, revision: current.revision };
        }
        if (Number(current.revision || 0) !== expected) return { conflict: true, currentRevision: Math.max(0, Math.trunc(Number(current.revision) || 0)) };
      }

      if (Number(decoded.revision || 0) !== expected + 1) {
        const error = new Error('World State Alpha sidecar body revision does not follow the expected revision.');
        error.retryable = false;
        throw error;
      }

      const uploaded = await uploadTextFile(target, body);
      // Without Web Locks (an insecure context such as SillyTavern over plain HTTP on a LAN) another tab can
      // pass the same revision check and upload in between: read the file back, and report a conflict
      // instead of a silent lost update when it no longer holds this body.
      if (!webLocksAvailable()) {
        const landedText = await read(uploaded.path).catch(() => null);
        let landed = null;
        try {
          landed = landedText === null ? null : decodeSidecar(landedText, { readOnly: true });
        } catch {
          landed = null;
        }
        // An unreadable read-back is not proof of a lost update: the upload itself succeeded.
        if (landed && landed.checksum !== decoded.checksum) {
          return { conflict: true, currentRevision: Math.max(0, Math.trunc(Number(landed?.revision) || 0)) };
        }
      }
      return {
        path: uploaded.path,
        revision: decoded.revision,
      };
    });
  }

  return Object.freeze({
    read,
    write,
    uploadJsonFile,
    fetchJsonFile,
    deterministicPath: worldStateHostDeterministicPath,
  });
}

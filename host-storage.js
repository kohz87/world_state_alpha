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
    let part = '';
    for (let index = 0; index < chunk.length; index += 1) part += String.fromCharCode(chunk[index]);
    parts.push(part);
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
} = {}) {
  if (typeof fetchFn !== 'function') throw new Error('fetch() is unavailable for World State Alpha sidecar persistence.');

  async function read(path) {
    const target = text(path);
    if (!target || isLogicalPath(target)) return null;
    const response = await reach(fetchFn, target, { method: 'GET', cache: 'no-store' });
    return readResponse(response);
  }

  async function uploadTextFile(filename, body) {
    const targetName = worldStateHostFileName(filename);
    const data = bytesToBase64(new TextEncoder().encode(String(body ?? '')));
    const response = await reach(fetchFn, '/api/files/upload', {
      method: 'POST',
      headers: headersValue(headers, headersFn),
      body: JSON.stringify({
        name: targetName,
        data,
      }),
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
    const physical = isLogicalPath(target) ? worldStateHostDeterministicPath(target) : target;
    return withWriterLock(physical, async () => {
      const expected = Math.max(0, Math.trunc(Number(expectedRevision) || 0));
      const decoded = decodeSidecar(body, { readOnly: true });

      const currentText = await read(physical);
      let current = null;
      if (currentText !== null) {
        try {
          current = decodeSidecar(currentText, { readOnly: true });
        } catch (error) {
          // A recovery baseline (revision 1) may replace a damaged file, only the one recorded as damaged.
          if (!(replaceCorrupt && replaceCorrupt === physical && expected === 0 && error?.damaged === true)) {
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

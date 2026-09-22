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
    const response = await fetchFn(target, { method: 'GET', cache: 'no-store' });
    return readResponse(response);
  }

  async function uploadTextFile(filename, body) {
    const targetName = worldStateHostFileName(filename);
    const data = bytesToBase64(new TextEncoder().encode(String(body ?? '')));
    const response = await fetchFn('/api/files/upload', {
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
      error.retryable = false;
      throw error;
    }
  }

  async function write({ path, expectedRevision = 0, body } = {}) {
    const target = text(path);
    if (!target) throw new Error('World State Alpha sidecar path is required.');

    return withWriterLock(target, async () => {
      const expected = Math.max(0, Math.trunc(Number(expectedRevision) || 0));

      if (!isLogicalPath(target)) {
        const currentText = await read(target);
        if (currentText === null) {
          if (expected !== 0) return { conflict: true };
        } else {
          let current;
          try {
            current = decodeSidecar(currentText);
          } catch (error) {
            error.retryable = false;
            throw error;
          }
          if (Number(current.revision || 0) !== expected) return { conflict: true };
        }
      } else if (expected !== 0) {
        return { conflict: true };
      }

      const decoded = decodeSidecar(body);
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

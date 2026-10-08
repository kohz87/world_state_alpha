import {
  LIMITS,
  SIDECAR_FORMAT,
  SIDECAR_FORMAT_VERSION,
} from './constants.js';
import { hashText, stableStringify } from './hash.js';
import { clone, cloneState, normalizeState } from './state-core.js';

export class RevisionConflictError extends Error {
  constructor(message = 'sidecar revision conflict', { currentRevision = null } = {}) {
    super(message);
    this.name = 'RevisionConflictError';
    this.code = 'WORLD_STATE_REVISION_CONFLICT';
    // The revision the conflicting write found on the server, when the adapter reports it.
    if (Number.isInteger(currentRevision)) this.currentRevision = currentRevision;
  }
}

export class SidecarCorruptionError extends Error {
  constructor(message = 'invalid or corrupt World State sidecar', { damaged = false } = {}) {
    super(message);
    this.name = 'SidecarCorruptionError';
    this.code = 'WORLD_STATE_CORRUPT_SIDECAR';
    // Damaged: not valid JSON, or its checksum no longer matches its content. Only such a file may be
    // replaced by an explicit recovery. A readable file of another format, version, schema or chat (a newer
    // World State on another device, for example) is never damaged and always fails closed.
    if (damaged) this.damaged = true;
  }
}

export function makeSidecarPath(chatKey) {
  if (!String(chatKey || '').trim()) throw new Error('chatKey is required');
  return `world_state_alpha/${hashText(String(chatKey))}.json`;
}

function corePayload({ chatKey, state, revision, appVersion, updatedAt }) {
  const owner = String(chatKey || '');
  if (!owner) throw new Error('chatKey is required');
  const normalized = normalizeState(state, { strictSchema: true, chatKey: owner });
  if (normalized.chatKey && normalized.chatKey !== owner) {
    throw new Error('state chatKey does not match sidecar owner');
  }
  normalized.chatKey = owner;
  return {
    format: SIDECAR_FORMAT,
    version: SIDECAR_FORMAT_VERSION,
    appVersion: String(appVersion || ''),
    chatKey: owner,
    revision: Math.max(0, Math.trunc(Number(revision) || 0)),
    updatedAt: String(updatedAt || ''),
    state: normalized,
  };
}

export function encodeSidecar({ chatKey, state, revision = 0, appVersion = '', updatedAt = new Date().toISOString() }) {
  const payload = corePayload({ chatKey, state, revision, appVersion, updatedAt });
  return JSON.stringify({ ...payload, checksum: hashText(stableStringify(payload)) });
}

// Sidecar texts already verified in this session. A capture's boundary refresh reads back the text it
// uploaded last, and its write re-checks that same server text before replacing it: identical text decodes
// to the identical result, so its checksum and schema are verified once, not three times per capture.
const VERIFIED_SIDECARS = [];
const VERIFIED_SIDECAR_LIMIT = 2;

function decodedCopy(result) {
  return { ...result, state: cloneState(result.state) };
}

export function decodeSidecar(text, { expectedChatKey = '' } = {}) {
  const source = String(text || '');
  const known = VERIFIED_SIDECARS.find(item => item.text === source);
  if (known) {
    if (expectedChatKey && known.result.chatKey !== expectedChatKey) throw new SidecarCorruptionError('sidecar belongs to a different chat');
    return decodedCopy(known.result);
  }
  const result = verifySidecar(source, { expectedChatKey });
  VERIFIED_SIDECARS.unshift({ text: source, result: decodedCopy(result) });
  VERIFIED_SIDECARS.length = Math.min(VERIFIED_SIDECARS.length, VERIFIED_SIDECAR_LIMIT);
  return result;
}

function verifySidecar(text, { expectedChatKey = '' } = {}) {
  let raw;
  try {
    raw = JSON.parse(String(text || ''));
  } catch {
    throw new SidecarCorruptionError('sidecar is not valid JSON', { damaged: true });
  }
  if (raw?.format !== SIDECAR_FORMAT || raw?.version !== SIDECAR_FORMAT_VERSION) {
    throw new SidecarCorruptionError('sidecar format/version mismatch');
  }
  if (expectedChatKey && raw.chatKey !== expectedChatKey) throw new SidecarCorruptionError('sidecar belongs to a different chat');
  const { checksum, ...withoutChecksum } = raw;
  if (!checksum || checksum !== hashText(stableStringify(withoutChecksum))) {
    throw new SidecarCorruptionError('sidecar checksum mismatch', { damaged: true });
  }
  let state;
  try {
    state = normalizeState(withoutChecksum.state, { strictSchema: true, chatKey: withoutChecksum.chatKey });
  } catch (error) {
    throw new SidecarCorruptionError(`invalid sidecar state: ${error.message}`);
  }
  if (state.chatKey !== withoutChecksum.chatKey) {
    throw new SidecarCorruptionError('sidecar state owner does not match payload owner');
  }
  return { ...withoutChecksum, state, checksum };
}

function retryable(error) {
  return Boolean(error?.retryable) && error?.code !== 'WORLD_STATE_REVISION_CONFLICT';
}

export async function readSidecar({ adapter, pointer, expectedChatKey }) {
  if (!pointer?.path) return null;
  if (!adapter || typeof adapter.read !== 'function') throw new Error('storage adapter.read is required');
  const text = await adapter.read(pointer.path);
  if (text === null || text === undefined) return null;
  return decodeSidecar(text, { expectedChatKey });
}

export async function writeSidecar({
  adapter,
  chatKey,
  state,
  pointer = null,
  appVersion = '',
  maxAttempts = LIMITS.storageAttempts,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  // An explicit recovery may replace a damaged current file (never a readable one): the path recorded
  // when it was found damaged, so a file that was replaced since is not overwritten blindly.
  replaceCorrupt = '',
}) {
  if (!adapter || typeof adapter.write !== 'function') throw new Error('storage adapter.write is required');
  const path = pointer?.path || makeSidecarPath(chatKey);
  const expectedRevision = Math.max(0, Math.trunc(Number(pointer?.revision) || 0));
  const nextRevision = expectedRevision + 1;
  const body = encodeSidecar({ chatKey, state, revision: nextRevision, appVersion });
  const target = decodeSidecar(body, { expectedChatKey: chatKey });
  const attempts = Math.max(1, Math.trunc(Number(maxAttempts) || 1));

  const recoverCommittedWrite = async () => {
    if (typeof adapter.read !== 'function') return null;
    const currentText = await adapter.read(path);
    if (currentText === null || currentText === undefined) return null;
    try {
      const current = decodeSidecar(currentText, { expectedChatKey: chatKey });
      if (current.revision === nextRevision && current.checksum === target.checksum) {
        return { path, revision: nextRevision, checksum: target.checksum };
      }
    } catch {
      return null;
    }
    return null;
  };

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await adapter.write({ path, expectedRevision, body, ...(replaceCorrupt ? { replaceCorrupt: String(replaceCorrupt) } : {}) });
      if (result?.conflict) {
        const recovered = await recoverCommittedWrite();
        if (recovered) return recovered;
        throw new RevisionConflictError(undefined, { currentRevision: result.currentRevision });
      }
      const revision = Math.max(0, Math.trunc(Number(result?.revision) || nextRevision));
      if (revision !== nextRevision) throw new RevisionConflictError('storage adapter returned an unexpected revision');
      const committedPath = String(result?.path || path).trim() || path;
      return { path: committedPath, revision, checksum: target.checksum };
    } catch (error) {
      if (error instanceof RevisionConflictError || error?.code === 'WORLD_STATE_REVISION_CONFLICT') {
        const recovered = await recoverCommittedWrite();
        if (recovered) return recovered;
        throw error;
      }
      lastError = error;
      if (!retryable(error) || attempt >= attempts) throw error;
      await sleep(Math.min(1000, 25 * (2 ** (attempt - 1))));
    }
  }
  throw lastError || new Error('sidecar write failed');
}

import { BUNDLE_FORMAT, BUNDLE_VERSION } from './constants.js';
import { hashText, stableStringify } from './hash.js';
import { clone, createState, normalizeState } from './state-core.js';

function bundleCore(state, exportedAt) {
  const normalized = normalizeState(state, { strictSchema: true });
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    sourceChatKey: normalized.chatKey,
    exportedAt: String(exportedAt || ''),
    state: normalized,
  };
}

export function exportBundle(state, { exportedAt = new Date().toISOString() } = {}) {
  const core = bundleCore(state, exportedAt);
  return JSON.stringify({ ...core, checksum: hashText(stableStringify(core)) });
}

export function importBundle(text, { targetChatKey, preserveChronology = false } = {}) {
  let raw;
  try {
    raw = JSON.parse(String(text || ''));
  } catch {
    throw new Error('bundle is not valid JSON');
  }
  if (raw?.format !== BUNDLE_FORMAT || raw?.version !== BUNDLE_VERSION) throw new Error('unsupported bundle format/version');
  const { checksum, ...core } = raw;
  if (!checksum || checksum !== hashText(stableStringify(core))) throw new Error('bundle checksum mismatch');
  if (!String(targetChatKey || '').trim()) throw new Error('targetChatKey is required');

  const imported = normalizeState(core.state, { strictSchema: true });
  const sameChat = imported.chatKey === targetChatKey;
  imported.chatKey = String(targetChatKey);

  if (!preserveChronology || !sameChat) {
    for (const record of imported.records) {
      record.createdAtMessage = null;
      record.lastChangedMessage = null;
      record.lastEvaluatedMessage = null;
    }
    for (const evidence of Object.values(imported.evidence)) {
      evidence.sourceMessageId = null;
      evidence.lineageKey = '';
      evidence.sourceClass = 'foreign_import';
    }
    for (const link of imported.links) link.sourceMessageId = null;
    imported.lastCaptureMessage = null;
  }

  imported.lineage = [];
  imported.rollbackJournalSequence = 0;
  imported.rollbackJournalFloorMessageId = -1;
  imported.rollbackJournal = [];
  imported.rollbackHead = null;
  imported.checkpoints = [];
  imported.recoveryRequired = null;
  return normalizeState(imported, { strictSchema: true });
}

export function resetState(chatKey) {
  return createState(chatKey);
}

export function cloneForExport(state) {
  return clone(normalizeState(state, { strictSchema: true }));
}

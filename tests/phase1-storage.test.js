import test from 'node:test';
import assert from 'node:assert/strict';

import { createState } from '../state-core.js';
import {
  decodeSidecar,
  encodeSidecar,
  makeSidecarPath,
  readSidecar,
  RevisionConflictError,
  SidecarCorruptionError,
  writeSidecar,
} from '../storage.js';
import { exportBundle, importBundle, resetState } from '../transfer.js';

class MemoryAdapter {
  constructor() {
    this.files = new Map();
    this.failures = 0;
    this.calls = 0;
  }

  async read(path) {
    return this.files.get(path)?.body ?? null;
  }

  async write({ path, expectedRevision, body }) {
    this.calls += 1;
    if (this.failures > 0) {
      this.failures -= 1;
      const error = new Error('temporary I/O failure');
      error.retryable = true;
      throw error;
    }
    const current = this.files.get(path);
    const revision = current?.revision ?? 0;
    if (revision !== expectedRevision) return { conflict: true };
    const decoded = decodeSidecar(body);
    this.files.set(path, { revision: decoded.revision, body });
    return { revision: decoded.revision };
  }
}

test('sidecar encode/decode validates chat ownership and corruption', () => {
  const state = createState('chat-a');
  const text = encodeSidecar({ chatKey: 'chat-a', state, revision: 1, appVersion: 'phase1-test', updatedAt: '2026-01-01T00:00:00Z' });
  const decoded = decodeSidecar(text, { expectedChatKey: 'chat-a' });
  assert.equal(decoded.revision, 1);
  assert.equal(decoded.state.chatKey, 'chat-a');
  assert.throws(() => decodeSidecar(text, { expectedChatKey: 'chat-b' }), SidecarCorruptionError);

  const tampered = JSON.parse(text);
  tampered.state.chatKey = 'evil';
  assert.throws(() => decodeSidecar(JSON.stringify(tampered)), SidecarCorruptionError);

  const wrongOwner = createState('chat-other');
  assert.throws(
    () => encodeSidecar({ chatKey: 'chat-a', state: wrongOwner, revision: 1 }),
    /does not match sidecar owner/,
  );
});

test('revision guard rejects a stale writer with different state', async () => {
  const adapter = new MemoryAdapter();
  const state = createState('chat-r');
  const first = await writeSidecar({ adapter, chatKey: 'chat-r', state });
  assert.equal(first.revision, 1);

  const conflicting = createState('chat-r');
  conflicting.records.push({
    id: 'wsr_conflict',
    kind: 'fact',
    summary: 'A different writer established this fact.',
    status: 'active',
    trend: null,
    anchors: [],
    createdAtMessage: null,
    lastChangedMessage: null,
    lastEvaluatedMessage: null,
    timeAnchor: '',
    evidenceIds: [],
    causedBy: [],
    affects: [],
  });

  await assert.rejects(
    writeSidecar({ adapter, chatKey: 'chat-r', state: conflicting, pointer: { path: first.path, revision: 0 } }),
    RevisionConflictError,
  );
});

test('retry path is bounded and keeps one expected revision', async () => {
  const adapter = new MemoryAdapter();
  adapter.failures = 2;
  const sleeps = [];
  const state = createState('chat-retry');
  const pointer = await writeSidecar({
    adapter,
    chatKey: 'chat-retry',
    state,
    maxAttempts: 3,
    sleep: async ms => sleeps.push(ms),
  });
  assert.equal(pointer.revision, 1);
  assert.equal(adapter.calls, 3);
  assert.equal(sleeps.length, 2);

  const loaded = await readSidecar({ adapter, pointer, expectedChatKey: 'chat-retry' });
  assert.equal(loaded.state.chatKey, 'chat-retry');
});

test('ambiguous successful write is recovered idempotently after retry conflict', async () => {
  class AmbiguousAdapter extends MemoryAdapter {
    async write({ path, expectedRevision, body }) {
      this.calls += 1;
      const current = this.files.get(path);
      const revision = current?.revision ?? 0;
      if (revision !== expectedRevision) return { conflict: true };
      const decoded = decodeSidecar(body);
      this.files.set(path, { revision: decoded.revision, body });
      if (this.calls === 1) {
        const error = new Error('response lost after durable write');
        error.retryable = true;
        throw error;
      }
      return { revision: decoded.revision };
    }
  }

  const adapter = new AmbiguousAdapter();
  const state = createState('chat-ambiguous');
  const pointer = await writeSidecar({
    adapter,
    chatKey: 'chat-ambiguous',
    state,
    maxAttempts: 2,
    sleep: async () => {},
  });
  assert.equal(pointer.revision, 1);
  assert.equal(adapter.calls, 2);
  const loaded = await readSidecar({ adapter, pointer, expectedChatKey: 'chat-ambiguous' });
  assert.equal(loaded.revision, 1);
});

test('sidecar path is deterministic and contains no raw chat identifier', () => {
  const a = makeSidecarPath('private-chat-name');
  const b = makeSidecarPath('private-chat-name');
  assert.equal(a, b);
  assert.equal(a.includes('private-chat-name'), false);
});

test('foreign import preserves current meaning but clears false local chronology', () => {
  const source = createState('source-chat');
  source.records.push({
    id: 'wsr_import',
    kind: 'fact',
    summary: 'The bridge is destroyed.',
    status: 'active',
    trend: null,
    anchors: ['bridge'],
    createdAtMessage: 40,
    lastChangedMessage: 41,
    lastEvaluatedMessage: 41,
    timeAnchor: '',
    evidenceIds: ['wse_import'],
    causedBy: [],
    affects: [],
  });
  source.evidence.wse_import = {
    id: 'wse_import',
    sourceMessageId: 41,
    lineageKey: 'foreign-lineage',
    sourceClass: 'assistant_narration',
    claim: 'The bridge is destroyed.',
    timeAnchor: '',
    recordIds: ['wsr_import'],
  };
  source.lineage = [{ messageId: 41, lineageKey: 'foreign-lineage' }];
  source.rollbackJournal = [{ seq: 1 }];
  source.rollbackHead = { seq: 1, messageId: 41, lineageKey: 'foreign-lineage' };

  const bundle = exportBundle(source, { exportedAt: '2026-01-01T00:00:00Z' });
  const imported = importBundle(bundle, { targetChatKey: 'target-chat' });

  assert.equal(imported.chatKey, 'target-chat');
  assert.equal(imported.records[0].summary, source.records[0].summary);
  assert.equal(imported.records[0].createdAtMessage, null);
  assert.equal(imported.evidence.wse_import.sourceMessageId, null);
  assert.equal(imported.evidence.wse_import.lineageKey, '');
  assert.equal(imported.evidence.wse_import.sourceClass, 'foreign_import');
  assert.deepEqual(imported.lineage, []);
  assert.deepEqual(imported.rollbackJournal, []);
  assert.equal(imported.rollbackHead, null);
});

test('reset creates pristine per-chat state', () => {
  const state = resetState('reset-chat');
  assert.equal(state.chatKey, 'reset-chat');
  assert.deepEqual(state.records, []);
  assert.deepEqual(state.evidence, {});
});

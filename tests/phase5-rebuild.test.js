import test from 'node:test';
import assert from 'node:assert/strict';

import { chatLineage, commitMutationBoundary, seedRootCheckpoint } from '../branch.js';
import { runCaptureOperation } from '../capture.js';
import { createDiagnosticStore } from '../diagnostics.js';
import {
  compareWorldStateSemantics,
  planChronologicalRebuild,
  runManualRebuild,
} from '../rebuild.js';
import { createState, reduceMutations } from '../state-core.js';

function scriptedDispatcher(calls = { count: 0 }) {
  return async (_ctx, options) => {
    calls.count += 1;
    const prompt = options.prompt;
    const visibleMatch = prompt.match(/VISIBLE CURRENT WORLD STATE \(current authority; use only these IDs\):\n(\[[^\n]*\])/);
    const visible = visibleMatch ? JSON.parse(visibleMatch[1]) : [];
    const existing = visible.find(record => Array.isArray(record.anchors)
      && record.anchors.some(anchor => String(anchor).toLocaleLowerCase().includes('dock strike')));

    let text = '{"mutations":[]}';

    if (prompt.includes('A dock strike begins at Southport.')) {
      text = JSON.stringify({
        mutations: [{
          action: 'create',
          kind: 'development',
          summary: 'The Southport dock strike is active.',
          trend: 'emerging',
          anchors: ['Southport', 'dock strike'],
          evidence: [{ sourceMessageId: 1, claim: 'A dock strike begins at Southport.' }],
        }],
      });
    } else if (prompt.includes('The Southport dock strike continues and cargo delays worsen.')) {
      text = JSON.stringify({
        mutations: [{
          action: 'update',
          recordId: existing?.id || 'missing-visible-record',
          summary: 'The Southport dock strike continues and cargo delays are worsening.',
          trend: 'rising',
          anchors: ['Southport', 'dock strike', 'cargo delays'],
          evidence: [{ sourceMessageId: 3, claim: 'The Southport dock strike continues and cargo delays worsen.' }],
        }],
      });
    } else if (prompt.includes('The Southport dock strike ends after an agreement.')) {
      text = JSON.stringify({
        mutations: [{
          action: 'resolve',
          recordId: existing?.id || 'missing-visible-record',
          summary: 'The Southport dock strike ends after an agreement.',
          evidence: [{ sourceMessageId: 5, claim: 'The Southport dock strike ends after an agreement.' }],
        }],
      });
    }

    return {
      text,
      receipt: {
        dispatched: true,
        outcome: 'success',
        route: 'test',
        profileId: '',
      },
    };
  };
}

function fixtureChat() {
  return [
    { role: 'user', content: 'I arrive at Southport.' },
    { role: 'assistant', content: 'A dock strike begins at Southport.' },
    { role: 'user', content: 'I wait several days.' },
    { role: 'assistant', content: 'The Southport dock strike continues and cargo delays worsen.' },
    { role: 'user', content: 'I return to the harbor.' },
    { role: 'assistant', content: 'The Southport dock strike ends after an agreement.' },
  ];
}

async function buildIncrementally(chatKey, chat, dispatcher) {
  const lineage = chatLineage(chat);
  let state = seedRootCheckpoint(createState(chatKey));
  let previousAssistant = -1;

  for (let messageId = 0; messageId < chat.length; messageId += 1) {
    if (chat[messageId].role !== 'assistant') continue;
    const exchange = chat.slice(previousAssistant + 1, messageId + 1).map((message, offset) => {
      const sourceMessageId = previousAssistant + 1 + offset;
      return {
        ...message,
        messageId: sourceMessageId,
        lineageKey: lineage[sourceMessageId].lineageKey,
      };
    });
    const before = state;
    const result = await runCaptureOperation({
      ctx: {},
      dispatcher,
      isCurrent: () => true,
      state,
      exchange,
      visibleRecords: state.records.slice(0, 8),
      chatKey,
      sourceMessageId: messageId,
      sourceLineageKey: lineage[messageId].lineageKey,
    });
    assert.ok(['applied', 'no-change'].includes(result.outcome));
    state = commitMutationBoundary(before, result.state, chat.slice(0, messageId + 1), messageId, 'capture');
    previousAssistant = messageId;
  }
  state.lineage = lineage;
  return state;
}

test('chronological rebuild planning is assistant-boundary based and bounded before provider work', () => {
  const chat = fixtureChat();
  const plan = planChronologicalRebuild(chat);
  assert.equal(plan.windows.length, 3);
  assert.deepEqual(plan.windows.map(item => item.messageId), [1, 3, 5]);
  assert.equal(plan.windows[1].exchange[0].messageId, 2);
  assert.equal(plan.windows[1].exchange.at(-1).messageId, 3);

  assert.throws(
    () => planChronologicalRebuild(chat, { maxBoundaries: 2 }),
    error => error?.code === 'WORLD_STATE_REBUILD_BOUNDARY_LIMIT',
  );
});


test('rebuild planner supports a global start message without renumbering historical boundaries', () => {
  const chat = fixtureChat();
  const partial = planChronologicalRebuild(chat, { startMessageId: 2, maxBoundaries: 10 });
  assert.deepEqual(partial.windows.map(item => item.messageId), [3, 5]);
  assert.equal(partial.windows[0].exchange[0].messageId, 2);
  assert.equal(partial.windows[0].exchange.at(-1).messageId, 3);
  assert.equal(partial.metrics.startMessageId, 2);

  const assistantAligned = planChronologicalRebuild(chat, { startMessageId: 3, maxBoundaries: 10 });
  assert.deepEqual(assistantAligned.windows.map(item => item.messageId), [3, 5]);
  assert.deepEqual(assistantAligned.windows[0].exchange.map(item => item.messageId), [2, 3]);
  assert.equal(assistantAligned.windows[0].exchange[0].content, 'I wait several days.');
  assert.equal(assistantAligned.metrics.startMessageId, 3);
});

test('partial rebuild uses an exact proven prior boundary and converges with full current semantics', async () => {
  const chat = fixtureChat();
  const current = await buildIncrementally('partial-range', chat, scriptedDispatcher());
  const progress = [];
  const result = await runManualRebuild({
    ctx: {},
    dispatcher: scriptedDispatcher(),
    state: current,
    chat,
    chatKey: 'partial-range',
    startMessageId: 2,
    maxBoundaries: 10,
    isCurrent: () => true,
    onProgress: item => progress.push(item),
  });
  assert.equal(result.outcome, 'completed');
  assert.equal(result.providerCalls, 2);
  assert.equal(result.processedBoundaries, 2);
  assert.equal(result.plan.startMessageId, 2);
  assert.deepEqual(progress.map(item => item.messageId), [3, 5]);
  assert.deepEqual(progress.map(item => item.processedBoundaries), [1, 2]);
  assert.equal(compareWorldStateSemantics(current, result.state).equivalent, true);
  assert.equal(result.state.checkpoints.some(item => item.messageId === -1), true);
});

test('partial rebuild starting on an assistant boundary retains the preceding user turn as exchange context', async () => {
  const chat = fixtureChat();
  const current = await buildIncrementally('partial-assistant-range', chat, scriptedDispatcher());
  const delegate = scriptedDispatcher();
  let calls = 0;
  const dispatcher = async (...args) => {
    calls += 1;
    if (calls === 1) assert.match(args[1].prompt, /I wait several days\./);
    return delegate(...args);
  };
  const result = await runManualRebuild({
    ctx: {},
    dispatcher,
    state: current,
    chat,
    chatKey: 'partial-assistant-range',
    startMessageId: 3,
    maxBoundaries: 10,
    isCurrent: () => true,
  });
  assert.equal(result.outcome, 'completed');
  assert.equal(result.providerCalls, 2);
  assert.equal(calls, 2);
  assert.equal(compareWorldStateSemantics(current, result.state).equivalent, true);
});

test('partial rebuild after reset fails closed before any provider call when prior canonical history is unavailable', async () => {
  const chat = fixtureChat();
  let calls = 0;
  const dispatcher = async () => {
    calls += 1;
    return { text: '{"mutations":[]}', receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' } };
  };
  const original = createState('partial-after-reset');
  const result = await runManualRebuild({
    ctx: {},
    dispatcher,
    state: original,
    chat,
    chatKey: 'partial-after-reset',
    startMessageId: 2,
    isCurrent: () => true,
  });
  assert.equal(result.outcome, 'failure');
  assert.equal(result.errorCode, 'WORLD_STATE_REBUILD_RANGE_BASE_UNAVAILABLE');
  assert.match(result.errorMessage, /Full chat after a reset|exact canonical/i);
  assert.equal(result.providerCalls, 0);
  assert.equal(calls, 0);
  assert.deepEqual(result.state, original);
});

test('manual rebuild reconstructs chat chronology using rebuild evidence and no lazy evolution calls', async () => {
  const chat = fixtureChat();
  const calls = { count: 0 };
  const result = await runManualRebuild({
    ctx: {},
    dispatcher: scriptedDispatcher(calls),
    state: createState('rebuild-basic'),
    chat,
    chatKey: 'rebuild-basic',
    isCurrent: () => true,
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.processedBoundaries, 3);
  assert.equal(result.providerCalls, 3);
  assert.equal(calls.count, 3);
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].status, 'resolved');
  assert.equal(result.state.records[0].summary, 'The Southport dock strike ends after an agreement.');
  assert.equal(result.state.lastCaptureMessage, 5);
  assert.equal(result.state.rollbackHead.messageId, 5);
  assert.ok(Object.values(result.state.evidence).every(item => item.sourceClass === 'rebuild'));
  assert.equal(result.receipts.some(item => item.outcome === 'evolved'), false);
});

test('rebuild from chat recovers an established persistent off-screen development', async () => {
  const chat = [
    { role: 'user', content: 'I ignore the market shakedown and leave Brackenford.' },
    {
      role: 'assistant',
      content: 'At Brackenford market, Orson and two carters continue demanding unauthorized unloading fees from traders after the traveler departs.',
    },
    { role: 'user', content: 'I continue toward Applecross and do not return to the market.' },
    { role: 'assistant', content: 'The traveler reaches Applecross before dusk.' },
  ];
  const calls = { count: 0 };
  const dispatcher = async (_ctx, options) => {
    calls.count += 1;
    assert.match(options.prompt, /REBUILD RECOVERY MODE/);
    if (options.prompt.includes('Orson and two carters continue demanding unauthorized unloading fees')) {
      return {
        text: JSON.stringify({
          mutations: [{
            action: 'create',
            kind: 'development',
            summary: 'Orson and local carters are extorting Brackenford market traders for unauthorized unloading fees.',
            trend: 'stable',
            anchors: ['Brackenford', 'market', 'Orson', 'carters'],
            evidence: [{
              sourceMessageId: 1,
              claim: 'Orson and two carters continue demanding unauthorized unloading fees from traders after the traveler departs.',
            }],
          }],
        }),
        receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
      };
    }
    return {
      text: '{"mutations":[]}',
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
    };
  };

  const result = await runManualRebuild({
    ctx: {},
    dispatcher,
    state: createState('rebuild-offscreen'),
    chat,
    chatKey: 'rebuild-offscreen',
    isCurrent: () => true,
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(calls.count, 2);
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].kind, 'development');
  assert.equal(result.state.records[0].status, 'active');
  assert.match(result.state.records[0].summary, /extorting Brackenford market traders/i);
  const evidence = result.state.evidence[result.state.records[0].evidenceIds[0]];
  assert.equal(evidence.sourceClass, 'rebuild');
});

test('controlled incremental and rebuild paths converge on equivalent current world state', async () => {
  const chat = fixtureChat();
  const incremental = await buildIncrementally('equivalence', chat, scriptedDispatcher());
  const rebuilt = await runManualRebuild({
    ctx: {},
    dispatcher: scriptedDispatcher(),
    state: incremental,
    chat,
    chatKey: 'equivalence',
    isCurrent: () => true,
  });

  assert.equal(rebuilt.outcome, 'completed');
  const comparison = compareWorldStateSemantics(incremental, rebuilt.state);
  assert.equal(comparison.equivalent, true);
  assert.equal(Object.values(incremental.evidence).some(item => item.sourceClass === 'assistant_narration'), true);
  assert.equal(Object.values(rebuilt.state.evidence).every(item => item.sourceClass === 'rebuild'), true);
});

test('rebuild keeps relevant resolved tombstones visible so passive history cannot resurrect', async () => {
  const chat = [
    { role: 'user', content: 'I arrive at Southport.' },
    { role: 'assistant', content: 'A dock strike begins at Southport.' },
    { role: 'user', content: 'I return after negotiations.' },
    { role: 'assistant', content: 'The Southport dock strike ends after an agreement.' },
    { role: 'user', content: 'I walk through Southport later.' },
    { role: 'assistant', content: 'The harbor is calm while workers discuss old grievances.' },
  ];
  const calls = { count: 0 };
  const dispatcher = async (_ctx, options) => {
    calls.count += 1;
    const prompt = options.prompt;
    const currentMatch = prompt.match(/CURRENT EXCHANGE \(the only automatic mutation evidence source\):\n(\[[^\n]*\])/);
    const current = currentMatch ? JSON.parse(currentMatch[1]) : [];
    const assistantText = current.find(message => message.role === 'assistant')?.content || '';
    const visibleMatch = prompt.match(/VISIBLE CURRENT WORLD STATE \(current authority; use only these IDs\):\n(\[[^\n]*\])/);
    const visible = visibleMatch ? JSON.parse(visibleMatch[1]) : [];
    const dock = visible.find(record => (record.anchors || []).includes('dock strike'));

    if (assistantText === 'A dock strike begins at Southport.') {
      return {
        text: JSON.stringify({ mutations: [{
          action: 'create',
          kind: 'development',
          summary: 'The Southport dock strike is active.',
          anchors: ['Southport', 'dock strike'],
          evidence: [{ sourceMessageId: 1, claim: 'A dock strike begins at Southport.' }],
        }] }),
        receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
      };
    }
    if (assistantText === 'The Southport dock strike ends after an agreement.') {
      return {
        text: JSON.stringify({ mutations: [{
          action: 'resolve',
          recordId: dock?.id || 'missing',
          summary: 'The Southport dock strike ends after an agreement.',
          evidence: [{ sourceMessageId: 3, claim: 'The Southport dock strike ends after an agreement.' }],
        }] }),
        receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
      };
    }
    return {
      text: JSON.stringify({ mutations: [{
        action: 'create',
        kind: 'development',
        summary: 'The Southport dock strike is active.',
        anchors: ['Southport', 'dock strike'],
        evidence: [{ sourceMessageId: 5, claim: 'workers discuss old grievances' }],
      }] }),
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
    };
  };

  const result = await runManualRebuild({
    ctx: {},
    dispatcher,
    state: createState('rebuild-tombstone'),
    chat,
    chatKey: 'rebuild-tombstone',
    isCurrent: () => true,
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].status, 'resolved');
  assert.equal(result.receipts.at(-1).rejected > 0, true);
});

test('rebuild permits an explicit genuinely new episode linked to a visible resolved predecessor', async () => {
  const chat = [
    { role: 'user', content: 'I arrive at Southport.' },
    { role: 'assistant', content: 'A dock strike begins at Southport.' },
    { role: 'user', content: 'I return after negotiations.' },
    { role: 'assistant', content: 'The Southport dock strike ends after an agreement.' },
    { role: 'user', content: 'Months later I return.' },
    { role: 'assistant', content: 'A new dock strike begins at Southport over a different contract.' },
  ];
  const dispatcher = async (_ctx, options) => {
    const prompt = options.prompt;
    const currentMatch = prompt.match(/CURRENT EXCHANGE \(the only automatic mutation evidence source\):\n(\[[^\n]*\])/);
    const current = currentMatch ? JSON.parse(currentMatch[1]) : [];
    const assistantText = current.find(message => message.role === 'assistant')?.content || '';
    const visibleMatch = prompt.match(/VISIBLE CURRENT WORLD STATE \(current authority; use only these IDs\):\n(\[[^\n]*\])/);
    const visible = visibleMatch ? JSON.parse(visibleMatch[1]) : [];
    const dock = visible.find(record => (record.anchors || []).includes('dock strike'));

    if (assistantText === 'A dock strike begins at Southport.') {
      return {
        text: JSON.stringify({ mutations: [{
          action: 'create',
          kind: 'development',
          summary: 'The Southport dock strike is active.',
          anchors: ['Southport', 'dock strike'],
          evidence: [{ sourceMessageId: 1, claim: 'A dock strike begins at Southport.' }],
        }] }),
        receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
      };
    }
    if (assistantText === 'The Southport dock strike ends after an agreement.') {
      return {
        text: JSON.stringify({ mutations: [{
          action: 'resolve',
          recordId: dock?.id || 'missing',
          summary: 'The Southport dock strike ends after an agreement.',
          evidence: [{ sourceMessageId: 3, claim: 'The Southport dock strike ends after an agreement.' }],
        }] }),
        receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
      };
    }
    return {
      text: JSON.stringify({ mutations: [{
        action: 'create',
        kind: 'development',
        summary: 'A new Southport dock strike is active over a different contract.',
        anchors: ['Southport', 'dock strike'],
        newEpisodeOfRecordId: dock?.id || 'missing',
        evidence: [{ sourceMessageId: 5, claim: 'A new dock strike begins at Southport over a different contract.' }],
      }] }),
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
    };
  };

  const result = await runManualRebuild({
    ctx: {},
    dispatcher,
    state: createState('rebuild-new-episode'),
    chat,
    chatKey: 'rebuild-new-episode',
    isCurrent: () => true,
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.state.records.length, 2, JSON.stringify(result.receipts));
  assert.equal(result.state.records.filter(record => record.status === 'resolved').length, 1);
  assert.equal(result.state.records.filter(record => record.status === 'active').length, 1);
  assert.ok(result.state.links.length >= 1);
});

test('rebuild is atomic: a failed later chunk leaves the original canonical state untouched', async () => {
  const chat = fixtureChat();
  const original = reduceMutations(createState('atomic-rebuild'), {
    chatKey: 'atomic-rebuild',
    messageId: 0,
    lineageKey: chatLineage(chat)[0].lineageKey,
    mutations: [{
      action: 'create',
      kind: 'fact',
      summary: 'Preexisting operator state remains authoritative if rebuild aborts.',
      anchors: ['preexisting'],
    }],
  }).state;

  let calls = 0;
  const good = scriptedDispatcher();
  const dispatcher = async (ctx, options, meta) => {
    calls += 1;
    if (calls === 2) {
      const error = new Error('provider unavailable');
      error.code = 'TEST_PROVIDER_FAILURE';
      error.receipt = { dispatched: true, outcome: 'failure', route: 'test', profileId: '' };
      throw error;
    }
    return good(ctx, options, meta);
  };

  const result = await runManualRebuild({
    ctx: {},
    dispatcher,
    state: original,
    chat,
    chatKey: 'atomic-rebuild',
    isCurrent: () => true,
  });

  assert.equal(result.outcome, 'failure');
  assert.equal(result.failedBoundary, 3);
  assert.equal(result.providerCalls, 2);
  assert.deepEqual(result.state, original);
});

test('stale rebuild result is discarded atomically when the chat/state snapshot changes', async () => {
  const chat = fixtureChat();
  const original = createState('stale-rebuild');
  let current = true;
  let calls = 0;
  const base = scriptedDispatcher();
  const dispatcher = async (ctx, options, meta) => {
    calls += 1;
    const result = await base(ctx, options, meta);
    if (calls === 1) current = false;
    return result;
  };

  const result = await runManualRebuild({
    ctx: {},
    dispatcher,
    state: original,
    chat,
    chatKey: 'stale-rebuild',
    isCurrent: () => current,
  });

  assert.equal(result.outcome, 'stale');
  assert.deepEqual(result.state, original);
  assert.equal(calls, 1);
});

test('rebuild refuses provider work without a currentness guard', async () => {
  const calls = { count: 0 };
  await assert.rejects(
    runManualRebuild({
      ctx: {},
      dispatcher: scriptedDispatcher(calls),
      state: createState('guard-rebuild'),
      chat: fixtureChat(),
      chatKey: 'guard-rebuild',
    }),
    error => error?.code === 'WORLD_STATE_REBUILD_CURRENT_GUARD_REQUIRED',
  );
  assert.equal(calls.count, 0);
});

test('rebuild fails closed on timeout, cancellation, and a later-window timeout', async () => {
  const chat = fixtureChat();
  const original = reduceMutations(createState('rebuild-provider-outcome'), {
    chatKey: 'rebuild-provider-outcome',
    messageId: 0,
    lineageKey: chatLineage(chat)[0].lineageKey,
    mutations: [{ action: 'create', kind: 'fact', summary: 'Preexisting state must survive rebuild failure.' }],
  }).state;

  for (const outcome of ['timeout', 'cancelled']) {
    const dispatcher = async () => {
      const error = new Error(outcome);
      error.code = outcome === 'timeout' ? 'WORLD_STATE_ROUTE_TIMEOUT' : 'WORLD_STATE_ROUTE_CANCELLED';
      error.receipt = { dispatched: true, outcome, route: 'test', profileId: '' };
      throw error;
    };
    const result = await runManualRebuild({
      ctx: {},
      dispatcher,
      state: original,
      chat,
      chatKey: 'rebuild-provider-outcome',
      isCurrent: () => true,
    });
    assert.equal(result.outcome, outcome === 'cancelled' ? 'cancelled' : 'failure');
    assert.equal(result.failedBoundary, 1);
    assert.deepEqual(result.state, original);
  }

  let calls = 0;
  const dispatcher = async () => {
    calls += 1;
    if (calls === 1) {
      return { text: '{"mutations":[]}', receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' } };
    }
    const error = new Error('late timeout');
    error.code = 'WORLD_STATE_ROUTE_TIMEOUT';
    error.receipt = { dispatched: true, outcome: 'timeout', route: 'test', profileId: '' };
    throw error;
  };
  const late = await runManualRebuild({
    ctx: {},
    dispatcher,
    state: original,
    chat,
    chatKey: 'rebuild-provider-outcome',
    isCurrent: () => true,
  });
  assert.equal(late.outcome, 'failure');
  assert.equal(late.failedBoundary, 3);
  assert.deepEqual(late.state, original);
});

test('rebuild cancellation persists across boundary gaps and the final progress callback', async () => {
  const chat = fixtureChat();
  const original = reduceMutations(createState('rebuild-persistent-cancel'), {
    chatKey: 'rebuild-persistent-cancel',
    messageId: 0,
    lineageKey: chatLineage(chat)[0].lineageKey,
    mutations: [{ action: 'create', kind: 'fact', summary: 'Original canonical state must survive operator cancellation.' }],
  }).state;

  {
    const controller = new AbortController();
    let calls = 0;
    const result = await runManualRebuild({
      ctx: {},
      state: original,
      chat,
      chatKey: 'rebuild-persistent-cancel',
      signal: controller.signal,
      isCurrent: () => true,
      dispatcher: async () => {
        calls += 1;
        return { text: '{"mutations":[]}', receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' } };
      },
      onProgress: progress => {
        if (progress.processedBoundaries === 1) controller.abort();
      },
    });
    assert.equal(result.outcome, 'cancelled');
    assert.equal(result.errorCode, 'WORLD_STATE_ROUTE_CANCELLED');
    assert.equal(calls, 1);
    assert.deepEqual(result.state, original);
  }

  {
    const finalChat = [{ role: 'assistant', content: 'The watchtower gate is now sealed for repairs.' }];
    const controller = new AbortController();
    let calls = 0;
    const result = await runManualRebuild({
      ctx: {},
      state: original,
      chat: finalChat,
      chatKey: 'rebuild-persistent-cancel',
      signal: controller.signal,
      isCurrent: () => true,
      dispatcher: async () => {
        calls += 1;
        return { text: '{"mutations":[]}', receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' } };
      },
      onProgress: () => controller.abort(),
    });
    assert.equal(result.outcome, 'cancelled');
    assert.equal(result.failedBoundary, null);
    assert.equal(calls, 1);
    assert.deepEqual(result.state, original);
  }
});

test('rebuild repairs live Gemini category/description drift, restores Current and Places, and keeps diagnostics', async () => {
  const chat = [{
    role: 'assistant',
    content: [
      'Morning mist clung to the North Road as Brackenford came into view ahead.',
      'Haulers guild carters in Brackenford are extorting fees from inbound farmers under threat of tipping their goods.',
    ].join(' '),
  }];
  const diagnostics = createDiagnosticStore();
  const result = await runManualRebuild({
    ctx: {},
    state: createState('rebuild-live-alias'),
    chat,
    chatKey: 'rebuild-live-alias',
    spatialEnabled: true,
    diagnostics,
    operationId: 'rebuild-live',
    isCurrent: () => true,
    dispatcher: async () => ({
      text: JSON.stringify({
        mutations: [{
          action: 'create',
          category: 'development',
          description: 'Haulers guild carters in Brackenford are extorting fees from inbound farmers.',
          evidence: [{
            sourceMessageId: 0,
            claim: 'Haulers guild carters in Brackenford are extorting fees from inbound farmers under threat of tipping their goods.',
          }],
        }],
        spatialMutations: [{
          action: 'upsert_location',
          name: 'Brackenford',
          type: 'village',
          context: 'Settlement beside the North Road',
          admissionReason: 'named',
          evidence: [{
            sourceMessageId: 0,
            claim: 'Morning mist clung to the North Road as Brackenford came into view ahead.',
          }],
        }],
      }),
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: 'gemini-3.7-flash-high' },
    }),
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].kind, 'development');
  assert.match(result.state.records[0].summary, /extorting fees/i);
  assert.equal(result.state.spatial.locations.some(item => item.name === 'Brackenford'), true);
  assert.equal(result.receipts[0].aliasRepairs, 2);

  const rows = diagnostics.records('rebuild-live-alias');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, 'rebuild');
  assert.equal(rows[0].aliasRepairs, 2);
  assert.equal(rows[0].code, 'WORLD_STATE_PROVIDER_ALIAS_REPAIRED');
  assert.match(rows[0].detail, /Repaired 2 unambiguous provider field aliases/i);
});

test('rebuild alias repair remains fail-closed when canonical and alias fields conflict', async () => {
  const chat = [{ role: 'assistant', content: 'A dock strike begins at Southport.' }];
  const original = createState('rebuild-alias-conflict');
  const result = await runManualRebuild({
    ctx: {},
    state: original,
    chat,
    chatKey: 'rebuild-alias-conflict',
    isCurrent: () => true,
    dispatcher: async () => ({
      text: JSON.stringify({
        mutations: [{
          action: 'create',
          kind: 'fact',
          category: 'development',
          summary: 'A dock strike is active at Southport.',
          description: 'A dock strike is active at Southport.',
          evidence: [{ sourceMessageId: 0, claim: 'A dock strike begins at Southport.' }],
        }],
      }),
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
    }),
  });

  assert.equal(result.outcome, 'failure');
  assert.equal(result.failedBoundary, 0);
  assert.deepEqual(result.state, original);
  assert.match(result.receipts[0].rejections[0].reason, /conflicting kind\/category provider fields/i);
});

test('rebuild aborts on a structurally malformed mutation row inside valid JSON', async () => {
  const chat = [
    { role: 'user', content: 'I arrive at Southport.' },
    { role: 'assistant', content: 'A dock strike begins at Southport.' },
  ];
  const original = reduceMutations(createState('rebuild-strict-wire'), {
    chatKey: 'rebuild-strict-wire',
    messageId: 0,
    lineageKey: chatLineage(chat)[0].lineageKey,
    mutations: [{ action: 'create', kind: 'fact', summary: 'Original state survives malformed rebuild output.' }],
  }).state;
  const result = await runManualRebuild({
    ctx: {},
    state: original,
    chat,
    chatKey: 'rebuild-strict-wire',
    isCurrent: () => true,
    dispatcher: async () => ({
      text: JSON.stringify({
        mutations: [{ action: 'create', kind: 'development', summary: 'Dock strike is active.' }],
      }),
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
    }),
  });
  assert.equal(result.outcome, 'failure');
  assert.equal(result.failedBoundary, 1);
  assert.deepEqual(result.state, original);
  assert.match(result.receipts[0].rejections[0].reason, /structurally invalid Reality mutation row|requires evidence/i);
});

test('Reality-only rebuild preserves the disabled Spatial namespace', async () => {
  const chat = [
    { role: 'user', content: 'I stay in town.' },
    { role: 'assistant', content: 'Nothing material changes.' },
  ];
  const original = createState('rebuild-spatial-disabled');
  original.spatial.profile = {
    system: 'cartesian2d',
    northAxis: '+y',
    eastAxis: '+x',
    unitKm: 5,
    decimalStep: 0.1,
    bounds: { minX: -500, maxX: 500, minY: -500, maxY: 500 },
    trueNorthLocked: true,
  };
  original.spatial.baseMapRef = { id: 'base-test', digest: 'digest-test', adapter: 'generic_cartesian' };
  original.spatial.locations.push({
    id: 'wsloc_saved',
    name: 'Saved Ford',
    type: 'ford',
    status: 'active',
    coordinate: { x: 4, y: 9, authority: 'narrative_explicit', locked: false },
    context: 'Saved campaign place',
    relative: null,
    routeRefs: [],
    createdAtMessage: 0,
    lastChangedMessage: 0,
    evidenceIds: [],
    notes: '',
  });

  const result = await runManualRebuild({
    ctx: {},
    state: original,
    chat,
    chatKey: 'rebuild-spatial-disabled',
    spatialEnabled: false,
    isCurrent: () => true,
    dispatcher: async () => ({
      text: '{"mutations":[]}',
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: '' },
    }),
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.state.spatial.baseMapRef?.id, 'base-test');
  assert.equal(result.state.spatial.profile?.unitKm, 5);
  assert.equal(result.state.spatial.locations.some(item => item.name === 'Saved Ford'), true);
});


test('live Gemini alias payload rebuild repopulates Current and Places after reset', async () => {
  const chat = [
    {
      role: 'assistant',
      content: "Morning mist clung to the North Road as Brackenford came into view ahead, chimney smoke rising beyond its low walls. Beside Brackenford's open gate stood a crowded notice board.",
    },
    { role: 'user', content: 'I accept the trench-boar work and head south.' },
    {
      role: 'assistant',
      content: [
        'Down the lane at the Northgate Stockyard, iron tires clattered against split-log ramps.',
        '"Two Aon until dusk," Karr said, barely glancing up from his scraper as he pointed a blunt finger toward a row of two-wheeled handcarts lined beside the fencing. "Bring it back whole. Break the ash tongue, you owe thirty."',
        'The handcart shoved deep into a screen of alder brush, the quarterstaff planted into the soggy bank.',
        'South of Brackenford, the North Road dwindled into a sunken wagon track flanked by hazel hedges and deep run-off channels.',
        'Half a league down the Applecross ditchline, the culvert opened into an overgrown gully choked with stinging nettles, wild rose briers, and black silt.',
        'Six Aon per head. Sounder of seven trench-boars rooting the lower drainage culvert south of Applecross road.',
        'Below the overhanging bank, tucked deep into a hollow under the very roots supporting the tree, dry leaves rustled with the low, wet grunting of heavy bodies shifting in the dirt.',
        '"Every crate off that wagon touches village gravel, Garrow." The speaker was a thick-necked carter in a grease-stained leather vest, planted square before an elderly farmer\'s handcart ten paces inside the gate. "Gravel belongs to the haulers\' guild. Two Aon for the cobbles. Pay it now. We don\'t want these crates tipped in the horse gutters."',
      ].join('\n'),
    },
  ];
  const diagnostics = createDiagnosticStore();
  let calls = 0;
  const dispatcher = async (_ctx, options) => {
    calls += 1;
    if (options.prompt.includes('Morning mist clung to the North Road')) {
      return {
        text: JSON.stringify({
          mutations: [],
          spatialMutations: [
            {
              action: 'upsert_location',
              name: 'Brackenford',
              type: 'village',
              context: 'Settlement with low walls and an open gate beside the North Road',
              admissionReason: 'named',
              evidence: [
                { sourceMessageId: 0, claim: 'Morning mist clung to the North Road as Brackenford came into view ahead, chimney smoke rising beyond its low walls.' },
                { sourceMessageId: 0, claim: "Beside Brackenford's open gate stood a crowded notice board." },
              ],
            },
            {
              action: 'upsert_location',
              name: 'North Road',
              type: 'road',
              context: 'Road leading to Brackenford',
              admissionReason: 'named',
              evidence: [{ sourceMessageId: 0, claim: 'Morning mist clung to the North Road as Brackenford came into view ahead, chimney smoke rising beyond its low walls.' }],
            },
          ],
        }),
        receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: 'gemini-3.7-flash-high' },
      };
    }

    const visibleMatch = options.prompt.match(/VISIBLE SPATIAL CONTINUITY \(current\/base authority; use only shown IDs\):\n(\[[^\n]*\])/);
    const visible = visibleMatch ? JSON.parse(visibleMatch[1]) : [];
    const brackenford = visible.find(item => item.name === 'Brackenford');
    assert.ok(brackenford?.id, 'second rebuild boundary should see Brackenford from the first boundary');

    return {
      text: JSON.stringify({
        mutations: [
          {
            action: 'create',
            category: 'development',
            description: 'A sounder of seven trench-boars is bedded down in a hollow beneath the roots of a hornbeam tree along the drainage culvert south of Applecross road.',
            evidence: [
              { sourceMessageId: 2, claim: 'Six Aon per head. Sounder of seven trench-boars rooting the lower drainage culvert south of Applecross road.' },
              { sourceMessageId: 2, claim: 'Below the overhanging bank, tucked deep into a hollow under the very roots supporting the tree, dry leaves rustled with the low, wet grunting of heavy bodies shifting in the dirt.' },
            ],
          },
          {
            action: 'create',
            category: 'development',
            description: "A handcart rented from Karr at the Northgate Stockyard for two Aon until dusk is stashed in alder brush near the Applecross culvert, subject to a thirty-Aon penalty if damaged.",
            evidence: [
              { sourceMessageId: 2, claim: '"Two Aon until dusk," Karr said, barely glancing up from his scraper as he pointed a blunt finger toward a row of two-wheeled handcarts lined beside the fencing. "Bring it back whole. Break the ash tongue, you owe thirty."' },
              { sourceMessageId: 2, claim: 'The handcart shoved deep into a screen of alder brush, the quarterstaff planted into the soggy bank.' },
            ],
          },
          {
            action: 'create',
            category: 'development',
            description: "Haulers' guild carters and drovers in Brackenford are extorting fees from inbound farmers and market stalls under threat of tipping their goods.",
            evidence: [{
              sourceMessageId: 2,
              claim: '"Every crate off that wagon touches village gravel, Garrow." The speaker was a thick-necked carter in a grease-stained leather vest, planted square before an elderly farmer\'s handcart ten paces inside the gate. "Gravel belongs to the haulers\' guild. Two Aon for the cobbles. Pay it now. We don\'t want these crates tipped in the horse gutters."',
            }],
          },
        ],
        spatialMutations: [
          {
            action: 'upsert_location',
            name: 'Northgate Stockyard',
            type: 'yard',
            context: 'Stockyard with timber racks, split-log ramps, and rental handcarts in Brackenford',
            admissionReason: 'named',
            relative: {
              toLocationId: brackenford.id,
              direction: 'unspecified',
              distanceKm: null,
              distanceMode: 'unspecified',
            },
            evidence: [{ sourceMessageId: 2, claim: 'Down the lane at the Northgate Stockyard, iron tires clattered against split-log ramps.' }],
          },
          {
            action: 'upsert_location',
            name: 'Applecross Culvert',
            type: 'waterway',
            context: 'Drainage culvert and overgrown gully along the ditchline south of Brackenford',
            admissionReason: 'named',
            relative: {
              toLocationId: brackenford.id,
              direction: 'south',
              distanceKm: 2.5,
              distanceMode: 'route',
            },
            evidence: [
              { sourceMessageId: 2, claim: 'South of Brackenford, the North Road dwindled into a sunken wagon track flanked by hazel hedges and deep run-off channels.' },
              { sourceMessageId: 2, claim: 'Half a league down the Applecross ditchline, the culvert opened into an overgrown gully choked with stinging nettles, wild rose briers, and black silt.' },
            ],
          },
        ],
      }),
      receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: 'gemini-3.7-flash-high' },
    };
  };

  const result = await runManualRebuild({
    ctx: {},
    dispatcher,
    diagnostics,
    state: createState('live-gemini-rebuild'),
    chat,
    chatKey: 'live-gemini-rebuild',
    spatialEnabled: true,
    isCurrent: () => true,
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(calls, 2);
  assert.equal(result.state.records.filter(record => record.status === 'active').length, 3);
  assert.equal(result.state.records.some(record => /trench-boars/i.test(record.summary)), true);
  assert.equal(result.state.records.some(record => /extorting fees/i.test(record.summary)), true);
  assert.equal(result.state.spatial.locations.some(location => location.name === 'Brackenford'), true);
  assert.equal(result.state.spatial.locations.some(location => location.name === 'North Road'), true);
  assert.equal(result.state.spatial.locations.some(location => location.name === 'Northgate Stockyard'), true);
  assert.equal(result.state.spatial.locations.some(location => location.name === 'Applecross Culvert'), true);
  assert.equal(result.receipts.reduce((sum, item) => sum + item.aliasRepairs, 0), 6);

  const rows = diagnostics.records('live-gemini-rebuild');
  assert.equal(rows.some(row => row.code === 'WORLD_STATE_PROVIDER_ALIAS_REPAIRED'), true);
  assert.equal(rows.some(row => row.label === 'rebuild' && row.sourceMessageId === 2), true);
});

test('five-boundary rebuild accepts a fenced final Gemini response without rolling back prior state', async () => {
  const chat = [
    { role: 'assistant', content: 'Morning mist clung to the North Road as Brackenford came into view ahead.' },
    { role: 'user', content: 'I take the boar work.' },
    { role: 'assistant', content: 'A sounder of seven trench-boars is rooted down at the Applecross culvert south of Brackenford.' },
    { role: 'user', content: 'I attack one.' },
    { role: 'assistant', content: 'One trench-boar is dead and the remaining six surge into the culvert mud.' },
    { role: 'user', content: 'I continue the fight.' },
    { role: 'assistant', content: 'Two trench-boars are dead or dying, two bolt south, and three remain near the hornbeam.' },
    { role: 'user', content: 'I finish the tusker.' },
    { role: 'assistant', content: 'Three trench-boars are dead, two yearlings are trapped by the fallen hornbeam, and two fled south. Further south, past the bend where the drainage ditch cut through the edge of the Applecross orchard lane, two trails of muddy foam marked where the first pair of runners had bolted into the low weeds.\n<World_State>\n**Loc:** Applecross Culvert | South of Brackenford | [31.4, 163.6]\n</World_State>' },
  ];
  const diagnostics = createDiagnosticStore();
  let calls = 0;
  const dispatcher = async (_ctx, options) => {
    calls += 1;
    const visibleRecordMatch = options.prompt.match(/VISIBLE CURRENT WORLD STATE \(current authority; use only these IDs\):\n(\[[^\n]*\])/);
    const visibleRecords = visibleRecordMatch ? JSON.parse(visibleRecordMatch[1]) : [];
    const boars = visibleRecords.find(record => /trench-boar/i.test(record.summary || ''));
    const visibleSpatialMatch = options.prompt.match(/VISIBLE SPATIAL CONTINUITY \(current\/base authority; use only shown IDs\):\n(\[[^\n]*\])/);
    const visibleSpatial = visibleSpatialMatch ? JSON.parse(visibleSpatialMatch[1]) : [];
    const brackenford = visibleSpatial.find(item => item.name === 'Brackenford');

    let payload;
    if (calls === 1) {
      payload = {
        mutations: [{
          action: 'create', kind: 'fact', summary: 'Noc Xu reached Brackenford by the North Road.',
          anchors: ['Noc Xu', 'Brackenford'],
          evidence: [{ sourceMessageId: 0, claim: 'Morning mist clung to the North Road as Brackenford came into view ahead.' }],
        }],
        spatialMutations: [
          {
            action: 'upsert_location', name: 'Brackenford', type: 'village', context: 'Village on the North Road', admissionReason: 'named',
            evidence: [{ sourceMessageId: 0, claim: 'Morning mist clung to the North Road as Brackenford came into view ahead.' }],
          },
          {
            action: 'upsert_route', name: 'North Road', type: 'road', context: 'Road leading toward Brackenford',
            evidence: [{ sourceMessageId: 0, claim: 'Morning mist clung to the North Road as Brackenford came into view ahead.' }],
          },
        ],
      };
    } else if (calls === 2) {
      assert.ok(brackenford?.id);
      payload = {
        mutations: [{
          action: 'create', kind: 'development', summary: 'Seven trench-boars are active at the Applecross culvert.', trend: 'stable',
          anchors: ['trench-boars', 'Applecross culvert'],
          evidence: [{ sourceMessageId: 2, claim: 'A sounder of seven trench-boars is rooted down at the Applecross culvert south of Brackenford.' }],
        }],
        spatialMutations: [{
          action: 'upsert_location', name: 'Applecross Culvert', type: 'culvert', context: 'Drainage culvert south of Brackenford', admissionReason: 'named',
          relative: { toLocationId: brackenford.id, direction: 'south', distanceKm: null, distanceMode: 'route' },
          evidence: [{ sourceMessageId: 2, claim: 'A sounder of seven trench-boars is rooted down at the Applecross culvert south of Brackenford.' }],
        }],
      };
    } else if (calls === 3) {
      assert.ok(boars?.id);
      payload = { mutations: [{
        action: 'update', recordId: boars.id, summary: 'One trench-boar is dead and six remain active in the culvert mud.', trend: 'rising',
        evidence: [{ sourceMessageId: 4, claim: 'One trench-boar is dead and the remaining six surge into the culvert mud.' }],
      }], spatialMutations: [] };
    } else if (calls === 4) {
      assert.ok(boars?.id);
      payload = { mutations: [{
        action: 'update', recordId: boars.id, kind: 'fact', status: 'active',
        summary: 'Two trench-boars are dead or dying, two fled south, and three remain near the hornbeam.', trend: null,
        evidence: [{ sourceMessageId: 6, claim: 'Two trench-boars are dead or dying, two bolt south, and three remain near the hornbeam.' }],
      }], spatialMutations: [] };
    } else {
      assert.equal(calls, 5);
      assert.ok(boars?.id);
      payload = { mutations: [{
        action: 'update', recordId: boars.id, summary: 'Three trench-boars are dead, two yearlings are trapped, and two fled south.', status: 'active', trend: null,
        evidence: [{ sourceMessageId: 8, claim: 'Three trench-boars are dead, two yearlings are trapped by the fallen hornbeam, and two fled south.' }],
      }], spatialMutations: [{
        action: 'upsert_location',
        name: 'Applecross Culvert',
        type: 'culvert',
        context: 'A drainage culvert and ditch bordering an orchard lane south of Brackenford.',
        coordinate: { x: 31.4, y: 163.6, authority: 'narrative_explicit' },
        relative: { toLocationId: brackenford.id, direction: 'south', distanceMode: 'unspecified' },
        admissionReason: 'named',
        evidence: [{
          sourceMessageId: 8,
          claim: 'Further south, past the bend where the drainage ditch cut through the edge of the Applecross orchard lane, two trails of muddy foam marked where the first pair of runners had bolted into the low weeds.',
        }],
      }] };
      const fence = '`' + '``';
      return { text: fence + 'json\n' + JSON.stringify(payload, null, 2) + '\n' + fence, receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: 'gemini-3.7-flash-high' } };
    }

    return { text: JSON.stringify(payload), receipt: { dispatched: true, outcome: 'success', route: 'test', profileId: 'gemini-3.7-flash-high' } };
  };

  const result = await runManualRebuild({
    ctx: {}, dispatcher, diagnostics, state: createState('five-boundary-fenced'), chat, chatKey: 'five-boundary-fenced', spatialEnabled: true, isCurrent: () => true,
  });

  assert.equal(calls, 5);
  assert.equal(result.outcome, 'completed');
  assert.equal(result.processedBoundaries, 5);
  assert.equal(result.state.records.some(record => /Three trench-boars are dead/i.test(record.summary)), true);
  assert.equal(result.state.spatial.locations.some(location => location.name === 'Brackenford'), true);
  assert.equal(result.state.spatial.locations.some(location => location.name === 'Applecross Culvert'), true);
  assert.equal(diagnostics.records('five-boundary-fenced').some(row => row.outcome === 'invalid-response'), false);
});
test('empty/no-assistant chat rebuild is local and does not require a provider guard', async () => {
  const state = reduceMutations(createState('empty-rebuild'), {
    chatKey: 'empty-rebuild',
    messageId: 0,
    lineageKey: chatLineage([{ role: 'user', content: 'Hello.' }])[0].lineageKey,
    mutations: [{
      action: 'create',
      kind: 'fact',
      summary: 'Old state.',
    }],
  }).state;

  const result = await runManualRebuild({
    state,
    chat: [{ role: 'user', content: 'Hello.' }],
    chatKey: 'empty-rebuild',
  });

  assert.equal(result.outcome, 'completed');
  assert.equal(result.providerCalls, 0);
  assert.deepEqual(result.state.records, []);
  assert.equal(result.state.lineage.length, 1);
});

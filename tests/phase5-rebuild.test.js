import test from 'node:test';
import assert from 'node:assert/strict';

import { chatLineage, commitMutationBoundary, seedRootCheckpoint } from '../branch.js';
import { runCaptureOperation } from '../capture.js';
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

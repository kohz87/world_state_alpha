import test from 'node:test';
import assert from 'node:assert/strict';

import { chatLineage } from '../branch.js';
import {
  CAPTURE_SYSTEM_PROMPT,
  buildCapturePrompt,
  processCaptureResponse,
  runCaptureOperation,
} from '../capture.js';
import { createDiagnosticStore } from '../diagnostics.js';
import { createState, reduceMutations } from '../state-core.js';

function withLineage(chat) {
  const lineage = chatLineage(chat);
  return chat.map((message, messageId) => ({
    ...message,
    messageId,
    lineageKey: lineage[messageId].lineageKey,
  }));
}

function sourceBoundary(exchange) {
  const last = exchange.at(-1);
  return { sourceMessageId: last.messageId, sourceLineageKey: last.lineageKey };
}

function ctxReturning(text, calls = { count: 0 }) {
  return {
    extensionSettings: { world_state_alpha: {}, disabledExtensions: [] },
    async generateRaw() {
      calls.count += 1;
      return text;
    },
  };
}

function existingState(chatKey, chat = [], mutation = null) {
  const state = createState(chatKey);
  if (!mutation || chat.length === 0) return state;
  const exchange = withLineage(chat);
  const last = exchange.at(-1);
  return reduceMutations(state, {
    chatKey,
    messageId: last.messageId,
    lineageKey: last.lineageKey,
    mutations: [mutation],
  }).state;
}

test('capture prompt explicitly rejects story-driving CoT as evidence', () => {
  assert.match(CAPTURE_SYSTEM_PROMPT, /Story-driving CoT principles/);
  assert.match(CAPTURE_SYSTEM_PROMPT, /do not apply to capture and are not evidence/);
  const prompt = buildCapturePrompt({
    exchange: withLineage([
      { role: 'user', content: 'I enter the hall.' },
      { role: 'assistant', content: 'The hall is quiet.' },
    ]),
    loreText: 'Riots sometimes occur here.',
  });
  assert.match(prompt.prompt, /LORE BASELINE/);
  assert.match(prompt.prompt, /never evidence of current occurrence/);
});

test('capture prompt requires persistent off-screen completeness instead of PC-only salience', () => {
  assert.match(CAPTURE_SYSTEM_PROMPT, /bounded for completeness/i);
  assert.match(CAPTURE_SYSTEM_PROMPT, /PC proximity.*not admission criteria/i);
  assert.match(CAPTURE_SYSTEM_PROMPT, /after the PC leaves or ignores it/i);
  assert.match(CAPTURE_SYSTEM_PROMPT, /several independent persistent conditions/i);

  const assistant = [
    '<writer_state>world_motion: market stalls unpacking; boars concealed near the ditch.</writer_state>',
    'A thick-necked carter named Orson blocks an elderly farmer\'s cart at Brackenford market.',
    '"Two Aon for the cobbles. Pay it now. We do not want these crates tipped in the horse gutters."',
    'Two other drovers stand behind him while watching whether the village watchman has left the gatehouse.',
    'The traveler ignores the shakedown and continues south.',
    'x'.repeat(7600),
    '<Blocks><World_State>',
    '**📡 Off-Screen:** Orson & Market Drovers — Harassing traders along the Brackenford stall rows',
    '**🔥 Unresolved Threads:** Extortion at Brackenford market stalls by local carters went uninterrupted.',
    '**🌱 Planted Seeds:** brush-thieves targeting cart wheels',
    '</World_State></Blocks>',
  ].join('\n');

  const prompt = buildCapturePrompt({
    exchange: withLineage([
      { role: 'user', content: 'I tear down the boar bounty, rent a handcart, then leave town.' },
      { role: 'assistant', content: assistant },
    ]),
  });

  assert.match(prompt.prompt, /PERSISTENCE COMPLETENESS CHECK/);
  assert.match(prompt.prompt, /Orson blocks an elderly farmer/);
  assert.match(prompt.prompt, /Extortion at Brackenford market stalls by local carters went uninterrupted/);
  assert.match(prompt.prompt, /off-screen, ignored by the PC/i);
});

test('established market extortion can coexist with a PC-adjacent capture in one bounded call', async () => {
  const chatKey = 'persistent-offscreen';
  const exchange = withLineage([
    { role: 'user', content: 'I ignore the market trouble and head for the Applecross ditch.' },
    {
      role: 'assistant',
      content: [
        'At Brackenford market, Orson blocks an elderly farmer\'s handcart and demands an unauthorized two-Aon unloading fee.',
        'Two other drovers back him while watching for the village watchman.',
        'The traveler leaves the shakedown uninterrupted and reaches Applecross Culvert.',
        'Seven trench-boars are bedded in an undercut hollow beneath the hornbeam roots.',
      ].join(' '),
    },
  ]);

  const response = JSON.stringify({
    mutations: [
      {
        action: 'create',
        kind: 'development',
        summary: 'Orson and local carters are extorting Brackenford market traders for unauthorized unloading fees.',
        trend: 'stable',
        anchors: ['Brackenford', 'market', 'Orson', 'carters', 'traders'],
        evidence: [{
          sourceMessageId: 1,
          claim: 'Orson blocks an elderly farmer\'s handcart and demands an unauthorized two-Aon unloading fee.',
        }],
      },
      {
        action: 'create',
        kind: 'fact',
        summary: 'Seven trench-boars are bedded beneath the hornbeam roots at Applecross Culvert.',
        anchors: ['Applecross Culvert', 'trench-boars', 'hornbeam'],
        evidence: [{
          sourceMessageId: 1,
          claim: 'Seven trench-boars are bedded in an undercut hollow beneath the hornbeam roots.',
        }],
      },
    ],
  });

  const result = await runCaptureOperation({
    ctx: ctxReturning(response),
    state: existingState(chatKey),
    exchange,
    chatKey,
    ...sourceBoundary(exchange),
    isCurrent: () => true,
  });

  assert.equal(result.outcome, 'applied');
  assert.equal(result.state.records.length, 2);
  assert.equal(result.state.records.filter(record => record.kind === 'development').length, 1);
  assert.match(result.state.records.find(record => record.kind === 'development').summary, /extorting Brackenford market traders/i);
  assert.match(result.state.records.find(record => record.kind === 'fact').summary, /trench-boars/i);
});

test('direct established fact is captured in one provider call', async () => {
  const chatKey = 'direct';
  const exchange = withLineage([
    { role: 'user', content: 'I watch the bridge.' },
    { role: 'assistant', content: 'The bridge collapses into the river.' },
  ]);
  const response = JSON.stringify({
    mutations: [{
      action: 'create',
      kind: 'fact',
      summary: 'The bridge is destroyed.',
      anchors: ['bridge'],
      evidence: [{ sourceMessageId: 1, claim: 'The bridge collapses into the river.' }],
    }],
  });
  const calls = { count: 0 };
  const result = await runCaptureOperation({
    ctx: ctxReturning(response, calls),
    isCurrent: () => true,
    state: existingState(chatKey),
    exchange,
    visibleRecords: [],
    chatKey,
    ...sourceBoundary(exchange),
  });
  assert.equal(calls.count, 1);
  assert.equal(result.outcome, 'applied');
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].summary, 'The bridge is destroyed.');
  assert.equal(Object.values(result.state.evidence)[0].sourceClass, 'assistant_narration');
  assert.equal(result.state.lastCaptureMessage, 1);
});

test('valid no-change response performs one call and creates no record', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I sit down.' },
    { role: 'assistant', content: 'Nothing in the wider setting changes.' },
  ]);
  const calls = { count: 0 };
  const result = await runCaptureOperation({
    ctx: ctxReturning('{"mutations":[]}', calls),
    isCurrent: () => true,
    state: existingState('quiet'),
    exchange,
    chatKey: 'quiet',
    ...sourceBoundary(exchange),
  });
  assert.equal(calls.count, 1);
  assert.equal(result.outcome, 'no-change');
  assert.equal(result.state.records.length, 0);
  assert.equal(result.state.lastCaptureMessage, 1);
});

test('lore possibility cannot become current state because lore is not evidence', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I walk through the square.' },
    { role: 'assistant', content: 'The square is calm this afternoon.' },
  ]);
  const response = JSON.stringify({
    mutations: [{
      action: 'create',
      kind: 'development',
      summary: 'A riot is active in the square.',
      anchors: ['square', 'riot'],
      evidence: [{ sourceMessageId: 1, claim: 'Riots sometimes occur here.' }],
    }],
  });
  const result = await runCaptureOperation({
    ctx: ctxReturning(response),
    isCurrent: () => true,
    state: existingState('lore-trap'),
    exchange,
    loreText: 'Riots sometimes occur here.',
    chatKey: 'lore-trap',
    ...sourceBoundary(exchange),
  });
  assert.equal(result.state.records.length, 0);
  assert.equal(result.rejected[0].stage, 'source-firewall');
});

test('Writer Mind world-motion invention is rejected when not grounded in exchange', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I wait by the station window.' },
    { role: 'assistant', content: 'Rain taps softly against the glass.' },
  ]);
  const response = JSON.stringify({
    mutations: [{
      action: 'create',
      kind: 'development',
      summary: 'A sabotage crisis begins at the reactor.',
      anchors: ['reactor'],
      reason: 'Avoid stagnation and create autonomous world motion.',
      evidence: [{ sourceMessageId: 1, claim: 'A sabotage crisis begins at the reactor.' }],
    }],
  });
  const result = await runCaptureOperation({
    ctx: ctxReturning(response),
    isCurrent: () => true,
    state: existingState('cot-firewall'),
    exchange,
    chatKey: 'cot-firewall',
    ...sourceBoundary(exchange),
  });
  assert.equal(result.state.records.length, 0);
  assert.equal(result.rejected[0].stage, 'source-firewall');
});

test('unknown record IDs are rejected instead of allowing hallucinated updates', () => {
  const exchange = withLineage([
    { role: 'user', content: 'I look at the gate.' },
    { role: 'assistant', content: 'The gate remains closed.' },
  ]);
  const state = existingState('unknown-id');
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'update',
        recordId: 'wsr_hallucinated',
        summary: 'The gate remains closed.',
        evidence: [{ sourceMessageId: 1, claim: 'The gate remains closed.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [],
    chatKey: 'unknown-id',
    ...sourceBoundary(exchange),
  });
  assert.equal(result.state.records.length, 0);
  assert.equal(result.rejected[0].stage, 'source-firewall');
});

test('semantically duplicate active create consolidates into existing record', () => {
  const baseChat = [{ role: 'assistant', content: 'A labor strike begins at the factory.' }];
  const state = existingState('dup-active', baseChat, {
    action: 'create',
    kind: 'development',
    summary: 'The factory labor strike is active.',
    anchors: ['factory', 'labor strike'],
  });
  const existing = state.records[0];
  const exchange = withLineage([
    { role: 'assistant', content: 'A labor strike begins at the factory.' },
    { role: 'assistant', content: 'The factory labor strike remains active as negotiations stall.' },
  ]);
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        summary: 'The factory labor strike remains active; negotiations are stalled.',
        trend: 'stable',
        anchors: ['factory', 'labor strike'],
        evidence: [{ sourceMessageId: 1, claim: 'The factory labor strike remains active as negotiations stall.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [existing],
    chatKey: 'dup-active',
    sourceMessageId: 1,
    sourceLineageKey: exchange.at(-1).lineageKey,
  });
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].id, existing.id);
  assert.match(result.state.records[0].summary, /negotiations are stalled/);
});

test('duplicate create that establishes resolution resolves the existing active record', () => {
  const baseChat = [{ role: 'assistant', content: 'The factory labor strike is active.' }];
  const state = existingState('dup-resolve', baseChat, {
    action: 'create',
    kind: 'development',
    summary: 'The factory labor strike is active.',
    anchors: ['factory', 'labor strike'],
  });
  const existing = state.records[0];
  const exchange = withLineage([
    { role: 'assistant', content: 'The factory labor strike is active.' },
    { role: 'assistant', content: 'The factory labor strike ends after an agreement.' },
  ]);
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        status: 'resolved',
        summary: 'The factory labor strike is resolved.',
        anchors: ['factory', 'labor strike'],
        evidence: [{ sourceMessageId: 1, claim: 'The factory labor strike ends after an agreement.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [existing],
    chatKey: 'dup-resolve',
    sourceMessageId: 1,
    sourceLineageKey: exchange.at(-1).lineageKey,
  });
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].id, existing.id);
  assert.equal(result.state.records[0].status, 'resolved');
});

test('capture cannot mutate a record outside the bounded visible context even if caller passes more records', () => {
  const chat = withLineage([{ role: 'assistant', content: 'Nine independent conditions are established.' }]);
  const state = reduceMutations(createState('bounded-visible'), {
    chatKey: 'bounded-visible',
    messageId: 0,
    lineageKey: chat[0].lineageKey,
    mutations: Array.from({ length: 9 }, (_, index) => ({
      action: 'create',
      kind: 'fact',
      summary: `Condition ${index + 1} is active.`,
      anchors: [`condition-${index + 1}`],
    })),
  }).state;
  const hidden = state.records[8];
  const exchange = withLineage([
    { role: 'assistant', content: 'Nine independent conditions are established.' },
    { role: 'assistant', content: 'Condition 9 changes materially.' },
  ]);
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'update',
        recordId: hidden.id,
        summary: 'Condition 9 changed.',
        evidence: [{ sourceMessageId: 1, claim: 'Condition 9 changes materially.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: state.records,
    chatKey: 'bounded-visible',
    sourceMessageId: 1,
    sourceLineageKey: exchange.at(-1).lineageKey,
  });
  assert.equal(result.rejected[0].stage, 'source-firewall');
  assert.equal(result.state.records.find(record => record.id === hidden.id).summary, hidden.summary);
});

test('resolved episode cannot resurrect from continuing underlying tension', () => {
  const baseChat = [{ role: 'assistant', content: 'The dock strike ends after an agreement.' }];
  const state = existingState('resolved', baseChat, {
    action: 'create',
    kind: 'development',
    summary: 'The dock strike is resolved.',
    status: 'resolved',
    anchors: ['dock strike', 'harbor wages'],
  });
  const existing = state.records[0];
  const exchange = withLineage([
    { role: 'assistant', content: 'The dock strike ends after an agreement.' },
    { role: 'assistant', content: 'Harbor wage tensions remain, but no new strike has begun.' },
  ]);
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        summary: 'The dock strike is active.',
        anchors: ['dock strike', 'harbor wages'],
        evidence: [{ sourceMessageId: 1, claim: 'Harbor wage tensions remain, but no new strike has begun.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [existing],
    chatKey: 'resolved',
    sourceMessageId: 1,
    sourceLineageKey: exchange.at(-1).lineageKey,
  });
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].status, 'resolved');
  assert.equal(result.rejected[0].stage, 'duplicate-gate');
});

test('explicit new episode may create a new record while preserving resolved predecessor', () => {
  const baseChat = [{ role: 'assistant', content: 'The dock strike ends after an agreement.' }];
  const state = existingState('new-episode', baseChat, {
    action: 'create',
    kind: 'development',
    summary: 'The dock strike is resolved.',
    status: 'resolved',
    anchors: ['dock strike', 'harbor wages'],
  });
  const prior = state.records[0];
  const exchange = withLineage([
    { role: 'assistant', content: 'The dock strike ends after an agreement.' },
    { role: 'assistant', content: 'A new dock strike begins today over a separate wage dispute.' },
  ]);
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        summary: 'A new dock strike is active.',
        anchors: ['dock strike', 'harbor wages'],
        newEpisodeOfRecordId: prior.id,
        evidence: [{ sourceMessageId: 1, claim: 'A new dock strike begins today over a separate wage dispute.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [prior],
    chatKey: 'new-episode',
    sourceMessageId: 1,
    sourceLineageKey: exchange.at(-1).lineageKey,
  });
  assert.equal(result.state.records.length, 2);
  assert.equal(result.state.records.find(record => record.id === prior.id).status, 'resolved');
  assert.ok(result.state.records.some(record => record.id !== prior.id && record.status === 'active'));
});

test('malformed provider JSON causes no mutation and no correction retry', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I watch.' },
    { role: 'assistant', content: 'The road closes after a landslide.' },
  ]);
  const calls = { count: 0 };
  const state = existingState('bad-json');
  const result = await runCaptureOperation({
    ctx: ctxReturning('markdown wrapper {"mutations":[]}', calls),
    isCurrent: () => true,
    state,
    exchange,
    chatKey: 'bad-json',
    ...sourceBoundary(exchange),
  });
  assert.equal(calls.count, 1);
  assert.equal(result.outcome, 'invalid-response');
  assert.deepEqual(result.state.records, state.records);
  assert.equal(result.state.lastCaptureMessage, 1);

  const repeated = await runCaptureOperation({
    ctx: ctxReturning('{"mutations":[]}', calls),
    isCurrent: () => true,
    state: result.state,
    exchange,
    chatKey: 'bad-json',
    ...sourceBoundary(exchange),
  });
  assert.equal(repeated.outcome, 'skipped');
  assert.equal(calls.count, 1);
});

test('automatic capture refuses to run without a currentness guard', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I wait.' },
    { role: 'assistant', content: 'The road closes.' },
  ]);
  const calls = { count: 0 };
  await assert.rejects(
    runCaptureOperation({
      ctx: ctxReturning('{"mutations":[]}', calls),
      state: existingState('guard-required'),
      exchange,
      chatKey: 'guard-required',
      ...sourceBoundary(exchange),
    }),
    error => error?.code === 'WORLD_STATE_CAPTURE_CURRENT_GUARD_REQUIRED',
  );
  assert.equal(calls.count, 0);
});

test('duplicate assistant receipt does not issue a second capture request', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I sit quietly.' },
    { role: 'assistant', content: 'The room remains unchanged.' },
  ]);
  const calls = { count: 0 };
  const first = await runCaptureOperation({
    ctx: ctxReturning('{"mutations":[]}', calls),
    isCurrent: () => true,
    state: existingState('duplicate-receipt'),
    exchange,
    chatKey: 'duplicate-receipt',
    ...sourceBoundary(exchange),
  });
  const second = await runCaptureOperation({
    ctx: ctxReturning('{"mutations":[]}', calls),
    isCurrent: () => true,
    state: first.state,
    exchange,
    chatKey: 'duplicate-receipt',
    ...sourceBoundary(exchange),
  });
  assert.equal(first.providerCalls, 1);
  assert.equal(second.outcome, 'skipped');
  assert.equal(second.providerCalls, 0);
  assert.equal(calls.count, 1);
});

test('stale result is discarded when currentness changes during provider call', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I wait.' },
    { role: 'assistant', content: 'The road closes.' },
  ]);
  const state = existingState('stale');
  let current = true;
  const ctx = ctxReturning('{"mutations":[]}');
  ctx.generateRaw = async () => {
    current = false;
    return '{"mutations":[]}';
  };
  const result = await runCaptureOperation({
    ctx,
    state,
    exchange,
    chatKey: 'stale',
    isCurrent: () => current,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.outcome, 'stale');
  assert.equal(result.errorCode, 'WORLD_STATE_ROUTE_CANCELLED');
  assert.equal(result.state.lastCaptureMessage, null);
  assert.equal(state.records.length, 0);
});

test('dispatched provider failure marks the boundary attempted without mutating world records', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I observe the road.' },
    { role: 'assistant', content: 'The road remains open.' },
  ]);
  const calls = { count: 0 };
  const ctx = ctxReturning('unused', calls);
  ctx.generateRaw = async () => {
    calls.count += 1;
    const error = new Error('provider failed');
    error.code = 'UPSTREAM_FAILURE';
    throw error;
  };
  const result = await runCaptureOperation({
    ctx,
    state: existingState('provider-failure'),
    exchange,
    chatKey: 'provider-failure',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.outcome, 'failure');
  assert.equal(result.providerCalls, 1);
  assert.equal(result.state.records.length, 0);
  assert.equal(result.state.lastCaptureMessage, 1);

  const repeated = await runCaptureOperation({
    ctx,
    state: result.state,
    exchange,
    chatKey: 'provider-failure',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(repeated.outcome, 'skipped');
  assert.equal(calls.count, 1);
});

test('low-information evidence excerpt cannot ground a mutation', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I inspect the square.' },
    { role: 'assistant', content: 'The square is calm and empty.' },
  ]);
  const response = JSON.stringify({
    mutations: [{
      action: 'create',
      kind: 'development',
      summary: 'A riot is active.',
      anchors: ['riot'],
      evidence: [{ sourceMessageId: 1, claim: 'The' }],
    }],
  });
  const result = await runCaptureOperation({
    ctx: ctxReturning(response),
    state: existingState('weak-evidence'),
    exchange,
    chatKey: 'weak-evidence',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.state.records.length, 0);
  assert.equal(result.rejected[0].stage, 'source-firewall');
});

test('diagnostics are allowlisted and never retain prompt, story, or provider response', async () => {
  const secretStory = 'PRIVATE_STORY_PAYLOAD_91827';
  const exchange = withLineage([
    { role: 'user', content: 'I listen.' },
    { role: 'assistant', content: secretStory },
  ]);
  const diagnostics = createDiagnosticStore();
  await runCaptureOperation({
    ctx: ctxReturning('{"mutations":[]}'),
    isCurrent: () => true,
    state: existingState('diagnostics'),
    exchange,
    chatKey: 'diagnostics',
    operationId: 'capture-1',
    diagnostics,
    ...sourceBoundary(exchange),
  });
  const exported = JSON.stringify(diagnostics.bundle('diagnostics', '0.2.0-alpha.1'));
  assert.doesNotMatch(exported, /PRIVATE_STORY_PAYLOAD_91827|CURRENT EXCHANGE/);
  assert.match(exported, /capture-1/);
});

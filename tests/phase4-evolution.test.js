import test from 'node:test';
import assert from 'node:assert/strict';

import { chatLineage, commitMutationBoundary, reconcileBranch } from '../branch.js';
import {
  EVOLUTION_SYSTEM_PROMPT,
  buildEvolutionContext,
  buildEvolutionPrompt,
  planLazyEvolution,
  prepareWorldStateContinuity,
  processEvolutionResponse,
  runLazyEvolution,
} from '../evolution.js';
import { buildRelevanceIndex, selectBackgroundDevelopments } from '../relevance.js';
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

function provider(text, calls = { count: 0 }, onCall = null) {
  return {
    extensionSettings: { world_state_alpha: {}, disabledExtensions: [] },
    async generateRaw() {
      calls.count += 1;
      onCall?.();
      return text;
    },
  };
}

function seedDevelopments(chatKey, definitions, {
  baseText = 'The established developments are described here.',
  withEvidence = true,
} = {}) {
  const chat = [{ role: 'assistant', content: baseText }];
  const exchange = withLineage(chat);
  const mutations = definitions.map(definition => ({
    action: 'create',
    kind: 'development',
    summary: definition.summary,
    trend: definition.trend ?? 'stable',
    anchors: definition.anchors || [],
    status: definition.status || 'active',
    ...(withEvidence ? {
      evidence: [{
        sourceMessageId: 0,
        lineageKey: exchange[0].lineageKey,
        sourceClass: 'assistant_narration',
        claim: definition.evidenceClaim || baseText,
      }],
    } : {}),
  }));
  const reduced = reduceMutations(createState(chatKey), {
    chatKey,
    messageId: 0,
    lineageKey: exchange[0].lineageKey,
    mutations,
  });
  return { state: reduced.state, chat, exchange };
}

function selected(state) {
  return state.records
    .filter(record => record.status === 'active')
    .map(record => ({ record, score: 10, source: 'seed', reasons: ['recent-anchor'] }));
}

test('evolution prompt makes elapsed time permission to evaluate, not evidence of change', () => {
  assert.match(EVOLUTION_SYSTEM_PROMPT, /Elapsed time is permission to evaluate/);
  assert.match(EVOLUTION_SYSTEM_PROMPT, /elapsed time alone is not evidence that a change occurred/);
  assert.match(EVOLUTION_SYSTEM_PROMPT, /Story-driving CoT principles/);
  assert.match(EVOLUTION_SYSTEM_PROMPT, /Prefer stable/);

  const seeded = seedDevelopments('prompt', [{
    summary: 'The reactor output is degrading.',
    anchors: ['reactor'],
    evidenceClaim: 'The reactor output is degrading because coolant pumps are failing.',
  }]);
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the reactor.' },
  ]);
  const plan = planLazyEvolution(seeded.state, {
    selectedEntries: selected(seeded.state),
    exchange,
    ...sourceBoundary(exchange),
  });
  const context = buildEvolutionContext(seeded.state, plan);
  const prompt = buildEvolutionPrompt(context, { loreText: 'The station has redundant reactor systems.' });
  assert.match(prompt.prompt, /MEANINGFUL ELAPSED HINT/);
  assert.match(prompt.prompt, /not occurrence evidence/);
});

test('meaningful five-week skip targets only selected stale developments', () => {
  const seeded = seedDevelopments('plan-time', [
    { summary: 'The freight dispute is active.', anchors: ['Kesselpass', 'freight'] },
    { summary: 'A remote ferry suspension is active.', anchors: ['remote ferry'] },
  ]);
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to Kesselpass.' },
  ]);
  const plan = planLazyEvolution(seeded.state, {
    selectedEntries: [{ record: seeded.state.records[0], score: 10, source: 'seed' }],
    exchange,
    ...sourceBoundary(exchange),
  });
  assert.equal(plan.elapsedHint.meaningful, true);
  assert.deepEqual(plan.targets.map(target => target.record.id), [seeded.state.records[0].id]);
});

test('short elapsed time alone does not trigger evolution', () => {
  const seeded = seedDevelopments('plan-short', [{
    summary: 'The student protest is active.',
    anchors: ['student protest'],
  }]);
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Three hours later, I return to the student protest.' },
  ]);
  const plan = planLazyEvolution(seeded.state, {
    selectedEntries: selected(seeded.state),
    exchange,
    ...sourceBoundary(exchange),
  });
  assert.equal(plan.elapsedHint.meaningful, false);
  assert.equal(plan.targets.length, 0);
});

test('grounded current affecting evidence triggers a stale relevant development without elapsed time', () => {
  const seeded = seedDevelopments('direct-trigger', [{
    summary: 'The freight dispute is active.',
    anchors: ['freight dispute'],
  }]);
  const record = seeded.state.records[0];
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Hadrik closes the freight gate completely today.' },
  ]);
  const plan = planLazyEvolution(seeded.state, {
    selectedEntries: selected(seeded.state),
    exchange,
    affectingEvidence: [{
      recordId: record.id,
      sourceMessageId: 1,
      claim: 'Hadrik closes the freight gate completely today.',
    }],
    ...sourceBoundary(exchange),
  });
  assert.equal(plan.targets.length, 1);
  assert.equal(plan.targets[0].trigger.directEvidence, true);
  assert.equal(plan.targets[0].trigger.elapsed, false);
});

test('ungrounded affecting evidence cannot trigger evolution', () => {
  const seeded = seedDevelopments('bad-direct', [{
    summary: 'The freight dispute is active.',
    anchors: ['freight dispute'],
  }]);
  const record = seeded.state.records[0];
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'I look at the gate.' },
  ]);
  const plan = planLazyEvolution(seeded.state, {
    selectedEntries: selected(seeded.state),
    exchange,
    affectingEvidence: [{
      recordId: record.id,
      sourceMessageId: 1,
      claim: 'Hadrik closes the freight gate completely today.',
    }],
    ...sourceBoundary(exchange),
  });
  assert.equal(plan.targets.length, 0);
  assert.equal(plan.rejectedAffectingEvidence.length, 1);
});

test('stable catch-up advances evaluation provenance without changing current world truth', async () => {
  const seeded = seedDevelopments('stable', [{
    summary: 'The dock labor dispute remains active.',
    anchors: ['dock labor dispute'],
    evidenceClaim: 'The dock labor dispute remains active after negotiations stall.',
  }]);
  const before = seeded.state.records[0];
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the docks.' },
  ]);
  const response = JSON.stringify({
    evaluations: [{
      recordId: before.id,
      outcome: 'stable',
      reason: 'Elapsed time permits reevaluation, but no supplied evidence establishes a change.',
      supportIds: ['t0'],
    }],
    derived: [],
  });
  const calls = { count: 0 };
  const result = await runLazyEvolution({
    ctx: provider(response, calls),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    chatKey: 'stable',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  const after = result.state.records[0];
  assert.equal(calls.count, 1);
  assert.equal(result.outcome, 'stable');
  assert.equal(after.summary, before.summary);
  assert.equal(after.trend, before.trend);
  assert.equal(after.lastChangedMessage, before.lastChangedMessage);
  assert.equal(after.lastEvaluatedMessage, 1);
  assert.equal(result.state.lastCaptureMessage, 0);
  const elapsedEvidence = Object.values(result.state.evidence).find(item => item.sourceClass === 'elapsed_hint');
  assert.ok(elapsedEvidence);
  assert.match(elapsedEvidence.claim, /Five weeks later/);
  assert.match(elapsedEvidence.claim, /Kesselpass|freight|returns|later/i);
});

test('time alone may not admit a changed outcome', async () => {
  const seeded = seedDevelopments('time-only-change', [{
    summary: 'The reactor degradation is active.',
    anchors: ['reactor'],
  }], { withEvidence: false });
  const record = seeded.state.records[0];
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the reactor.' },
  ]);
  const response = JSON.stringify({
    evaluations: [{
      recordId: record.id,
      outcome: 'update',
      summary: 'The reactor has failed completely.',
      reason: 'Five weeks passed.',
      supportIds: ['t0'],
    }],
    derived: [],
  });
  const result = await runLazyEvolution({
    ctx: provider(response),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    chatKey: 'time-only-change',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.outcome, 'invalid-response');
  assert.equal(result.state.records[0].summary, record.summary);
  assert.equal(result.state.records[0].lastEvaluatedMessage, 0);
});

test('meaningful elapsed time plus prior accepted causal evidence can update one development', async () => {
  const seeded = seedDevelopments('time-grounded-change', [{
    summary: 'Reactor output is declining as coolant pumps continue degrading.',
    trend: 'falling',
    anchors: ['reactor', 'coolant pumps'],
    evidenceClaim: 'Reactor output is declining because the coolant pumps continue degrading.',
  }]);
  const record = seeded.state.records[0];
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I check the reactor again.' },
  ]);
  const response = JSON.stringify({
    evaluations: [{
      recordId: record.id,
      outcome: 'update',
      summary: 'Reactor output remains constrained as coolant degradation continues.',
      trend: 'falling',
      reason: 'The established degradation mechanism remains active over the meaningful elapsed interval.',
      supportIds: ['t0', 'h0'],
    }],
    derived: [],
  });
  const result = await runLazyEvolution({
    ctx: provider(response),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    currentTimeAnchor: 'Cycle 44',
    chatKey: 'time-grounded-change',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.outcome, 'evolved');
  assert.match(result.state.records[0].summary, /remains constrained/);
  assert.equal(result.state.records[0].lastChangedMessage, 1);
  assert.equal(result.state.records[0].lastEvaluatedMessage, 1);
  assert.equal(result.state.records[0].timeAnchor, 'Cycle 44');
});

test('grounded current affecting evidence can admit a change without elapsed time', async () => {
  const seeded = seedDevelopments('current-change', [{
    summary: 'The freight gate dispute is active.',
    anchors: ['freight gate'],
  }]);
  const record = seeded.state.records[0];
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Hadrik closes the freight gate completely today.' },
  ]);
  const response = JSON.stringify({
    evaluations: [{
      recordId: record.id,
      outcome: 'update',
      summary: 'The freight gate dispute has intensified after Hadrik fully closed the gate.',
      trend: 'rising',
      reason: 'The current exchange directly establishes a stronger restriction.',
      supportIds: ['c0'],
    }],
    derived: [],
  });
  const result = await runLazyEvolution({
    ctx: provider(response),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    affectingEvidence: [{
      recordId: record.id,
      sourceMessageId: 1,
      claim: 'Hadrik closes the freight gate completely today.',
    }],
    chatKey: 'current-change',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.outcome, 'evolved');
  assert.equal(result.state.records[0].trend, 'rising');
  assert.ok(Object.values(result.state.evidence).some(item => item.claim.includes('closes the freight gate')));
});

test('prepare continuity performs a five-week catch-up then reruns injection from updated state', async () => {
  const seeded = seedDevelopments('prepare-five-week', [{
    summary: 'Kesselpass freight traffic is congested.',
    trend: 'rising',
    anchors: ['Kesselpass', 'freight traffic'],
    evidenceClaim: 'Kesselpass freight traffic is congested by diverted caravans.',
  }]);
  const record = seeded.state.records[0];
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, Lucien returns to Kesselpass.' },
  ]);
  const response = JSON.stringify({
    evaluations: [{
      recordId: record.id,
      outcome: 'update',
      summary: 'Kesselpass freight congestion remains severe but has stopped worsening.',
      trend: 'stable',
      reason: 'The established congestion persisted across the elapsed interval without evidence of further escalation.',
      supportIds: ['t0', 'h0'],
    }],
    derived: [],
  });
  const calls = { count: 0 };
  const result = await prepareWorldStateContinuity({
    ctx: provider(response, calls),
    state: seeded.state,
    recentText: 'Five weeks later, Lucien returns to Kesselpass.',
    exchange,
    currentMessageId: 1,
    chatKey: 'prepare-five-week',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(calls.count, 1);
  assert.equal(result.providerCalls, 1);
  assert.equal(result.evolution.outcome, 'evolved');
  assert.match(result.injection.text, /stopped worsening/);
  assert.match(result.injection.text, /trend: stable/);
});

test('background selector examines only a bounded stale-development slice', () => {
  const seeded = seedDevelopments(
    'background-pool',
    Array.from({ length: 40 }, (_, index) => ({
      summary: `Remote development ${index} remains active.`,
      anchors: [`remote-${index}`],
    })),
  );
  const index = buildRelevanceIndex(seeded.state);
  const excludedId = seeded.state.records[0].id;
  const result = selectBackgroundDevelopments(index, {
    excludeIds: new Set([excludedId]),
    currentMessageId: 500,
    maxRecords: 3,
    scanCap: 9,
  });

  assert.equal(result.metrics.examined, 9);
  assert.equal(result.selected.length, 3);
  assert.equal(result.selected.some(entry => entry.record.id === excludedId), false);
  assert.ok(result.selected.every(entry => entry.source === 'background'));
  assert.equal(index.backgroundCursor, 9);
});

test('meaningful elapsed time catches up remote developments even when none are scene-relevant', async () => {
  const seeded = seedDevelopments('background-catchup', [
    { summary: 'North quarry labor unrest remains active.', anchors: ['North quarry'] },
    { summary: 'West canal silting remains unresolved.', anchors: ['West canal'] },
    { summary: 'Hill shrine repairs remain incomplete.', anchors: ['Hill shrine'] },
    { summary: 'East orchard blight remains active.', anchors: ['East orchard'] },
    { summary: 'South ferry shortage remains active.', anchors: ['South ferry'] },
  ]);
  const index = buildRelevanceIndex(seeded.state);
  const exchange = [{
    role: 'user',
    content: 'Five weeks later, I remain at an unrelated observatory.',
    messageId: 500,
    lineageKey: 'lineage-500',
  }];
  const backgroundIds = seeded.state.records.slice(0, 3).map(record => record.id);
  const response = JSON.stringify({
    evaluations: backgroundIds.map(recordId => ({
      recordId,
      outcome: 'stable',
      reason: 'Elapsed time permits reevaluation, but no supplied evidence establishes a change.',
      supportIds: ['t0'],
    })),
    derived: [],
  });
  const calls = { count: 0 };

  const result = await prepareWorldStateContinuity({
    ctx: provider(response, calls),
    state: seeded.state,
    index,
    recentText: exchange[0].content,
    currentMessageId: 500,
    exchange,
    chatKey: 'background-catchup',
    sourceMessageId: 500,
    sourceLineageKey: 'lineage-500',
    isCurrent: () => true,
  });

  assert.equal(calls.count, 1);
  assert.equal(result.providerCalls, 1);
  assert.equal(result.evolution.backgroundSelection.selected, 3);
  assert.deepEqual(result.evolution.plan.targets.map(target => target.record.id), backgroundIds);
  for (const recordId of backgroundIds) {
    assert.equal(result.state.records.find(record => record.id === recordId).lastEvaluatedMessage, 500);
  }

  const repeated = await prepareWorldStateContinuity({
    ctx: provider('unused', calls),
    state: result.state,
    index,
    recentText: exchange[0].content,
    currentMessageId: 501,
    exchange,
    chatKey: 'background-catchup',
    sourceMessageId: 501,
    sourceLineageKey: 'lineage-501',
    isCurrent: () => true,
  });
  assert.equal(calls.count, 1);
  assert.equal(repeated.providerCalls, 0);
  assert.equal(repeated.evolution.backgroundSelection.boundaryAlreadyProcessed, true);

  const rehydratedIndex = buildRelevanceIndex(result.state);
  const rehydratedSweep = selectBackgroundDevelopments(rehydratedIndex, {
    currentMessageId: 500,
    maxRecords: 3,
    scanCap: 32,
  });
  assert.equal(rehydratedSweep.selected.length, 0);
  assert.equal(rehydratedSweep.metrics.boundaryAlreadyProcessed, true);
});

test('relevant targets keep priority and background only fills the remaining six-target batch slots', async () => {
  const seeded = seedDevelopments('background-fill', [
    { summary: 'Kesselpass freight congestion remains active.', anchors: ['Kesselpass'] },
    { summary: 'Kesselpass hiring pressure remains active.', anchors: ['Kesselpass'] },
    { summary: 'Kesselpass lodging pressure remains active.', anchors: ['Kesselpass'] },
    { summary: 'Kesselpass inspection delays remain active.', anchors: ['Kesselpass'] },
    { summary: 'North quarry labor unrest remains active.', anchors: ['North quarry'] },
    { summary: 'West canal silting remains unresolved.', anchors: ['West canal'] },
    { summary: 'Hill shrine repairs remain incomplete.', anchors: ['Hill shrine'] },
    { summary: 'East orchard blight remains active.', anchors: ['East orchard'] },
  ]);
  const index = buildRelevanceIndex(seeded.state);
  const exchange = [{
    role: 'user',
    content: 'Five weeks later, I return to Kesselpass.',
    messageId: 500,
    lineageKey: 'lineage-500',
  }];
  const relevantIds = seeded.state.records.slice(0, 4).map(record => record.id);
  const remoteIds = seeded.state.records.slice(4).map(record => record.id);
  const responseIds = [...relevantIds, ...remoteIds.slice(0, 2)];
  const response = JSON.stringify({
    evaluations: responseIds.map(recordId => ({
      recordId,
      outcome: 'stable',
      reason: 'Elapsed time permits reevaluation, but no supplied evidence establishes a change.',
      supportIds: ['t0'],
    })),
    derived: [],
  });

  const result = await prepareWorldStateContinuity({
    ctx: provider(response),
    state: seeded.state,
    index,
    recentText: exchange[0].content,
    currentMessageId: 500,
    exchange,
    chatKey: 'background-fill',
    sourceMessageId: 500,
    sourceLineageKey: 'lineage-500',
    isCurrent: () => true,
  });

  const targetIds = result.evolution.plan.targets.map(target => target.record.id);
  assert.equal(targetIds.length, 6);
  assert.deepEqual(new Set(targetIds.slice(0, 4)), new Set(relevantIds));
  assert.equal(targetIds.slice(4).every(id => remoteIds.includes(id)), true);
  assert.equal(result.evolution.backgroundSelection.selected, 2);
});

test('background catch-up stays dormant without meaningful elapsed time', async () => {
  const seeded = seedDevelopments('background-no-time', [
    { summary: 'Remote bridge repairs remain incomplete.', anchors: ['Remote bridge'] },
  ]);
  const index = buildRelevanceIndex(seeded.state);
  const exchange = [{
    role: 'user',
    content: 'I remain at an unrelated observatory.',
    messageId: 500,
    lineageKey: 'lineage-500',
  }];
  const calls = { count: 0 };

  const result = await prepareWorldStateContinuity({
    ctx: provider('unused', calls),
    state: seeded.state,
    index,
    recentText: exchange[0].content,
    currentMessageId: 500,
    exchange,
    chatKey: 'background-no-time',
    sourceMessageId: 500,
    sourceLineageKey: 'lineage-500',
    isCurrent: () => true,
  });

  assert.equal(calls.count, 0);
  assert.equal(result.providerCalls, 0);
  assert.equal(result.evolution.backgroundSelection.selected, 0);
  assert.equal(result.state.records[0].lastEvaluatedMessage, 0);
});

test('ordinary relevant turn with no trigger uses zero evolution calls', async () => {
  const seeded = seedDevelopments('no-trigger', [{
    summary: 'East Dormitory is inaccessible.',
    anchors: ['East Dormitory'],
  }]);
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'I walk toward East Dormitory.' },
  ]);
  const calls = { count: 0 };
  const result = await prepareWorldStateContinuity({
    ctx: provider('unused', calls),
    state: seeded.state,
    recentText: 'I walk toward East Dormitory.',
    exchange,
    currentMessageId: 1,
    chatKey: 'no-trigger',
    ...sourceBoundary(exchange),
  });
  assert.equal(calls.count, 0);
  assert.equal(result.evolution.outcome, 'skipped');
  assert.match(result.injection.text, /East Dormitory is inaccessible/);
});

test('background catch-up never falls back to a full-state scan when no relevance index is supplied', async () => {
  const seeded = seedDevelopments('irrelevant', [{
    summary: 'The southern ferry dispute is active.',
    anchors: ['southern ferry'],
  }]);
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I enter East Dormitory.' },
  ]);
  const calls = { count: 0 };
  const result = await prepareWorldStateContinuity({
    ctx: provider('unused', calls),
    state: seeded.state,
    recentText: 'Five weeks later, I enter East Dormitory.',
    exchange,
    currentMessageId: 1,
    chatKey: 'irrelevant',
    ...sourceBoundary(exchange),
  });
  assert.equal(calls.count, 0);
  assert.equal(result.injection.text, '');
});

test('one batched request evaluates multiple eligible relevant developments', async () => {
  const seeded = seedDevelopments('batch', [
    { summary: 'Kesselpass freight congestion is active.', anchors: ['Kesselpass'], evidenceClaim: 'Kesselpass freight congestion is active and persistent.' },
    { summary: 'Kesselpass hiring pressure is rising.', anchors: ['Kesselpass'], evidenceClaim: 'Kesselpass hiring pressure is rising because caravans are delayed.' },
    { summary: 'Kesselpass lodging demand is elevated.', anchors: ['Kesselpass'], evidenceClaim: 'Kesselpass lodging demand is elevated by stranded merchants.' },
  ]);
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to Kesselpass.' },
  ]);
  const evaluations = seeded.state.records.map(record => ({
    recordId: record.id,
    outcome: 'stable',
    reason: 'The elapsed interval permits reevaluation but no supplied evidence establishes a material change.',
    supportIds: ['t0'],
  }));
  const calls = { count: 0 };
  const result = await runLazyEvolution({
    ctx: provider(JSON.stringify({ evaluations, derived: [] }), calls),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    chatKey: 'batch',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(calls.count, 1);
  assert.equal(result.plan.targets.length, 3);
  assert.equal(result.outcomes.length, 3);
  assert.equal(result.stableCount, 3);
});

test('duplicate selected entries cannot duplicate an evolution target', () => {
  const seeded = seedDevelopments('dedupe-targets', [{
    summary: 'The Kesselpass dispute is active.',
    anchors: ['Kesselpass'],
  }]);
  const entry = selected(seeded.state)[0];
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to Kesselpass.' },
  ]);
  const plan = planLazyEvolution(seeded.state, {
    selectedEntries: [entry, entry, entry],
    exchange,
    ...sourceBoundary(exchange),
  });
  assert.equal(plan.targets.length, 1);
});

test('automatic batch is capped at six targets', () => {
  const seeded = seedDevelopments('cap', Array.from({ length: 8 }, (_, index) => ({
    summary: `Kesselpass development ${index} is active.`,
    anchors: ['Kesselpass'],
  })));
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to Kesselpass.' },
  ]);
  const plan = planLazyEvolution(seeded.state, {
    selectedEntries: selected(seeded.state),
    exchange,
    ...sourceBoundary(exchange),
  });
  assert.equal(plan.targets.length, 6);
});

test('resolve outcome removes the development from normal private injection', async () => {
  const seeded = seedDevelopments('resolve', [{
    summary: 'The dock strike is active.',
    anchors: ['dock strike'],
    evidenceClaim: 'The dock strike is active under a time-limited mediation process.',
  }]);
  const record = seeded.state.records[0];
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the dock strike district.' },
  ]);
  const response = JSON.stringify({
    evaluations: [{
      recordId: record.id,
      outcome: 'resolve',
      summary: 'The dock strike has ended.',
      reason: 'The time-limited process and elapsed interval causally permit resolution in the supplied state.',
      supportIds: ['t0', 'h0'],
    }],
    derived: [],
  });
  const result = await prepareWorldStateContinuity({
    ctx: provider(response),
    state: seeded.state,
    recentText: 'Five weeks later, I return to the dock strike district.',
    exchange,
    currentMessageId: 1,
    chatKey: 'resolve',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.state.records[0].status, 'resolved');
  assert.equal(result.injection.text, '');
});

test('resolved development does not resurrect because lore still describes the pressure', async () => {
  const seeded = seedDevelopments('no-resurrect', [{
    summary: 'The dock strike has ended.',
    anchors: ['dock strike', 'harbor wages'],
    status: 'resolved',
  }]);
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the harbor.' },
  ]);
  const calls = { count: 0 };
  const result = await prepareWorldStateContinuity({
    ctx: provider('unused', calls),
    state: seeded.state,
    recentText: 'Five weeks later, I return to the harbor.',
    loreText: 'Dockworkers and harbor authorities have longstanding wage tensions.',
    exchange,
    currentMessageId: 1,
    chatKey: 'no-resurrect',
    ...sourceBoundary(exchange),
  });
  assert.equal(calls.count, 0);
  assert.equal(result.state.records[0].status, 'resolved');
});

test('single target plus elapsed time alone cannot spawn a derived thread', async () => {
  const seeded = seedDevelopments('derived-single', [{
    summary: 'The freight dispute is active.',
    anchors: ['freight dispute'],
    evidenceClaim: 'The freight dispute is active and inspections are causing delays.',
  }]);
  const record = seeded.state.records[0];
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the freight district.' },
  ]);
  const response = JSON.stringify({
    evaluations: [{
      recordId: record.id,
      outcome: 'stable',
      reason: 'No change is established.',
      supportIds: ['t0'],
    }],
    derived: [{
      summary: 'A smuggling network is expanding.',
      trend: 'rising',
      anchors: ['smuggling'],
      causeRecordIds: [record.id],
      reason: 'Trade restrictions can encourage smuggling.',
      supportIds: ['t0', 'h0'],
    }],
  });
  const result = await runLazyEvolution({
    ctx: provider(response),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    chatKey: 'derived-single',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.state.records.length, 1);
  assert.equal(result.derivedCount, 0);
  assert.equal(result.rejectedDerived[0].stage, 'derived-gate');
});

test('two established interacting targets plus elapsed evidence may admit one derived development', async () => {
  const seeded = seedDevelopments('derived-two', [
    {
      summary: 'Trade restrictions are limiting food shipments.',
      anchors: ['trade restrictions', 'food shipments'],
      evidenceClaim: 'Trade restrictions are limiting food shipments into the district.',
    },
    {
      summary: 'Food shortages are worsening.',
      anchors: ['food shortages'],
      evidenceClaim: 'Food shortages are worsening as legal supplies remain constrained.',
    },
  ]);
  const [trade, shortage, fuel] = seeded.state.records;
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the food market.' },
  ]);
  const response = JSON.stringify({
    evaluations: [
      { recordId: trade.id, outcome: 'stable', reason: 'No direct change is established.', supportIds: ['t0'] },
      { recordId: shortage.id, outcome: 'stable', reason: 'No direct change is established.', supportIds: ['t0'] },
    ],
    derived: [{
      summary: 'An illicit food trade is becoming established around constrained legal supply.',
      trend: 'emerging',
      anchors: ['illicit food trade', 'food supply'],
      causeRecordIds: [trade.id, shortage.id],
      reason: 'The interaction of sustained shipment restrictions and worsening shortage causally supports an illicit supply channel.',
      supportIds: ['t0', 'h0', 'h1'],
    }],
  });
  const result = await runLazyEvolution({
    ctx: provider(response),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    chatKey: 'derived-two',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.derivedCount, 1);
  assert.equal(result.state.records.length, 3);
  const derived = result.state.records.find(item => ![trade.id, shortage.id].includes(item.id));
  assert.equal(derived.kind, 'development');
  assert.deepEqual(new Set(derived.causedBy), new Set([trade.id, shortage.id]));
});

test('derived development cannot pad its cause list without support from every cause', async () => {
  const seeded = seedDevelopments('derived-cause-coverage', [
    {
      summary: 'Trade restrictions are limiting food shipments.',
      anchors: ['trade restrictions'],
      evidenceClaim: 'Trade restrictions are limiting food shipments.',
    },
    {
      summary: 'Food shortages are worsening.',
      anchors: ['food shortages'],
      evidenceClaim: 'Food shortages are worsening due to constrained supply.',
    },
  ]);
  const [trade, shortage] = seeded.state.records;
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the food market.' },
  ]);
  const response = JSON.stringify({
    evaluations: [
      { recordId: trade.id, outcome: 'stable', reason: 'Stable.', supportIds: ['t0'] },
      { recordId: shortage.id, outcome: 'stable', reason: 'Stable.', supportIds: ['t0'] },
    ],
    derived: [{
      summary: 'An illicit food trade is becoming established.',
      anchors: ['illicit food trade'],
      causeRecordIds: [trade.id, shortage.id],
      reason: 'Attempted cause padding.',
      supportIds: ['t0', 'h0'],
    }],
  });
  const result = await runLazyEvolution({
    ctx: provider(response),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    chatKey: 'derived-cause-coverage',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.derivedCount, 0);
  assert.match(result.rejectedDerived[0].reason, /each declared derived cause/);
});

test('derived development cannot borrow support from an undeclared cause record', async () => {
  const seeded = seedDevelopments('derived-unrelated-support', [
    {
      summary: 'Trade restrictions are limiting food shipments.',
      anchors: ['trade restrictions'],
      evidenceClaim: 'Trade restrictions are limiting food shipments.',
    },
    {
      summary: 'Food shortages are worsening.',
      anchors: ['food shortages'],
      evidenceClaim: 'Food shortages are worsening due to constrained supply.',
    },
    {
      summary: 'Fuel rationing is active.',
      anchors: ['fuel rationing'],
      evidenceClaim: 'Fuel rationing is active after refinery damage.',
    },
  ]);
  const [trade, shortage, fuel] = seeded.state.records;
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the food market.' },
  ]);
  const response = JSON.stringify({
    evaluations: [
      { recordId: trade.id, outcome: 'stable', reason: 'Stable.', supportIds: ['t0'] },
      { recordId: shortage.id, outcome: 'stable', reason: 'Stable.', supportIds: ['t0'] },
      { recordId: fuel.id, outcome: 'stable', reason: 'Stable.', supportIds: ['t0'] },
    ],
    derived: [{
      summary: 'An illicit food trade is becoming established.',
      anchors: ['illicit food trade'],
      causeRecordIds: [trade.id, shortage.id],
      reason: 'Attempted support borrowing.',
      supportIds: ['t0', 'h2'],
    }],
  });
  const result = await runLazyEvolution({
    ctx: provider(response),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    chatKey: 'derived-unrelated-support',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.derivedCount, 0);
  assert.match(result.rejectedDerived[0].reason, /declared cause records/);
});

test('derived development is deduplicated against projected same-batch target updates', async () => {
  const seeded = seedDevelopments('derived-projected-dup', [
    {
      summary: 'Trade restrictions are limiting food shipments.',
      anchors: ['trade restrictions'],
      evidenceClaim: 'Trade restrictions are limiting food shipments.',
    },
    {
      summary: 'Food shortages are worsening.',
      anchors: ['food shortages'],
      evidenceClaim: 'Food shortages are worsening due to constrained supply.',
    },
  ]);
  const [trade, shortage] = seeded.state.records;
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the food market.' },
  ]);
  const convergedSummary = 'An illicit food trade is becoming established around constrained legal supply.';
  const response = JSON.stringify({
    evaluations: [
      {
        recordId: trade.id,
        outcome: 'update',
        summary: convergedSummary,
        trend: 'emerging',
        reason: 'The established restriction mechanism persists across the elapsed interval.',
        supportIds: ['t0', 'h0'],
      },
      { recordId: shortage.id, outcome: 'stable', reason: 'Stable.', supportIds: ['t0'] },
    ],
    derived: [{
      summary: convergedSummary,
      trend: 'emerging',
      anchors: ['illicit food trade'],
      causeRecordIds: [trade.id, shortage.id],
      reason: 'The same meaning is redundantly proposed as a new thread.',
      supportIds: ['t0', 'h0', 'h1'],
    }],
  });
  const result = await runLazyEvolution({
    ctx: provider(response),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    chatKey: 'derived-projected-dup',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.outcome, 'evolved');
  assert.equal(result.state.records.length, 2);
  assert.equal(result.derivedCount, 0);
  assert.equal(result.state.records.find(item => item.id === trade.id).summary, convergedSummary);
  assert.match(result.rejectedDerived[0].reason, /already represented/);
});

test('duplicate derived development is suppressed instead of proliferating threads', async () => {
  const seeded = seedDevelopments('derived-dup', [
    {
      summary: 'Trade restrictions are limiting food shipments.',
      anchors: ['trade restrictions'],
      evidenceClaim: 'Trade restrictions are limiting food shipments.',
    },
    {
      summary: 'Food shortages are worsening.',
      anchors: ['food shortages'],
      evidenceClaim: 'Food shortages are worsening due to constrained supply.',
    },
    {
      summary: 'An illicit food trade is becoming established.',
      anchors: ['illicit food trade'],
      evidenceClaim: 'An illicit food trade is becoming established around the shortage.',
    },
  ]);
  const [trade, shortage] = seeded.state.records;
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the food market.' },
  ]);
  const response = JSON.stringify({
    evaluations: [
      { recordId: trade.id, outcome: 'stable', reason: 'Stable.', supportIds: ['t0'] },
      { recordId: shortage.id, outcome: 'stable', reason: 'Stable.', supportIds: ['t0'] },
    ],
    derived: [{
      summary: 'An illicit food trade is becoming established.',
      trend: 'emerging',
      anchors: ['illicit food trade'],
      causeRecordIds: [trade.id, shortage.id],
      reason: 'The same consequence is proposed again.',
      supportIds: ['t0', 'h0', 'h1'],
    }],
  });
  const result = await runLazyEvolution({
    ctx: provider(response),
    state: seeded.state,
    selectedEntries: selected(seeded.state).slice(0, 2),
    exchange,
    chatKey: 'derived-dup',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.state.records.length, 3);
  assert.equal(result.derivedCount, 0);
  assert.match(result.rejectedDerived[0].reason, /already represented/);
});

test('derived candidate cannot resurrect a resolved episode', async () => {
  const seeded = seedDevelopments('derived-resolved', [
    {
      summary: 'Trade restrictions are limiting food shipments.',
      anchors: ['trade restrictions'],
      evidenceClaim: 'Trade restrictions are limiting food shipments.',
    },
    {
      summary: 'Food shortages are worsening.',
      anchors: ['food shortages'],
      evidenceClaim: 'Food shortages are worsening due to constrained supply.',
    },
    {
      summary: 'The illicit food trade has ended.',
      anchors: ['illicit food trade'],
      status: 'resolved',
      evidenceClaim: 'The illicit food trade has ended after enforcement action.',
    },
  ]);
  const [trade, shortage] = seeded.state.records;
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the market.' },
  ]);
  const response = JSON.stringify({
    evaluations: [
      { recordId: trade.id, outcome: 'stable', reason: 'Stable.', supportIds: ['t0'] },
      { recordId: shortage.id, outcome: 'stable', reason: 'Stable.', supportIds: ['t0'] },
    ],
    derived: [{
      summary: 'The illicit food trade has ended.',
      anchors: ['illicit food trade'],
      causeRecordIds: [trade.id, shortage.id],
      reason: 'Attempted resurrection-like duplicate.',
      supportIds: ['t0', 'h0', 'h1'],
    }],
  });
  const result = await runLazyEvolution({
    ctx: provider(response),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    chatKey: 'derived-resolved',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.state.records.length, 3);
  assert.equal(result.derivedCount, 0);
  assert.match(result.rejectedDerived[0].reason, /resolved\/superseded/);
});

test('more than one derived proposal makes the provider response invalid and applies nothing', async () => {
  const seeded = seedDevelopments('derived-limit', [{
    summary: 'The reactor degradation is active.',
    anchors: ['reactor'],
    evidenceClaim: 'The reactor degradation is active because coolant pumps are failing.',
  }]);
  const record = seeded.state.records[0];
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the reactor.' },
  ]);
  const response = JSON.stringify({
    evaluations: [{
      recordId: record.id,
      outcome: 'stable',
      reason: 'Stable.',
      supportIds: ['t0'],
    }],
    derived: [
      { summary: 'Derived A', reason: 'A', causeRecordIds: [record.id], supportIds: ['t0'] },
      { summary: 'Derived B', reason: 'B', causeRecordIds: [record.id], supportIds: ['t0'] },
    ],
  });
  const result = await runLazyEvolution({
    ctx: provider(response),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    chatKey: 'derived-limit',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.outcome, 'invalid-response');
  assert.equal(result.state.records[0].lastEvaluatedMessage, 0);
});

test('eligible evolution refuses to run without an owned raw-message boundary', async () => {
  const seeded = seedDevelopments('boundary-required', [{
    summary: 'The reactor degradation is active.',
    anchors: ['reactor'],
    evidenceClaim: 'The reactor degradation is active because coolant pumps are failing.',
  }]);
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the reactor.' },
  ]);
  const calls = { count: 0 };
  await assert.rejects(
    runLazyEvolution({
      ctx: provider('{"evaluations":[],"derived":[]}', calls),
      state: seeded.state,
      selectedEntries: selected(seeded.state),
      exchange,
      elapsedHint: { raw: 'Five weeks later', meaningful: true, sourceMessageId: 1, lineageKey: exchange[1].lineageKey },
      chatKey: 'boundary-required',
      isCurrent: () => true,
    }),
    error => error?.code === 'WORLD_STATE_EVOLUTION_BOUNDARY_REQUIRED',
  );
  assert.equal(calls.count, 0);
});

test('eligible evolution refuses to run without a currentness guard', async () => {
  const seeded = seedDevelopments('guard-required', [{
    summary: 'The reactor degradation is active.',
    anchors: ['reactor'],
    evidenceClaim: 'The reactor degradation is active because coolant pumps are failing.',
  }]);
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the reactor.' },
  ]);
  const calls = { count: 0 };
  await assert.rejects(
    runLazyEvolution({
      ctx: provider('{"evaluations":[],"derived":[]}', calls),
      state: seeded.state,
      selectedEntries: selected(seeded.state),
      exchange,
      chatKey: 'guard-required',
      ...sourceBoundary(exchange),
    }),
    error => error?.code === 'WORLD_STATE_EVOLUTION_CURRENT_GUARD_REQUIRED',
  );
  assert.equal(calls.count, 0);
});

test('malformed evolution JSON performs exactly one provider call and no mutation', async () => {
  const seeded = seedDevelopments('malformed-evolution', [{
    summary: 'The reactor degradation is active.',
    anchors: ['reactor'],
    evidenceClaim: 'The reactor degradation is active because coolant pumps are failing.',
  }]);
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the reactor.' },
  ]);
  const calls = { count: 0 };
  const result = await runLazyEvolution({
    ctx: provider('not-json', calls),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    chatKey: 'malformed-evolution',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(calls.count, 1);
  assert.equal(result.outcome, 'invalid-response');
  assert.equal(result.state.records[0].lastEvaluatedMessage, 0);
  assert.equal(result.state.records[0].summary, seeded.state.records[0].summary);
});

test('provider failure after dispatch leaves canonical evolution state unchanged', async () => {
  const seeded = seedDevelopments('evolution-provider-failure', [{
    summary: 'The reactor degradation is active.',
    anchors: ['reactor'],
    evidenceClaim: 'The reactor degradation is active because coolant pumps are failing.',
  }]);
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the reactor.' },
  ]);
  const calls = { count: 0 };
  const ctx = provider('unused', calls);
  ctx.generateRaw = async () => {
    calls.count += 1;
    const error = new Error('upstream failure');
    error.code = 'UPSTREAM_FAILURE';
    throw error;
  };
  const result = await runLazyEvolution({
    ctx,
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    chatKey: 'evolution-provider-failure',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(calls.count, 1);
  assert.equal(result.outcome, 'failure');
  assert.equal(result.state.records[0].lastEvaluatedMessage, 0);
  assert.equal(result.state.records[0].summary, seeded.state.records[0].summary);
});

test('stale provider output is discarded without advancing evaluation state', async () => {
  const seeded = seedDevelopments('stale-evolution', [{
    summary: 'The reactor degradation is active.',
    anchors: ['reactor'],
    evidenceClaim: 'The reactor degradation is active because coolant pumps are failing.',
  }]);
  const record = seeded.state.records[0];
  const exchange = withLineage([
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to the reactor.' },
  ]);
  let current = true;
  const response = JSON.stringify({
    evaluations: [{ recordId: record.id, outcome: 'stable', reason: 'Stable.', supportIds: ['t0'] }],
    derived: [],
  });
  const result = await runLazyEvolution({
    ctx: provider(response, { count: 0 }, () => { current = false; }),
    state: seeded.state,
    selectedEntries: selected(seeded.state),
    exchange,
    chatKey: 'stale-evolution',
    isCurrent: () => current,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.outcome, 'stale');
  assert.equal(result.state.records[0].lastEvaluatedMessage, 0);
});

test('evolution mutation is reversible through the same branch journal contract', async () => {
  const seeded = seedDevelopments('rollback-evolution', [{
    summary: 'The freight dispute is active.',
    anchors: ['Kesselpass', 'freight dispute'],
    evidenceClaim: 'The freight dispute is active and inspections are causing delays.',
  }]);
  const baseCommitted = commitMutationBoundary(
    createState('rollback-evolution'),
    seeded.state,
    seeded.chat,
    0,
    'capture',
  );
  const record = baseCommitted.records[0];
  const fullChat = [
    ...seeded.chat,
    { role: 'user', content: 'Five weeks later, I return to Kesselpass.' },
  ];
  const exchange = withLineage(fullChat);
  const response = JSON.stringify({
    evaluations: [{
      recordId: record.id,
      outcome: 'update',
      summary: 'The freight dispute remains active but traffic has partially adapted.',
      trend: 'stable',
      reason: 'Established diversion behavior plus elapsed time supports partial adaptation.',
      supportIds: ['t0', 'h0'],
    }],
    derived: [],
  });
  const evolved = await runLazyEvolution({
    ctx: provider(response),
    state: baseCommitted,
    selectedEntries: selected(baseCommitted),
    exchange,
    chatKey: 'rollback-evolution',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  const committed = commitMutationBoundary(
    baseCommitted,
    evolved.state,
    fullChat,
    1,
    'evolution',
  );
  assert.match(committed.records[0].summary, /partially adapted/);

  const rolled = reconcileBranch(committed, seeded.chat);
  assert.equal(rolled.failClosed, false);
  assert.equal(rolled.state.records[0].summary, 'The freight dispute is active.');
  assert.equal(rolled.state.records[0].lastEvaluatedMessage, 0);
});

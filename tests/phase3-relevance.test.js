import test from 'node:test';
import assert from 'node:assert/strict';

import {
  extractContextTerms,
  normalizeAnchor,
  scoreRecordRelevance,
  selectRelevantRecords,
} from '../relevance.js';

function record(id, summary, {
  kind = 'fact',
  status = 'active',
  trend = null,
  anchors = [],
  lastChangedMessage = null,
  causedBy = [],
  affects = [],
} = {}) {
  return {
    id,
    kind,
    summary,
    status,
    trend,
    anchors,
    createdAtMessage: 1,
    lastChangedMessage,
    lastEvaluatedMessage: lastChangedMessage,
    timeAnchor: '',
    evidenceIds: [],
    causedBy,
    affects,
  };
}

function state(records, links = []) {
  return { records, links };
}

test('anchor normalization is setting-agnostic and Unicode-safe', () => {
  assert.equal(normalizeAnchor('  Mars Colony Seven / O₂ Refinery  '), 'mars colony seven o2 refinery');
  assert.deepEqual(extractContextTerms('東寮 reactor-7 Student Council'), ['東寮', 'reactor', '7', 'student', 'council']);
});

test('single-word anchors respect token boundaries while non-space scripts still match', () => {
  const falsePositive = record('art', 'The art exhibit is closed.', { anchors: ['art'] });
  const cjk = record('east-dorm', '東寮は閉鎖されています。', { anchors: ['東寮'] });
  const latin = selectRelevantRecords(state([falsePositive]), {
    recentText: 'The party continues in the courtyard.',
  });
  const nonSpace = selectRelevantRecords(state([cjk]), {
    recentText: '彼女は東寮に戻る。',
  });
  assert.equal(latin.selected.length, 0);
  assert.equal(nonSpace.selected[0].record.id, 'east-dorm');
});

test('exact recent anchor match strongly selects the relevant fact', () => {
  const relevant = record('r1', 'Kesselpass freight traffic is congested.', {
    anchors: ['Kesselpass', 'freight traffic'],
  });
  const unrelated = record('r2', 'Southport fish prices remain elevated.', {
    anchors: ['Southport', 'fish prices'],
  });
  const result = selectRelevantRecords(state([relevant, unrelated]), {
    recentText: 'Lucien arrives at Kesselpass after sunset.',
    currentMessageId: 100,
  });
  assert.equal(result.selected[0].record.id, 'r1');
  assert.equal(result.selected.some(item => item.record.id === 'r2'), false);
  assert.ok(result.selected[0].reasons.includes('recent-anchor'));
});

test('generic single summary words do not flood relevance while compact distinctive summaries still work', () => {
  const noisy = Array.from({ length: 20 }, (_, index) => record(
    `condition-${index}`,
    `Condition ${index} remains operational under normal circumstances.`,
    { anchors: [] },
  ));
  const quiet = selectRelevantRecords(state(noisy), {
    recentText: 'The condition is discussed briefly.',
  });
  assert.equal(quiet.selected.length, 0);

  const distinctive = record('reactor-unique', 'Reactor outage persists.', { anchors: [] });
  const matched = selectRelevantRecords(state([distinctive]), {
    recentText: 'The reactor remains offline after the outage.',
  });
  assert.equal(matched.selected[0].record.id, 'reactor-unique');
});

test('summary overlap can retrieve a record even when the exact anchor is absent', () => {
  const target = record('reactor', 'Reactor output is limited while coolant pumps are repaired.', {
    anchors: ['core systems'],
  });
  const scored = scoreRecordRelevance(target, {
    recentText: 'The crew asks whether reactor output remains limited during coolant repairs.',
  });
  assert.ok(scored.score >= 0.9);
  assert.ok(scored.reasons.includes('recent-summary'));
});

test('currently retrieved lore can contribute relevance but does not change record authority', () => {
  const target = record('student', 'The student fee protest remains active.', {
    kind: 'development',
    anchors: ['student fee protest', 'University Administration'],
  });
  const result = selectRelevantRecords(state([target]), {
    recentText: 'She enters the administration building.',
    loreText: 'University Administration handles student fee policy.',
  });
  assert.equal(result.selected[0].record.id, 'student');
  assert.ok(result.selected[0].reasons.some(reason => reason.startsWith('lore-') || reason.startsWith('recent-')));
});

test('one-hop causal or related records may expand from a strongly relevant seed', () => {
  const seed = record('trade', 'Hadrik inspections are delaying freight.', {
    kind: 'development',
    anchors: ['Hadrik', 'freight'],
  });
  const linked = record('kessel', 'Some merchants are diverting through Kesselpass.', {
    kind: 'development',
    anchors: ['Kesselpass'],
  });
  const unrelated = record('island', 'A remote island ferry is suspended.', {
    anchors: ['island ferry'],
  });
  const result = selectRelevantRecords(state(
    [seed, linked, unrelated],
    [{ id: 'l1', from: 'trade', to: 'kessel', type: 'related', sourceMessageId: 40 }],
  ), {
    recentText: 'The merchant complains about Hadrik freight inspections.',
    currentMessageId: 50,
  });
  assert.ok(result.selected.some(item => item.record.id === 'trade' && item.source === 'seed'));
  assert.ok(result.selected.some(item => item.record.id === 'kessel' && item.source === 'linked'));
  assert.equal(result.selected.some(item => item.record.id === 'island'), false);
});

test('one-hop expansion never outranks the direct seed when the result cap is one', () => {
  const seed = record('seed', 'The freight gate is closed.', {
    anchors: ['freight gate'],
  });
  const linked = record('linked', 'A nearby warehouse is operating under restrictions.', {
    anchors: ['warehouse'],
    lastChangedMessage: 99,
  });
  const result = selectRelevantRecords(state(
    [seed, linked],
    [{ id: 'rel', from: 'seed', to: 'linked', type: 'related', sourceMessageId: 98 }],
  ), {
    recentText: 'They arrive at the freight gate.',
    currentMessageId: 100,
    maxRecords: 1,
  });
  assert.equal(result.selected.length, 1);
  assert.equal(result.selected[0].record.id, 'seed');
  assert.equal(result.selected[0].source, 'seed');
});

test('resolved and superseded records do not enter normal relevance injection', () => {
  const resolved = record('old-strike', 'The dock strike is resolved.', {
    kind: 'development',
    status: 'resolved',
    anchors: ['dock strike'],
  });
  const superseded = record('old-ruler', 'Aldren formerly ruled Valenne.', {
    status: 'superseded',
    anchors: ['Aldren', 'Valenne'],
  });
  const current = record('queen', 'Queen Serise currently rules Valenne.', {
    anchors: ['Serise', 'Valenne'],
  });
  const result = selectRelevantRecords(state([resolved, superseded, current]), {
    recentText: 'The court in Valenne prepares for Queen Serise.',
  });
  assert.deepEqual(result.selected.map(item => item.record.id), ['queen']);
});

test('recent-change bonus never makes an otherwise unrelated record relevant', () => {
  const unrelated = record('fresh', 'The oxygen refinery is offline.', {
    anchors: ['oxygen refinery'],
    lastChangedMessage: 99,
  });
  const result = selectRelevantRecords(state([unrelated]), {
    recentText: 'The student council meets in East Dormitory.',
    currentMessageId: 100,
  });
  assert.equal(result.selected.length, 0);
});

test('hundreds of backend records still yield a tiny relevant subset', () => {
  const records = Array.from({ length: 500 }, (_, index) => record(
    `r${index}`,
    `Unrelated condition ${index} remains unchanged.`,
    { anchors: [`unrelated-${index}`] },
  ));
  records[377] = record('kesselpass', 'Kesselpass freight traffic is congested by diverted caravans.', {
    kind: 'development',
    trend: 'rising',
    anchors: ['Kesselpass', 'freight traffic'],
    lastChangedMessage: 480,
  });
  records[378] = record('trade-dispute', 'The Vardrenn-Hadrik freight dispute remains active.', {
    kind: 'development',
    anchors: ['Vardrenn', 'Hadrik', 'freight dispute'],
  });
  const links = [{ id: 'lk', from: 'kesselpass', to: 'trade-dispute', type: 'related', sourceMessageId: 480 }];

  const result = selectRelevantRecords(state(records, links), {
    recentText: 'Lucien reaches Kesselpass and sees caravans queued around the freight yard.',
    currentMessageId: 500,
    maxRecords: 6,
  });

  assert.equal(result.metrics.scannedRecords, 500);
  assert.ok(result.selected.length <= 6);
  assert.ok(result.selected.length <= 2);
  assert.ok(result.selected.some(item => item.record.id === 'kesselpass'));
  assert.equal(result.selected.some(item => /^r\d+$/.test(item.record.id)), false);
});

test('same relevance engine supports fantasy, sci-fi, and social settings without schema branches', () => {
  const fixtures = [
    {
      record: record('fantasy', 'The Northglass bridge is destroyed.', { anchors: ['Northglass bridge'] }),
      query: 'They approach Northglass bridge.',
    },
    {
      record: record('scifi', 'Habitation Deck C is sealed.', { anchors: ['Habitation Deck C'] }),
      query: 'The lift stops at Habitation Deck C.',
    },
    {
      record: record('social', 'East Dormitory is inaccessible.', { anchors: ['East Dormitory'] }),
      query: 'She returns to East Dormitory.',
    },
  ];

  for (const fixture of fixtures) {
    const result = selectRelevantRecords(state([fixture.record]), { recentText: fixture.query });
    assert.equal(result.selected[0].record.id, fixture.record.id);
  }
});

test('ranking is deterministic under equal scores', () => {
  const a = record('a', 'The gate is closed.', { anchors: ['gate'] });
  const b = record('b', 'The gate is guarded.', { anchors: ['gate'] });
  const first = selectRelevantRecords(state([b, a]), { recentText: 'They approach the gate.' });
  const second = selectRelevantRecords(state([a, b]), { recentText: 'They approach the gate.' });
  assert.deepEqual(first.selected.map(item => item.record.id), second.selected.map(item => item.record.id));
});

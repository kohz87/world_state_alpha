// alpha.54: deep-pass items 43-45 (performance) and section 7 (cleanups), each checked against
// 0.9.0-alpha.53 first. Costs are asserted as counts (copies, reads, model builds), never as timings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { chatLineage, commitMutationBoundary } from '../branch.js';
import { extractElapsedHint } from '../elapsed.js';
import { applyManualMutation, queryWorldState } from '../manual.js';
import { processSpatialCapture } from '../spatial-capture.js';
import { normalizeSpatialState, reduceSpatialMutations } from '../spatial-core.js';
import { canonicalDomain, createState, reduceMutations } from '../state-core.js';
import { createWorldStateUiController } from '../ui.js';

const source = fs.readFileSync('index.js', 'utf8');

// Counts how often each message's text is read: chatLineage fingerprints every message once per call.
function countingChat(length) {
  const reads = { count: 0 };
  const chat = Array.from({ length }, (_, index) => {
    const text = 'Message ' + index;
    return {
      is_user: index % 2 === 1,
      is_system: false,
      name: index % 2 ? 'User' : 'Narrator',
      get mes() { reads.count += 1; return text; },
    };
  });
  return { chat, reads };
}

function seededState(chat) {
  const lineage = chatLineage(chat);
  const out = reduceMutations(createState('a54'), {
    chatKey: 'a54', messageId: 0, lineageKey: lineage[0].lineageKey, operation: 'capture',
    mutations: [{ action: 'create', kind: 'fact', summary: 'The bridge is closed', anchors: ['bridge'], evidence: [{ sourceMessageId: 0, claim: 'The bridge is closed' }] }],
  });
  return commitMutationBoundary(createState('a54'), out.state, chat.slice(0, 1), 0, 'capture');
}

test('43: the Reality reducer builds no unused undo patch and copies the domain once', () => {
  const { chat } = countingChat(3);
  const state = seededState(chat);
  const lineage = chatLineage(chat);
  const out = reduceMutations(state, {
    chatKey: 'a54', messageId: 2, lineageKey: lineage[2].lineageKey, operation: 'capture',
    mutations: [{ action: 'create', kind: 'fact', summary: 'The ferry runs again', anchors: ['ferry'], evidence: [{ sourceMessageId: 2, claim: 'The ferry runs again' }] }],
  });
  // Before: a second normalized copy of the input and an undo patch nobody read.
  assert.equal('undo' in out, false);
  // The result is still a private copy: changing it leaves the input alone.
  out.state.records[0].summary = 'changed';
  assert.equal(state.records[0].summary, 'The bridge is closed');
  // canonicalDomain no longer copies the normalized domain a second time, and is still independent.
  const domain = canonicalDomain(state);
  domain.records[0].summary = 'changed';
  assert.equal(state.records[0].summary, 'The bridge is closed');
  const reducer = fs.readFileSync('state-core.js', 'utf8');
  assert.doesNotMatch(reducer, /records: clone\(normalized\.records\)/);
});

test('44: the Places reducer builds no undo patch, and a capture with no proposals copies nothing', () => {
  const spatial = normalizeSpatialState({ locations: [{ id: 'mill', name: 'Old Mill', status: 'active', coordinate: { x: 1, y: 2, authority: 'manual', locked: true } }] });
  const reduced = reduceSpatialMutations(spatial, { chatKey: 'a54', messageId: 2, lineageKey: 'l2', operation: 'capture', mutations: [] }, null, { visibleLocations: [] });
  assert.equal('undo' in reduced, false);
  reduced.spatial.locations[0].name = 'changed';
  assert.equal(spatial.locations[0].name, 'Old Mill');
  const text = 'The wheel turns.';
  const out = processSpatialCapture({ rawSpatialMutations: [], spatial, exchange: [{ messageId: 2, role: 'assistant', content: text, lineageKey: 'l2' }], visibleLocations: [], chatKey: 'a54', sourceMessageId: 2, sourceLineageKey: 'l2', operation: 'capture' });
  // Before: two full reduce passes (copy, normalize, diff) of every place for nothing.
  assert.equal(out.spatial, spatial);
  assert.equal(out.applied.length, 0);
});

test('45: a manual edit fingerprints the chat once', () => {
  const { chat, reads } = countingChat(40);
  const state = seededState(chat);
  reads.count = 0;
  chatLineage(chat);
  const onePass = reads.count;
  reads.count = 0;
  const res = applyManualMutation({ state, chat, chatKey: 'a54', messageId: 39, mutation: { action: 'create', kind: 'fact', summary: 'The gate is barred', anchors: ['gate'] }, note: 'Operator note' });
  assert.equal(res.outcome, 'applied');
  // Before: the boundary check and the commit each fingerprinted all 40 messages.
  assert.equal(reads.count, onePass);
});

test('45: the end of a rebuild checks its range once before saving', () => {
  const rebuild = source.slice(source.indexOf("if (actionId === 'rebuild')"), source.indexOf('async function applySpatialAction('));
  // Before: four back-to-back exact checks, each re-fingerprinting the whole range.
  assert.equal((rebuild.match(/isCurrentExact\(\)/g) || []).length, 3);
  assert.match(rebuild, /const currentAtEnd = isCurrentExact\(\);/);
});

test('45: a panel click reads the model already rendered', async () => {
  const state = createState('chat:a54');
  state.spatial.locations = [{ id: 'wsloc_mill', name: 'Old Mill', type: 'mill', status: 'active', baseRefId: null, coordinate: { x: 1, y: 2, authority: 'manual', locked: false }, context: '', routeRefs: [], notes: '', createdAtMessage: 1, lastChangedMessage: 1, evidenceIds: [] }];
  let builds = 0;
  const listeners = {};
  const root = { innerHTML: '', addEventListener(type, fn) { listeners[type] = fn; }, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
  const ctl = createWorldStateUiController({ root, getState: () => { builds += 1; return state; }, initialTab: 'spatial', onSpatialAction: async () => true });
  builds = 0;
  ctl.refresh();
  const oneRefresh = builds;
  builds = 0;
  await listeners.click({ target: { closest: wanted => (wanted === '[data-wsa-spatial-action]' ? { dataset: { wsaSpatialAction: 'toggle_lock' } } : null) }, preventDefault() {} });
  // Before: the handler built the whole model to read one field, then refresh() built it again.
  assert.equal(builds, oneRefresh);
  ctl.destroy();
});

test('section 7: one text canonicalizer, one direction table, no dead branches', () => {
  for (const file of ['duplicate.js', 'manual.js', 'relevance.js', 'source-firewall.js', 'spatial-capture.js', 'spatial-relevance.js', 'spatial-core.js']) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /\.normalize\('NFKC'\)\s*\.toLocaleLowerCase\(\)\s*\.replace\(\/\[\^\\p\{L\}\\p\{N\}\]\+\/gu/, file);
  }
  assert.doesNotMatch(fs.readFileSync('ui.js', 'utf8'), /northeast: 'southwest',/);
  assert.equal(extractElapsedHint('Several days later, the snow melts.')?.meaningful, true);
  assert.doesNotMatch(fs.readFileSync('elapsed.js', 'utf8'), /const vague = /);
  const routing = fs.readFileSync('provider-routing.js', 'utf8');
  assert.doesNotMatch(routing, /configuredMax \? \(\) => ctx\.generateRaw\(routedOptions\) : \(\) => ctx\.generateRaw\(options\)/);
  assert.equal((source.match(/rebuildRequest\.resume === true \? rebuildResumes\.get\(chatKey\) : null/g) || []).length, 1);
  // The search filters once and still reports every match.
  const state = createState('a54');
  for (let i = 0; i < 5; i += 1) state.records.push({ id: 'r' + i, kind: 'fact', status: 'active', summary: 'Gate number ' + i, anchors: ['gate'], trend: null, evidenceIds: [], createdAtMessage: i, lastChangedMessage: i });
  const found = queryWorldState(state, { text: 'gate', limit: 2 });
  assert.deepEqual([found.records.length, found.totalMatched], [2, 5]);
});

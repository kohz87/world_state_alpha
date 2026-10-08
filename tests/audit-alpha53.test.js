// alpha.53: deep-pass items 10, 11, 17 and 40-42 (UI and relevance), each reproduced against
// 0.9.0-alpha.52 first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildRelevanceIndex, nonAsciiBigrams, selectBackgroundDevelopments, selectRelevantRecords, updateRelevanceIndex } from '../relevance.js';
import { createState } from '../state-core.js';
import { createWorldStateUiController } from '../ui.js';

function record(id, summary, anchors, extra = {}) {
  return { id, kind: 'fact', status: 'active', summary, anchors, trend: null, lastChangedMessage: 1, ...extra };
}

// A replace-on-innerHTML DOM with focus and caret: every render builds fresh form fields, like a browser.
function fakePanelRoot() {
  const listeners = {};
  const doc = { activeElement: null };
  let html = '';
  let fields = [];
  const element = (attrs, value, checked) => {
    const el = {
      isConnected: true,
      type: /type="checkbox"/.test(attrs) ? 'checkbox' : 'text',
      value,
      checked,
      disabled: /\sdisabled/.test(attrs),
      selectionStart: null,
      selectionEnd: null,
      getAttribute: name => (attrs.match(new RegExp(name + '="([^"]*)"')) || [])[1] ?? (new RegExp('\\s' + name + '(?=[\\s>]|$)').test(attrs) ? '' : null),
      hasAttribute: name => el.getAttribute(name) !== null,
      getClientRects: () => [1],
      focus() { doc.activeElement = el; },
      setSelectionRange(start, end) { el.selectionStart = start; el.selectionEnd = end; },
      closest: selector => {
        const [, name, wanted] = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/) || [];
        const actual = name ? el.getAttribute(name) : null;
        return actual !== null && (wanted === undefined || actual === wanted) ? el : null;
      },
    };
    return el;
  };
  const unescape = text => text.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  const matching = selector => {
    const [, name, wanted] = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/) || [];
    return name ? fields.filter(field => field.getAttribute(name) !== null && (wanted === undefined || field.getAttribute(name) === wanted)) : [];
  };
  const root = {
    get innerHTML() { return html; },
    set innerHTML(next) {
      for (const field of fields) field.isConnected = false;
      html = next;
      fields = [];
      for (const match of next.matchAll(/<input([^>]*)>/g)) {
        fields.push(element(match[1], unescape((match[1].match(/value="([^"]*)"/) || [])[1] || ''), /\schecked/.test(match[1])));
      }
      for (const match of next.matchAll(/<textarea([^>]*)>([\s\S]*?)<\/textarea>/g)) fields.push(element(match[1], unescape(match[2]), false));
      for (const match of next.matchAll(/<select([^>]*)>([\s\S]*?)<\/select>/g)) {
        fields.push(element(match[1], unescape((match[2].match(/<option value="([^"]*)" selected>/) || [])[1] || ''), false));
      }
    },
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener() {},
    contains: el => fields.includes(el),
    querySelector: selector => matching(selector)[0] || null,
    querySelectorAll: selector => matching(selector),
  };
  return { root, doc, listeners, field: (attr, name) => root.querySelector(name === undefined ? '[' + attr + ']' : '[' + attr + '="' + name + '"]') };
}

function withDocument(doc, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true });
  try {
    return fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'document', had);
    else delete globalThis.document;
  }
}

function placesState() {
  const state = createState('chat:a53');
  state.spatial.locations = [{
    id: 'wsloc_tower', name: 'Old Tower', type: 'tower', status: 'active', baseRefId: null,
    coordinate: { x: 10, y: 5, authority: 'manual', locked: false }, context: 'Old context', routeRefs: [], notes: '',
    createdAtMessage: 1, lastChangedMessage: 1, evidenceIds: [],
  }];
  return state;
}

const clickOn = (dom, selector, dataset = {}, extra = {}) => dom.listeners.click({
  target: { closest: wanted => (wanted === selector ? { dataset, ...extra } : null) },
  preventDefault() {},
});

test('10: a trailing space typed into search or the Places filter is kept', () => {
  const dom = fakePanelRoot();
  const ctl = createWorldStateUiController({ root: dom.root, getState: () => createState('chat:a53') });
  const search = dom.field('data-wsa-search');
  search.value = 'iron ';
  dom.listeners.input({ target: search });
  // Before: the re-render wrote back 'iron', so the next letter made 'irong...'.
  assert.equal(dom.field('data-wsa-search').value, 'iron ');
  assert.equal(ctl.getUiState().activeTab, 'search');
  ctl.destroy();

  const places = fakePanelRoot();
  const spatial = createWorldStateUiController({ root: places.root, getState: placesState, initialTab: 'spatial' });
  const filter = places.field('data-wsa-spatial-search');
  filter.value = 'old ';
  places.listeners.input({ target: filter });
  assert.equal(places.field('data-wsa-spatial-search').value, 'old ');
  spatial.destroy();
});

test('11: a background refresh keeps focus and caret in the field being typed in', async () => {
  const dom = fakePanelRoot();
  const state = placesState();
  const ctl = createWorldStateUiController({ root: dom.root, getState: () => state, initialTab: 'spatial', onSpatialAction: async () => true });
  const key = ctl.refresh().spatial.locations[0].key;
  await clickOn(dom, '[data-wsa-spatial-key]', { wsaSpatialKey: key });
  await clickOn(dom, '[data-wsa-spatial-edit]');
  const context = dom.field('data-wsa-field', 'context');
  context.value = 'Draft context';
  dom.listeners.input({ target: context });
  context.focus();
  context.setSelectionRange(5, 5);
  withDocument(dom.doc, () => ctl.refresh());
  const after = dom.field('data-wsa-field', 'context');
  // Before: the field was rebuilt and nothing in the panel had focus.
  assert.equal(dom.doc.activeElement, after);
  assert.deepEqual([after.selectionStart, after.selectionEnd], [5, 5]);
  ctl.destroy();
});

test('17: a link to a record beyond the first 120 rows opens that record', async () => {
  const state = createState('chat:a53');
  for (let i = 0; i < 125; i += 1) {
    state.records.push({ id: 'r' + i, kind: 'fact', status: 'active', summary: 'Fact number ' + i, anchors: ['fact' + i], trend: null, evidenceIds: [], createdAtMessage: i, lastChangedMessage: i });
  }
  state.records.push({ id: 'old', kind: 'fact', status: 'resolved', summary: 'An old resolved fact', anchors: ['old'], trend: null, evidenceIds: [], createdAtMessage: 0, lastChangedMessage: 0 });
  const dom = fakePanelRoot();
  const ctl = createWorldStateUiController({ root: dom.root, getState: () => state });
  await clickOn(dom, '[data-wsa-open-record]', { wsaOpenRecord: 'row-0' });
  const shown = ctl.refresh();
  // Before: the oldest active record fell back to the Resolved tab, which opened its first row.
  assert.equal(ctl.getUiState().activeTab, 'current');
  assert.equal(shown.detail?.summary, 'Fact number 0');
  ctl.destroy();
});

test('17: Copy JSON copies the operation shown beside the button', async () => {
  const dom = fakePanelRoot();
  const ctl = createWorldStateUiController({ root: dom.root, getState: () => createState('chat:a53'), getDiagnostics: () => [{ label: 'capture', outcome: 'applied', responseJson: '{"newer":true}' }] });
  let copied = null;
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { clipboard: { writeText: async text => { copied = text; } } }, configurable: true });
  try {
    const shownBlock = { querySelector: selector => (selector === 'pre' ? { textContent: '{"shown":true}' } : null) };
    const button = { dataset: { wsaCopyJson: 'response', wsaDiagnosticIndex: '0' }, closest: selector => (selector === '.wsa-operation-json' ? shownBlock : null) };
    await dom.listeners.click({ target: { closest: wanted => (wanted === '[data-wsa-copy-json]' ? button : null) }, preventDefault() {} });
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
  }
  // Before: the button's render-time row number was looked up in a newly built list.
  assert.equal(copied, '{"shown":true}');
  ctl.destroy();
});

test('17: declining Reset profile keeps the typed values', async () => {
  let answer;
  const dom = fakePanelRoot();
  const ctl = createWorldStateUiController({ root: dom.root, getState: placesState, initialTab: 'spatial', onSpatialAction: async () => answer });
  await clickOn(dom, '[data-wsa-open-map-settings]');
  const unit = dom.field('data-wsa-profile-field', 'unitKm');
  unit.value = '5';
  dom.listeners.input({ target: unit });
  answer = undefined;
  await clickOn(dom, '[data-wsa-spatial-action]', { wsaSpatialAction: 'reset_profile' });
  // Before: the draft was dropped although nothing was reset.
  assert.equal(dom.field('data-wsa-profile-field', 'unitKm').value, '5');
  answer = true;
  await clickOn(dom, '[data-wsa-spatial-action]', { wsaSpatialAction: 'reset_profile' });
  assert.notEqual(dom.field('data-wsa-profile-field', 'unitKm').value, '5');
  ctl.destroy();
  // The host answers whether the reset was saved (a declined confirm answers nothing).
  const host = fs.readFileSync('index.js', 'utf8');
  assert.match(host, /return await applyManualProfile\(reset, 'Reset manual Coordinate Profile'\);/);
});

test('17: a short landscape window does not push the panel header off-screen', () => {
  const css = fs.readFileSync('ui.css', 'utf8');
  // Before: the 420px minimum height was reset only below 768px wide.
  assert.match(css, /@media \(max-height: 500px\) \{[\s\S]{0,400}?\.wsa-panel \{[^}]*min-height: 0;/);
});

test('40: function words in multi-word anchors do not flood the candidate pool', () => {
  const records = [];
  for (let i = 0; i < 300; i += 1) records.push(record('shrine' + i, 'Shrine ' + i + ' keeps its candles lit', ['the shrine ' + i]));
  records.push(record('target', 'Smugglers run contraband through the harbor tunnels', ['Black Tide ring']));
  const state = { records };
  const query = { recentText: 'the smugglers slip contraband through the harbor tunnels', currentMessageId: 5 };
  assert.equal(selectRelevantRecords(state, query).selected[0]?.record.id, 'target');
  // Before: 'the' gave all 300 shrine records a candidate hit and the target never reached scoring.
  assert.equal(selectRelevantRecords(state, { ...query, index: buildRelevanceIndex(state) }).selected[0]?.record.id, 'target');
  // A single-word anchor that is a function word still matches by name.
  const will = { records: [record('will', 'Will keeps the ferry running', ['Will'])] };
  assert.equal(selectRelevantRecords(will, { recentText: 'We ask Will about it.', index: buildRelevanceIndex(will), currentMessageId: 5 }).selected[0]?.record.id, 'will');
});

test('41: one accented letter does not spend the budget on plain-ASCII letter pairs', () => {
  // Before: every pair of a text with one accent was emitted, 'de' and 'on' included.
  assert.deepEqual(nonAsciiBigrams('Déjà de'), ['dé', 'éj', 'jà', 'àd']);
  assert.deepEqual(nonAsciiBigrams('雁门关'), ['雁门', '门关']);
  const records = [];
  for (let i = 0; i < 300; i += 1) records.push(record('eglise' + i, 'Église numéro ' + i + ' de Montréal', ['Église de Montréal ' + i]));
  records.push(record('target', 'Les contrebandiers passent la marchandise par les tunnels du port', ['contrebandiers']));
  const state = { records };
  const result = selectRelevantRecords(state, { index: buildRelevanceIndex(state), recentText: 'Déjà cette nuit, les contrebandiers passent la marchandise par les tunnels du port.', currentMessageId: 5 });
  assert.equal(result.selected[0]?.record.id, 'target');
});

test('42: resolved developments do not use background catch-up slots', () => {
  const developments = [];
  for (let i = 0; i < 40; i += 1) developments.push(record('d' + String(i).padStart(2, '0'), 'Development ' + i + ' continues', ['d' + i], { kind: 'development', lastEvaluatedMessage: 0 }));
  const index = buildRelevanceIndex({ records: developments });
  // 36 of them resolve during the session.
  updateRelevanceIndex(index, { upsertedRecords: developments.slice(0, 36).map(item => ({ ...item, status: 'resolved' })) });
  const picked = selectBackgroundDevelopments(index, { currentMessageId: 10, maxRecords: 6, scanCap: 32 });
  // Before: the 32-slot scan landed on resolved ids and reached no active development.
  assert.equal(picked.selected.length, 4);
});

// Code review hardening.

test('review: a linked record beyond the bounded list is rendered and opened', async () => {
  const state = createState('chat:a53');
  for (let i = 0; i < 125; i += 1) {
    state.records.push({ id: 'r' + i, kind: 'fact', status: 'active', summary: 'Fact number ' + i, anchors: ['fact' + i], trend: null, evidenceIds: [], createdAtMessage: i, lastChangedMessage: i });
  }
  const dom = fakePanelRoot();
  const ctl = createWorldStateUiController({ root: dom.root, getState: () => state });
  await clickOn(dom, '[data-wsa-open-record]', { wsaOpenRecord: 'row-0' });
  const shown = ctl.refresh();
  assert.ok(shown.views.current.some(row => row.key === 'row-0'));
  assert.match(dom.root.innerHTML, /Fact number 0\b/);
  ctl.destroy();
});

test('review: a multi-word anchor led by a function-word name is found by its content words', () => {
  // A multi-word anchor scores only when all its words are in the scene, so 'Will' alone never selected
  // 'Will Turner' (on alpha.52 either); the full name still does through 'turner'.
  const records = [record('turner', 'The ferryman keeps his boat moored', ['Will Turner'])];
  for (let i = 0; i < 300; i += 1) records.push(record('shrine' + i, 'Shrine ' + i + ' keeps its candles lit', ['the shrine ' + i]));
  const state = { records };
  const result = selectRelevantRecords(state, { index: buildRelevanceIndex(state), recentText: 'Will Turner waits at the docks.', currentMessageId: 5 });
  assert.equal(result.selected[0]?.record.id, 'turner');
});

test('review: a duplicate background id is compacted once, not on every update', () => {
  const dev = record('d1', 'Development one continues', ['d1'], { kind: 'development' });
  const index = buildRelevanceIndex({ records: [] });
  updateRelevanceIndex(index, { upsertedRecords: [dev] });
  updateRelevanceIndex(index, { upsertedRecords: [{ ...dev, status: 'resolved' }, dev] });
  updateRelevanceIndex(index, { upsertedRecords: [dev] });
  assert.deepEqual(index.backgroundDevelopmentIds, ['d1']);
});

test('review: inner spaces do not end bulk mode; a disabled field falls back to the search focus', () => {
  const ui = fs.readFileSync('ui.js', 'utf8');
  assert.match(ui, /const bulkScope = ui\.activeTab \+ '\|' \+ clean\(ui\.query, 500\);/);
  assert.match(ui, /clean\(ui\.query, 500\),\s*clean\(ui\.spatialSearch, 120\),/);
  assert.match(ui, /element\.focus\(\{ preventScroll: true \}\);[\s\S]{0,400}return !globalThis\.document \|\| globalThis\.document\.activeElement === element;/);
  // The Copy button no longer carries a row number that a new row could shift.
  assert.doesNotMatch(ui, /data-wsa-diagnostic-index/);
});

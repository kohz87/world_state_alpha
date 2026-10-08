// alpha.58: deep-pass items 61-68 (panel and accessibility).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { normalizeSpatialState } from '../spatial-core.js';
import { createState, reduceMutations } from '../state-core.js';
import { buildWorldStateUiModel, createWorldStateUiController, renderWorldStatePanel } from '../ui.js';

const source = fs.readFileSync('index.js', 'utf8');

// A replace-on-innerHTML DOM: every render builds fresh elements for the panel's controls (any tag carrying a
// data-wsa attribute, and the dialog section), with focus, dataset and closest() by attribute or class.
function fakeDom() {
  const doc = { activeElement: null, body: { children: [], appendChild(child) { this.children.push(child); child.isConnected = true; } } };
  doc.createElement = () => {
    const attrs = {};
    return { isConnected: false, textContent: '', setAttribute: (name, value) => { attrs[name] = value; }, getAttribute: name => attrs[name] ?? null, remove() { this.isConnected = false; } };
  };
  let html = '';
  let elements = [];
  const camel = name => name.replace(/^data-/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  const make = (tag, attrText, before) => {
    const attributes = [...attrText.matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => ({ name, value: value ?? '' }));
    const get = name => attributes.find(item => item.name === name)?.value ?? null;
    const classes = String(get('class') || '').split(/\s+/);
    const inline = tag === 'INPUT' && /wsa-search-inline">[^<]*(?:<svg[\s\S]*?<\/svg>)?\s*$/.test(before.slice(-600));
    const el = {
      tagName: tag, attributes, isConnected: true, disabled: get('disabled') !== null, type: get('type') || 'text',
      value: get('value') || '', dataset: Object.fromEntries(attributes.filter(item => item.name.startsWith('data-')).map(item => [camel(item.name), item.value])),
      getAttribute: get, hasAttribute: name => get(name) !== null, getClientRects: () => [1],
      focus() { doc.activeElement = el; },
      closest: selector => (matches(el, selector) || (selector === '.wsa-search-inline' && inline) ? el : null),
    };
    el.classes = classes;
    return el;
  };
  const matches = (el, selector) => {
    if (selector.startsWith('.')) return el.classes.includes(selector.slice(1));
    const [, name, wanted] = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/) || [];
    return Boolean(name) && el.getAttribute(name) !== null && (wanted === undefined || el.getAttribute(name) === wanted);
  };
  const root = {
    listeners: {},
    get innerHTML() { return html; },
    set innerHTML(next) {
      for (const el of elements) el.isConnected = false;
      html = next;
      elements = [];
      for (const match of next.matchAll(/<(\w+)((?:\s[^>]*)?)>/g)) {
        if (/data-wsa-|class="wsa-panel"/.test(match[2])) elements.push(make(match[1].toUpperCase(), match[2], next.slice(0, match.index)));
      }
    },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    removeEventListener() {},
    contains: el => elements.includes(el),
    querySelector: selector => elements.find(el => matches(el, selector)) || null,
    querySelectorAll: selector => elements.filter(el => matches(el, selector)),
  };
  return { root, doc };
}

function withDom(fn) {
  const dom = fakeDom();
  const had = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const keyListeners = [];
  const addListener = globalThis.addEventListener;
  const removeListener = globalThis.removeEventListener;
  Object.defineProperty(globalThis, 'document', { value: dom.doc, configurable: true, writable: true });
  globalThis.addEventListener = (type, fn) => { if (type === 'keydown') keyListeners.push(fn); };
  globalThis.removeEventListener = () => {};
  try {
    return fn({ ...dom, key: event => keyListeners.forEach(fn => fn({ preventDefault() {}, stopPropagation() {}, ...event })) });
  } finally {
    if (had) Object.defineProperty(globalThis, 'document', had);
    else delete globalThis.document;
    globalThis.addEventListener = addListener;
    globalThis.removeEventListener = removeListener;
  }
}

function stateWith(summaries) {
  return reduceMutations(createState('a58'), {
    chatKey: 'a58', messageId: 1, lineageKey: 'l1', operation: 'manual',
    mutations: summaries.map(summary => ({ action: 'create', kind: 'fact', summary, anchors: [], evidence: [{ sourceMessageId: 1, claim: summary, sourceClass: 'manual' }] })),
  }).state;
}

test('61: toasts show above the open panel', () => {
  assert.match(fs.readFileSync('ui.css', 'utf8'), /body\.wsa-panel-open #toast-container \{\s*z-index: 2147483200 !important;/);
  assert.match(source, /document\.body\.classList\.add\('wsa-panel-open'\);/);
  assert.match(source, /globalThis\.document\?\.body\?\.classList\?\.remove\('wsa-panel-open'\);/);
});

test('62: the dialog takes focus, keeps it on the clicked control, and Escape closes the innermost layer', async () => {
  await withDom(async ({ root, doc, key }) => {
    let closed = 0;
    const controller = createWorldStateUiController({ root, getState: () => stateWith(['The north gate is barred']), onClose: () => { closed += 1; } });
    // Before: focus stayed on the page behind the modal.
    assert.equal(doc.activeElement?.classes?.includes('wsa-panel'), true);
    const tab = root.querySelector('[data-wsa-tab="spatial"]');
    tab.focus();
    await root.listeners.click({ target: tab });
    // Before: the re-render dropped focus to the page body.
    assert.equal(doc.activeElement?.getAttribute('data-wsa-tab'), 'spatial');
    assert.equal(doc.activeElement.isConnected, true);
    await root.listeners.click({ target: root.querySelector('[data-wsa-open-rebuild]') });
    assert.equal(controller.getUiState().rebuildOpen, true);
    key({ key: 'Escape' });
    assert.equal(controller.getUiState().rebuildOpen, false);
    assert.equal(closed, 0);
    key({ key: 'Escape' });
    assert.equal(closed, 1);
    // Live regions are not part of the re-rendered markup.
    assert.doesNotMatch(root.innerHTML, /aria-live/);
    controller.destroy();
  });
});

test('63: emptying the search view\'s own box keeps the search view', async () => {
  await withDom(async ({ root }) => {
    const controller = createWorldStateUiController({ root, getState: () => stateWith(['The north gate is barred']) });
    const nav = root.querySelector('[data-wsa-search]');
    nav.value = 'gate';
    root.listeners.input({ target: nav });
    assert.equal(controller.getUiState().activeTab, 'search');
    const inline = root.querySelectorAll('[data-wsa-search]').find(el => el.closest('.wsa-search-inline'));
    assert.ok(inline);
    inline.value = '';
    root.listeners.input({ target: inline });
    // Before: back to Current, which on phones hides the only search box.
    assert.equal(controller.getUiState().activeTab, 'search');
    const navAgain = root.querySelectorAll('[data-wsa-search]').find(el => !el.closest('.wsa-search-inline'));
    navAgain.value = '';
    root.listeners.input({ target: navAgain });
    assert.equal(controller.getUiState().activeTab, 'current');
    controller.destroy();
  });
});

test('64 and 65: a declined archive keeps the edit form; Add place stops at a cancelled prompt', async () => {
  await withDom(async ({ root }) => {
    const state = { ...createState('a58'), spatial: normalizeSpatialState({ locations: [{ id: 'mill', name: 'Old Mill', type: 'mill', status: 'active', coordinate: { x: null, y: null, authority: 'unknown', locked: false } }] }) };
    let answer;
    const controller = createWorldStateUiController({ root, getState: () => state, initialTab: 'spatial', onSpatialAction: async () => answer });
    await root.listeners.click({ target: root.querySelector('[data-wsa-spatial-key]') });
    await root.listeners.click({ target: root.querySelector('[data-wsa-spatial-edit]') });
    assert.equal(controller.getUiState().spatialEditing, true);
    answer = undefined;
    await root.listeners.click({ target: root.querySelector('[data-wsa-spatial-action="archive_location"]') });
    // Before: the form closed (and its unsaved edits were dropped) although nothing was archived.
    assert.equal(controller.getUiState().spatialEditing, true);
    answer = true;
    await root.listeners.click({ target: root.querySelector('[data-wsa-spatial-action="archive_location"]') });
    assert.equal(controller.getUiState().spatialEditing, false);
    controller.destroy();
  });
  for (const step of ['typeRaw', 'xRaw', 'yRaw', 'contextRaw']) assert.match(source, new RegExp('if \\(' + step + ' === null\\) return;'));
  for (const action of ['Archived location', 'Merged duplicate into', 'Deleted location']) assert.match(source, new RegExp('return persistSpatialState\\(res\\.state, \'' + action));
});

test('66: a free-text direction is shown as stated from either side and kept by the edit form', () => {
  const spatial = normalizeSpatialState({
    locations: [
      { id: 'mill', name: 'Old Mill', type: 'mill', status: 'active', coordinate: { x: null, y: null, authority: 'unknown', locked: false } },
      { id: 'weir', name: 'Weir', type: 'weir', status: 'active', coordinate: { x: null, y: null, authority: 'unknown', locked: false } },
    ],
    relations: [{ id: 'rel1', fromId: 'mill', toId: 'weir', direction: 'upstream', distanceMode: 'unspecified' }],
  });
  const state = { ...createState('a58'), spatial };
  const keyOf = name => buildWorldStateUiModel(state, { activeView: 'spatial' }).spatial.locations.find(item => item.name === name).key;
  const millModel = buildWorldStateUiModel(state, { activeView: 'spatial', selectedSpatialKey: keyOf('Old Mill') });
  // Before: "upstream relative to Weir" from the mill, the same words as from the weir.
  assert.equal(millModel.spatial.detail.relations[0].summary, 'Weir is upstream of this place');
  const weirModel = buildWorldStateUiModel(state, { activeView: 'spatial', selectedSpatialKey: keyOf('Weir') });
  assert.equal(weirModel.spatial.detail.relations[0].summary, 'upstream relative to Old Mill');
  const html = renderWorldStatePanel(weirModel, { activeTab: 'spatial', spatialDetailOpen: true, spatialEditing: true });
  // Before: the compass-only select had no "upstream", so any save erased it.
  assert.match(html, /<option value="upstream" selected>upstream \(as stated\)<\/option>/);
});

test('67: a click after a state change without a re-render acts on the record the operator saw', async () => {
  await withDom(async ({ root }) => {
    let state = stateWith(['A plague grips the docks', 'The north gate is barred']);
    const calls = [];
    createWorldStateUiController({ root, getState: () => state, onRecordAction: async (action, payload) => { calls.push(payload.record); } });
    const shown = buildWorldStateUiModel(state).views.current.findIndex(row => row.summary === 'The north gate is barred');
    await root.listeners.click({ target: root.querySelector('[data-wsa-record-index="' + shown + '"]') });
    // A branch restore lands while an input method composes (no re-render): positions shift under the
    // rendered rows, and the gate's old row key now names the plague.
    state = stateWith(['The bridge has fallen', 'A plague grips the docks', 'The north gate is barred']);
    await root.listeners.click({ target: root.querySelector('[data-wsa-record-action="resolve"]') });
    assert.equal(calls.length, 1);
    // Before: the plague (the record now at the gate's old position) was sent.
    assert.equal(calls[0].summary, 'The north gate is barred');
    assert.equal(calls[0].key, 'row-' + state.records.findIndex(item => item.summary === 'The north gate is barred'));
  });
});

test('68: the rebuild reports active campaign places', () => {
  assert.match(source, /places: activeCampaignPlaceCount\(state\.spatial\),/);
  assert.match(source, /const placeCount = activeCampaignPlaceCount\(result\.state\.spatial\);/);
  assert.match(fs.readFileSync('rebuild.js', 'utf8'), /places: activeCampaignPlaceCount\(candidate\.spatial\),/);
});

// Code review hardening.

test('review: Escape keeps a place form with unsaved edits open', async () => {
  await withDom(async ({ root, key }) => {
    const state = { ...createState('a58'), spatial: normalizeSpatialState({ locations: [{ id: 'mill', name: 'Old Mill', type: 'mill', status: 'active', coordinate: { x: null, y: null, authority: 'unknown', locked: false } }] }) };
    let closed = 0;
    const controller = createWorldStateUiController({ root, getState: () => state, initialTab: 'spatial', onClose: () => { closed += 1; } });
    await root.listeners.click({ target: root.querySelector('[data-wsa-spatial-key]') });
    await root.listeners.click({ target: root.querySelector('[data-wsa-spatial-edit]') });
    const name = root.querySelector('[data-wsa-field="name"]');
    name.value = 'Old Mill Ruins';
    root.listeners.input({ target: name });
    key({ key: 'Escape' });
    // Before: the form closed and the typed name was dropped.
    assert.equal(controller.getUiState().spatialEditing, true);
    assert.equal(closed, 0);
    controller.destroy();
  });
});

test('review: a record opened beyond the bounded list is still found after positions shift', async () => {
  await withDom(async ({ root }) => {
    const summaries = Array.from({ length: 130 }, (_, index) => 'Condition number ' + index + ' holds');
    let state = stateWith(summaries);
    const calls = [];
    createWorldStateUiController({ root, getState: () => state, onRecordAction: async (action, payload) => { calls.push(payload.record); } });
    // A record the bounded Current list leaves out, in the state after the shift too.
    const next = stateWith(['A new first condition holds', ...summaries]);
    const listed = new Set(buildWorldStateUiModel(next).views.current.map(row => row.summary));
    const hidden = summaries.findIndex(summary => !listed.has(summary));
    assert.ok(hidden >= 0);
    const link = { dataset: { wsaOpenRecord: 'row-' + hidden }, closest: selector => (selector === '[data-wsa-open-record]' ? link : null) };
    await root.listeners.click({ target: link });
    state = next;
    await root.listeners.click({ target: root.querySelector('[data-wsa-record-action="resolve"]') });
    // Before: the record was in no bounded view of the new state, so the click did nothing.
    assert.equal(calls[0]?.summary, summaries[hidden]);
    assert.equal(calls[0]?.key, 'row-' + (hidden + 1));
  });
});

test('review: a rebuild status that goes away is not announced', () => {
  const said = [];
  withDom(({ root, doc }) => {
    doc.createElement = () => ({ setAttribute() {}, set textContent(value) { said.push(value); }, isConnected: true, remove() {} });
    let status = { operationId: 'op1', phase: 'running', totalBoundaries: 2, processedBoundaries: 0, providerCalls: 0, currentRecords: 0, places: 0 };
    const controller = createWorldStateUiController({ root, getState: () => createState('a58'), getRuntimeInfo: () => ({ rebuildStatus: status }) });
    status = { ...status, phase: 'completed' };
    controller.refresh();
    status = null;
    controller.refresh();
    // Before: "Rebuild status" was announced for the status that went away.
    assert.deepEqual(said, ['Rebuild completed']);
    controller.destroy();
  });
});

test('review: free-text orientation, sheet focus, rendered tab and untagged controls', () => {
  assert.match(source, /fromId: statedFromAnchorSide \? selectedEffectiveId : anchor\.id,/);
  const ui = fs.readFileSync('ui.js', 'utf8');
  assert.match(ui, /const sheetOpened = ui\.rebuildOpen && !ui\.sheetWasOpen;/);
  assert.match(ui, /selectedRecordRows\(renderedModel\(\), ui\.renderedTab \?\? ui\.activeTab\)/);
  assert.match(ui, /return \{ selector: index >= 0 \? tag : '', selection: null, radio: null, index, inside: true \};/);
});

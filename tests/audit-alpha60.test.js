// alpha.60: forfeit a missed live capture without a rebuild.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import { affectsCaptureRecovery, unrecoveredCaptureFailures } from '../diagnostics.js';
import { createState } from '../state-core.js';
import { buildWorldStateUiModel, createWorldStateUiController, renderWorldStatePanel } from '../ui.js';

function scenario(name) {
  const run = spawnSync(process.execPath, ['tests/host/' + name + '.mjs'], { encoding: 'utf8', timeout: 60000 });
  const line = String(run.stdout || '').split('\n').find(item => item.startsWith('@@RESULT '));
  assert.ok(line, name + ' produced no result:\n' + String(run.stderr || '').slice(-2000));
  return JSON.parse(line.slice('@@RESULT '.length));
}

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

const row = (at, outcome, extra = {}) => ({ label: 'capture', at, sourceMessageId: 7, lineageKey: 'ln-a', contentLineageKey: 'c-a', outcome, ...extra });

test('a forfeited capture clears the failures of that message version only, and is no failure itself', () => {
  assert.deepEqual(unrecoveredCaptureFailures([row(1, 'invalid-response'), row(2, 'forfeited')]), []);
  // Another version of the message (a swipe) keeps its own failure.
  assert.deepEqual(unrecoveredCaptureFailures([row(1, 'invalid-response'), row(2, 'forfeited', { lineageKey: 'ln-b', contentLineageKey: 'c-b' })]).map(item => item.lineageKey), ['ln-a']);
  // The same version after a hide or unhide (another lineage key, same hide-insensitive key) is forfeited.
  assert.deepEqual(unrecoveredCaptureFailures([row(1, 'invalid-response'), row(2, 'forfeited', { lineageKey: 'ln-hidden' })]), []);
  // A later failure of that version is listed again.
  assert.equal(unrecoveredCaptureFailures([row(1, 'invalid-response'), row(2, 'forfeited'), row(3, 'provider-error')]).length, 1);
  assert.deepEqual(unrecoveredCaptureFailures([row(2, 'forfeited')]), []);
  // It is saved at once while a failure is listed, like any recovery.
  assert.equal(affectsCaptureRecovery(row(2, 'forfeited'), { failuresListed: true }), true);
  assert.equal(affectsCaptureRecovery(row(2, 'forfeited'), { failuresListed: false }), false);
});

test('the Missed captures notice offers Forfeit for each listed message, outside the rebuild sheet and runs', async () => {
  const state = createState('chat:test:forfeit');
  const runtimeInfo = { chatMessages: 60, earliestPartialStart: 1, captureFailures: [21, 33] };
  const model = buildWorldStateUiModel(state, { runtimeInfo });
  const world = renderWorldStatePanel(model, {});
  assert.match(world, /Forfeit without recovering:[\s\S]*data-wsa-forfeit-capture="21"[\s\S]*data-wsa-forfeit-capture="33"/);
  assert.match(world, /aria-label="Forfeit the missed capture of message 21"/);
  const sheet = renderWorldStatePanel(model, { rebuildOpen: true }).split('data-wsa-rebuild-sheet')[1];
  assert.doesNotMatch(sheet, /data-wsa-forfeit-capture/);
  const running = buildWorldStateUiModel(state, { runtimeInfo: { ...runtimeInfo, rebuildStatus: { phase: 'running', operationId: 'rebuild:1' } } });
  assert.doesNotMatch(renderWorldStatePanel(running, {}), /data-wsa-forfeit-capture/);

  await withDom(async ({ root }) => {
    const calls = [];
    createWorldStateUiController({
      root,
      getState: () => state,
      getRuntimeInfo: () => runtimeInfo,
      onMaintenanceAction: async (id, payload) => { calls.push([id, payload]); return true; },
    });
    await root.listeners.click({ target: root.querySelector('[data-wsa-forfeit-capture="33"]') });
    assert.deepEqual(calls, [['forfeit_capture', { messageId: 33 }]]);
  });
});

test('forfeiting in the host clears the notice without a rebuild, changes no World State and saves the log row', () => {
  const result = scenario('forfeit-capture');
  assert.deepEqual(result.failedBefore, [2]);
  // Review hardening: refused at once while a rebuild runs; a full log and an unreadable sidecar (both set up
  // before the forfeit below) neither stop it nor delay its save.
  assert.equal(result.refusedWhileRunning, true);
  // Declined: still listed. A message that is not listed is refused.
  assert.deepEqual(result.afterDecline, [2]);
  assert.equal(result.staleNotice, true);
  assert.deepEqual(result.afterForfeit, []);
  assert.equal(result.revision[0], result.revision[1]);
  assert.equal(result.records[0], result.records[1]);
  assert.equal(result.savedForfeit, true);
  assert.equal(result.success, true);
});

test('review hardening: Forfeit reaches more messages than the notice names, and says a later rebuild still re-reads it', () => {
  const state = createState('chat:test:forfeit-many');
  const ids = n => Array.from({ length: n }, (_, i) => 10 + i * 2);
  // alpha.64: six buttons show at first, and "Show all" expands them (a phone screen is not filled).
  const collapsed = renderWorldStatePanel(buildWorldStateUiModel(state, { runtimeInfo: { chatMessages: 200, earliestPartialStart: 1, captureFailures: ids(15) } }), {});
  assert.equal((collapsed.match(/data-wsa-forfeit-capture=/g) || []).length, 6);
  assert.match(collapsed, /data-wsa-forfeit-more[^>]*>Show all 15</);
  const fifteen = renderWorldStatePanel(buildWorldStateUiModel(state, { runtimeInfo: { chatMessages: 200, earliestPartialStart: 1, captureFailures: ids(15) } }), { forfeitExpanded: true });
  assert.equal((fifteen.match(/data-wsa-forfeit-capture=/g) || []).length, 15);
  const many = renderWorldStatePanel(buildWorldStateUiModel(state, { runtimeInfo: { chatMessages: 200, earliestPartialStart: 1, captureFailures: ids(45) } }), { forfeitExpanded: true });
  assert.equal((many.match(/data-wsa-forfeit-capture=/g) || []).length, 40);
  assert.match(many, /and 5 more \(shown once these are forfeited or recovered\)/);

  const source = fs.readFileSync('index.js', 'utf8');
  const forfeit = source.slice(source.indexOf('async function forfeitMissedCapture('), source.indexOf('async function applyMaintenanceActionNow('));
  assert.match(forfeit, /a later Recapture or rebuild that covers this message still re-reads it/);
  // Saved at once through the store's own report of the failure it clears (alpha.61), not a second save.
  assert.match(forfeit, /A row that clears a listed failure is saved at once/);
  assert.doesNotMatch(forfeit, /scheduleOperationLogSave/);
  assert.doesNotMatch(forfeit, /refreshChatStateFromServer|ensureChatStateLoaded/);
});

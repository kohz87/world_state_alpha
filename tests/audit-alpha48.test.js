// alpha.48: external audit A19-A21, A27-A29 and the batch 4 robustness/UX items, each reproduced against
// 0.9.0-alpha.47 first.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { buildRelevanceIndex, selectRelevantRecords } from '../relevance.js';

const source = fs.readFileSync('index.js', 'utf8');

function record(id, summary, anchors, extra = {}) {
  return { id, kind: 'fact', status: 'active', summary, anchors, trend: null, lastChangedMessage: 1, ...extra };
}

test('A19: retired neighbours do not use up the one-hop budget', () => {
  const state = {
    records: [
      record('bridge', 'The Varn bridge is closed', ['Varn bridge']),
      record('a1', 'A toll was charged', ['toll'], { status: 'resolved' }),
      record('a2', 'A guard stood watch', ['guard'], { status: 'superseded' }),
      record('a3', 'Ferries ran at night', ['ferry'], { status: 'resolved' }),
      record('z_crossing', 'Freight now crosses at the ford', ['ford']),
    ],
    links: ['a1', 'a2', 'a3', 'z_crossing'].map(to => ({ from: 'bridge', to })),
  };
  const query = { recentText: 'We reach the Varn bridge at dusk.', currentMessageId: 5 };
  const plain = selectRelevantRecords(state, query).selected.map(item => item.record.id);
  assert.deepEqual(plain, ['bridge', 'z_crossing']);
  // Before: the indexed path sliced three retired ids first and linked nothing.
  const indexed = selectRelevantRecords(state, { ...query, index: buildRelevanceIndex(state) });
  assert.deepEqual(indexed.selected.map(item => item.record.id), ['bridge', 'z_crossing']);
  assert.equal(indexed.metrics.linkedCandidates, 1);
});

test('A20: a specific anchor phrase reaches scoring ahead of a crowded common word', () => {
  const records = [];
  for (let i = 0; i < 600; i += 1) records.push(record('gate' + String(i).padStart(3, '0'), 'Gate number ' + i + ' has a fresh coat of paint', ['Gate']));
  records.push(record('kessel', 'The Kesselpass Gate is closed to all traffic', ['Kesselpass Gate'], { lastChangedMessage: 0 }));
  const state = { records };
  const result = selectRelevantRecords(state, { index: buildRelevanceIndex(state), recentText: 'We ride up to the Kesselpass Gate.', currentMessageId: 5 });
  // Before: 'gate' filled the candidate pool first and the closure never reached scoring.
  assert.equal(result.selected[0]?.record.id, 'kessel');
});

test('A29: the newest Chinese name is found after a long run of earlier Chinese text', () => {
  const state = { records: [record('pass', '雁门关已经封闭', ['雁门关'])] };
  const older = '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜金生丽水玉出昆冈剑号巨阙珠称夜光果珍李柰菜重芥姜海咸河淡鳞潜羽翔龙师火帝鸟官人皇始制文字乃服衣裳推位让国有虞陶唐吊民伐罪周发殷汤坐朝问道垂拱平章爱育黎首臣伏戎羌遐迩一体率宾归王鸣凤在竹白驹食场化被草木赖及万方盖此身发四大五常恭惟鞠养岂敢毁伤女慕贞洁男效才良知过必改得能莫忘罔谈彼短靡恃己长信使可覆器欲难量墨悲丝染诗赞羔羊';
  assert.ok([...older].length >= 160);
  const query = { recentText: older + '我们终于抵达雁门关。', currentMessageId: 5 };
  assert.equal(selectRelevantRecords(state, query).selected[0]?.record.id, 'pass');
  // Before: bigrams were taken from the oldest characters only, so the indexed path found nothing.
  assert.equal(selectRelevantRecords(state, { ...query, index: buildRelevanceIndex(state) }).selected[0]?.record.id, 'pass');
});

test('A21: the host relevance view keeps the end of a long reply', async () => {
  const { boundedExchangeText } = await import('../capture.js');
  const reply = 'The road winds on. '.repeat(260) + 'At last the Old Observatory reopens its doors.';
  assert.ok(reply.length > 4900);
  // Before: each message was cut to its first 3500 characters, dropping the late mention.
  assert.match(source, /function recentText\(exchange\) \{\s*return boundedExchangeText\(/);
  assert.doesNotMatch(source, /slice\(0, 3500\)/);
  assert.match(boundedExchangeText(['We walk.', reply]), /Old Observatory reopens/);
  // Still bounded, newest first: an overlong reply keeps its start and end within the exchange budget.
  const huge = 'Start. ' + 'x'.repeat(20000) + ' The Old Observatory reopens.';
  const view = boundedExchangeText(['Older message.', huge]);
  assert.ok(view.length <= 12000);
  assert.match(view, /^Older message\.\nStart\./);
  assert.match(view, /Old Observatory reopens\.$/);
});

test('A28: Resume refuses when the same profile now runs a different model', async () => {
  const { worldStateRouteFingerprint, dispatchWorldStateRequest } = await import('../provider-routing.js');
  const profiles = [{ id: 'p1', name: 'Capture', api: 'openai', model: 'model-a' }];
  const calls = [];
  const ctx = {
    extensionSettings: { connectionManager: { profiles }, world_state_alpha: { connectionProfile: 'p1' } },
    ConnectionManagerRequestService: {
      getProfile: id => profiles.find(item => item.id === id),
      sendRequest: async (id) => { calls.push(profiles.find(item => item.id === id).model); return { content: '{}' }; },
    },
  };
  const before = worldStateRouteFingerprint(ctx, { profileId: 'p1' });
  profiles[0].model = 'model-b';
  const after = worldStateRouteFingerprint(ctx, { profileId: 'p1' });
  // Before: the resume point kept only {"profileId":"p1"}, which is unchanged.
  assert.notEqual(JSON.stringify(after), JSON.stringify(before));
  // A run pinned to the earlier signature refuses before sending anything.
  await assert.rejects(
    dispatchWorldStateRequest(ctx, { prompt: 'x' }, { route: { profileId: 'p1', signature: before.signature } }),
    error => error.code === 'WORLD_STATE_PROFILE_CHANGED',
  );
  assert.deepEqual(calls, []);
  // The host model of the default route is part of it too, and so is the output cap.
  const host = { mainApi: 'textgenerationwebui', onlineStatus: 'model-a', extensionSettings: {} };
  const hostBefore = JSON.stringify(worldStateRouteFingerprint(host, {}));
  host.onlineStatus = 'model-b';
  assert.notEqual(JSON.stringify(worldStateRouteFingerprint(host, {})), hostBefore);
  host.onlineStatus = 'model-a';
  host.extensionSettings.world_state_alpha = { maxOutputTokens: 4000 };
  assert.notEqual(JSON.stringify(worldStateRouteFingerprint(host, {})), hostBefore);
  // The host stores and checks the fingerprint, and pins each boundary to its signature.
  const rebuild = source.slice(source.indexOf("if (actionId === 'rebuild')"), source.indexOf('async function applySpatialAction('));
  assert.match(rebuild, /const routeFingerprint = worldStateRouteFingerprint\(getContext\(\), routeSettings\(\)\);/);
  // alpha.57: the host connection is pinned the same way.
  assert.match(rebuild, /route: routeFingerprint\.signature\s*\? \{ \.\.\.routeSettings\(\), signature: routeFingerprint\.signature \}\s*: pinnedHostRoute\(routeFingerprint\),/);
  assert.match(rebuild, /routeKey,\n\s*totalBoundaries/);
});

// A replace-on-innerHTML DOM: every render builds fresh form fields from the HTML, like a real browser.
function fakePanelRoot() {
  const listeners = {};
  let html = '';
  let fields = [];
  const element = (attrs, value, checked) => {
    const el = {
      isConnected: true,
      type: /type="checkbox"/.test(attrs) ? 'checkbox' : 'text',
      value,
      checked,
      disabled: /\sdisabled/.test(attrs),
      getAttribute: name => (attrs.match(new RegExp(name + '="([^"]*)"')) || [])[1] ?? null,
      closest: selector => {
        const [, name, wanted] = selector.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/) || [];
        const actual = name ? el.getAttribute(name) ?? (new RegExp(name + '(?=[\\s>])').test(attrs) ? '' : null) : null;
        return actual !== null && (wanted === undefined || actual === wanted) ? el : null;
      },
    };
    return el;
  };
  const unescape = text => text.replaceAll('&quot;', '"').replaceAll('&#39;', "'").replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
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
    querySelector(selector) {
      const [, name, wanted] = selector.match(/^\[([\w-]+)="([^"]*)"\]$/) || [];
      return name ? fields.find(field => field.getAttribute(name) === wanted) || null : null;
    },
    querySelectorAll() { return []; },
  };
  return { root, listeners, field: (attr, name) => root.querySelector('[' + attr + '="' + name + '"]') };
}

async function placesPanel({ onSpatialAction = async () => true, relations = [] } = {}) {
  const { createWorldStateUiController } = await import('../ui.js');
  const { createState } = await import('../state-core.js');
  const state = createState('chat:a27');
  state.spatial.locations = [{
    id: 'wsloc_tower', name: 'Old Tower', type: 'tower', status: 'active', baseRefId: null,
    coordinate: { x: 10, y: 5, authority: 'manual', locked: false }, context: 'Old context', routeRefs: [], notes: '',
    createdAtMessage: 1, lastChangedMessage: 1, evidenceIds: [],
  }, {
    id: 'wsloc_mill', name: 'Old Mill', type: 'mill', status: 'active', baseRefId: null,
    coordinate: { x: 0, y: 0, authority: 'manual', locked: false }, context: '', routeRefs: [], notes: '',
    createdAtMessage: 1, lastChangedMessage: 1, evidenceIds: [],
  }];
  state.spatial.relations = relations;
  const dom = fakePanelRoot();
  const ctl = createWorldStateUiController({ root: dom.root, getState: () => state, initialTab: 'spatial', onSpatialAction });
  const key = ctl.refresh().spatial.locations.find(item => item.name === 'Old Tower')?.key || '';
  const click = (selector, dataset = {}) => dom.listeners.click({ target: { closest: wanted => (wanted === selector ? { dataset } : null) }, preventDefault() {} });
  if (key) await click('[data-wsa-spatial-key]', { wsaSpatialKey: key });
  await click('[data-wsa-spatial-edit]');
  const type = (name, value) => {
    const el = dom.field('data-wsa-field', name);
    el.value = value;
    dom.listeners.input({ target: el });
  };
  return { ctl, dom, state, click, type };
}

test('A27: a background refresh keeps unsaved Places edits', async () => {
  const { ctl, dom, state, type } = await placesPanel();
  assert.equal(ctl.getUiState().spatialEditing, true);
  type('name', 'New Tower');
  type('x', '44');
  type('context', 'Draft context');
  // A capture completes elsewhere and the host refreshes the panel.
  state.spatial.locations[0].notes = 'Changed by capture';
  ctl.refresh();
  // Before: every field was rebuilt from canonical state, so the typing was lost.
  assert.equal(dom.field('data-wsa-field', 'name').value, 'New Tower');
  assert.equal(dom.field('data-wsa-field', 'x').value, '44');
  assert.equal(dom.field('data-wsa-field', 'context').value, 'Draft context');
  // A field the operator did not touch shows the new canonical value.
  assert.equal(dom.field('data-wsa-field', 'notes').value, 'Changed by capture');
  ctl.destroy();
});

test('batch 4: a rejected save keeps the form and its draft; a committed save closes it', async () => {
  let result = false;
  const { ctl, dom, click, type } = await placesPanel({ onSpatialAction: async () => result });
  type('name', 'New Tower');
  await click('[data-wsa-spatial-action]', { wsaSpatialAction: 'save_location' });
  // Before: the editor closed whatever the host answered, dropping the typing.
  assert.equal(ctl.getUiState().spatialEditing, true);
  assert.equal(dom.field('data-wsa-field', 'name').value, 'New Tower');
  result = true;
  await click('[data-wsa-spatial-action]', { wsaSpatialAction: 'save_location' });
  assert.equal(ctl.getUiState().spatialEditing, false);
  // Reopening the editor starts from canonical state again.
  await click('[data-wsa-spatial-edit]');
  assert.equal(dom.field('data-wsa-field', 'name').value, 'Old Tower');
  ctl.destroy();
});

test('batch 4: typing through an input method does not re-render the search box mid-composition', async () => {
  const { createWorldStateUiController } = await import('../ui.js');
  const { createState } = await import('../state-core.js');
  const dom = fakePanelRoot();
  const ctl = createWorldStateUiController({ root: dom.root, getState: () => createState('chat:ime') });
  assert.match(dom.root.innerHTML, /<input[^>]*data-wsa-search/);
  // The focused search box, mid-composition.
  const target = { isConnected: true, value: 'ｓ', closest: selector => (selector === '[data-wsa-search]' ? target : null), getAttribute: () => null };
  dom.root.contains = el => el === target;
  const renders = () => dom.root.innerHTML;
  const before = renders();
  dom.listeners.compositionstart({ target });
  dom.listeners.input({ target, isComposing: true });
  ctl.refresh();
  // Before: every composing keystroke (and any background refresh) replaced the focused input.
  assert.equal(renders(), before);
  target.value = '砦';
  dom.listeners.compositionend({ target });
  assert.equal(ctl.getUiState().query, '砦');
  assert.equal(ctl.getUiState().activeTab, 'search');
  ctl.destroy();
});

test('batch 4: failed panel actions report an error; overlapping chat loads are serialized', () => {
  // Before: a thrown import/reset/Places action gave only "Uncaught (in promise)" in the console.
  assert.match(source, /return queueChatWork\(chatKey, \(\) => applyMaintenanceActionNow\(actionId, payload, chatKey\)\)\s*\.catch\(error => actionFailed\(/);
  assert.match(source, /return queueChatWork\(chatKey, \(\) => applySpatialActionNow\(actionId, payload, chatKey\)\)\s*\.catch\(error => actionFailed\('Places edit', error, chatKey\)\);/);
  assert.match(source, /function actionFailed\(label, error, chatKey\) \{[\s\S]{0,200}notify\('error', label \+ ' failed: '/);
  // Before: the queue's own cleanup re-raised every failed task as an unhandled rejection.
  const queue = source.slice(source.indexOf('function queueChatWork('), source.indexOf('function chatHeadGuard('));
  assert.doesNotMatch(queue, /next\.finally\(/);
  assert.match(queue, /next\.then\(cleanup, cleanup\);/);
  // Before: activation reconciled (and wrote a restore) outside the queue, racing a second activation.
  const activate = source.slice(source.indexOf('async function activateCurrentChat('), source.indexOf('function connectionProfileUiContext('));
  assert.match(activate, /await serializeActivation\(chatKey, async \(\) => \{\s*if \(currentChatKey\(\) !== chatKey\) return;\s*await reconcileCurrentBranch\(chatKey, \{ persistRestore: true \}\);/);
});

test('batch 4: a place related to an archived place can still be saved', () => {
  const save = source.slice(source.indexOf("if (actionId === 'save_location' && payload.location) {"), source.indexOf("if (actionId === 'toggle_lock' && payload.location) {"));
  // An unchanged relation is left alone; a changed one keeps its anchor by id, not by a name lookup that
  // skips archived places.
  assert.match(save, /const keptAnchor = relationId && shownRelation\.anchorId && anchorName === String\(shownRelation\.anchorName \|\| ''\)\.trim\(\)/);
  assert.match(save, /relationId = '';\s*anchorName = '';/);
  assert.match(save, /const anchor = keptAnchor \? \{ id: keptAnchor \} : findEffectiveByName\(afterLocation\.state, anchorName\);/);
  assert.match(save, /return await persistSpatialState\(res\.state, 'Saved location '/);
});

test('A20/A29 for Places: a specific name and the newest Chinese name reach the bounded pool', async () => {
  const { selectRelevantLocations } = await import('../spatial-relevance.js');
  const place = (id, name) => ({ id, name, type: 'landmark', status: 'active', baseRefId: null, coordinate: { x: null, y: null, authority: 'unknown', locked: false }, context: '', routeRefs: [], notes: '', createdAtMessage: 1, lastChangedMessage: 1, evidenceIds: [] });
  const crowded = { locations: [], relations: [], routes: [], overrides: [], evidence: {} };
  for (let i = 0; i < 300; i += 1) crowded.locations.push(place('g' + i, 'Gate'));
  crowded.locations.push(place('kessel', 'Kesselpass Gate'));
  const ids = result => result.selected.map(item => item.location?.id || item.id);
  assert.ok(ids(selectRelevantLocations(crowded, { recentText: 'We ride up to the Kesselpass Gate.' })).includes('kessel'));
  const older = '天地玄黄宇宙洪荒日月盈昃辰宿列张寒来暑往秋收冬藏闰余成岁律吕调阳云腾致雨露结为霜金生丽水玉出昆冈剑号巨阙珠称夜光果珍李柰菜重芥姜海咸河淡鳞潜羽翔龙师火帝鸟官人皇始制文字乃服衣裳推位让国';
  const chinese = { locations: [place('pass', '雁门关')], relations: [], routes: [], overrides: [], evidence: {} };
  assert.deepEqual(ids(selectRelevantLocations(chinese, { recentText: older + '我们终于抵达雁门关。' })), ['pass']);
});

test('review hardening: a profile draft ends on save or reset', async () => {
  // The save is rejected; the reset is applied (a declined reset keeps the draft, see alpha.53 item 17).
  const { ctl, dom, click } = await placesPanel({ onSpatialAction: async action => action === 'reset_profile' });
  await click('[data-wsa-map-settings]');
  const unit = () => dom.field('data-wsa-profile-field', 'unitKm');
  unit().value = '5';
  dom.listeners.input({ target: unit() });
  await click('[data-wsa-spatial-action]', { wsaSpatialAction: 'save_profile' });
  assert.equal(unit().value, '5');
  // Before: Reset put the typed value straight back over the reset profile.
  await click('[data-wsa-spatial-action]', { wsaSpatialAction: 'reset_profile' });
  assert.notEqual(unit().value, '5');
  ctl.destroy();
});

test('review hardening: the editor keeps the relation it opened with; a click ends a composition hold', async () => {
  const sent = [];
  const { ctl, dom, state, click, type } = await placesPanel({
    relations: [{ id: 'rel_r1', fromId: 'wsloc_mill', toId: 'wsloc_tower', direction: 'north', distanceKm: 3, distanceMode: 'straight_line', notes: '', evidenceIds: [] }],
    onSpatialAction: async (action, payload) => { sent.push(payload.formData); return true; },
  });
  type('relativeAnchor', 'Kestrel');
  // A capture replaces the relation the form was showing with another one.
  state.spatial.relations = [{ id: 'rel_r2', fromId: 'wsloc_tower', toId: 'wsloc_mill', direction: 'south', distanceKm: 9, distanceMode: 'route', notes: '', evidenceIds: [] }];
  ctl.refresh();
  assert.equal(dom.field('data-wsa-field', 'relativeAnchor').value, 'Kestrel');
  await click('[data-wsa-spatial-action]', { wsaSpatialAction: 'save_location' });
  // Before: the save named rel_r2, so the host deleted a relation the operator never touched.
  assert.equal(sent[0].relationId, '');

  await click('[data-wsa-spatial-edit]');
  const field = dom.field('data-wsa-field', 'name');
  dom.listeners.compositionstart({ target: field });
  const before = dom.root.innerHTML;
  await click('[data-wsa-spatial-cancel-edit]');
  // Before: the click's re-render stayed deferred until the keyboard committed.
  assert.notEqual(dom.root.innerHTML, before);
  assert.equal(ctl.getUiState().spatialEditing, false);
  ctl.destroy();
});

test('review hardening: rare phrases and context-only words cannot crowd out a specific match', async () => {
  const { phraseCandidates, rarestFirst } = await import('../relevance.js');
  const postings = new Map([['city guard', new Set(Array.from({ length: 600 }, (_, i) => 'g' + i))], ['mira', new Set(['mira'])]]);
  const order = rarestFirst(phraseCandidates(['the', 'city', 'guard', 'waves', 'mira', 'arrives'], 6, 384, { newestFirst: true }), postings);
  // Before: the two-word phrase shared by 600 records was looked up (and could use up the budget) first.
  assert.ok(order.indexOf('mira') < order.indexOf('city guard'));
  const { selectRelevantLocations } = await import('../spatial-relevance.js');
  const place = (id, name, context = '') => ({ id, name, type: 'landmark', status: 'active', baseRefId: null, coordinate: { x: null, y: null, authority: 'unknown', locked: false }, context, routeRefs: [], notes: '', createdAtMessage: 1, lastChangedMessage: 1, evidenceIds: [] });
  const spatial = { locations: [], relations: [], routes: [], overrides: [], evidence: {} };
  for (let i = 0; i < 500; i += 1) spatial.locations.push(place('p' + i, 'Hamlet ' + i, 'beside the old road'));
  spatial.locations.push(place('kessel', 'Kesselpass'));
  const ids = selectRelevantLocations(spatial, { recentText: 'We take the road to Kesselpass.' }).selected.map(item => item.location.id);
  assert.ok(ids.includes('kessel'));
});

test('review hardening: a tiny remaining budget stays bounded; an unreadable host model never matches', async () => {
  const { boundedExchangeText } = await import('../capture.js');
  assert.ok(boundedExchangeText(['x'.repeat(50000), 'y'.repeat(4998), 'z'.repeat(7000)]).length <= 12000);
  const { worldStateRouteFingerprint } = await import('../provider-routing.js');
  const host = { mainApi: 'openai', chatCompletionSettings: { chat_completion_source: 'openai' }, onlineStatus: 'Valid', extensionSettings: {} };
  // Before: chat completion without a readable model fell back to the status text, which never changes.
  assert.notEqual(JSON.stringify(worldStateRouteFingerprint(host, {})), JSON.stringify(worldStateRouteFingerprint(host, {})));
  host.getChatCompletionModel = () => 'gpt-a';
  const before = JSON.stringify(worldStateRouteFingerprint(host, {}));
  assert.equal(JSON.stringify(worldStateRouteFingerprint(host, {})), before);
  host.chatCompletionSettings.chat_completion_source = 'claude';
  assert.notEqual(JSON.stringify(worldStateRouteFingerprint(host, {})), before);
  // Activation waits only for other activations of the chat, never the writer queue.
  const activate = source.slice(source.indexOf('async function activateCurrentChat('), source.indexOf('function connectionProfileUiContext('));
  assert.doesNotMatch(activate, /queueChatWork/);
});

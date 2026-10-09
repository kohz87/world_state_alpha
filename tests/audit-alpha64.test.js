// alpha.64: deep-pass items 70-102 (relevance, evolution, rebuild, injection, panel) and 109-110.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { parseEvolutionJson, validateEvolutionEnvelope } from '../evolution-wire.js';
import { runLazyEvolution } from '../evolution.js';
import { buildWorldStateInjection } from '../injection.js';
import { queryWorldState } from '../manual.js';
import { buildRelevanceIndex, selectRelevantRecords } from '../relevance.js';
import { createState, reduceMutations } from '../state-core.js';
import { buildWorldStateUiModel, renderWorldStatePanel } from '../ui.js';

const index = fs.readFileSync('index.js', 'utf8');
const ui = fs.readFileSync('ui.js', 'utf8');
const rebuild = fs.readFileSync('rebuild.js', 'utf8');
const evolution = fs.readFileSync('evolution.js', 'utf8');
const relevance = fs.readFileSync('relevance.js', 'utf8');

function seeded(rows) {
  return reduceMutations(createState('a64'), {
    chatKey: 'a64', messageId: 0, lineageKey: 'ln_0', operation: 'capture',
    mutations: rows.map(([summary, anchors, kind = 'development']) => ({ action: 'create', kind, summary, anchors, evidence: [{ sourceMessageId: 0, claim: summary }] })),
  }).state;
}
const selectedIds = (state, recentText) => selectRelevantRecords(state, { index: buildRelevanceIndex(state), recentText }).selected.map(item => item.record?.summary);

test('70: a one-word anchor in a spaced script matches whole words only', () => {
  const state = seeded([['Le été festival continues', ['été']], ['Ivan holds the ford', ['Иван']]]);
  assert.deepEqual(selectedIds(state, 'La société dort. Мы в Ивановке.'), []);
  assert.ok(selectedIds(state, 'Иван ждёт у брода.').includes('Ivan holds the ford'));
});

test('71 and 75: due developments are chosen before the four relevant slots, and an unfinished catch-up gives its slots back', () => {
  assert.match(evolution, /const dueIds = relevantDevelopments\.length > EVOLUTION_LIMITS\.relevantTargets/);
  assert.match(evolution, /\? relevantDevelopments\.filter\(entry => dueIds\.has\(recordFromEntry\(entry\)\?\.id\)\)/);
  // The same rule as the host: a run that changed nothing (and was not skipped) gives the slots back.
  assert.match(evolution, /if \(publishIndex && cursorBefore && backgroundSelection\.selected\.length && evolution\.outcome !== 'skipped'\s*&& \(evolution\.state \|\| state\) === state\) \{\s*index\.backgroundCursor = cursorBefore\.cursor;/);
});

test('72 and 76: rebuild matching reads Chinese and Japanese text, and any specific one-word anchor addresses a record', () => {
  assert.match(rebuild, /function spacelessAnchorIn\(normalized, haystack\)/);
  assert.match(rebuild, /sharedContentBigrams\(record\?\.summary \|\| '', context\.pairs\)/);
  assert.match(rebuild, /if \(anchors\.some\(anchor => !anchor\.includes\(' '\) && \(\(anchor\.length >= 5/);
  assert.doesNotMatch(rebuild, /anchors\.length === 1 && anchors\[0\]\.length >= 5/);
});

test('73: function words take no anchor-lookup slot unless used as names', () => {
  assert.match(relevance, /if \(seen\.has\(token\) \|\| \(RELEVANCE_STOPWORDS\.has\(token\) && !names\?\.has\(token\)\)\) continue;/);
  assert.match(relevance, /recentAnchorTokens: lookupTokens\(recentAll, \{ newestFirst: true, names: recentNames \}\)/);
});

test('74: an empty rebuild boundary commits only when replayed Places change there', () => {
  assert.match(rebuild, /if \(historyTimeline\?\.changesBetween\?\.\(lastCommittedBoundary, window\.messageId\)\) \{\s*candidate = commitMutationBoundary\(/);
});

test('77: sorting is the same on every device', () => {
  for (const file of ['rebuild.js', 'relevance.js']) assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /localeCompare/);
});

test('78: an unset injection budget is the default, not 1', () => {
  const state = seeded([['The north bridge has collapsed into the river', ['north bridge']]]);
  const injection = buildWorldStateInjection(state, { recentText: 'We reach the north bridge.', budgetTokens: null });
  assert.ok(injection.text.includes('north bridge'), injection.text);
});

test('79: panel search matches the start of words', () => {
  const state = seeded([['The army marches toward Karsk', ['Karsk']], ['The war in the north drags on', ['war']]]);
  const hits = queryWorldState(state, { text: 'war' }).records.map(record => record.summary);
  assert.deepEqual(hits, ['The war in the north drags on']);
});

test('80: a null derived list and a capitalized outcome are valid', () => {
  const parsed = parseEvolutionJson(JSON.stringify({ evaluations: [{ recordId: 'r1', outcome: 'Stable', reason: 'nothing changed' }], derived: null }));
  const wire = validateEvolutionEnvelope(parsed);
  assert.deepEqual(wire.rejected, []);
  assert.equal(wire.evaluations[0].outcome, 'stable');
});

test('81 and 109: an evolution that changes nothing returns the state it was given', async () => {
  const state = seeded([['The north bridge has collapsed into the river', ['north bridge']]]);
  const result = await runLazyEvolution({ state, selectedEntries: [], chatKey: 'a64', sourceMessageId: 1, sourceLineageKey: 'l1', isCurrent: () => true });
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.state, state);
  assert.doesNotMatch(evolution, /cloneState/);
});

test('82: a rebuild whose range changed while it ran is reported stale, with what happened', () => {
  assert.match(index, /const staleAtEnd = result\.outcome === 'completed' && !currentAtEnd;/);
  assert.match(index, /The rebuilt messages changed while the rebuild ran, so nothing was replaced\. Run it again\./);
});

test('83 and 84: one rebuild per Start click, and a blank number field is its default', () => {
  assert.match(ui, /if \(ui\.rebuildStarting\) return;/);
  assert.match(ui, /numberInput\(maxInput\?\.value\) \?\? currentModel\.maintenance\.rebuild\.defaultMaxBoundaries/);
  assert.match(ui, /const value = numberInput\(lastInput\.value\);\s*if \(value !== null\) ui\.rebuildForm\.lastMessages = Math\.max\(1, value\);/);
});

test('85-89: bulk mode ends with no active rows; Escape skips hidden layers; the sheet focuses its form; no auto-expand; mentions remap', () => {
  assert.match(ui, /if \(ui\.bulk\.active && !activeRowsByKey\(next\)\.size\) \{\s*ui\.bulk\.active = false;/);
  assert.match(ui, /\} else if \(ui\.activeTab === 'spatial' && \(ui\.spatialEditing \|\| ui\.mapSettingsOpen\)\) \{/);
  assert.match(ui, /const first = tabStops\(\)\.find\(item => !item\.classList\?\.contains\?\.\('wsa-sheet-backdrop'\)/);
  assert.match(ui, /if \(ui\.selectedRecordId && next\.selectedRecordId !== ui\.selectedRecordId\) ui\.detailOpen = false;/);
  assert.match(ui, /const key = mention \? currentKeyOf\(mention\) : shownKey;/);
});

test('90-92: Operations are newest first, stay expanded, and keep the model\'s whitespace', () => {
  const diagnostics = [
    { operationId: 'a', at: 1, label: 'capture', outcome: 'applied', sourceMessageId: 1, responseJson: '{\n  "mutations": []\n}' },
    { operationId: 'b', at: 2, label: 'capture', outcome: 'failed', sourceMessageId: 3 },
  ];
  const html = renderWorldStatePanel(buildWorldStateUiModel(createState('a64'), { diagnostics }), { activeTab: 'diagnostics' });
  assert.ok(html.indexOf('Msg 3') < html.indexOf('Msg 1'), 'newest first');
  assert.match(html, /\{\n {2}&quot;mutations&quot;: \[\]\n\}/);
  const key = /data-wsa-operation="([^"]+)"/.exec(html)[1];
  const open = renderWorldStatePanel(buildWorldStateUiModel(createState('a64'), { diagnostics }), { activeTab: 'diagnostics', openOperations: new Set([key]) });
  assert.match(open, new RegExp('data-wsa-operation="' + key + '" open'));
});

test('93, 94, 98, 99 and 102: Forfeit redraws, runs outside the chat queue, sits in a group, shows six at first and names only an integer', () => {
  const ids = Array.from({ length: 12 }, (_, i) => 10 + i);
  const html = renderWorldStatePanel(buildWorldStateUiModel(createState('a64'), { runtimeInfo: { chatMessages: 200, earliestPartialStart: 1, captureFailures: ids } }), {});
  assert.equal((html.match(/data-wsa-forfeit-capture=/g) || []).length, 6);
  assert.match(html, /role="group" aria-label="Missed captures"/);
  assert.doesNotMatch(html, /wsa-capture-failures" role="status"/);
  assert.match(ui, /ui\.forfeitPending = false;\s*\}\s*\/\/ Redrawn here too[^\n]*\n\s*refresh\(\);/);
  assert.match(index, /if \(rebuildRunning\(chatKey\)\) return refuseForfeitDuringRebuild\(\);\s*return forfeitMissedCapture\(chatKey, payload\)/);
  // Outside the queue, the row names the message as the live chat holds it, and only that listed version.
  assert.match(index, /const lineage = chatLineage\(prefix\);[\s\S]{0,400}const sameVersion = unrecoveredCaptureFailures/);
  assert.match(index, /const messageId = typeof payload\?\.messageId === 'number' \? payload\.messageId : NaN;/);
});

test('95-97: unsaved place edits are confirmed before leaving, Copy falls back, a lost pointer capture ends the drag', () => {
  assert.match(ui, /function placeDraftMayGo\(\)/);
  assert.match(ui, /if \(key !== ui\.selectedSpatialKey && !placeDraftMayGo\(\)\) return;/);
  assert.match(ui, /if \(nextTab !== ui\.activeTab && !placeDraftMayGo\(\)\) return;/);
  assert.match(ui, /await globalThis\.navigator\.clipboard\.writeText\(value\);[\s\S]{0,80}\} catch \{/);
  assert.match(ui, /button\.textContent = copied \? 'Copied' : 'Copy failed';\s*button\.focus/);
  assert.match(fs.readFileSync('launcher.js', 'utf8'), /addEventListener\('lostpointercapture', onLostPointerCapture\)/);
});

test('100 and 101: a relation under an override\'s own id names its place, and panel names fold like the Places core', () => {
  assert.match(ui, /for \(const item of resolvedLocations\) if \(item\.overrideId && !locMap\.has\(item\.overrideId\)\) locMap\.set\(item\.overrideId, item\);/);
  assert.doesNotMatch(ui.slice(ui.indexOf('function placeParentKeys('), ui.indexOf('function isPlaceAncestor(')), /toLocaleLowerCase/);
  assert.doesNotMatch(ui.slice(ui.indexOf('function placeMentions('), ui.indexOf('export function buildWorldStateUiModel(')), /toLocaleLowerCase/);
});

test('review hardening: Korean names with particles still match; kana endings are no shared topic', async () => {
  const state = seeded([['The army gathers in Seoul', ['서울']]]);
  assert.ok(selectedIds(state, '서울에서 군대가 모였다').includes('The army gathers in Seoul'));
  const { sharedContentBigrams, spacelessBigrams } = await import('../hash.js');
  // One shared word (王都) plus common endings (されている) is one content pair, not five.
  assert.equal(sharedContentBigrams('王都は封鎖されている', spacelessBigrams('兵が王都に入り、門は閉ざされている')), 1);
  assert.match(rebuild, /pairs: spacelessBigrams\(recentText\)/);
});

test('review hardening: a second rebuild is refused from the click; a stale finish says so; Start guards only the start', () => {
  assert.match(index, /return \(rebuildRequests\.get\(chatKey\) \|\| 0\) > 0 \|\| \['running', 'cancelling', 'committing'\]/);
  assert.match(index, /if \(actionId === 'rebuild'\) \{\s*if \(rebuildRunning\(chatKey\)\) \{\s*notify\('info', 'A rebuild is already running/);
  assert.match(index, /staleAtEnd\s*\? 'World State Alpha rebuild finished, but '/);
  assert.match(ui, /await Promise\.race\(\[started, new Promise\(resolve => setTimeout\(resolve, REBUILD_START_GUARD_MS\)\)\]\);/);
  assert.match(evolution, /const dueRelevant = dueIds \? relevantEvolutionEntries\.length :/);
});

test('review hardening: the model text shown in Operations never ends on half an emoji', () => {
  const text = 'a'.repeat(15999) + '\u{1F600}';
  const html = renderWorldStatePanel(buildWorldStateUiModel(createState('a64'), { diagnostics: [{ operationId: 'x', at: 1, label: 'capture', outcome: 'applied', responseJson: text }] }), { activeTab: 'diagnostics' });
  assert.doesNotMatch(html, /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
});

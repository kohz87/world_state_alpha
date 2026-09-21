import test from 'node:test';
import assert from 'node:assert/strict';

import { createState, reduceMutations } from '../state-core.js';

test('evolution-owned evaluation does not masquerade as capture', () => {
  const initial = createState('operation-owner');
  const captured = reduceMutations(initial, {
    chatKey: 'operation-owner',
    messageId: 2,
    lineageKey: 'ln2',
    mutations: [{
      action: 'create',
      kind: 'development',
      summary: 'The strike is active.',
      anchors: ['strike'],
    }],
  }).state;
  assert.equal(captured.lastCaptureMessage, 2);

  const recordId = captured.records[0].id;
  const evolved = reduceMutations(captured, {
    chatKey: 'operation-owner',
    messageId: 5,
    lineageKey: 'ln5',
    operation: 'evolution',
    mutations: [{
      action: 'update',
      recordId,
      evidence: [{
        sourceClass: 'elapsed_hint',
        claim: 'Five weeks later',
        sourceMessageId: 5,
        lineageKey: 'ln5',
      }],
    }],
  }).state;

  assert.equal(evolved.lastCaptureMessage, 2);
  assert.equal(evolved.records[0].lastEvaluatedMessage, 5);
  assert.equal(evolved.records[0].lastChangedMessage, 2);
});

test('resolve and supersede may carry an opaque current time anchor', () => {
  let state = createState('time-anchor');
  state = reduceMutations(state, {
    chatKey: 'time-anchor',
    messageId: 0,
    lineageKey: 'ln0',
    mutations: [{
      action: 'create',
      kind: 'development',
      summary: 'The investigation is active.',
    }],
  }).state;
  const id = state.records[0].id;

  state = reduceMutations(state, {
    chatKey: 'time-anchor',
    messageId: 4,
    lineageKey: 'ln4',
    operation: 'evolution',
    mutations: [{
      action: 'resolve',
      recordId: id,
      summary: 'The investigation concluded without findings.',
      timeAnchor: 'Late Autumn Term',
    }],
  }).state;

  assert.equal(state.records[0].status, 'resolved');
  assert.equal(state.records[0].timeAnchor, 'Late Autumn Term');
  assert.equal(state.lastCaptureMessage, 0);
});

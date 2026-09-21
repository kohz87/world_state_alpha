import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectElapsedHintFromExchange,
  extractElapsedHint,
  normalizeElapsedHint,
} from '../elapsed.js';

test('five-week skip is detected as meaningful without a calendar engine', () => {
  const hint = extractElapsedHint('Five weeks later, she returns to Blackwake.', {
    sourceMessageId: 42,
    lineageKey: 'ln42',
  });
  assert.equal(hint.raw, 'Five weeks later');
  assert.equal(hint.amount, 5);
  assert.equal(hint.unit, 'week');
  assert.equal(hint.meaningful, true);
  assert.equal(hint.sourceMessageId, 42);
});

test('short hour-scale passage is retained but not automatically meaningful', () => {
  const hint = extractElapsedHint('Three hours later, the shift changes.');
  assert.equal(hint.amount, 3);
  assert.equal(hint.unit, 'hour');
  assert.equal(hint.meaningful, false);
});

test('48 hours is recognized as meaningful without requiring day conversion', () => {
  const hint = extractElapsedHint('48 hours later, the crew returns.');
  assert.equal(hint.amount, 48);
  assert.equal(hint.unit, 'hour');
  assert.equal(hint.meaningful, true);
});

test('a couple of weeks is recognized as a meaningful natural-language interval', () => {
  const hint = extractElapsedHint('A couple of weeks later, the convoy returns.');
  assert.equal(hint.amount, 2);
  assert.equal(hint.unit, 'week');
  assert.equal(hint.meaningful, true);
});

test('single following day is conservative and does not automatically trigger evolution', () => {
  const hint = extractElapsedHint('The following day, classes resume.');
  assert.equal(hint.unit, 'day');
  assert.equal(hint.meaningful, false);
});

test('explicit opaque fictional elapsed hints degrade gracefully', () => {
  const hint = normalizeElapsedHint('three moons later', {
    sourceMessageId: 77,
    lineageKey: 'ln77',
  });
  assert.equal(hint.raw, 'three moons later');
  assert.equal(hint.meaningful, true);
  assert.equal(hint.unit, '');
  assert.equal(hint.sourceMessageId, 77);
});

test('structured opaque hint may explicitly decline meaningful evolution', () => {
  const hint = normalizeElapsedHint({
    raw: 'one short bell later',
    meaningful: false,
  });
  assert.equal(hint.meaningful, false);
});

test('exchange detector binds elapsed evidence to the exact message boundary', () => {
  const hint = detectElapsedHintFromExchange([
    { messageId: 10, role: 'assistant', content: 'The dispute remains active.', lineageKey: 'ln10' },
    { messageId: 11, role: 'user', content: 'Several months later, I return.', lineageKey: 'ln11' },
  ]);
  assert.equal(hint.sourceMessageId, 11);
  assert.equal(hint.lineageKey, 'ln11');
  assert.equal(hint.meaningful, true);
});

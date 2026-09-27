import test from 'node:test';
import assert from 'node:assert/strict';

import { chatLineage } from '../branch.js';
import {
  ACCUMULATED_ELAPSED_LIMITS,
  detectAccumulatedDayStepHint,
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

test('elapsed detector ignores hidden planning, future intentions, hypotheticals, and quoted schedules', () => {
  const hidden = detectElapsedHintFromExchange([{
    messageId: 7,
    lineageKey: 'ln7',
    role: 'assistant',
    content: '<writer_state>pending_thread: Five weeks later, resolve remote pressures.</writer_state> We are still here on the same morning.',
  }]);
  assert.equal(hidden, null);

  const timer = detectElapsedHintFromExchange([{
    messageId: 71,
    lineageKey: 'ln71',
    role: 'assistant',
    content: '<Consequence_Timers>Five weeks later, resolve remote pressures.</Consequence_Timers> We are still here on the same morning.',
  }]);
  assert.equal(timer, null);

  const system = detectElapsedHintFromExchange([{
    messageId: 72,
    lineageKey: 'ln72',
    role: 'system',
    content: 'Five weeks later, run maintenance.',
  }]);
  assert.equal(system, null);

  const bareNext = detectElapsedHintFromExchange([{
    messageId: 73,
    lineageKey: 'ln73',
    role: 'user',
    content: 'Next week, I return to Southport.',
  }]);
  assert.equal(bareNext, null);

  const future = detectElapsedHintFromExchange([{
    messageId: 8,
    lineageKey: 'ln8',
    role: 'user',
    content: 'I will come back next week, but today I stay here.',
  }]);
  assert.equal(future, null);

  const hypothetical = detectElapsedHintFromExchange([{
    messageId: 9,
    lineageKey: 'ln9',
    role: 'user',
    content: 'If five weeks later the gate is still shut, I might leave.',
  }]);
  assert.equal(hypothetical, null);

  const quoted = detectElapsedHintFromExchange([{
    messageId: 10,
    lineageKey: 'ln10',
    role: 'assistant',
    content: 'The clerk writes "Five weeks later" in the draft schedule, but no time passes.',
  }]);
  assert.equal(quoted, null);

  const actual = detectElapsedHintFromExchange([{
    messageId: 11,
    lineageKey: 'ln11',
    role: 'assistant',
    content: 'Five weeks later, the caravan returns to Southport.',
  }]);
  assert.equal(actual?.meaningful, true);
  assert.equal(actual?.sourceMessageId, 11);
  assert.match(actual?.context || '', /Five weeks later/);
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

function dayByDayChat(steps) {
  // steps: [[userText, assistantText], ...]
  return steps.flatMap(([user, assistant]) => [
    { is_user: true, mes: user },
    { is_user: false, mes: assistant },
  ]);
}

test('narrated day steps accumulate across exchanges into one meaningful hint', () => {
  const chat = dayByDayChat([
    ['I help Malia load the wagon.', 'The next morning, the wagon rolls out of Farwick.'],
    ['I scout ahead for game.', 'The following day, the track climbs toward High Ghyll.'],
    ['I hunt at dusk.', 'The deer bolts into the pines.'],
  ]);
  const lineage = chatLineage(chat);
  const hint = detectAccumulatedDayStepHint(chat, chat.length - 1, { lineage });
  assert.equal(hint.meaningful, true);
  assert.equal(hint.source, 'accumulated');
  assert.equal(hint.unit, 'day');
  assert.equal(hint.amount, ACCUMULATED_ELAPSED_LIMITS.thresholdDays);
  assert.equal(hint.sourceMessageId, 3, 'fires on the message that completes the second day step');
  assert.equal(hint.lineageKey, lineage[3].lineageKey);
  assert.match(hint.context, /The next morning/);
  assert.match(hint.context, /The following day/);

  const oneStep = detectAccumulatedDayStepHint(chat, 2, { lineage });
  assert.equal(oneStep, null, 'a single day step stays below the threshold');
});

test('one exchange contributes at most one day step', () => {
  const chat = dayByDayChat([
    ['The next morning, I pack up camp.', 'The next morning is grey; the next day promises rain.'],
    ['I keep walking.', 'The road bends east.'],
  ]);
  assert.equal(detectAccumulatedDayStepHint(chat, chat.length - 1), null);
});

test('quoted, planned, hypothetical, hidden-planning and system day steps never count', () => {
  const chat = [
    { is_user: false, mes: 'Malia says, "We leave the next morning."' },
    { is_user: true, mes: 'We will set out the next morning.' },
    { is_user: false, mes: 'If the rain stops, the following day would be clear.' },
    { is_user: true, mes: 'I wait.' },
    { is_user: false, mes: '<writer_state>The next day: advance the beasts.</writer_state> Nothing changes.' },
    { is_user: true, mes: 'I rest.' },
    { is_user: false, is_system: true, mes: 'The next day arrives.' },
    { is_user: true, mes: "I'll leave the day after tomorrow." },
    { is_user: false, mes: 'The camp stays quiet.' },
  ];
  assert.equal(detectAccumulatedDayStepHint(chat, chat.length - 1), null);
});

test('the count restarts after the last recorded elapsed catch-up and after explicit skips', () => {
  const chat = dayByDayChat([
    ['I ride.', 'The next morning, fog lifts.'],
    ['I ride on.', 'The following day, the pass opens.'],
    ['I ride again.', 'The next morning, snow falls.'],
    ['I camp.', 'The next day, the wind drops.'],
  ]);
  const last = chat.length - 1;
  assert.equal(detectAccumulatedDayStepHint(chat, last).sourceMessageId, 7, 'fires again after two more steps');
  assert.equal(detectAccumulatedDayStepHint(chat, last, { sinceMessageId: 3 }).sourceMessageId, 7);
  assert.equal(detectAccumulatedDayStepHint(chat, last, { sinceMessageId: 5 }), null, 'only one step since the recorded catch-up');

  const withSkip = dayByDayChat([
    ['I ride.', 'The next morning, fog lifts.'],
    ['I ride on.', 'Three days later, the caravan reaches the ford.'],
    ['I cross.', 'The next morning, the river falls.'],
  ]);
  assert.equal(detectAccumulatedDayStepHint(withSkip, withSkip.length - 1), null, 'an explicit skip resets the count');
});

test('accumulation is deterministic across later boundaries and bounded by the lookback', () => {
  const chat = dayByDayChat([
    ['I ride.', 'The next morning, fog lifts.'],
    ['I ride on.', 'The following day, the pass opens.'],
    ['I rest.', 'Nothing moves.'],
    ['I rest again.', 'Still nothing.'],
  ]);
  assert.equal(detectAccumulatedDayStepHint(chat, 3).sourceMessageId, 3);
  assert.equal(detectAccumulatedDayStepHint(chat, chat.length - 1).sourceMessageId, 3, 'the same firing point is reported until a catch-up is recorded');

  const padding = Array.from({ length: ACCUMULATED_ELAPSED_LIMITS.lookbackMessages }, (_, index) => ({ is_user: index % 2 === 0, mes: 'Talk continues.' }));
  const old = [...chat.slice(0, 4), ...padding];
  assert.equal(detectAccumulatedDayStepHint(old, old.length - 1), null, 'steps older than the lookback are ignored');
});

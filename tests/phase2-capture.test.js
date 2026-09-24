import test from 'node:test';
import assert from 'node:assert/strict';

import { chatLineage } from '../branch.js';
import {
  assistantBoundaryExchange,
  CAPTURE_SYSTEM_PROMPT,
  buildCapturePrompt,
  extractWorldStateCompletenessHints,
  processCaptureResponse,
  runCaptureOperation,
} from '../capture.js';
import { parseCaptureJson } from '../capture-wire.js';
import { createDiagnosticStore } from '../diagnostics.js';
import { createState, reduceMutations } from '../state-core.js';

test('capture parser accepts one fenced JSON object but still rejects surrounding prose', () => {
  const payload = '{"mutations":[],"spatialMutations":[]}';
  const fence = '`' + '``';
  assert.deepEqual(parseCaptureJson(payload), { mutations: [], spatialMutations: [] });
  assert.deepEqual(parseCaptureJson(fence + 'json\n' + payload + '\n' + fence), { mutations: [], spatialMutations: [] });
  assert.deepEqual(parseCaptureJson(fence + '\n' + payload + '\n' + fence), { mutations: [], spatialMutations: [] });

  assert.throws(
    () => parseCaptureJson('Here is the result:\n' + fence + 'json\n' + payload + '\n' + fence),
    /one JSON object/i,
  );
  assert.throws(
    () => parseCaptureJson(fence + 'json\n' + payload + '\n' + fence + '\nextra'),
    /one JSON object/i,
  );
});
function withLineage(chat) {
  const lineage = chatLineage(chat);
  return chat.map((message, messageId) => ({
    ...message,
    messageId,
    lineageKey: lineage[messageId].lineageKey,
  }));
}

function sourceBoundary(exchange) {
  const last = exchange.at(-1);
  return { sourceMessageId: last.messageId, sourceLineageKey: last.lineageKey };
}

test('assistant boundary exchange excludes the previous assistant turn', () => {
  const chat = [
    { role: 'user', content: 'I enter Brackenford.' },
    { role: 'assistant', content: 'The market is busy and a dock strike is discussed.' },
    { role: 'user', content: 'I ignore the market and head south.' },
    { role: 'assistant', content: 'At Applecross Culvert, seven trench-boars are bedded beneath the roots.' },
  ];
  const lineage = chatLineage(chat);

  const first = assistantBoundaryExchange(chat, 1, lineage);
  assert.deepEqual(first.map(item => item.messageId), [0, 1]);

  const second = assistantBoundaryExchange(chat, 3, lineage);
  assert.deepEqual(second.map(item => item.messageId), [2, 3]);
  assert.equal(second.some(item => /dock strike/i.test(item.content)), false);
  assert.equal(second.at(-1).lineageKey, lineage[3].lineageKey);
});

function ctxReturning(text, calls = { count: 0 }) {
  return {
    extensionSettings: { world_state_alpha: {}, disabledExtensions: [] },
    async generateRaw() {
      calls.count += 1;
      return text;
    },
  };
}

function existingState(chatKey, chat = [], mutation = null) {
  const state = createState(chatKey);
  if (!mutation || chat.length === 0) return state;
  const exchange = withLineage(chat);
  const last = exchange.at(-1);
  return reduceMutations(state, {
    chatKey,
    messageId: last.messageId,
    lineageKey: last.lineageKey,
    mutations: [mutation],
  }).state;
}

test('capture prompt explicitly rejects story-driving CoT as evidence', () => {
  assert.match(CAPTURE_SYSTEM_PROMPT, /Story-driving CoT principles/);
  assert.match(CAPTURE_SYSTEM_PROMPT, /do not apply to capture and are not evidence/);
  const prompt = buildCapturePrompt({
    exchange: withLineage([
      { role: 'user', content: 'I enter the hall.' },
      { role: 'assistant', content: 'The hall is quiet.' },
    ]),
    loreText: 'Riots sometimes occur here.',
  });
  assert.match(prompt.prompt, /LORE BASELINE/);
  assert.match(prompt.prompt, /never evidence of current occurrence/);
});

test('capture explicitly reconciles lifecycle endings and direct resolve remains source-firewalled', () => {
  assert.match(CAPTURE_SYSTEM_PROMPT, /Reconcile lifecycle for shown active records/i);
  assert.match(CAPTURE_SYSTEM_PROMPT, /ended, completed, failed, eliminated, or permanently ceased/i);
  assert.match(CAPTURE_SYSTEM_PROMPT, /off-screen status.*temporary absence.*uncertainty.*never proves resolution/i);

  const initial = withLineage([{
    role: 'assistant',
    content: 'Two ditch boars remain alive in the orchard.',
  }]);
  const state = existingState('capture-lifecycle-resolve', initial, {
    action: 'create',
    kind: 'development',
    summary: 'Two ditch boars remain active in the orchard.',
    anchors: ['ditch boars', 'orchard'],
  });
  const record = state.records[0];
  const exchange = withLineage([{
    role: 'assistant',
    content: 'The last two ditch boars collapse in the mud. No animals remain in the sounder.',
  }]);
  const prompt = buildCapturePrompt({
    exchange,
    visibleRecords: [record],
    operation: 'rebuild',
  });
  assert.match(prompt.prompt, /LIFECYCLE CHECK/);
  assert.match(prompt.prompt, /REBUILD:/);
  assert.match(prompt.prompt, /Later historical boundaries may close earlier active threads/i);

  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'resolve',
        recordId: record.id,
        summary: 'The ditch-boar sounder is resolved after the last two animals collapse.',
        evidence: [{
          sourceMessageId: 0,
          claim: 'The last two ditch boars collapse in the mud. No animals remain in the sounder.',
        }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [record],
    chatKey: 'capture-lifecycle-resolve',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(result.acceptedCount, 1);
  assert.equal(result.state.records[0].status, 'resolved');
  assert.equal(result.state.records[0].lastChangedMessage, 0);
});

test('unique prior-scene lifecycle antecedent permits an indirect ending without becoming evidence', () => {
  const initial = withLineage([{
    role: 'assistant',
    content: 'Two ditch boars remain alive in the orchard.',
  }]);
  const state = existingState('capture-indirect-lifecycle', initial, {
    action: 'create',
    kind: 'development',
    summary: 'Two ditch boars remain active in the orchard.',
    anchors: ['ditch boars', 'orchard'],
  });
  const record = state.records[0];
  const exchange = withLineage([{
    role: 'assistant',
    content: 'The last two collapse in the mud. Nothing stirs afterward.',
  }]);

  const prompt = buildCapturePrompt({
    exchange,
    visibleRecords: [record],
    lifecycleContextRecordIds: [record.id],
  });
  assert.match(prompt.prompt, /INTERPRETIVE LIFECYCLE ANTECEDENT/);
  assert.match(prompt.prompt, /NOT mutation evidence/);

  const payload = JSON.stringify({
    mutations: [{
      action: 'resolve',
      recordId: record.id,
      summary: 'The ditch-boar sounder ends after the last two animals collapse.',
      evidence: [{
        sourceMessageId: 0,
        claim: 'The last two collapse in the mud. Nothing stirs afterward.',
      }],
    }],
  });

  const withoutAntecedent = processCaptureResponse({
    text: payload,
    state,
    exchange,
    visibleRecords: [record],
    chatKey: 'capture-indirect-lifecycle',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });
  assert.equal(withoutAntecedent.state.records[0].status, 'active');
  assert.equal(withoutAntecedent.rejected[0].stage, 'source-firewall');
  assert.match(withoutAntecedent.rejected[0].reason, /does not identify the existing target/i);

  const withAntecedent = processCaptureResponse({
    text: payload,
    state,
    exchange,
    visibleRecords: [record],
    lifecycleContextRecordIds: [record.id],
    chatKey: 'capture-indirect-lifecycle',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });
  assert.equal(withAntecedent.acceptedCount, 1);
  assert.equal(withAntecedent.state.records[0].status, 'resolved');
});

test('interpretive lifecycle binding cannot retarget an unrelated visible record', () => {
  const base = withLineage([{
    role: 'assistant',
    content: 'Two ditch boars remain in the orchard while a Southport dock strike also continues.',
  }]);
  const state = reduceMutations(createState('capture-target-binding'), {
    chatKey: 'capture-target-binding',
    messageId: 0,
    lineageKey: base[0].lineageKey,
    mutations: [{
      action: 'create',
      kind: 'development',
      summary: 'Two ditch boars remain active in the orchard.',
      anchors: ['ditch boars', 'orchard'],
    }, {
      action: 'create',
      kind: 'development',
      summary: 'The Southport dock strike remains active.',
      anchors: ['Southport', 'dock strike'],
    }],
  }).state;
  const boars = state.records.find(record => /ditch boars/i.test(record.summary));
  const dock = state.records.find(record => /dock strike/i.test(record.summary));
  const exchange = withLineage([{
    role: 'assistant',
    content: 'The last two collapse in the mud. Nothing stirs afterward.',
  }]);

  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'resolve',
        recordId: dock.id,
        summary: 'The Southport dock strike remains active; collapse.',
        evidence: [{
          sourceMessageId: 0,
          claim: 'The last two collapse in the mud. Nothing stirs afterward.',
        }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [boars, dock],
    lifecycleContextRecordIds: [boars.id],
    chatKey: 'capture-target-binding',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(result.state.records.find(record => record.id === dock.id).status, 'active');
  assert.equal(result.rejected[0].stage, 'source-firewall');
  assert.match(result.rejected[0].reason, /does not identify the existing target/i);
});

test('terminal create consolidation is re-firewalled against the chosen active target', () => {
  const base = withLineage([{
    role: 'assistant',
    content: 'Two ditch boars remain in the orchard while a Southport dock strike also continues.',
  }]);
  const state = reduceMutations(createState('capture-consolidated-target-binding'), {
    chatKey: 'capture-consolidated-target-binding',
    messageId: 0,
    lineageKey: base[0].lineageKey,
    mutations: [{
      action: 'create',
      kind: 'development',
      summary: 'Two ditch boars remain active in the orchard.',
      anchors: ['ditch boars', 'orchard'],
    }, {
      action: 'create',
      kind: 'development',
      summary: 'The Southport dock strike remains active.',
      anchors: ['Southport', 'dock strike'],
    }],
  }).state;
  const boars = state.records.find(record => /ditch boars/i.test(record.summary));
  const dock = state.records.find(record => /dock strike/i.test(record.summary));
  const exchange = withLineage([{
    role: 'assistant',
    content: 'The last two collapse in the mud. Nothing stirs afterward.',
  }]);

  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        status: 'resolved',
        summary: 'The Southport dock strike ends after the last two collapse.',
        anchors: ['Southport', 'dock strike'],
        evidence: [{
          sourceMessageId: 0,
          claim: 'The last two collapse in the mud. Nothing stirs afterward.',
        }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [boars, dock],
    lifecycleContextRecordIds: [boars.id],
    chatKey: 'capture-consolidated-target-binding',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(result.state.records.find(record => record.id === dock.id).status, 'active');
  assert.equal(result.rejected[0].stage, 'source-firewall');
  assert.equal(result.rejected[0].duplicateRecordId, dock.id);
  assert.match(result.rejected[0].reason, /does not identify the existing target/i);
});

test('ambiguous prior-scene lifecycle candidates fail closed for an indirect ending', () => {
  const base = withLineage([{
    role: 'assistant',
    content: 'Two ditch boars remain in the orchard while two marsh wolves remain by the ford.',
  }]);
  const state = reduceMutations(createState('capture-ambiguous-lifecycle'), {
    chatKey: 'capture-ambiguous-lifecycle',
    messageId: 0,
    lineageKey: base[0].lineageKey,
    mutations: [{
      action: 'create',
      kind: 'development',
      summary: 'Two ditch boars remain active in the orchard.',
      anchors: ['ditch boars', 'orchard'],
    }, {
      action: 'create',
      kind: 'development',
      summary: 'Two marsh wolves remain active by the ford.',
      anchors: ['marsh wolves', 'ford'],
    }],
  }).state;
  const exchange = withLineage([{
    role: 'assistant',
    content: 'The last two collapse in the mud. Nothing stirs afterward.',
  }]);
  const target = state.records[0];

  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'resolve',
        recordId: target.id,
        summary: 'The ditch-boar sounder ends after the last two animals collapse.',
        evidence: [{
          sourceMessageId: 0,
          claim: 'The last two collapse in the mud. Nothing stirs afterward.',
        }],
      }],
    }),
    state,
    exchange,
    visibleRecords: state.records,
    lifecycleContextRecordIds: state.records.map(record => record.id),
    chatKey: 'capture-ambiguous-lifecycle',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(result.state.records[0].status, 'active');
  assert.equal(result.rejected[0].stage, 'source-firewall');
  assert.match(result.rejected[0].reason, /does not identify the existing target/i);
});

test('automatic capture cannot mutate a resolved tombstone in place', () => {
  const base = withLineage([{
    role: 'assistant',
    content: 'The Southport dock strike ended after an agreement.',
  }]);
  const state = existingState('capture-history-immutable', base, {
    action: 'create',
    kind: 'development',
    status: 'resolved',
    summary: 'The Southport dock strike is resolved.',
    anchors: ['Southport', 'dock strike'],
  });
  const record = state.records[0];
  const exchange = withLineage([{
    role: 'assistant',
    content: 'The Southport dock strike remains resolved after the agreement.',
  }]);

  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'update',
        recordId: record.id,
        summary: 'The Southport dock strike remains resolved after the agreement.',
        evidence: [{
          sourceMessageId: 0,
          claim: 'The Southport dock strike remains resolved after the agreement.',
        }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [record],
    chatKey: 'capture-history-immutable',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(result.state.records[0].summary, 'The Southport dock strike is resolved.');
  assert.equal(result.rejected[0].stage, 'source-firewall');
  assert.match(result.rejected[0].reason, /history is immutable/i);
});

test('unmatched already-resolved create cannot mint a one-off history record', () => {
  const exchange = withLineage([{
    role: 'assistant',
    content: 'The brief duel ends when both combatants lower their blades and leave.',
  }]);
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        status: 'resolved',
        summary: 'The brief duel is resolved after both combatants leave.',
        anchors: ['brief duel'],
        evidence: [{
          sourceMessageId: 0,
          claim: 'The brief duel ends when both combatants lower their blades and leave.',
        }],
      }],
    }),
    state: createState('capture-terminal-create'),
    exchange,
    visibleRecords: [],
    chatKey: 'capture-terminal-create',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(result.state.records.length, 0);
  assert.equal(result.rejected[0].stage, 'duplicate-gate');
  assert.match(result.rejected[0].reason, /cannot be created as history/i);
});

test('already-finished explicit recurrence cannot bypass terminal history admission', () => {
  const base = withLineage([{
    role: 'assistant',
    content: 'The first Southport dock strike ended after an agreement.',
  }]);
  const state = existingState('capture-terminal-new-episode', base, {
    action: 'create',
    kind: 'development',
    status: 'resolved',
    summary: 'The first Southport dock strike is resolved.',
    anchors: ['Southport', 'dock strike'],
  });
  const prior = state.records[0];
  const exchange = withLineage([{
    role: 'assistant',
    content: 'A second Southport dock strike begins and ends the same day after a separate agreement.',
  }]);

  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        status: 'resolved',
        summary: 'A second Southport dock strike begins and ends the same day.',
        anchors: ['Southport', 'dock strike'],
        newEpisodeOfRecordId: prior.id,
        evidence: [{
          sourceMessageId: 0,
          claim: 'A second Southport dock strike begins and ends the same day after a separate agreement.',
        }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [prior],
    chatKey: 'capture-terminal-new-episode',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(result.state.records.length, 1);
  assert.equal(result.rejected[0].stage, 'duplicate-gate');
  assert.match(result.rejected[0].reason, /new episode must be active/i);
});

test('spatial capture prompt keeps the exact Reality mutation schema and provider aliases repair deterministically', () => {
  const prompt = buildCapturePrompt({
    exchange: withLineage([
      { role: 'assistant', content: 'Seven trench-boars remain at Applecross Culvert.' },
    ]),
    spatialEnabled: true,
  });
  assert.match(prompt.prompt, /"kind":"fact\|development-for-create"/);
  assert.match(prompt.prompt, /"summary":"compact current state"/);
  assert.doesNotMatch(prompt.prompt, /\.\.\.Reality mutations\.\.\./);
  assert.match(CAPTURE_SYSTEM_PROMPT, /Never substitute category for kind or description for summary/);

  const exchange = withLineage([
    { role: 'assistant', content: 'Seven trench-boars remain at Applecross Culvert.' },
  ]);
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        category: 'development',
        description: 'Seven trench-boars remain at Applecross Culvert.',
        evidence: [{ sourceMessageId: 0, claim: 'Seven trench-boars remain at Applecross Culvert.' }],
      }],
      spatialMutations: [],
    }),
    state: createState('provider-alias-repair'),
    exchange,
    chatKey: 'provider-alias-repair',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
    operation: 'rebuild',
    evidenceSourceClass: 'rebuild',
    spatialEnabled: true,
  });

  assert.equal(result.aliasRepairs, 2);
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].kind, 'development');
  assert.equal(result.state.records[0].summary, 'Seven trench-boars remain at Applecross Culvert.');
});

test('conflicting provider aliases remain structurally invalid during rebuild', () => {
  const exchange = withLineage([
    { role: 'assistant', content: 'A dock strike begins at Southport.' },
  ]);
  assert.throws(
    () => processCaptureResponse({
      text: JSON.stringify({
        mutations: [{
          action: 'create',
          kind: 'fact',
          category: 'development',
          summary: 'A dock strike begins at Southport.',
          evidence: [{ sourceMessageId: 0, claim: 'A dock strike begins at Southport.' }],
        }],
      }),
      state: createState('provider-alias-conflict'),
      exchange,
      chatKey: 'provider-alias-conflict',
      sourceMessageId: 0,
      sourceLineageKey: exchange[0].lineageKey,
      operation: 'rebuild',
    }),
    error => error?.code === 'WORLD_STATE_REBUILD_REALITY_WIRE_INVALID'
      && /conflicting kind\/category/i.test(error.message),
  );
});

test('capture prompt requires persistent off-screen completeness instead of PC-only salience', () => {
  assert.match(CAPTURE_SYSTEM_PROMPT, /bounded for completeness/i);
  assert.match(CAPTURE_SYSTEM_PROMPT, /PC proximity.*not admission criteria/i);
  assert.match(CAPTURE_SYSTEM_PROMPT, /after the PC leaves or ignores it/i);
  assert.match(CAPTURE_SYSTEM_PROMPT, /several independent persistent conditions/i);

  const assistant = [
    '<writer_state>world_motion: market stalls unpacking; boars concealed near the ditch.</writer_state>',
    'A thick-necked carter named Orson blocks an elderly farmer\'s cart at Brackenford market.',
    '"Two Aon for the cobbles. Pay it now. We do not want these crates tipped in the horse gutters."',
    'Two other drovers stand behind him while watching whether the village watchman has left the gatehouse.',
    'The traveler ignores the shakedown and continues south.',
    'x'.repeat(7600),
    '<Blocks><World_State>',
    '**📡 Off-Screen:** Orson & Market Drovers — Harassing traders along the Brackenford stall rows',
    '**🔥 Unresolved Threads:** Extortion at Brackenford market stalls by local carters went uninterrupted.',
    '**🌱 Planted Seeds:** brush-thieves targeting cart wheels',
    '</World_State></Blocks>',
  ].join('\n');

  const prompt = buildCapturePrompt({
    exchange: withLineage([
      { role: 'user', content: 'I tear down the boar bounty, rent a handcart, then leave town.' },
      { role: 'assistant', content: assistant },
    ]),
  });

  assert.match(prompt.prompt, /PERSISTENCE COMPLETENESS CHECK/);
  assert.match(prompt.prompt, /STRUCTURED CURRENT-STATE COMPLETENESS CHECKLIST/);
  assert.match(prompt.prompt, /Orson blocks an elderly farmer/);
  assert.match(prompt.prompt, /Extortion at Brackenford market stalls by local carters went uninterrupted/);
  assert.match(prompt.prompt, /off-screen.*ignored/i);
  assert.equal(prompt.completenessHints.some(item => /Extortion at Brackenford/i.test(item.text)), true);
  assert.equal(prompt.completenessHints.some(item => /brush-thieves targeting cart wheels/i.test(item.text)), false);
});

test('persistent rumor/news can be captured as information state without promoting quoted claims to fact', () => {
  assert.match(CAPTURE_SYSTEM_PROMPT, /Persistent information state is eligible/i);
  assert.match(CAPTURE_SYSTEM_PROMPT, /Quoted dialogue alone may establish only the speech act/i);
  assert.match(CAPTURE_SYSTEM_PROMPT, /never promote its external claim to objective fact/i);

  const exchange = withLineage([{
    role: 'assistant',
    content: [
      '**Around the central stone hearth, voices clashed above the scrape of iron spoons.**',
      '**"The high switchbacks past Cairnwatch are washing out," a mule-driver in sheepskin barked. "Kesselpass is taking fifty Aon a team at the lower gate. Pay the toll. Wait three days in the mud. Those are the choices."**',
      '**"It is not the toll," an older trader countered. "The Gloamwood Verge has run wild. A pack of quill-fiends pushed past the second boundary stones two nights back. A wood-hauler died behind the lime pits."**',
    ].join('\n'),
  }]);

  const reported = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        summary: 'Reports are circulating among traders that quill-fiends crossed the second Gloamwood Verge boundary stones and that a wood-hauler was killed behind the lime pits.',
        anchors: ['Gloamwood Verge', 'quill-fiends', 'boundary stones'],
        evidence: [{
          sourceMessageId: 0,
          claim: 'A pack of quill-fiends pushed past the second boundary stones two nights back. A wood-hauler died behind the lime pits.',
        }],
      }],
    }),
    state: createState('reported-information'),
    exchange,
    chatKey: 'reported-information',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(reported.acceptedCount, 1);
  assert.equal(reported.rejected.length, 0);
  assert.match(reported.state.records[0].summary, /^Reports are circulating/i);

  const promoted = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        summary: 'Quill-fiends crossed the second Gloamwood Verge boundary stones and killed a wood-hauler behind the lime pits.',
        anchors: ['Gloamwood Verge', 'quill-fiends', 'boundary stones'],
        evidence: [{
          sourceMessageId: 0,
          claim: 'A pack of quill-fiends pushed past the second boundary stones two nights back. A wood-hauler died behind the lime pits.',
        }],
      }],
    }),
    state: createState('reported-promotion-blocked'),
    exchange,
    chatKey: 'reported-promotion-blocked',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(promoted.acceptedCount, 0);
  assert.equal(promoted.state.records.length, 0);
  assert.equal(promoted.rejected[0].stage, 'source-firewall');
  assert.match(promoted.rejected[0].reason, /quoted dialogue alone.*speech act.*underlying claim/i);

  const nounStatePromotion = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        summary: 'The state of the Gloamwood Verge is dangerous because quill-fiends crossed the second boundary stones.',
        anchors: ['Gloamwood Verge', 'quill-fiends'],
        evidence: [{
          sourceMessageId: 0,
          claim: 'A pack of quill-fiends pushed past the second boundary stones two nights back. A wood-hauler died behind the lime pits.',
        }],
      }],
    }),
    state: createState('reported-state-noun-blocked'),
    exchange,
    chatKey: 'reported-state-noun-blocked',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });
  assert.equal(nounStatePromotion.acceptedCount, 0);
  assert.equal(nounStatePromotion.rejected[0].stage, 'source-firewall');

  const speechActExchange = withLineage([{
    role: 'assistant',
    content: 'The magistrate struck the table with his seal. "I declare the north gate closed until dawn."',
  }]);
  const speechAct = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'fact',
        summary: 'The magistrate declares the north gate closed until dawn.',
        anchors: ['north gate', 'magistrate'],
        evidence: [{
          sourceMessageId: 0,
          claim: 'I declare the north gate closed until dawn.',
        }],
      }],
    }),
    state: createState('quoted-speech-act'),
    exchange: speechActExchange,
    chatKey: 'quoted-speech-act',
    sourceMessageId: 0,
    sourceLineageKey: speechActExchange[0].lineageKey,
  });
  assert.equal(speechAct.acceptedCount, 1);
  assert.equal(speechAct.rejected.length, 0);
  assert.match(speechAct.state.records[0].summary, /declares the north gate closed/i);
});

test('source firewall rejects unrelated summaries and drops unsupported anchors despite grounded excerpts', () => {
  const exchange = withLineage([{ role: 'assistant', content: 'The bridge collapses into the river.' }]);
  const unrelated = processCaptureResponse({
    text: JSON.stringify({ mutations: [{
      action: 'create', kind: 'fact', summary: 'King Aldren has been assassinated and civil war is spreading.',
      anchors: ['King Aldren', 'civil war'],
      evidence: [{ sourceMessageId: 0, claim: 'The bridge collapses into the river.' }],
    }] }),
    state: createState('unrelated-summary'), exchange, chatKey: 'unrelated-summary', sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });
  assert.equal(unrelated.acceptedCount, 0);
  assert.equal(unrelated.state.records.length, 0);
  assert.equal(unrelated.rejected[0].stage, 'source-firewall');
  assert.match(unrelated.rejected[0].reason, /not supported by.*evidence/i);

  const grounded = processCaptureResponse({
    text: JSON.stringify({ mutations: [{
      action: 'create', kind: 'fact', summary: 'The bridge is destroyed.', anchors: ['bridge', 'King Aldren'],
      evidence: [{ sourceMessageId: 0, claim: 'The bridge collapses into the river.' }],
    }] }),
    state: createState('unsupported-anchor'), exchange, chatKey: 'unsupported-anchor', sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });
  assert.equal(grounded.acceptedCount, 1);
  assert.deepEqual(grounded.state.records[0].anchors, ['bridge']);
});

test('existing canonical anchors can bind a non-create mutation even when the stored summary wording changed', () => {
  const base = withLineage([{
    role: 'assistant',
    content: 'Freight movement through the pass is suspended.',
  }]);
  const state = existingState('anchor-target-binding', base, {
    action: 'create',
    kind: 'development',
    summary: 'Freight movement is suspended.',
    anchors: ['Kesselpass'],
  });
  const record = state.records[0];
  const exchange = withLineage([{
    role: 'assistant',
    content: 'Kesselpass caravans begin moving again under escort.',
  }]);

  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'update',
        recordId: record.id,
        summary: 'Freight movement resumes through Kesselpass under escort.',
        evidence: [{
          sourceMessageId: 0,
          claim: 'Kesselpass caravans begin moving again under escort.',
        }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [record],
    chatKey: 'anchor-target-binding',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(result.acceptedCount, 1);
  assert.match(result.state.records[0].summary, /resumes through Kesselpass/i);
});

test('a broad shared place anchor alone cannot retarget an unrelated active condition', () => {
  const base = withLineage([{
    role: 'assistant',
    content: 'The Southport dock strike remains active.',
  }]);
  const state = existingState('broad-anchor-target-reject', base, {
    action: 'create',
    kind: 'development',
    summary: 'The Southport dock strike remains active.',
    anchors: ['Southport', 'dock strike'],
  });
  const record = state.records[0];
  const exchange = withLineage([{
    role: 'assistant',
    content: 'Southport rain stops before dusk.',
  }]);

  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'resolve',
        recordId: record.id,
        summary: 'The Southport dock strike ends as the rain stops.',
        evidence: [{
          sourceMessageId: 0,
          claim: 'Southport rain stops before dusk.',
        }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [record],
    chatKey: 'broad-anchor-target-reject',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(result.state.records[0].status, 'active');
  assert.equal(result.rejected[0].stage, 'source-firewall');
  assert.match(result.rejected[0].reason, /does not identify the existing target/i);
});

test('unrelated objective evidence cannot wash a quoted rumor into objective reality', () => {
  const exchange = withLineage([{
    role: 'assistant',
    content: '"Quill-fiends crossed the second boundary stones," a trader said. Rain fell over the market square.',
  }]);
  const result = processCaptureResponse({
    text: JSON.stringify({ mutations: [{
      action: 'create', kind: 'fact', summary: 'Quill-fiends crossed the second boundary stones.',
      anchors: ['quill-fiends', 'boundary stones'],
      evidence: [
        { sourceMessageId: 0, claim: 'Quill-fiends crossed the second boundary stones' },
        { sourceMessageId: 0, claim: 'Rain fell over the market square.' },
      ],
    }] }),
    state: createState('mixed-hearsay-bypass'), exchange, chatKey: 'mixed-hearsay-bypass', sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });
  assert.equal(result.acceptedCount, 0);
  assert.match(result.rejected[0].reason, /quoted dialogue alone|attributed evidence/i);
});

test('indirect reports remain reported until objective narration corroborates the same assertion', () => {
  const reportedExchange = withLineage([{
    role: 'assistant', content: 'A trader reported that Kesselpass is closed by an avalanche.',
  }]);
  const objective = processCaptureResponse({
    text: JSON.stringify({ mutations: [{
      action: 'create', kind: 'fact', summary: 'Kesselpass is closed by an avalanche.', anchors: ['Kesselpass'],
      evidence: [{ sourceMessageId: 0, claim: 'Kesselpass is closed by an avalanche' }],
    }] }),
    state: createState('indirect-report-objective'), exchange: reportedExchange, chatKey: 'indirect-report-objective', sourceMessageId: 0,
    sourceLineageKey: reportedExchange[0].lineageKey,
  });
  assert.equal(objective.acceptedCount, 0);

  const preserved = processCaptureResponse({
    text: JSON.stringify({ mutations: [{
      action: 'create', kind: 'fact', summary: 'A trader reports that Kesselpass is closed by an avalanche.', anchors: ['Kesselpass'],
      evidence: [{ sourceMessageId: 0, claim: 'Kesselpass is closed by an avalanche' }],
    }] }),
    state: createState('indirect-report-preserved'), exchange: reportedExchange, chatKey: 'indirect-report-preserved', sourceMessageId: 0,
    sourceLineageKey: reportedExchange[0].lineageKey,
  });
  assert.equal(preserved.acceptedCount, 1);

  const confirmedExchange = withLineage([{
    role: 'assistant',
    content: 'A trader reported that quill-fiends crossed the second boundary stones. Scouts later confirmed quill-fiends crossed the second boundary stones.',
  }]);
  const confirmed = processCaptureResponse({
    text: JSON.stringify({ mutations: [{
      action: 'create', kind: 'fact', summary: 'Quill-fiends crossed the second boundary stones.', anchors: ['quill-fiends', 'boundary stones'],
      evidence: [
        { sourceMessageId: 0, claim: 'quill-fiends crossed the second boundary stones' },
        { sourceMessageId: 0, claim: 'Scouts later confirmed quill-fiends crossed the second boundary stones.' },
      ],
    }] }),
    state: createState('reported-objective-confirmation'), exchange: confirmedExchange, chatKey: 'reported-objective-confirmation', sourceMessageId: 0,
    sourceLineageKey: confirmedExchange[0].lineageKey,
  });
  assert.equal(confirmed.acceptedCount, 1);
});

test('World_State Off-Screen and Unresolved Threads become a bounded completeness checklist', () => {
  const assistant = [
    '<writer_state>world_motion: market stalls unpacking; boars concealed near the ditch.</writer_state>',
    '<font color="#C05A46">"Every crate off that wagon touches village gravel, Garrow."</font>',
    'The speaker was a thick-necked carter blocking an elderly farmer ten paces inside Brackenford gate.',
    '<font color="#C05A46">"Gravel belongs to the haulers\' guild. Two Aon for the cobbles. Pay it now. We don\'t want these crates tipped in the horse gutters."</font>',
    '<World_State>',
    '**📡 Off-Screen:**',
    '* Karr — Working the timber yard at Northgate Stockyard',
    '* Orson & Market Drovers — Harassing traders along the Brackenford stall rows',
    '',
    '**🔥 Unresolved Threads:**',
    '* Trench-boar sounder is bedded down directly beneath Noc\'s tree, unseen from the water line.',
    '* Rented handcart sits concealed in the alder brush forty paces up the bank.',
    '* Extortion at Brackenford market stalls by local carters went uninterrupted.',
    '* The Long Root Pattern Core Weave remains hidden at Snake stage.',
    '',
    '**🌱 Planted Seeds:** Reeve bounty payout; haulers shakedown; brush-thieves',
    '**⏳ Consequence Timers:** Handcart rental due back by dusk',
    '**🎯 Arc Phase:** Setup',
    '</World_State>',
    '<NPC_Inner_Chatter>KARR: private thought</NPC_Inner_Chatter>',
  ].join('\n');
  const exchange = withLineage([{ role: 'assistant', content: assistant }]);
  const hints = extractWorldStateCompletenessHints(exchange);

  assert.equal(hints.some(item => /Extortion at Brackenford market stalls/i.test(item.text)), true);
  assert.equal(hints.some(item => /Orson & Market Drovers/i.test(item.text)), true);
  assert.equal(hints.some(item => /Planted Seeds|brush-thieves|Consequence Timers|Arc Phase/i.test(item.text)), false);

  const prompt = buildCapturePrompt({ exchange, operation: 'rebuild' });
  assert.match(prompt.prompt, /STRUCTURED CURRENT-STATE COMPLETENESS CHECKLIST/);
  assert.match(prompt.prompt, /Extortion at Brackenford market stalls by local carters went uninterrupted/);
  assert.match(prompt.prompt, /Re-check each.*exchange/i);
  assert.equal(prompt.completenessHints.length, hints.length);
});

test('live Brackenford extortion payload is admitted through HTML narration and survives beside other records', () => {
  const exchange = withLineage([{
    role: 'assistant',
    content: [
      '<font color="#C05A46">"Every crate off that wagon touches village gravel, Garrow."</font>',
      'The speaker was a thick-necked carter in a grease-stained leather vest, planted square before an elderly farmer\'s handcart ten paces inside the gate.',
      '<font color="#C05A46">"Gravel belongs to the haulers\' guild. Two Aon for the cobbles. Pay it now. We don\'t want these crates tipped in the horse gutters."</font>',
      'Two other rough-shirted drovers stood behind the carter, thumbs hooked in their rope belts, eyes drifting over the morning crowd to see if the village watchman had finished his ale at the gatehouse.',
      '<World_State>',
      '**📡 Off-Screen:**',
      '* Orson & Market Drovers — Harassing traders along the Brackenford stall rows',
      '**🔥 Unresolved Threads:**',
      '* Extortion at Brackenford market stalls by local carters went uninterrupted.',
      '</World_State>',
    ].join('\n'),
  }]);

  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        summary: "Haulers' guild carters in Brackenford are extorting fees from inbound farmers and market stalls under threat of tipping their cargo.",
        status: 'active',
        trend: 'stable',
        anchors: ['Brackenford', "haulers' guild", 'extortion'],
        evidence: [
          {
            sourceMessageId: 0,
            claim: "Gravel belongs to the haulers' guild. Two Aon for the cobbles. Pay it now. We don't want these crates tipped in the horse gutters.",
          },
          {
            sourceMessageId: 0,
            claim: 'Two other rough-shirted drovers stood behind the carter, thumbs hooked in their rope belts, eyes drifting over the morning crowd to see if the village watchman had finished his ale at the gatehouse.',
          },
        ],
      }],
    }),
    state: createState('live-brackenford-extortion'),
    exchange,
    chatKey: 'live-brackenford-extortion',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
    operation: 'rebuild',
    evidenceSourceClass: 'rebuild',
  });

  assert.equal(result.acceptedCount, 1);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].kind, 'development');
  assert.match(result.state.records[0].summary, /extorting fees/i);
});

test('established market extortion can coexist with a PC-adjacent capture in one bounded call', async () => {
  const chatKey = 'persistent-offscreen';
  const exchange = withLineage([
    { role: 'user', content: 'I ignore the market trouble and head for the Applecross ditch.' },
    {
      role: 'assistant',
      content: [
        'At Brackenford market, Orson blocks an elderly farmer\'s handcart and demands an unauthorized two-Aon unloading fee.',
        'Two other drovers back him while watching for the village watchman.',
        'The traveler leaves the shakedown uninterrupted and reaches Applecross Culvert.',
        'Seven trench-boars are bedded in an undercut hollow beneath the hornbeam roots.',
      ].join(' '),
    },
  ]);

  const response = JSON.stringify({
    mutations: [
      {
        action: 'create',
        kind: 'development',
        summary: 'Orson and local carters are extorting Brackenford market traders for unauthorized unloading fees.',
        trend: 'stable',
        anchors: ['Brackenford', 'market', 'Orson', 'carters', 'traders'],
        evidence: [{
          sourceMessageId: 1,
          claim: 'Orson blocks an elderly farmer\'s handcart and demands an unauthorized two-Aon unloading fee.',
        }],
      },
      {
        action: 'create',
        kind: 'fact',
        summary: 'Seven trench-boars are bedded beneath the hornbeam roots at Applecross Culvert.',
        anchors: ['Applecross Culvert', 'trench-boars', 'hornbeam'],
        evidence: [{
          sourceMessageId: 1,
          claim: 'Seven trench-boars are bedded in an undercut hollow beneath the hornbeam roots.',
        }],
      },
    ],
  });

  const result = await runCaptureOperation({
    ctx: ctxReturning(response),
    state: existingState(chatKey),
    exchange,
    chatKey,
    ...sourceBoundary(exchange),
    isCurrent: () => true,
  });

  assert.equal(result.outcome, 'applied');
  assert.equal(result.state.records.length, 2);
  assert.equal(result.state.records.filter(record => record.kind === 'development').length, 1);
  assert.match(result.state.records.find(record => record.kind === 'development').summary, /extorting Brackenford market traders/i);
  assert.match(result.state.records.find(record => record.kind === 'fact').summary, /trench-boars/i);
});

test('direct established fact is captured in one provider call', async () => {
  const chatKey = 'direct';
  const exchange = withLineage([
    { role: 'user', content: 'I watch the bridge.' },
    { role: 'assistant', content: 'The bridge collapses into the river.' },
  ]);
  const response = JSON.stringify({
    mutations: [{
      action: 'create',
      kind: 'fact',
      summary: 'The bridge is destroyed.',
      anchors: ['bridge'],
      evidence: [{ sourceMessageId: 1, claim: 'The bridge collapses into the river.' }],
    }],
  });
  const calls = { count: 0 };
  const result = await runCaptureOperation({
    ctx: ctxReturning(response, calls),
    isCurrent: () => true,
    state: existingState(chatKey),
    exchange,
    visibleRecords: [],
    chatKey,
    ...sourceBoundary(exchange),
  });
  assert.equal(calls.count, 1);
  assert.equal(result.outcome, 'applied');
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].summary, 'The bridge is destroyed.');
  assert.equal(Object.values(result.state.evidence)[0].sourceClass, 'assistant_narration');
  assert.equal(result.state.lastCaptureMessage, 1);
});

test('valid no-change response performs one call and creates no record', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I sit down.' },
    { role: 'assistant', content: 'Nothing in the wider setting changes.' },
  ]);
  const calls = { count: 0 };
  const result = await runCaptureOperation({
    ctx: ctxReturning('{"mutations":[]}', calls),
    isCurrent: () => true,
    state: existingState('quiet'),
    exchange,
    chatKey: 'quiet',
    ...sourceBoundary(exchange),
  });
  assert.equal(calls.count, 1);
  assert.equal(result.outcome, 'no-change');
  assert.equal(result.state.records.length, 0);
  assert.equal(result.state.lastCaptureMessage, 1);
});

test('lore possibility cannot become current state because lore is not evidence', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I walk through the square.' },
    { role: 'assistant', content: 'The square is calm this afternoon.' },
  ]);
  const response = JSON.stringify({
    mutations: [{
      action: 'create',
      kind: 'development',
      summary: 'A riot is active in the square.',
      anchors: ['square', 'riot'],
      evidence: [{ sourceMessageId: 1, claim: 'Riots sometimes occur here.' }],
    }],
  });
  const result = await runCaptureOperation({
    ctx: ctxReturning(response),
    isCurrent: () => true,
    state: existingState('lore-trap'),
    exchange,
    loreText: 'Riots sometimes occur here.',
    chatKey: 'lore-trap',
    ...sourceBoundary(exchange),
  });
  assert.equal(result.state.records.length, 0);
  assert.equal(result.rejected[0].stage, 'source-firewall');
});

test('Writer Mind world-motion invention is rejected when not grounded in exchange', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I wait by the station window.' },
    { role: 'assistant', content: 'Rain taps softly against the glass.' },
  ]);
  const response = JSON.stringify({
    mutations: [{
      action: 'create',
      kind: 'development',
      summary: 'A sabotage crisis begins at the reactor.',
      anchors: ['reactor'],
      reason: 'Avoid stagnation and create autonomous world motion.',
      evidence: [{ sourceMessageId: 1, claim: 'A sabotage crisis begins at the reactor.' }],
    }],
  });
  const result = await runCaptureOperation({
    ctx: ctxReturning(response),
    isCurrent: () => true,
    state: existingState('cot-firewall'),
    exchange,
    chatKey: 'cot-firewall',
    ...sourceBoundary(exchange),
  });
  assert.equal(result.state.records.length, 0);
  assert.equal(result.rejected[0].stage, 'source-firewall');
});

test('unknown record IDs are rejected instead of allowing hallucinated updates', () => {
  const exchange = withLineage([
    { role: 'user', content: 'I look at the gate.' },
    { role: 'assistant', content: 'The gate remains closed.' },
  ]);
  const state = existingState('unknown-id');
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'update',
        recordId: 'wsr_hallucinated',
        summary: 'The gate remains closed.',
        evidence: [{ sourceMessageId: 1, claim: 'The gate remains closed.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [],
    chatKey: 'unknown-id',
    ...sourceBoundary(exchange),
  });
  assert.equal(result.state.records.length, 0);
  assert.equal(result.rejected[0].stage, 'source-firewall');
});

test('semantically duplicate active create consolidates into existing record', () => {
  const baseChat = [{ role: 'assistant', content: 'A labor strike begins at the factory.' }];
  const state = existingState('dup-active', baseChat, {
    action: 'create',
    kind: 'development',
    summary: 'The factory labor strike is active.',
    anchors: ['factory', 'labor strike'],
  });
  const existing = state.records[0];
  const exchange = withLineage([
    { role: 'assistant', content: 'A labor strike begins at the factory.' },
    { role: 'assistant', content: 'The factory labor strike remains active as negotiations stall.' },
  ]);
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        summary: 'The factory labor strike remains active; negotiations are stalled.',
        trend: 'stable',
        anchors: ['factory', 'labor strike'],
        evidence: [{ sourceMessageId: 1, claim: 'The factory labor strike remains active as negotiations stall.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [existing],
    chatKey: 'dup-active',
    sourceMessageId: 1,
    sourceLineageKey: exchange.at(-1).lineageKey,
  });
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].id, existing.id);
  assert.match(result.state.records[0].summary, /negotiations are stalled/);
});

test('duplicate create that establishes resolution resolves the existing active record', () => {
  const baseChat = [{ role: 'assistant', content: 'The factory labor strike is active.' }];
  const state = existingState('dup-resolve', baseChat, {
    action: 'create',
    kind: 'development',
    summary: 'The factory labor strike is active.',
    anchors: ['factory', 'labor strike'],
  });
  const existing = state.records[0];
  const exchange = withLineage([
    { role: 'assistant', content: 'The factory labor strike is active.' },
    { role: 'assistant', content: 'The factory labor strike ends after an agreement.' },
  ]);
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        status: 'resolved',
        summary: 'The factory labor strike is resolved.',
        anchors: ['factory', 'labor strike'],
        evidence: [{ sourceMessageId: 1, claim: 'The factory labor strike ends after an agreement.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [existing],
    chatKey: 'dup-resolve',
    sourceMessageId: 1,
    sourceLineageKey: exchange.at(-1).lineageKey,
  });
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].id, existing.id);
  assert.equal(result.state.records[0].status, 'resolved');
});

test('terminal duplicate create prefers the current active episode over a closer old tombstone', () => {
  const base = withLineage([{
    role: 'assistant',
    content: 'An old Southport dock strike was resolved; a renewed Southport dock strike is now active.',
  }]);
  const state = reduceMutations(createState('dup-active-over-history'), {
    chatKey: 'dup-active-over-history',
    messageId: 0,
    lineageKey: base[0].lineageKey,
    mutations: [{
      action: 'create',
      kind: 'development',
      status: 'resolved',
      summary: 'The renewed Southport dock strike is resolved.',
      anchors: ['Southport', 'dock strike'],
    }, {
      action: 'create',
      kind: 'development',
      summary: 'The renewed Southport dock strike is active.',
      anchors: ['Southport', 'dock strike'],
    }],
  }).state;
  const historical = state.records.find(record => record.status === 'resolved');
  const active = state.records.find(record => record.status === 'active');
  const exchange = withLineage([{
    role: 'assistant',
    content: 'The renewed Southport dock strike ends after an agreement.',
  }]);

  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        status: 'resolved',
        summary: 'The renewed Southport dock strike is resolved.',
        anchors: ['Southport', 'dock strike'],
        evidence: [{
          sourceMessageId: 0,
          claim: 'The renewed Southport dock strike ends after an agreement.',
        }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [historical, active],
    chatKey: 'dup-active-over-history',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(result.state.records.find(record => record.id === historical.id).status, 'resolved');
  assert.equal(result.state.records.find(record => record.id === active.id).status, 'resolved');
  assert.equal(result.applied[0].recordId, active.id);
});

test('capture cannot mutate a record outside the bounded visible context even if caller passes more records', () => {
  const chat = withLineage([{ role: 'assistant', content: 'Nine independent conditions are established.' }]);
  const state = reduceMutations(createState('bounded-visible'), {
    chatKey: 'bounded-visible',
    messageId: 0,
    lineageKey: chat[0].lineageKey,
    mutations: Array.from({ length: 9 }, (_, index) => ({
      action: 'create',
      kind: 'fact',
      summary: `Condition ${index + 1} is active.`,
      anchors: [`condition-${index + 1}`],
    })),
  }).state;
  const hidden = state.records[8];
  const exchange = withLineage([
    { role: 'assistant', content: 'Nine independent conditions are established.' },
    { role: 'assistant', content: 'Condition 9 changes materially.' },
  ]);
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'update',
        recordId: hidden.id,
        summary: 'Condition 9 changed.',
        evidence: [{ sourceMessageId: 1, claim: 'Condition 9 changes materially.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: state.records,
    chatKey: 'bounded-visible',
    sourceMessageId: 1,
    sourceLineageKey: exchange.at(-1).lineageKey,
  });
  assert.equal(result.rejected[0].stage, 'source-firewall');
  assert.equal(result.state.records.find(record => record.id === hidden.id).summary, hidden.summary);
});

test('resolved episode cannot resurrect from continuing underlying tension', () => {
  const baseChat = [{ role: 'assistant', content: 'The dock strike ends after an agreement.' }];
  const state = existingState('resolved', baseChat, {
    action: 'create',
    kind: 'development',
    summary: 'The dock strike is resolved.',
    status: 'resolved',
    anchors: ['dock strike', 'harbor wages'],
  });
  const existing = state.records[0];
  const exchange = withLineage([
    { role: 'assistant', content: 'The dock strike ends after an agreement.' },
    { role: 'assistant', content: 'Harbor wage tensions remain, but no new strike has begun.' },
  ]);
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        summary: 'The dock strike is active.',
        anchors: ['dock strike', 'harbor wages'],
        evidence: [{ sourceMessageId: 1, claim: 'Harbor wage tensions remain, but no new strike has begun.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [existing],
    chatKey: 'resolved',
    sourceMessageId: 1,
    sourceLineageKey: exchange.at(-1).lineageKey,
  });
  assert.equal(result.state.records.length, 1);
  assert.equal(result.state.records[0].status, 'resolved');
  assert.equal(result.rejected[0].stage, 'duplicate-gate');
});

test('explicit new episode may create a new record while preserving resolved predecessor', () => {
  const baseChat = [{ role: 'assistant', content: 'The dock strike ends after an agreement.' }];
  const state = existingState('new-episode', baseChat, {
    action: 'create',
    kind: 'development',
    summary: 'The dock strike is resolved.',
    status: 'resolved',
    anchors: ['dock strike', 'harbor wages'],
  });
  const prior = state.records[0];
  const exchange = withLineage([
    { role: 'assistant', content: 'The dock strike ends after an agreement.' },
    { role: 'assistant', content: 'A new dock strike begins today over a separate wage dispute.' },
  ]);
  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        summary: 'A new dock strike is active.',
        anchors: ['dock strike', 'harbor wages'],
        newEpisodeOfRecordId: prior.id,
        evidence: [{ sourceMessageId: 1, claim: 'A new dock strike begins today over a separate wage dispute.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [prior],
    chatKey: 'new-episode',
    sourceMessageId: 1,
    sourceLineageKey: exchange.at(-1).lineageKey,
  });
  assert.equal(result.state.records.length, 2);
  assert.equal(result.state.records.find(record => record.id === prior.id).status, 'resolved');
  assert.ok(result.state.records.some(record => record.id !== prior.id && record.status === 'active'));
});

test('explicit new episode cannot link an unrelated event through a broad shared place anchor', () => {
  const base = withLineage([{
    role: 'assistant',
    content: 'The Southport dock strike ended after an agreement.',
  }]);
  const state = existingState('new-episode-broad-anchor-reject', base, {
    action: 'create',
    kind: 'development',
    status: 'resolved',
    summary: 'The Southport dock strike is resolved.',
    anchors: ['Southport', 'dock strike'],
  });
  const prior = state.records[0];
  const exchange = withLineage([{
    role: 'assistant',
    content: 'A new Southport ferry schedule begins today.',
  }]);

  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        summary: 'A new Southport ferry schedule is active.',
        anchors: ['Southport'],
        newEpisodeOfRecordId: prior.id,
        evidence: [{
          sourceMessageId: 0,
          claim: 'A new Southport ferry schedule begins today.',
        }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [prior],
    chatKey: 'new-episode-broad-anchor-reject',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(result.state.records.length, 1);
  assert.equal(result.rejected[0].stage, 'duplicate-gate');
  assert.match(result.rejected[0].reason, /sufficiently related/i);
});

test('explicit new-episode proposals consolidate into an already-active recurrence instead of duplicating Current', () => {
  const base = withLineage([{
    role: 'assistant',
    content: 'The first dock strike ended after an agreement, while a later dock strike is now active.',
  }]);
  const state = reduceMutations(createState('new-episode-active-dedupe'), {
    chatKey: 'new-episode-active-dedupe',
    messageId: 0,
    lineageKey: base[0].lineageKey,
    mutations: [{
      action: 'create',
      kind: 'development',
      status: 'resolved',
      summary: 'The first dock strike is resolved.',
      anchors: ['dock strike', 'harbor wages'],
    }, {
      action: 'create',
      kind: 'development',
      summary: 'A new dock strike is active.',
      anchors: ['dock strike', 'harbor wages'],
    }],
  }).state;
  const prior = state.records.find(record => record.status === 'resolved');
  const active = state.records.find(record => record.status === 'active');
  const exchange = withLineage([{
    role: 'assistant',
    content: 'A new dock strike is active; talks stall.',
  }]);

  const result = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'create',
        kind: 'development',
        summary: 'A new dock strike is active; talks stall.',
        anchors: ['dock strike', 'harbor wages'],
        newEpisodeOfRecordId: prior.id,
        evidence: [{
          sourceMessageId: 0,
          claim: 'A new dock strike is active; talks stall.',
        }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [prior, active],
    chatKey: 'new-episode-active-dedupe',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });

  assert.equal(result.state.records.length, 2);
  assert.ok(result.applied.length > 0, JSON.stringify({ rejected: result.rejected, records: result.state.records }));
  assert.equal(result.applied[0].recordId, active.id);
  assert.match(result.state.records.find(record => record.id === active.id).summary, /talks stall/i);
});

test('malformed provider JSON causes no mutation and no correction retry', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I watch.' },
    { role: 'assistant', content: 'The road closes after a landslide.' },
  ]);
  const calls = { count: 0 };
  const state = existingState('bad-json');
  const result = await runCaptureOperation({
    ctx: ctxReturning('markdown wrapper {"mutations":[]}', calls),
    isCurrent: () => true,
    state,
    exchange,
    chatKey: 'bad-json',
    ...sourceBoundary(exchange),
  });
  assert.equal(calls.count, 1);
  assert.equal(result.outcome, 'invalid-response');
  assert.deepEqual(result.state.records, state.records);
  assert.equal(result.state.lastCaptureMessage, 1);

  const repeated = await runCaptureOperation({
    ctx: ctxReturning('{"mutations":[]}', calls),
    isCurrent: () => true,
    state: result.state,
    exchange,
    chatKey: 'bad-json',
    ...sourceBoundary(exchange),
  });
  assert.equal(repeated.outcome, 'skipped');
  assert.equal(calls.count, 1);
});

test('mixed valid and malformed live mutation rows fail closed without partial commit', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I watch the bridge.' },
    { role: 'assistant', content: 'The bridge collapses into the river.' },
  ]);
  const calls = { count: 0 };
  const state = existingState('mixed-wire-live');
  const response = JSON.stringify({
    mutations: [
      {
        action: 'create', kind: 'fact', summary: 'The bridge is destroyed.', anchors: ['bridge'],
        evidence: [{ sourceMessageId: 1, claim: 'The bridge collapses into the river.' }],
      },
      { action: 'update', recordId: 'missing-evidence', summary: 'Malformed row has no evidence.' },
    ],
  });
  const result = await runCaptureOperation({
    ctx: ctxReturning(response, calls), isCurrent: () => true, state, exchange,
    chatKey: 'mixed-wire-live', ...sourceBoundary(exchange),
  });
  assert.equal(result.outcome, 'invalid-response');
  assert.equal(result.errorCode, 'WORLD_STATE_CAPTURE_REALITY_WIRE_INVALID');
  assert.deepEqual(result.state.records, state.records);
  assert.equal(result.state.lastCaptureMessage, 1);
  assert.equal(calls.count, 1);

  const repeated = await runCaptureOperation({
    ctx: ctxReturning('{"mutations":[]}', calls), isCurrent: () => true, state: result.state, exchange,
    chatKey: 'mixed-wire-live', ...sourceBoundary(exchange),
  });
  assert.equal(repeated.outcome, 'skipped');
  assert.equal(calls.count, 1);
});

test('automatic capture refuses to run without a currentness guard', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I wait.' },
    { role: 'assistant', content: 'The road closes.' },
  ]);
  const calls = { count: 0 };
  await assert.rejects(
    runCaptureOperation({
      ctx: ctxReturning('{"mutations":[]}', calls),
      state: existingState('guard-required'),
      exchange,
      chatKey: 'guard-required',
      ...sourceBoundary(exchange),
    }),
    error => error?.code === 'WORLD_STATE_CAPTURE_CURRENT_GUARD_REQUIRED',
  );
  assert.equal(calls.count, 0);
});

test('duplicate assistant receipt does not issue a second capture request', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I sit quietly.' },
    { role: 'assistant', content: 'The room remains unchanged.' },
  ]);
  const calls = { count: 0 };
  const first = await runCaptureOperation({
    ctx: ctxReturning('{"mutations":[]}', calls),
    isCurrent: () => true,
    state: existingState('duplicate-receipt'),
    exchange,
    chatKey: 'duplicate-receipt',
    ...sourceBoundary(exchange),
  });
  const second = await runCaptureOperation({
    ctx: ctxReturning('{"mutations":[]}', calls),
    isCurrent: () => true,
    state: first.state,
    exchange,
    chatKey: 'duplicate-receipt',
    ...sourceBoundary(exchange),
  });
  assert.equal(first.providerCalls, 1);
  assert.equal(second.outcome, 'skipped');
  assert.equal(second.providerCalls, 0);
  assert.equal(calls.count, 1);
});

test('stale result is discarded when currentness changes during provider call', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I wait.' },
    { role: 'assistant', content: 'The road closes.' },
  ]);
  const state = existingState('stale');
  let current = true;
  const ctx = ctxReturning('{"mutations":[]}');
  ctx.generateRaw = async () => {
    current = false;
    return '{"mutations":[]}';
  };
  const result = await runCaptureOperation({
    ctx,
    state,
    exchange,
    chatKey: 'stale',
    isCurrent: () => current,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.outcome, 'stale');
  assert.equal(result.errorCode, 'WORLD_STATE_ROUTE_CANCELLED');
  assert.equal(result.state.lastCaptureMessage, null);
  assert.equal(state.records.length, 0);
});

test('dispatched provider failure marks the boundary attempted without mutating world records', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I observe the road.' },
    { role: 'assistant', content: 'The road remains open.' },
  ]);
  const calls = { count: 0 };
  const ctx = ctxReturning('unused', calls);
  ctx.generateRaw = async () => {
    calls.count += 1;
    const error = new Error('provider failed');
    error.code = 'UPSTREAM_FAILURE';
    throw error;
  };
  const result = await runCaptureOperation({
    ctx,
    state: existingState('provider-failure'),
    exchange,
    chatKey: 'provider-failure',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.outcome, 'failure');
  assert.equal(result.providerCalls, 1);
  assert.equal(result.state.records.length, 0);
  assert.equal(result.state.lastCaptureMessage, 1);

  const repeated = await runCaptureOperation({
    ctx,
    state: result.state,
    exchange,
    chatKey: 'provider-failure',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(repeated.outcome, 'skipped');
  assert.equal(calls.count, 1);
});

test('low-information evidence excerpt cannot ground a mutation', async () => {
  const exchange = withLineage([
    { role: 'user', content: 'I inspect the square.' },
    { role: 'assistant', content: 'The square is calm and empty.' },
  ]);
  const response = JSON.stringify({
    mutations: [{
      action: 'create',
      kind: 'development',
      summary: 'A riot is active.',
      anchors: ['riot'],
      evidence: [{ sourceMessageId: 1, claim: 'The' }],
    }],
  });
  const result = await runCaptureOperation({
    ctx: ctxReturning(response),
    state: existingState('weak-evidence'),
    exchange,
    chatKey: 'weak-evidence',
    isCurrent: () => true,
    ...sourceBoundary(exchange),
  });
  assert.equal(result.state.records.length, 0);
  assert.equal(result.rejected[0].stage, 'source-firewall');
});

test('summary-only capture update preserves omitted anchors and trend while explicit replacement still works', () => {
  let state = reduceMutations(createState('omission-semantics'), {
    chatKey: 'omission-semantics',
    messageId: 0,
    lineageKey: 'ln0',
    mutations: [{
      action: 'create',
      kind: 'development',
      summary: 'The Southport dock strike is active.',
      anchors: ['Southport', 'dock strike'],
      trend: 'rising',
    }],
  }).state;
  const record = state.records[0];
  const exchange = withLineage([
    { role: 'assistant', content: 'The Southport dock strike remains active while talks continue.' },
  ]);

  const summaryOnly = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'update',
        recordId: record.id,
        summary: 'The Southport dock strike remains active while talks continue.',
        evidence: [{ sourceMessageId: 0, claim: 'The Southport dock strike remains active while talks continue.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [record],
    chatKey: 'omission-semantics',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });
  assert.deepEqual(summaryOnly.state.records[0].anchors, ['Southport', 'dock strike']);
  assert.equal(summaryOnly.state.records[0].trend, 'rising');

  state = summaryOnly.state;
  const trendOnlyExchange = withLineage([
    { role: 'assistant', content: 'The Southport dock strike is easing.' },
  ]);
  const trendOnly = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'update',
        recordId: record.id,
        trend: 'falling',
        evidence: [{ sourceMessageId: 0, claim: 'The Southport dock strike is easing.' }],
      }],
    }),
    state,
    exchange: trendOnlyExchange,
    visibleRecords: [state.records[0]],
    chatKey: 'omission-semantics',
    sourceMessageId: 0,
    sourceLineageKey: trendOnlyExchange[0].lineageKey,
  });
  assert.equal(trendOnly.state.records[0].trend, 'falling');
  assert.deepEqual(trendOnly.state.records[0].anchors, ['Southport', 'dock strike']);
  assert.equal(trendOnly.state.records[0].summary, 'The Southport dock strike remains active while talks continue.');

  state = trendOnly.state;
  const replaced = processCaptureResponse({
    text: JSON.stringify({
      mutations: [{
        action: 'update',
        recordId: record.id,
        anchors: [],
        trend: null,
        evidence: [{ sourceMessageId: 0, claim: 'The Southport dock strike remains active while talks continue.' }],
      }],
    }),
    state,
    exchange,
    visibleRecords: [state.records[0]],
    chatKey: 'omission-semantics',
    sourceMessageId: 0,
    sourceLineageKey: exchange[0].lineageKey,
  });
  assert.deepEqual(replaced.state.records[0].anchors, []);
  assert.equal(replaced.state.records[0].trend, null);
});

test('diagnostics retain bounded model response content but never prompt, story, headers, reasoning, or credentials', async () => {
  const secretStory = 'PRIVATE_STORY_PAYLOAD_91827';
  const exchange = withLineage([
    { role: 'user', content: 'I listen.' },
    { role: 'assistant', content: secretStory },
  ]);
  const diagnostics = createDiagnosticStore();
  await runCaptureOperation({
    ctx: ctxReturning('{"mutations":[]}'),
    isCurrent: () => true,
    state: existingState('diagnostics'),
    exchange,
    chatKey: 'diagnostics',
    operationId: 'capture-1',
    diagnostics,
    ...sourceBoundary(exchange),
  });
  const exported = JSON.stringify(diagnostics.bundle('diagnostics', '0.2.0-alpha.1'));
  assert.doesNotMatch(exported, /PRIVATE_STORY_PAYLOAD_91827|CURRENT EXCHANGE|authorization|reasoning_content|session-id|api[_-]?key/i);
  assert.match(exported, /capture-1/);
  assert.match(exported, /responseJson/);
  assert.match(exported, /mutations/);
});

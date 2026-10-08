import { chatLineage } from './branch.js';
import { CaptureWireError, parseCaptureJson, validateCaptureEnvelope } from './capture-wire.js';
import { createDiagnosticStore } from './diagnostics.js';
import { DUPLICATE_THRESHOLD, consolidateCreateCandidate, duplicateSimilarity, mergeAnchors } from './duplicate.js';
import { dispatchWorldStateRequest } from './provider-routing.js';
import { sanitizeAssistantNarration } from './narrative-sanitizer.js';
import { processSpatialCapture } from './spatial-capture.js';
import { SPATIAL_WIRE_LIMITS } from './spatial-wire.js';
import { applyCaptureSourceFirewall } from './source-firewall.js';
import { clone, clipMiddle, messageRole as roleOf, messageText } from './common.js';
import { cloneState, reduceMutations } from './state-core.js';

export const CAPTURE_RESPONSE_TOKENS = 2200;
const REALITY_MUTATION_SHAPE = '{"action":"create|update|resolve|supersede","recordId":"existing-id-for-non-create","kind":"fact|development-for-create","summary":"compact current state","status":"active for create","trend":"emerging|rising|stable|falling|uncertain when useful","anchors":["concept"],"reason":"grounded reason","evidence":[{"sourceMessageId":123,"claim":"verbatim excerpt from current exchange"}],"relatedRecordIds":["visible-id"],"newEpisodeOfRecordId":"optional visible resolved/superseded id"}';
export const CAPTURE_LIMITS = Object.freeze({
  exchangeMessages: 4,
  exchangeChars: 12000,
  perMessageChars: 7000,
  visibleRecords: 8,
  lifecycleVisibleRecords: 2,
  lifecycleContextMessages: 4,
  loreChars: 3500,
  completenessHints: 10,
  completenessHintChars: 320,
});

// A checklist bullet: '-', '*', '+', '•' and similar marks, or a number ('1.', '2)').
const CHECKLIST_BULLET = /^\s*(?:[-*+•‣◦▪●]|\d{1,3}[.)])\s+/u;
// A bullet that is itself a bold section label ('- **🌱 Planted Seeds:** …').
const CHECKLIST_LABEL_BULLET = /^\s*(?:[-*+•‣◦▪●]|\d{1,3}[.)])\s+\*\*[^*\n]{1,80}?:\s*\*\*/u;

function normalizeChecklistText(value) {
  return String(value ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(CHECKLIST_BULLET, '')
    .replace(/^\s*[-*]+\s*/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseWorldStateSectionLine(line) {
  const raw = String(line ?? '');
  const cleaned = raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/[*#_]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const offScreen = cleaned.match(/^[^\p{L}\p{N}]*off[-\s]?screen\s*:\s*(.*)$/iu);
  if (offScreen) return { section: 'off_screen', inline: offScreen[1] || '' };

  const unresolved = cleaned.match(/^[^\p{L}\p{N}]*unresolved threads\s*:\s*(.*)$/iu);
  if (unresolved) return { section: 'unresolved_threads', inline: unresolved[1] || '' };

  const headingLike = cleaned.match(/^[^:]{2,80}:\s*(.*)$/u);
  return headingLike ? { section: 'other', inline: headingLike[1] || '' } : null;
}

export function extractWorldStateCompletenessHints(exchange = []) {
  const messages = (Array.isArray(exchange) ? exchange : [])
    .filter(message => roleOf(message) === 'assistant' && Number.isInteger(message?.messageId))
    .slice(-CAPTURE_LIMITS.exchangeMessages);
  const hints = [];
  const seen = new Set();

  function pushHint(messageId, section, rawValue) {
    const value = normalizeChecklistText(rawValue).slice(0, CAPTURE_LIMITS.completenessHintChars);
    const key = value.normalize('NFKC').toLocaleLowerCase();
    if (!value || key.length < 8 || seen.has(key)) return false;
    seen.add(key);
    hints.push({ sourceMessageId: messageId, section, text: value });
    return hints.length >= CAPTURE_LIMITS.completenessHints;
  }

  for (const message of messages) {
    const narration = sanitizeAssistantNarration(messageText(message));
    const blocks = narration.match(/<World_State(?:\s+[^>]*)?>[\s\S]*?(?:<\/World_State>|$)/gi) || [];
    for (const block of blocks) {
      let section = '';
      for (const rawLine of block.split(/\r?\n/u)) {
        // Inside a section a bullet is an entry even when it contains a colon ('- The Iron Watch: ...');
        // only non-bullet lines can start or end a section.
        // A bullet that is itself a bold section label ('- **🌱 Planted Seeds:** …') still switches or closes
        // the section like any heading.
        if (section && CHECKLIST_BULLET.test(rawLine) && !CHECKLIST_LABEL_BULLET.test(rawLine)) {
          if (pushHint(message.messageId, section, rawLine)) return hints;
          continue;
        }
        const parsed = parseWorldStateSectionLine(rawLine);
        if (parsed) {
          section = parsed.section === 'other' ? '' : parsed.section;
          if (section && parsed.inline && pushHint(message.messageId, section, parsed.inline)) return hints;
          continue;
        }
        if (/^\s*---+\s*$/u.test(rawLine)) {
          section = '';
          continue;
        }
        if (!section || !CHECKLIST_BULLET.test(rawLine)) continue;
        if (pushHint(message.messageId, section, rawLine)) return hints;
      }
    }
  }
  return hints;
}

export const CAPTURE_RECOVERY_INSTRUCTION = 'Recover every materially persistent condition established in this exchange, including conditions that were already off-screen, ignored, or unrelated to the PC objective.';

export const CAPTURE_SYSTEM_PROMPT = [
  'Return exactly one valid JSON object for World State Alpha capture. No markdown or commentary.',
  'You are a conservative continuity extractor, not a narrator or Story Director.',
  'Propose only current world facts/developments and lifecycle changes already established by the CURRENT EXCHANGE.',
  'Capture is bounded for completeness, not ranked only by immediate PC salience: scan the whole CURRENT EXCHANGE for every distinct material persistent condition, up to the mutation limit.',
  'PC proximity, current objective, or whether the PC intervened are not admission criteria. An established ongoing condition that will continue independently after the PC leaves or ignores it belongs as a development, including when it is now off-screen.',
  'If the exchange establishes several independent persistent conditions, represent each once instead of stopping after the most scene-salient one.',
  'Persistence means useful future continuity after the scene cuts away. Ignore fleeting scenery, momentary positions, routine inventory/skill state, ordinary one-off transactions, notices/offers, isolated claims, plans, planted seeds, CYOA options, inner chatter, or mere possibilities unless the narration separately establishes a persistent condition.',
  'A single shown incident can establish a persistent arrangement: when a group asserts control over a place, collects levies/tolls/fees/protection payments, enforces a blockade, curfew, or checkpoint, or bystanders visibly and habitually avoid or submit to it, capture that ongoing arrangement as a development even though the individual confrontation or payment is one-off.',
  'Keep dialogue-borne claims attributed: when an arrangement rests on what someone says (a new tax, an official order, a claimed jurisdiction or authority), describe who is asserting, demanding, or threatening what (for example: men claiming X authority are demanding a raised levy from vendors), never state the claim itself as fact. An attributed summary is accepted; an unattributed restatement of the claim is rejected.',
  'Persistent information state is eligible only when rumor/report/warning/belief/allegation/news is established as circulating, repeated, public, consequential, or otherwise persistent. Store the information state, not the unverified claim. Quoted dialogue alone may establish only the speech act itself (for example declaration/threat/demand/promise/refusal/warning) or a reported/rumored/claimed/believed account; never promote its external claim to objective fact. Ignore isolated chatter.',
  'Story-driving CoT principles such as autonomous world motion, scene variation, chance, escalation, or avoiding stagnation do not apply to capture and are not evidence.',
  'Existing World State records are current campaign authority. Lore is baseline context/possibility only and cannot by itself establish a current condition.',
  'Never invent off-screen developments, outcomes, consequences, or causal links.',
  'Write each create/update summary as the condition that is true now (who or what is in which state), not as a narrated past event: describe lasting consequences such as injury, loss, damage, death, or control rather than retelling the incident that caused them. A resolve/supersede summary may state how the record ended.',
  'For every non-noop mutation, cite 1-4 short verbatim excerpts from CURRENT EXCHANGE using sourceMessageId.',
  'Keep the JSON valid: escape every double quote inside a JSON string as \\", including dialogue quotation marks copied into verbatim excerpts. Never leave a raw double quote inside a string (excerpt matching ignores punctuation, so an excerpt without its quotation marks is also accepted).',
  'Use shown record IDs only for update/resolve/supersede/related links. Never create an ID.',
  'Reality mutation field names are exact: use kind and summary. Never substitute category for kind or description for summary.',
  'Reconcile lifecycle for shown active records addressed by CURRENT EXCHANGE: resolve only when explicitly ended, completed, failed, eliminated, or permanently ceased; supersede only when explicitly replaced; update if it still exists but changed.',
  'Resolved/superseded records shown for recurrence checks are immutable history: never update, resolve, or supersede them. A genuinely new recurrence must be a create with newEpisodeOfRecordId.',
  'If an INTERPRETIVE LIFECYCLE ANTECEDENT is shown, it is prior accepted context for resolving an indirect reference only; it is not mutation evidence. CURRENT EXCHANGE must still establish the update/ending/replacement.',
  'A death, destruction, or elimination established by CURRENT EXCHANGE ends shown active records (facts or developments) that depend on that person, group, or thing continuing: resolve conditions they were running, holding, or suffering (an injury, captivity, occupation, a racket or scheme they ran). Keep the death itself current: update a shown active record describing that subject\'s state to the new state (for example injured or robbed -> dead), or create a fact for it when none is shown; never leave a death only in a resolved or superseded record. Merely mentioning, threatening, fearing, or suspecting a death never ends a record.',
  'An ending may be transient as an event but still retires the prior ongoing record. Silence, off-screen status, temporary absence, escape, interruption, uncertainty, scene departure, or PC irrelevance never proves resolution.',
  'Use resolve/supersede for lifecycle changes; do not smuggle them through update. If no persistent change or proven lifecycle transition exists, return {"mutations":[]}.',
].join(' ');

const SYSTEM_MESSAGE_TYPES = new Set([
  'help',
  'welcome',
  'empty',
  'generic',
  'narrator',
  'comment',
  'slash_commands',
  'formatting',
  'hotkeys',
  'macros',
  'welcome_prompt',
  'assistant_note',
]);

// A hidden (is_system) row is still a conversation turn when it carries ordinary user/assistant markers;
// genuine system/tool/UI rows stay system. Shared by live capture and rebuild.
export function hiddenConversationRole(message) {
  if (message?.is_system !== true) return roleOf(message);

  const extra = message?.extra && typeof message.extra === 'object' ? message.extra : {};
  const type = String(extra.type || '').trim().toLowerCase();
  if (extra.isSmallSys === true || extra.uses_system_ui === true || Array.isArray(extra.tool_invocations)) return 'system';
  if (SYSTEM_MESSAGE_TYPES.has(type)) return 'system';

  if (message?.is_user === true || message?.role === 'user') return 'user';
  if (message?.role === 'assistant') return 'assistant';
  if (type === 'assistant_message') return 'assistant';

  if (typeof message?.original_avatar === 'string' && message.original_avatar.trim()) return 'assistant';
  if (Array.isArray(message?.swipes) || Number.isInteger(message?.swipe_id)) return 'assistant';
  if (message?.gen_started || message?.gen_finished) return 'assistant';
  if (typeof extra.api === 'string' && extra.api.trim()) return 'assistant';
  if (typeof extra.model === 'string' && extra.model.trim()) return 'assistant';
  if (Number.isInteger(extra.gen_id)) return 'assistant';

  return 'system';
}

// A visible narrator message (SillyTavern /sys) is narration the next reply continues from, not a reply: it
// neither ends an exchange nor is a capture boundary, so the user's action before it is captured with the
// reply that follows (live and in rebuild alike).
export function isNarratorMessage(message) {
  return message?.is_system !== true && message?.is_user !== true
    && String(message?.extra?.type || '').trim().toLowerCase() === 'narrator';
}

export function assistantBoundaryExchange(chat = [], endMessageId, knownLineage = null) {
  const rows = Array.isArray(chat) ? chat : [];
  if (!Number.isInteger(endMessageId) || endMessageId < 0 || endMessageId >= rows.length) return [];
  if (roleOf(rows[endMessageId]) !== 'assistant' || isNarratorMessage(rows[endMessageId])) return [];

  const lineage = Array.isArray(knownLineage) && knownLineage.length > endMessageId
    ? knownLineage
    : chatLineage(rows);
  let startMessageId = 0;
  for (let index = endMessageId - 1; index >= 0; index -= 1) {
    // A hidden assistant reply still ended its exchange (rebuild treats it as a boundary by default), so the
    // user turns it answered are not captured again as current evidence for this reply.
    const row = rows[index];
    if ((roleOf(row) === 'assistant' && !isNarratorMessage(row)) || (row?.is_system === true && hiddenConversationRole(row) === 'assistant')) {
      startMessageId = index + 1;
      break;
    }
  }

  return rows.slice(startMessageId, endMessageId + 1).map((message, offset) => {
    const messageId = startMessageId + offset;
    return {
      ...clone(message),
      messageId,
      lineageKey: lineage[messageId]?.lineageKey || '',
    };
  });
}

// The relevance view of an exchange, bounded exactly like the capture exchange: newest message first within
// the exchange budget, each message clipped to keep its start and its end (the newest text).
export function boundedExchangeText(contents = []) {
  const rows = (Array.isArray(contents) ? contents : []).map(value => String(value ?? '').trim()).filter(Boolean);
  let remaining = CAPTURE_LIMITS.exchangeChars;
  const out = [];
  for (let index = rows.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const text = clipMiddle(rows[index], Math.min(CAPTURE_LIMITS.perMessageChars, remaining));
    remaining -= text.length + 1;
    out.unshift(text);
  }
  return out.join('\n');
}

export function normalizeCaptureExchange(exchange = []) {
  const candidates = (Array.isArray(exchange) ? exchange : [])
    .filter(message => Number.isInteger(message?.messageId) && roleOf(message) !== 'system')
    .slice(-CAPTURE_LIMITS.exchangeMessages)
    .map(message => ({
      messageId: message.messageId,
      role: roleOf(message),
      lineageKey: typeof message.lineageKey === 'string' ? message.lineageKey : '',
      content: clipMiddle(
        roleOf(message) === 'assistant'
          ? sanitizeAssistantNarration(messageText(message))
          : messageText(message),
        CAPTURE_LIMITS.perMessageChars,
      ),
    }));

  let remaining = CAPTURE_LIMITS.exchangeChars;
  const out = [];
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    if (remaining <= 0) break;
    const message = candidates[i];
    const content = clipMiddle(message.content, remaining);
    remaining -= content.length;
    out.unshift({ ...message, content });
  }
  return out;
}

export function captureDue({ exchange = [], lastCaptureMessage = null, sourceMessageId = null } = {}) {
  const normalized = normalizeCaptureExchange(exchange);
  const last = normalized.at(-1);
  if (!last || last.role !== 'assistant' || !last.content.trim()) return false;
  const boundary = Number.isInteger(sourceMessageId) ? sourceMessageId : last.messageId;
  if (last.messageId !== boundary) return false;
  return lastCaptureMessage !== boundary;
}

function boundedVisibleRecords(records = []) {
  return (Array.isArray(records) ? records : []).slice(0, CAPTURE_LIMITS.visibleRecords);
}

function renderRecords(records = []) {
  return boundedVisibleRecords(records)
    .map(record => ({
      id: record.id,
      kind: record.kind,
      summary: record.summary,
      status: record.status,
      trend: record.trend ?? null,
      anchors: Array.isArray(record.anchors) ? record.anchors : [],
    }));
}

export function buildCapturePrompt({
  exchange = [],
  visibleRecords = [],
  lifecycleContextRecordIds = [],
  loreText = '',
  operation = 'capture',
  spatialEnabled = false,
  visibleLocations = [],
  spatialProfile = null,
} = {}) {
  const currentExchange = normalizeCaptureExchange(exchange);
  const completenessHints = extractWorldStateCompletenessHints(exchange);
  const records = renderRecords(visibleRecords);
  const lifecycleContextIdSet = new Set(
    (Array.isArray(lifecycleContextRecordIds) ? lifecycleContextRecordIds : [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .slice(0, CAPTURE_LIMITS.lifecycleVisibleRecords),
  );
  const interpretiveLifecycle = records
    .filter(record => record.status === 'active' && lifecycleContextIdSet.has(record.id))
    .map(record => ({ id: record.id, kind: record.kind, summary: record.summary, anchors: record.anchors }));
  const lore = clipMiddle(loreText, CAPTURE_LIMITS.loreChars);
  const prompt = [
    'CURRENT EXCHANGE (the only automatic mutation evidence source):',
    JSON.stringify(currentExchange.map(({ messageId, role, content }) => ({ messageId, role, content }))),
    '',
    // Live capture and rebuild share one recovery instruction so a live turn is asked for exactly what a
    // rebuild of the same exchange recovers; rebuild only adds its historical-boundary framing.
    operation === 'rebuild'
      ? 'REBUILD RECOVERY MODE: This is one historical chronological exchange boundary. ' + CAPTURE_RECOVERY_INSTRUCTION + ' Do not infer un-narrated evolution between boundaries; later narrated exchanges must establish later changes.'
      : 'CAPTURE RECOVERY: ' + CAPTURE_RECOVERY_INSTRUCTION,
    'VISIBLE WORLD STATE CONTEXT (active records are current authority; resolved/superseded records are recurrence context only; use only these IDs):',
    JSON.stringify(records),
    '',
    interpretiveLifecycle.length ? 'INTERPRETIVE LIFECYCLE ANTECEDENT (prior accepted context, NOT mutation evidence):' : '',
    interpretiveLifecycle.length ? JSON.stringify(interpretiveLifecycle) : '',
    interpretiveLifecycle.length
      ? 'Use this only to bind an indirect reference in CURRENT EXCHANGE to an already-active record. CURRENT EXCHANGE alone must establish any changed/ended/replaced state. Keep enough subject wording from the shown antecedent in the proposed summary for deterministic target validation.'
      : '',
    '',
    'LIFECYCLE CHECK: If CURRENT EXCHANGE explicitly ends/completes/fails/eliminates a shown active record (fact or development), including through the death or elimination of the person or group it depends on, resolve it; if explicitly replaces it, supersede it; if it continues but changed, update it. Silence, off-screen status, absence, escape, or uncertainty never proves resolution.',
    operation === 'rebuild'
      ? 'REBUILD: Later historical boundaries may close earlier active threads; reconcile those endings so completed episodes do not remain active.'
      : '',
    '',
    'RELEVANT LORE BASELINE (context/possibility only; never evidence of current occurrence):',
    lore || '(none)',
    '',
    'PERSISTENCE COMPLETENESS CHECK: Before output, sweep the entire CURRENT EXCHANGE again. Represent every distinct materially persistent current condition established there, even when off-screen or ignored. Exclude transient detail, mere notices, isolated claims, plans, and options. Persistent rumor/news is eligible only as explicitly reported/rumored/believed information state, never as verified fact. Do not duplicate conditions.',
    completenessHints.length ? 'STRUCTURED CURRENT-STATE COMPLETENESS CHECKLIST:' : '',
    completenessHints.length ? JSON.stringify(completenessHints) : '',
    completenessHints.length
      ? 'Checklist policy: these narrator-authored Off-Screen/Unresolved entries are advisory. Re-check each against the exchange and include only materially persistent conditions not already represented. Prefer ordinary narration as evidence; World_State may corroborate. Exclude transient state, inventory/skill, seeds/timers/phase, CYOA, inner chatter, planning, isolated claims, and possibilities. Rumor/news requires established circulation/significance and reported/rumored/believed wording.'
      : '',
    '',
    spatialEnabled ? 'VISIBLE SPATIAL CONTINUITY (current/base authority; use only shown IDs):' : '',
    spatialEnabled ? JSON.stringify((Array.isArray(visibleLocations) ? visibleLocations : []).slice(0, 8).map(location => ({
      id: location.id,
      name: location.name,
      type: location.type,
      context: location.context || '',
      coordinate: location.coordinate || null,
      routeRefs: Array.isArray(location.routeRefs) ? location.routeRefs.slice(0, 8) : [],
      source: location.isBase ? 'base' : 'campaign',
    }))) : '',
    spatialEnabled ? 'SPATIAL PROFILE:' : '',
    spatialEnabled ? JSON.stringify(spatialProfile || null) : '',
    'OUTPUT SHAPE:',
    spatialEnabled
      ? '{"mutations":[' + REALITY_MUTATION_SHAPE + '],"spatialMutations":[{"action":"upsert_location|upsert_relation|upsert_route","locationId":"visible existing id only when updating","name":"grounded persistent place name","type":"generic place type","context":"established context","coordinate":{"x":1.2,"y":3.4,"authority":"narrative_explicit"},"relative":{"toLocationId":"visible anchor id","direction":"east","distanceKm":10,"distanceMode":"straight_line|route|unspecified"},"routeRefs":["visible route"],"admissionReason":"named|explicit_position|explicit_coordinate|revisited|persistent_feature|route_landmark|material_event","evidence":[{"sourceMessageId":123,"claim":"verbatim excerpt from CURRENT EXCHANGE"}]}]}'
      : '{"mutations":[' + REALITY_MUTATION_SHAPE + ']}',
    spatialEnabled
      ? 'Spatial rules: track only persistent established places; never capture generic scenery. Planning/writer_state is not evidence. Do not invent precise coordinates. Route/travel distance is not straight-line displacement. Never assign manual/base/campaign_override authority. At most ' + SPATIAL_WIRE_LIMITS.mutations + ' spatialMutations per response: keep the most material ones. If no spatial change return spatialMutations:[] alongside mutations.'
      : '',
    spatialEnabled ? 'For no material change return exactly {"mutations":[],"spatialMutations":[]}.' : 'For no material change return exactly {"mutations":[]}.',
  ].filter(Boolean).join('\n');
  return {
    systemPrompt: CAPTURE_SYSTEM_PROMPT,
    prompt,
    responseLength: CAPTURE_RESPONSE_TOKENS,
    completenessHints,
    quietToLoud: false,
    instructOverride: true,
    trimNames: false,
  };
}

function rejectedEntry(stage, reason, extra = {}) {
  return { stage, reason: String(reason || 'rejected'), ...extra };
}

function markCaptureAttempt(inputState, sourceMessageId) {
  const next = cloneState(inputState);
  next.lastCaptureMessage = sourceMessageId;
  return next;
}

export function processCaptureResponse({
  text,
  state,
  exchange,
  visibleRecords = [],
  lifecycleContextRecordIds = [],
  chatKey,
  sourceMessageId,
  sourceLineageKey,
  operation = 'capture',
  evidenceSourceClass = '',
  spatialEnabled = false,
  visibleLocations = [],
  baseMap = null,
  spatialProfile = null,
} = {}) {
  const raw = parseCaptureJson(text);
  const wire = validateCaptureEnvelope(raw);
  if (wire.rejected.length) {
    const first = wire.rejected[0];
    throw new CaptureWireError(
      `${operation === 'rebuild' ? 'rebuild' : 'capture'} rejected structurally invalid Reality mutation row ${first.index}: ${first.reason}`,
      operation === 'rebuild' ? 'WORLD_STATE_REBUILD_REALITY_WIRE_INVALID' : 'WORLD_STATE_CAPTURE_REALITY_WIRE_INVALID',
    );
  }
  const boundedRecords = boundedVisibleRecords(visibleRecords);
  const rejected = [];
  const accepted = [];

  for (let index = 0; index < wire.mutations.length; index += 1) {
    const proposal = wire.mutations[index];
    if (proposal.action === 'noop') continue;
    const firewalled = applyCaptureSourceFirewall(proposal, {
      exchange,
      visibleRecords: boundedRecords,
      lifecycleContextRecordIds,
      state,
    });
    if (!firewalled.ok) {
      rejected.push(rejectedEntry('source-firewall', firewalled.reason, { index }));
      continue;
    }
    const consolidated = consolidateCreateCandidate(firewalled.mutation, boundedRecords);
    if (!consolidated.ok) {
      rejected.push(rejectedEntry('duplicate-gate', consolidated.reason, {
        index,
        duplicateRecordId: consolidated.duplicate?.record?.id || '',
      }));
      continue;
    }

    let admittedMutation = consolidated.mutation;
    if (firewalled.mutation.action === 'create' && admittedMutation.action !== 'create') {
      const rebound = applyCaptureSourceFirewall(admittedMutation, {
        exchange,
        visibleRecords: boundedRecords,
        lifecycleContextRecordIds,
        state,
      });
      if (!rebound.ok) {
        rejected.push(rejectedEntry('source-firewall', rebound.reason, {
          index,
          duplicateRecordId: consolidated.duplicate?.record?.id || '',
        }));
        continue;
      }
      admittedMutation = rebound.mutation;
    }

    // The duplicate gate only sees records that existed before this response; a second near-identical
    // create in the same response would otherwise become a separate record for one condition.
    // One condition proposed twice in the same response is merged into the first create (anchors and
    // evidence), using the duplicate gate's own threshold.
    if (evidenceSourceClass) {
      admittedMutation.evidence = (admittedMutation.evidence || []).map(item => ({
        ...item,
        sourceClass: evidenceSourceClass,
      }));
    }
    const sameResponseDuplicate = admittedMutation.action === 'create'
      ? accepted.find(item => item.action === 'create' && duplicateSimilarity(admittedMutation, item) >= DUPLICATE_THRESHOLD)
      : null;
    if (sameResponseDuplicate) {
      sameResponseDuplicate.anchors = mergeAnchors(sameResponseDuplicate.anchors || [], admittedMutation.anchors || []);
      sameResponseDuplicate.evidence = [...(sameResponseDuplicate.evidence || []), ...(admittedMutation.evidence || [])].slice(0, 4);
      rejected.push(rejectedEntry('duplicate-gate', 'merged into another create in this response', { index }));
      continue;
    }
    accepted.push(admittedMutation);
  }

  const reduced = reduceMutations(state, {
    chatKey,
    messageId: sourceMessageId,
    lineageKey: sourceLineageKey,
    operation,
    mutations: accepted,
  });
  for (const item of reduced.rejected) {
    rejected.push(rejectedEntry('reducer', item.reason));
  }

  // The reducer's state is already this call's private copy.
  const nextState = reduced.state;
  nextState.lastCaptureMessage = sourceMessageId;

  let spatialResult = {
    spatial: nextState.spatial,
    applied: [],
    rejected: [],
    proposedCount: 0,
    acceptedCount: 0,
    indexDelta: {
      changedLocationIds: [],
      upsertedLocations: [],
      removedLocationIds: [],
      upsertedRelations: [],
      removedRelationIds: [],
      upsertedRoutes: [],
      removedRouteIds: [],
    },
  };
  if (spatialEnabled) {
    // Omitted means no Spatial changes; present but not a list (an object, a string, null) is malformed
    // output, and the whole boundary fails rather than reading it as "no places".
    if (raw.spatialMutations !== undefined && !Array.isArray(raw.spatialMutations)) {
      throw new CaptureWireError('capture response spatialMutations must be an array');
    }
    spatialResult = processSpatialCapture({
      rawSpatialMutations: raw.spatialMutations || [],
      spatial: nextState.spatial,
      exchange,
      visibleLocations,
      baseMap,
      profile: spatialProfile || nextState.spatial?.profile,
      chatKey,
      sourceMessageId,
      sourceLineageKey,
      operation,
      evidenceSourceClass,
    });
    // A row past the per-response cap is dropped on its own; only a malformed row fails the boundary.
    const structuralSpatial = (spatialResult.rejected || []).find(item => item?.stage === 'spatial-wire' && item.code !== 'WORLD_STATE_SPATIAL_WIRE_LIMIT');
    if (structuralSpatial) {
      throw new CaptureWireError(
        `${operation === 'rebuild' ? 'rebuild' : 'capture'} rejected structurally invalid Spatial mutation row ${structuralSpatial.index ?? '?'}: ${structuralSpatial.reason}`,
        operation === 'rebuild' ? 'WORLD_STATE_REBUILD_SPATIAL_WIRE_INVALID' : 'WORLD_STATE_CAPTURE_SPATIAL_WIRE_INVALID',
      );
    }
    nextState.spatial = spatialResult.spatial;
  }

  return {
    state: nextState,
    proposedCount: Array.isArray(raw.mutations) ? raw.mutations.length : 0,
    acceptedCount: accepted.length,
    applied: reduced.applied,
    rejected,
    indexDelta: reduced.indexDelta || { upsertedRecords: [], appendedLinks: [], corpusRecords: nextState.records.length },
    spatial: spatialResult,
    aliasRepairs: wire.aliasRepairs || 0,
  };
}

export async function runCaptureOperation({
  ctx,
  state,
  exchange,
  visibleRecords = [],
  lifecycleContextRecordIds = [],
  loreText = '',
  chatKey,
  sourceMessageId,
  sourceLineageKey,
  sourceContentLineageKey = '',
  route = undefined,
  operationId = '',
  timeoutMs = undefined,
  signal = undefined,
  isCurrent = undefined,
  diagnostics = undefined,
  dispatcher = dispatchWorldStateRequest,
  operation = 'capture',
  evidenceSourceClass = '',
  label = 'capture',
  spatialEnabled = false,
  visibleLocations = [],
  baseMap = null,
  spatialProfile = null,
} = {}) {
  const diagnosticStore = diagnostics || createDiagnosticStore();
  const startedAt = Date.now();
  // The hide-insensitive lineage key (or a getter given the row outcome) that
  // lets a missed capture survive hiding/unhiding an earlier message.
  const contentKey = outcome => {
    try {
      const value = typeof sourceContentLineageKey === 'function'
        ? sourceContentLineageKey(outcome)
        : sourceContentLineageKey;
      return typeof value === 'string' ? value : '';
    } catch {
      return '';
    }
  };

  if (!captureDue({ exchange, lastCaptureMessage: state?.lastCaptureMessage, sourceMessageId })) {
    return { outcome: 'skipped', state: cloneState(state), providerCalls: 0, rejected: [], applied: [] };
  }

  if (typeof isCurrent !== 'function') {
    const error = new Error('automatic capture requires an isCurrent() guard');
    error.code = 'WORLD_STATE_CAPTURE_CURRENT_GUARD_REQUIRED';
    throw error;
  }
  const current = () => isCurrent();
  if (!current()) {
    // Recorded so a capture abandoned by a chat switch is listed as missed; a
    // swipe, edit or delete changes the message's lineage and drops the row.
    diagnosticStore.record(chatKey, {
      operationId,
      lineageKey: sourceLineageKey,
      contentLineageKey: contentKey('stale'),
      label,
      sourceMessageId,
      outcome: 'stale',
      code: 'WORLD_STATE_CAPTURE_STALE',
      detail: 'Operation became stale before the provider request was sent.',
      durationMs: Date.now() - startedAt,
    });
    return { outcome: 'stale', state: cloneState(state), providerCalls: 0, rejected: [], applied: [] };
  }

  const options = buildCapturePrompt({
    exchange,
    visibleRecords,
    lifecycleContextRecordIds,
    loreText,
    operation,
    spatialEnabled,
    visibleLocations,
    spatialProfile,
  });
  let dispatched;
  try {
    dispatched = await dispatcher(ctx, options, {
      route,
      chatKey,
      operationId,
      timeoutMs,
      signal,
      isCurrent: current,
      label,
    });
  } catch (error) {
    const receipt = error?.receipt || {};
    const providerCalls = receipt.dispatched ? 1 : 0;
    const stale = error?.code === 'WORLD_STATE_ROUTE_CANCELLED' && !current();
    const outcome = stale ? 'stale' : (receipt.outcome || 'failure');
    diagnosticStore.record(chatKey, {
      operationId,
      lineageKey: sourceLineageKey,
      contentLineageKey: contentKey(outcome),
      label,
      sourceMessageId,
      outcome,
      code: error?.code || 'PROVIDER_ERROR',
      detail: String(error?.message || error).slice(0, 320),
      route: receipt.route || '',
      profileId: receipt.profileId || '',
      providerCalls,
      candidateRecords: Math.min(visibleRecords.length, CAPTURE_LIMITS.visibleRecords),
      completenessHints: options.completenessHints?.length || 0,
      promptChars: options.systemPrompt.length + options.prompt.length,
      responseChars: 0,
      durationMs: Date.now() - startedAt,
    });
    return {
      outcome,
      state: stale || providerCalls === 0 ? cloneState(state) : markCaptureAttempt(state, sourceMessageId),
      providerCalls,
      rejected: [rejectedEntry('provider', error?.message || error, { code: error?.code || 'PROVIDER_ERROR' })],
      applied: [],
      errorCode: error?.code || 'PROVIDER_ERROR',
      routeReceipt: receipt,
    };
  }

  if (!current()) {
    diagnosticStore.record(chatKey, {
      operationId,
      lineageKey: sourceLineageKey,
      contentLineageKey: contentKey('stale'),
      label,
      sourceMessageId,
      outcome: 'stale',
      code: 'WORLD_STATE_CAPTURE_STALE',
      detail: 'Operation became stale before provider output could be applied.',
      route: dispatched.receipt?.route || '',
      profileId: dispatched.receipt?.profileId || '',
      providerCalls: 1,
      candidateRecords: Math.min(visibleRecords.length, CAPTURE_LIMITS.visibleRecords),
      completenessHints: options.completenessHints?.length || 0,
      promptChars: options.systemPrompt.length + options.prompt.length,
      responseChars: dispatched.text.length,
      durationMs: Date.now() - startedAt,
    });
    return { outcome: 'stale', state: cloneState(state), providerCalls: 1, rejected: [], applied: [] };
  }

  try {
    const processed = processCaptureResponse({
      text: dispatched.text,
      state,
      exchange,
      visibleRecords,
      lifecycleContextRecordIds,
      chatKey,
      sourceMessageId,
      sourceLineageKey,
      operation,
      evidenceSourceClass,
      spatialEnabled,
      visibleLocations,
      baseMap,
      spatialProfile,
    });
    const spatialApplied = processed.spatial?.applied?.length || 0;
    const spatialRejected = processed.spatial?.rejected?.length || 0;
    const outcome = (processed.applied.length + spatialApplied) > 0 ? 'applied' : 'no-change';
    diagnosticStore.record(chatKey, {
      operationId,
      lineageKey: sourceLineageKey,
      contentLineageKey: contentKey(outcome),
      label,
      sourceMessageId,
      outcome,
      code: processed.aliasRepairs ? 'WORLD_STATE_PROVIDER_ALIAS_REPAIRED' : '',
      detail: processed.aliasRepairs
        ? `Repaired ${processed.aliasRepairs} unambiguous provider field alias${processed.aliasRepairs === 1 ? '' : 'es'} before validation.`
        : '',
      route: dispatched.receipt?.route || '',
      profileId: dispatched.receipt?.profileId || '',
      providerCalls: 1,
      proposed: processed.proposedCount + (processed.spatial?.proposedCount || 0),
      accepted: processed.acceptedCount + (processed.spatial?.acceptedCount || 0),
      applied: processed.applied.length + spatialApplied,
      rejected: processed.rejected.length + spatialRejected,
      aliasRepairs: processed.aliasRepairs || 0,
      candidateRecords: Math.min(visibleRecords.length, CAPTURE_LIMITS.visibleRecords),
      completenessHints: options.completenessHints?.length || 0,
      promptChars: options.systemPrompt.length + options.prompt.length,
      responseChars: dispatched.text.length,
      durationMs: Date.now() - startedAt,
      responseJson: dispatched.text,
      rejectionsJson: JSON.stringify([
        ...(processed.rejected || []),
        ...(processed.spatial?.rejected || []),
      ]),
    });
    return {
      ...processed,
      outcome,
      providerCalls: 1,
      routeReceipt: dispatched.receipt,
      completenessHints: options.completenessHints?.length || 0,
    };
  } catch (error) {
    if (!(error instanceof CaptureWireError)) throw error;
    diagnosticStore.record(chatKey, {
      operationId,
      lineageKey: sourceLineageKey,
      contentLineageKey: contentKey('invalid-response'),
      label,
      sourceMessageId,
      outcome: 'invalid-response',
      code: error.code,
      detail: String(error.message || error).slice(0, 320),
      route: dispatched.receipt?.route || '',
      profileId: dispatched.receipt?.profileId || '',
      providerCalls: 1,
      candidateRecords: Math.min(visibleRecords.length, CAPTURE_LIMITS.visibleRecords),
      completenessHints: options.completenessHints?.length || 0,
      promptChars: options.systemPrompt.length + options.prompt.length,
      responseChars: dispatched.text.length,
      durationMs: Date.now() - startedAt,
      responseJson: dispatched.text,
      rejectionsJson: JSON.stringify([{ stage: 'response', code: error.code, reason: String(error.message || error).slice(0, 320) }]),
    });
    return {
      outcome: 'invalid-response',
      state: markCaptureAttempt(state, sourceMessageId),
      providerCalls: 1,
      rejected: [rejectedEntry('response', error.message, { code: error.code })],
      applied: [],
      errorCode: error.code,
      routeReceipt: dispatched.receipt,
    };
  }
}

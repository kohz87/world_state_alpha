// Sentences (or lines) of a text bind a coordinate to the place it describes (shared with the firewall).
import { captureExchangeIndex, containsOnWordBoundaries, evidenceClaimGrounded, evidenceClaimQuotedOnly, sentencesOf } from './source-firewall.js';
import {
  baseLocationByName,
  canonicalSpatialDirection,
  deriveCoordinate,
  directionFromDelta,
  effectiveLocationId,
  normalizeCoordinate,
  normalizeSpatialState,
  reduceSpatialMutations,
  resolveEffectiveLocations,
  resolveSpatialProfile,
  validateBounds,
} from './spatial-core.js';
import { validateSpatialEnvelope } from './spatial-wire.js';
import { canonicalText as norm } from './hash.js';

const GENERIC_SCENERY = new Set([
  'clearing', 'a clearing', 'the clearing',
  'road', 'a road', 'the road', 'dirt road',
  'forest', 'a forest', 'the forest', 'forest path',
  'woods', 'the woods', 'some woods',
  'trees', 'the trees', 'some trees',
  'trail', 'a trail', 'the trail',
  'path', 'a path', 'the path',
  'riverbank', 'the riverbank', 'a riverbank',
  'scenery', 'generic scenery',
  'campsite', 'a campsite', 'the campsite',
  'room', 'a room', 'the room',
  'hallway', 'a hallway', 'the hallway',
  'field', 'a field', 'the field',
  'street', 'a street', 'the street',
]);

function isGenericScenery(name) {
  const n = norm(name);
  if (!n || n.length < 2) return true;
  return GENERIC_SCENERY.has(n);
}

const GENERIC_PLACE_WORDS = new Set([
  'road', 'street', 'lane', 'trail', 'path', 'track', 'bridge', 'ford',
  'culvert', 'ditch', 'ditchline', 'river', 'stream', 'canal', 'harbor',
  'harbour', 'yard', 'stockyard', 'market', 'square', 'gate', 'hall',
  'inn', 'tavern', 'village', 'town', 'city', 'camp', 'ruin', 'shrine',
]);

function locationNameGrounded(name, evidence, exchangeById) {
  const needle = norm(name);
  if (!needle) return false;
  const nameTokens = needle.split(' ').filter(Boolean);
  const distinctive = nameTokens.filter(token => token.length >= 3 && !GENERIC_PLACE_WORDS.has(token));

  for (const item of evidence || []) {
    const source = exchangeById.get(item.sourceMessageId);
    if (!source) continue;
    // Whole words only: "Oak" is not in "cloak" (scripts written without spaces match inside runs of letters).
    if (needle.length >= 2 && containsOnWordBoundaries(norm(source.text), needle)) return true;

    // Conservative compositional grounding for provider-normalized names such
    // as "Applecross Culvert" when one accepted quote says
    // "Applecross ... the culvert". Every proposed token must occur in that
    // same grounded claim and at least one token must be distinctive.
    if (nameTokens.length >= 2 && nameTokens.length <= 4 && distinctive.length) {
      const claimTokens = new Set(norm(item.claim).split(' ').filter(Boolean));
      if (nameTokens.every(token => claimTokens.has(token))) return true;
    }
  }
  return false;
}

function groundEvidence(items, exchangeById, evidenceSourceClass = '') {
  const out = [];
  for (const item of items || []) {
    const source = exchangeById.get(item.sourceMessageId);
    if (!source || source.role === 'system') {
      return { ok: false, reason: 'spatial evidence must come from the bounded current user/assistant exchange' };
    }
    if (!evidenceClaimGrounded(item.claim, source.text)) {
      return { ok: false, reason: 'spatial evidence claim is not grounded in sanitized source narration' };
    }
    out.push({
      sourceMessageId: item.sourceMessageId,
      lineageKey: source.lineageKey,
      sourceClass: evidenceSourceClass || (source.role === 'user' ? 'user_narration' : 'assistant_narration'),
      claim: item.claim,
    });
  }
  return out.length ? { ok: true, evidence: out } : { ok: false, reason: 'spatial mutation has no grounded evidence' };
}

function coordKnown(coord) {
  return Number.isFinite(coord?.x) && Number.isFinite(coord?.y);
}

function directionsCompatible(stated, actual) {
  return canonicalSpatialDirection(stated) === canonicalSpatialDirection(actual);
}

// The written coordinate forms: [x, y]; (x, y); and x=12.4, y=45.0 (signed values, Markdown axis labels,
// JSON-quoted keys, and comma/pipe/whitespace separators).
const COORDINATE_FORMS = Object.freeze([
  /\[\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\]/g,
  /\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*\)/g,
  /(?:\*\*)?["']?x["']?(?:\*\*)?\s*[:=](?:\*\*)?\s*([+-]?\d+(?:\.\d+)?)\s*(?:,|\||\s+)\s*(?:\*\*)?["']?y["']?(?:\*\*)?\s*[:=](?:\*\*)?\s*([+-]?\d+(?:\.\d+)?)/gi,
]);

function extractExplicitCoordinatesFromText(text) {
  const coords = [];
  if (typeof text !== 'string') return coords;
  for (const form of COORDINATE_FORMS) {
    for (const match of text.matchAll(form)) coords.push({ x: Number(match[1]), y: Number(match[2]) });
  }
  return coords;
}

// The sentence names this place: its full name, or every distinctive word of it
// (so "Falcon Fortress" never stands in for "Falcon Peak").
function sentenceNamesPlace(sentence, name) {
  const haystack = ` ${norm(sentence)} `;
  const needle = norm(name);
  if (!needle) return false;
  if (haystack.includes(` ${needle} `)) return true;
  const distinctive = needle.split(' ').filter(token => token.length >= 3 && !GENERIC_PLACE_WORDS.has(token));
  return distinctive.length > 0 && distinctive.every(token => haystack.includes(` ${token} `));
}

// A coordinate is narrative-explicit only where the narration states it for this
// place: in a cited sentence that both names the place and carries the pair.
// A pair given for another place elsewhere in the message is never borrowed,
// and a pair known only from quoted dialogue is hearsay, not narrative authority.
// Returns the narrated pair itself (the nearest within the profile's precision step), never the model's numbers.
function narratedCoordinateFor(coord, evidence, exchangeById, decimalStep = 0.1, name = '') {
  if (!coordKnown(coord)) return null;
  const tolerance = Math.max(0.1, decimalStep || 0.1);
  const found = [];
  const matches = text => {
    const near = extractExplicitCoordinatesFromText(text)
      .filter(exp => Math.abs(exp.x - coord.x) <= tolerance && Math.abs(exp.y - coord.y) <= tolerance);
    found.push(...near);
    return near.length > 0;
  };

  for (const item of evidence || []) {
    const source = exchangeById.get(item.sourceMessageId);
    if (!source) continue;
    if (evidenceClaimQuotedOnly(item.claim, source.text)) continue;
    // Narration only: a pair spoken in dialogue is hearsay wherever the cited claim sits.
    const sentences = sentencesOf(withoutSpokenDialogue(source.text));
    sentences.forEach((sentence, at) => {
      if (name && !sentenceNamesPlace(sentence, name)
        // "The Old Mill stands by the river. It sits at [12, 4]."
        && !(at > 0 && REFERS_BACK.test(sentence) && sentenceNamesPlace(sentences[at - 1], name))) return;
      matches(sentence);
    });
  }
  if (!found.length) return null;
  const distance = item => Math.hypot(item.x - coord.x, item.y - coord.y);
  return found.reduce((best, item) => (distance(item) < distance(best) ? item : best));
}

// Quoted dialogue (a quoted span with more than one word); a quoted axis label such as "X": 12 is kept.
function withoutSpokenDialogue(text) {
  const spoken = span => (/\s/u.test(span.slice(1, -1).trim()) ? ' ' : span);
  return String(text || '')
    .replace(/"[^"\n]*"/gu, spoken)
    .replace(/“[^”\n]*”/gu, spoken);
}

const REFERS_BACK = /^\s*it\s+(?:sits|stands|lies|rests|is located|is found|is set|is situated)\b/iu;

// Hypothetical or proposed construction ("if we built Moonspire Tower ...",
// "plans to raise a fort"): no current place is established. An ordinary
// conditional about travel ("if you follow the road you will reach ...") is not.
const CONSTRUCT = '(?:build|built|raise|raised|found|founded|erect|erected)';
const HYPOTHETICAL_PLACE = new RegExp(`\\bif\\s+(?:we|they|you|he|she|someone|anyone|i)\\s+(?:were to\\s+|ever\\s+|could\\s+|would\\s+)?${CONSTRUCT}\\b|\\b(?:were to|would|could|might|plans? to|planned to|planning to|intends? to|intended to|hopes? to|wants? to)\\s+${CONSTRUCT}\\b|\\b(?:imagine|suppose|supposing)\\b`, 'iu');

function placeEvidenceHypothetical(evidence, exchangeById) {
  const items = Array.isArray(evidence) ? evidence : [];
  if (!items.length) return false;
  return items.every(item => {
    if (HYPOTHETICAL_PLACE.test(String(item.claim || ''))) return true;
    const source = exchangeById.get(item.sourceMessageId);
    if (!source) return false;
    // Hypothetical only when every sentence that carries the claim is.
    const grounding = sentencesOf(source.text).filter(sentence => evidenceClaimGrounded(item.claim, sentence));
    return grounding.length > 0 && grounding.every(sentence => HYPOTHETICAL_PLACE.test(sentence));
  });
}

const DIRECTION_TEXT_FORMS = Object.freeze({
  north: ['north'],
  south: ['south'],
  east: ['east'],
  west: ['west'],
  northeast: ['northeast', 'north east'],
  northwest: ['northwest', 'north west'],
  southeast: ['southeast', 'south east'],
  southwest: ['southwest', 'south west'],
});

const canonicalDirection = canonicalSpatialDirection;

function evidenceSourceTexts(evidence, exchangeById) {
  const out = [];
  const seen = new Set();
  for (const item of evidence || []) {
    const source = exchangeById.get(item.sourceMessageId);
    if (!source?.text || seen.has(item.sourceMessageId)) continue;
    seen.add(item.sourceMessageId);
    out.push(source.text);
  }
  return out;
}

function directionGroundedInNarration(direction, evidence, exchangeById) {
  const canonical = canonicalDirection(direction);
  const forms = DIRECTION_TEXT_FORMS[canonical] || [];
  if (!forms.length) return false;
  for (const text of evidenceSourceTexts(evidence, exchangeById)) {
    const normalized = norm(text);
    if (forms.some(form => ` ${normalized} `.includes(` ${form} `))) return true;
  }
  return false;
}

function distanceGroundedInNarration(distanceKm, evidence, exchangeById) {
  if (!Number.isFinite(distanceKm) || distanceKm < 0) return false;
  const tolerance = Math.max(0.01, Math.abs(distanceKm) * 1e-6);
  for (const text of evidenceSourceTexts(evidence, exchangeById)) {
    const matches = text.matchAll(/(-?\d+(?:\.\d+)?)\s*(?:km\b|kilomet(?:er|re)s?\b)/gi);
    for (const match of matches) {
      if (Math.abs(Number(match[1]) - distanceKm) <= tolerance) return true;
    }
  }
  return false;
}

// The sentences that state this distance: what qualifies a distance is read there, not anywhere in the
// message ("The winds howled. Millbrook lies 12 km north" is no route).
function distanceSentences(distanceKm, evidence, exchangeById) {
  if (!Number.isFinite(distanceKm)) return [];
  const tolerance = Math.max(0.01, Math.abs(distanceKm) * 1e-6);
  return evidenceSourceTexts(evidence, exchangeById).flatMap(sentencesOf).filter(sentence => [...sentence.matchAll(/(-?\d+(?:\.\d+)?)\s*(?:km\b|kilomet(?:er|re)s?\b)/gi)]
    .some(match => Math.abs(Number(match[1]) - distanceKm) <= tolerance));
}

const ROUTE_TRAVEL = /\b(?:road|route|trail|path|river|sea|sail|sailing|travel|travelled|traveled|journey|along|ride|riding|rode|walk|walking|march|marching|hike|hiking|trek|trekking|voyage|winding)\b/u;
const STRAIGHT_DISTANCE = /\b(?:straight line|straightline|direct distance|as the crow flies)\b/u;

// A distance is straight-line only where its sentence says so; a ride, walk or road length is route context,
// never Cartesian displacement. The model's label decides only when the sentence carries both kinds of
// wording, and it can never promote an unqualified distance (a 'route' label may still mark one as route).
function distanceModeFor(proposedMode, distanceKm, evidence, exchangeById) {
  const sentences = distanceSentences(distanceKm, evidence, exchangeById).map(norm);
  const route = sentences.some(sentence => ROUTE_TRAVEL.test(sentence));
  const straight = sentences.some(sentence => STRAIGHT_DISTANCE.test(sentence));
  if (straight && !route) return 'straight_line';
  if (straight) return proposedMode === 'route' || proposedMode === 'straight_line' ? proposedMode : 'unspecified';
  return route || proposedMode === 'route' ? 'route' : 'unspecified';
}

function groundDirectRelationProposal(proposal, from, to, evidence, exchangeById) {
  if (!from || !to) return { ok: false, reason: 'direct relation requires established endpoints' };
  if (!locationNameGrounded(from.name, evidence, exchangeById)
      || !locationNameGrounded(to.name, evidence, exchangeById)) {
    return { ok: false, reason: 'relation endpoint names are not grounded together in accepted narration' };
  }

  const direction = proposal.direction && directionGroundedInNarration(proposal.direction, evidence, exchangeById)
    ? canonicalDirection(proposal.direction)
    : null;
  const distanceGrounded = Number.isFinite(proposal.distanceKm)
    && distanceGroundedInNarration(proposal.distanceKm, evidence, exchangeById);
  const distanceKm = distanceGrounded ? proposal.distanceKm : null;
  const distanceMode = distanceGrounded ? distanceModeFor(proposal.distanceMode, distanceKm, evidence, exchangeById) : 'unspecified';

  if (!direction && distanceKm === null) {
    return { ok: false, reason: 'relation has no grounded direction or numeric distance' };
  }

  return {
    ok: true,
    proposal: {
      ...proposal,
      direction,
      distanceKm,
      distanceMode,
    },
  };
}

function groundRelativeProposal(relative, anchor, evidence, exchangeById) {
  if (!relative || !anchor) return { ok: false, reason: 'relative position requires an established anchor' };
  if (!locationNameGrounded(anchor.name, evidence, exchangeById)) {
    return { ok: false, reason: 'relative anchor name is not grounded in accepted narration' };
  }
  if (!directionGroundedInNarration(relative.direction, evidence, exchangeById)) {
    return { ok: false, reason: 'relative direction is not grounded in accepted narration' };
  }

  const hasDistance = Number.isFinite(relative.distanceKm);
  const distanceGrounded = hasDistance && distanceGroundedInNarration(relative.distanceKm, evidence, exchangeById);
  const distanceKm = distanceGrounded ? relative.distanceKm : null;
  const distanceMode = distanceGrounded ? distanceModeFor(relative.distanceMode, distanceKm, evidence, exchangeById) : 'unspecified';

  return {
    ok: true,
    relative: {
      ...relative,
      direction: canonicalDirection(relative.direction),
      distanceKm,
      distanceMode,
    },
    mayDeriveStraight: Boolean(distanceGrounded && distanceKm > 0 && distanceMode === 'straight_line'),
  };
}

function cleanHeaderText(value, max = 240) {
  return String(value || '')
    .replace(/[*_]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// A coordinate written beside the name ("Old Mill [12, 4]", "Old Mill — x=12, y=4") is not part of it.
function headerPlaceName(value) {
  let name = String(value || '');
  for (const form of COORDINATE_FORMS) name = name.replace(form, ' ');
  return cleanHeaderText(name).replace(/(?:\s*(?:[@—–,;:|-]|\bat\b))+\s*$/iu, '').trim();
}

function uniqueCoordinates(coords, tolerance = 1e-9) {
  const out = [];
  for (const coord of coords || []) {
    if (!Number.isFinite(coord?.x) || !Number.isFinite(coord?.y)) continue;
    if (out.some(item => Math.abs(item.x - coord.x) <= tolerance && Math.abs(item.y - coord.y) <= tolerance)) continue;
    out.push(coord);
  }
  return out;
}

function explicitWorldStateLocationHeaders(exchangeById) {
  const headers = [];
  for (const source of exchangeById.values()) {
    if (!source?.text || source.role === 'system') continue;
    const blocks = source.text.matchAll(/<World_State(?:\s+[^>]*)?>([\s\S]*?)(?:<\/World_State>|$)/gi);
    for (const blockMatch of blocks) {
      const body = blockMatch[1] || '';
      for (const rawLine of body.split(/\r?\n/)) {
        if (!/\bLoc(?:ation)?\s*:/i.test(rawLine)) continue;
        if (/\b(?:Planted Seeds|Consequence Timers|Arc Phase|Scene Phase)\b/i.test(rawLine)) continue;

        const parts = rawLine.split('|').map(part => part.trim()).filter(Boolean);
        const locIndex = parts.findIndex(part => /\bLoc(?:ation)?\s*:/i.test(part));
        if (locIndex < 0) continue;
        const locPart = parts[locIndex];
        const locMatch = locPart.match(/\bLoc(?:ation)?\s*:\s*(?:\*\*)?\s*(.+)$/i);
        const name = headerPlaceName(locMatch?.[1] || '');
        if (!name || isGenericScenery(name)) continue;

        const contextParts = [];
        for (const part of parts.slice(locIndex + 1)) {
          if (extractExplicitCoordinatesFromText(part).length) break;
          if (/\b(?:Wx|Weather|Temp(?:erature)?|Time)\s*:/i.test(part)) break;
          const clean = cleanHeaderText(part, 160);
          if (clean) contextParts.push(clean);
          if (contextParts.length >= 2) break;
        }

        const coords = uniqueCoordinates(extractExplicitCoordinatesFromText(rawLine));
        headers.push({
          sourceMessageId: source.messageId,
          lineageKey: source.lineageKey,
          name,
          context: cleanHeaderText(contextParts.join(' | '), 320),
          coordinate: coords.length === 1
            ? { x: coords[0].x, y: coords[0].y, authority: 'narrative_explicit', locked: false }
            : null,
          ambiguousCoordinate: coords.length > 1,
          claim: String(rawLine).trim().slice(0, 500),
        });
      }
    }
  }
  return headers.slice(0, 4);
}

// The model's row number of a proposal (none for a row the header supplement added).
function rowOf(proposal) {
  return Number.isInteger(proposal?.__row) ? { index: proposal.__row } : {};
}

function supplementExplicitWorldStateHeaders(modelMutations, exchangeById) {
  const mutations = (modelMutations || []).map(item => structuredClone(item));
  const rejected = [];
  const suppressed = new Set();
  let added = 0;

  for (const header of explicitWorldStateLocationHeaders(exchangeById)) {
    const matches = [];
    for (let index = 0; index < mutations.length; index += 1) {
      const proposal = mutations[index];
      if (proposal?.action === 'upsert_location' && norm(proposal.name) === norm(header.name)) matches.push(index);
    }

    if (header.ambiguousCoordinate || matches.length > 1) {
      for (const index of matches) suppressed.add(index);
      rejected.push({
        stage: 'spatial-deterministic-header',
        ...rowOf(matches.length === 1 ? mutations[matches[0]] : null),
        reason: header.ambiguousCoordinate
          ? 'explicit current-location header contains conflicting coordinate pairs'
          : 'explicit current-location header matches multiple model location proposals',
        sourceMessageId: header.sourceMessageId,
      });
      continue;
    }

    if (matches.length === 1) {
      const index = matches[0];
      const proposal = mutations[index];
      if (header.coordinate && coordKnown(proposal.coordinate)) {
        const current = normalizeCoordinate(proposal.coordinate);
        if (Math.abs(current.x - header.coordinate.x) > 1e-9 || Math.abs(current.y - header.coordinate.y) > 1e-9) {
          suppressed.add(index);
          rejected.push({
            stage: 'spatial-deterministic-header',
            ...rowOf(proposal),
            reason: 'model coordinate conflicts with explicit current-location header',
            sourceMessageId: header.sourceMessageId,
          });
          continue;
        }
      }
      if (header.coordinate && !coordKnown(proposal.coordinate)) {
        proposal.coordinate = header.coordinate;
        proposal.admissionReason = 'explicit_coordinate';
      }
      if (!proposal.context && header.context) proposal.context = header.context;
      if (!(proposal.evidence || []).some(item => item.sourceMessageId === header.sourceMessageId && item.claim === header.claim)) {
        proposal.evidence = [...(proposal.evidence || []), { sourceMessageId: header.sourceMessageId, claim: header.claim }].slice(0, 4);
      }
      continue;
    }

    // Only what the header establishes: an existing place keeps its type, context and notes.
    mutations.push({
      action: 'upsert_location',
      name: header.name,
      ...(header.context ? { context: header.context } : {}),
      coordinate: header.coordinate,
      admissionReason: header.coordinate ? 'explicit_coordinate' : 'explicit_position',
      evidence: [{ sourceMessageId: header.sourceMessageId, claim: header.claim }],
    });
    added += 1;
  }

  return { mutations: mutations.filter((_item, index) => !suppressed.has(index)), rejected, added };
}
export function processSpatialCapture({
  rawSpatialMutations = [],
  spatial,
  exchange = [],
  visibleLocations = [],
  baseMap = null,
  profile = null,
  chatKey = '',
  sourceMessageId,
  sourceLineageKey = '',
  operation = 'capture',
  evidenceSourceClass = '',
} = {}) {
  const wire = validateSpatialEnvelope(rawSpatialMutations);
  const exchangeById = captureExchangeIndex(exchange);
  const supplemented = supplementExplicitWorldStateHeaders(
    wire.mutations.map((item, at) => ({ ...item, __row: wire.rowIndexes[at] })),
    exchangeById,
  );
  const rejected = [
    ...wire.rejected.map(item => ({ stage: 'spatial-wire', ...item })),
    ...supplemented.rejected,
  ];
  const accepted = [];
  const visibleById = new Map((Array.isArray(visibleLocations) ? visibleLocations : []).map(item => [item.id, item]));
  // Base-map places named by the narration but outside the visible set (looked up by name, never scanned).
  const namedBase = [];
  const activeProfile = baseMap ? resolveSpatialProfile(spatial, baseMap) : (profile || resolveSpatialProfile(spatial));

  for (let index = 0; index < supplemented.mutations.length; index += 1) {
    const proposal = structuredClone(supplemented.mutations[index]);
    const rowIndex = Number.isInteger(proposal.__row) ? proposal.__row : undefined;
    delete proposal.__row;
    const grounded = groundEvidence(proposal.evidence, exchangeById, evidenceSourceClass);
    if (!grounded.ok) {
      rejected.push({ stage: 'spatial-source-firewall', index: rowIndex, reason: grounded.reason });
      continue;
    }
    proposal.evidence = grounded.evidence;

    if (proposal.action === 'upsert_location') {
      const isUpdate = Boolean(proposal.locationId);
      if (isUpdate && !visibleById.has(proposal.locationId)) {
        rejected.push({ stage: 'spatial-source-firewall', index: rowIndex, reason: 'spatial update target was not in bounded visible context' });
        continue;
      }

      const durableAdmission = new Set([
        'explicit_position',
        'explicit_coordinate',
        'revisited',
        'persistent_feature',
        'route_landmark',
        'material_event',
      ]).has(String(proposal.admissionReason || ''));

      if (isGenericScenery(proposal.name) && !durableAdmission) {
        rejected.push({ stage: 'spatial-admission', index: rowIndex, reason: 'generic scenery requires independent persistence/position evidence' });
        continue;
      }

      if (!isUpdate && !locationNameGrounded(proposal.name, proposal.evidence, exchangeById)) {
        rejected.push({ stage: 'spatial-admission', index: rowIndex, reason: 'generated location name is not grounded in accepted narration' });
        continue;
      }
      if (!isUpdate && placeEvidenceHypothetical(proposal.evidence, exchangeById)) {
        rejected.push({ stage: 'spatial-admission', index: rowIndex, reason: 'a hypothetical or proposed place is not current geography' });
        continue;
      }
      // An update may rename a place only to a name the narration actually uses; otherwise it keeps its name.
      if (isUpdate) {
        const known = visibleById.get(proposal.locationId);
        if (known?.name && norm(known.name) !== norm(proposal.name)
          && !locationNameGrounded(proposal.name, proposal.evidence, exchangeById)) {
          proposal.name = known.name;
        }
      }

      if (!isUpdate) {
        const nameKey = norm(proposal.name);
        const visibleMatch = [...visibleById.values()].find(item => norm(item?.name) === nameKey);
        if (visibleMatch?.id) proposal.locationId = visibleMatch.id;
        // A base-map place outside the visible set is that place, not a new campaign one (a campaign place
        // of the same name is matched by the reducer).
        const base = !visibleMatch && baseMap && !(spatial?.locations || []).some(item => item.status === 'active' && norm(item.name) === nameKey)
          ? baseLocationByName(baseMap, proposal.name)
          : null;
        if (base?.ambiguous) {
          rejected.push({ stage: 'spatial-admission', index: rowIndex, reason: 'place name matches more than one base-map place' });
          continue;
        }
        const effective = base ? resolveEffectiveLocations(spatial, baseMap, { onlyIds: new Set([base.id]) })[0] : null;
        // An archived or merged override is a place the operator retired: narration never updates it.
        if (effective?.id && (effective.status || 'active') === 'active') {
          visibleById.set(effective.id, effective);
          namedBase.push(effective);
          proposal.locationId = effective.id;
        }
      }

      const targetIsUpdate = Boolean(proposal.locationId);

      // Check Coordinate Firewall
      let finalCoord = null;
      let coordGrounded = false;

      if (proposal.coordinate && coordKnown(proposal.coordinate)) {
        const normCoord = normalizeCoordinate(proposal.coordinate);
        // Automatic coordinate firewall: narrative_explicit only if accepted source text explicitly contains matching x/y.
        // Grounding is checked first: an invented coordinate is simply dropped and never costs the place itself;
        // only a narrated coordinate outside the profile bounds rejects the proposal.
        const narrated = placeEvidenceHypothetical(proposal.evidence, exchangeById)
          ? null
          : narratedCoordinateFor(normCoord, proposal.evidence, exchangeById, activeProfile?.decimalStep, proposal.name);
        coordGrounded = Boolean(narrated);
        if (coordGrounded && activeProfile?.bounds && !validateBounds(narrated.x, narrated.y, activeProfile.bounds)) {
          rejected.push({ stage: 'spatial-coordinate', index: rowIndex, reason: 'explicit coordinate is outside profile bounds' });
          continue;
        }
        if (coordGrounded) {
          finalCoord = {
            x: narrated.x,
            y: narrated.y,
            authority: 'narrative_explicit',
            locked: false,
          };
        } else {
          // Fabricated coordinate proposed by LLM without text evidence
          // Do not accept raw coordinate
          finalCoord = null;
        }
      }

      // Check relative derivation if applicable. A bad optional relation must
      // not erase an otherwise grounded proper named place; retain the place
      // with unknown position while dropping only unsupported precision.
      if (proposal.relative) {
        const anchor = visibleById.get(proposal.relative.toLocationId);
        let groundedRelative = null;

        if (!anchor) {
          rejected.push({
            stage: 'spatial-relative',
            index: rowIndex,
            reason: 'unsupported relative relation dropped; named location retained when admissible: anchor was not in bounded visible spatial context',
          });
        } else {
          const checkedRelative = groundRelativeProposal(
            proposal.relative,
            anchor,
            proposal.evidence,
            exchangeById,
          );
          if (!checkedRelative.ok) {
            rejected.push({
              stage: 'spatial-relative',
              index: rowIndex,
              reason: 'unsupported relative relation dropped; named location retained when admissible: ' + checkedRelative.reason,
            });
          } else {
            groundedRelative = checkedRelative;
          }
        }

        if (!groundedRelative) {
          if (isGenericScenery(proposal.name)) continue;
          proposal.relative = null;
        } else {
          proposal.relative = groundedRelative.relative;

          // Deterministic derived coordinate computed in code ONLY from a
          // grounded anchor + direction + admissible straight/direct distance.
          if (!finalCoord && activeProfile && coordKnown(anchor.coordinate) && groundedRelative.mayDeriveStraight) {
            const derived = deriveCoordinate(anchor.coordinate, {
              direction: proposal.relative.direction,
              distanceKm: proposal.relative.distanceKm,
              distanceMode: proposal.relative.distanceMode,
              unitKm: activeProfile.unitKm,
              decimalStep: activeProfile.decimalStep,
              bounds: activeProfile.bounds,
              northAxis: activeProfile.northAxis,
              eastAxis: activeProfile.eastAxis,
            });
            if (derived) finalCoord = derived;
          }

          if (!finalCoord) {
            finalCoord = { x: null, y: null, authority: 'relative', locked: false };
          }

          // True North Lock verification
          if (coordKnown(finalCoord) && coordKnown(anchor.coordinate) && activeProfile?.trueNorthLocked === true) {
            const actual = directionFromDelta(
              finalCoord.x - anchor.coordinate.x,
              finalCoord.y - anchor.coordinate.y,
              activeProfile,
            );
            if (actual && !directionsCompatible(proposal.relative.direction, actual)) {
              rejected.push({
                stage: 'spatial-true-north',
                index: rowIndex,
                reason: 'relative direction conflicts with coordinate delta under locked True North',
              });
              continue;
            }
          }

          accepted.push({
            action: 'upsert_relation',
            fromId: proposal.relative.toLocationId,
            toId: proposal.locationId || '',
            direction: proposal.relative.direction,
            distanceKm: proposal.relative.distanceKm,
            distanceMode: proposal.relative.distanceMode,
            notes: '',
            evidence: proposal.evidence,
            __deferredTargetName: proposal.locationId ? '' : proposal.name,
          });
        }
      }

      if (!finalCoord) {
        if (proposal.coordinate && coordKnown(proposal.coordinate) && !coordGrounded && !targetIsUpdate) {
          // If the model tried to propose a coordinate with no relative fallback, assign unknown authority
          finalCoord = { x: null, y: null, authority: 'unknown', locked: false };
        } else if (!targetIsUpdate) {
          finalCoord = { x: null, y: null, authority: 'unknown', locked: false };
        }
      }

      proposal.coordinate = finalCoord;

      accepted.push(proposal);
      continue;
    }

    if (proposal.action === 'upsert_relation') {
      if (!visibleById.has(proposal.fromId) || !visibleById.has(proposal.toId)) {
        rejected.push({ stage: 'spatial-source-firewall', index: rowIndex, reason: 'relation endpoints must be visible established locations' });
        continue;
      }
      const from = visibleById.get(proposal.fromId);
      const to = visibleById.get(proposal.toId);
      const groundedRelation = groundDirectRelationProposal(proposal, from, to, proposal.evidence, exchangeById);
      if (!groundedRelation.ok) {
        rejected.push({ stage: 'spatial-relation-grounding', index: rowIndex, reason: groundedRelation.reason });
        continue;
      }
      const groundedProposal = groundedRelation.proposal;
      if (groundedProposal.direction && coordKnown(from.coordinate) && coordKnown(to.coordinate) && activeProfile?.trueNorthLocked === true) {
        const actual = directionFromDelta(
          to.coordinate.x - from.coordinate.x,
          to.coordinate.y - from.coordinate.y,
          activeProfile,
        );
        if (actual && !directionsCompatible(groundedProposal.direction, actual)) {
          rejected.push({ stage: 'spatial-true-north', index: rowIndex, reason: 'relation direction conflicts with authoritative coordinate delta' });
          continue;
        }
      }
      accepted.push(groundedProposal);
      continue;
    }

    if (proposal.action === 'upsert_route') {
      if (isGenericScenery(proposal.name)) {
        rejected.push({ stage: 'spatial-admission', index: rowIndex, reason: 'cannot capture generic unnamed route' });
        continue;
      }
      if (!locationNameGrounded(proposal.name, proposal.evidence, exchangeById)) {
        rejected.push({ stage: 'spatial-source-firewall', index: rowIndex, reason: 'route name is not grounded in accepted narration' });
        continue;
      }
      if ((proposal.endpoints || []).some(id => !visibleById.has(id))) {
        rejected.push({ stage: 'spatial-source-firewall', index: rowIndex, reason: 'route endpoints must be visible established locations' });
        continue;
      }
      accepted.push(proposal);
    }
  }

  // Create/update locations before relations so a newly created relation can resolve the generated ID.
  // A pass with nothing to apply is skipped: with no proposals at all the caller's (private) Spatial state is
  // returned as it is, rather than copied and diffed twice.
  const locationMutations = accepted.filter(item => item.action === 'upsert_location');
  const otherMutations = accepted.filter(item => item.action !== 'upsert_location' && !item.__deferredTargetName);
  const unchanged = input => ({
    spatial: input && typeof input === 'object' && Array.isArray(input.locations) ? input : normalizeSpatialState(input),
    applied: [],
    rejected: [],
    indexDelta: {},
  });
  const reducedLocations = !locationMutations.length ? unchanged(spatial) : reduceSpatialMutations(spatial, {
    chatKey,
    messageId: sourceMessageId,
    lineageKey: sourceLineageKey,
    operation,
    mutations: locationMutations,
  }, baseMap, { visibleLocations: [...visibleLocations, ...namedBase] });

  // A relative relation names its new place: link it to the place that name was saved as, whether it was
  // created now or matched an existing same-name place outside the visible set.
  const savedNameToId = new Map();
  for (const item of reducedLocations.applied || []) {
    if (item.action !== 'create_location' && item.action !== 'update_location') continue;
    const loc = reducedLocations.spatial.locations.find(candidate => candidate.id === item.locationId);
    if (loc) savedNameToId.set(norm(loc.name), effectiveLocationId(loc, baseMap, reducedLocations.spatial));
  }

  for (const deferred of accepted.filter(item => item.__deferredTargetName)) {
    const targetId = savedNameToId.get(norm(deferred.__deferredTargetName));
    if (targetId) otherMutations.push({ ...deferred, toId: targetId, __deferredTargetName: undefined });
    else rejected.push({ stage: 'spatial-relative', reason: 'relative relation dropped: its place was not saved' });
  }

  const reducedOther = !otherMutations.length ? unchanged(reducedLocations.spatial) : reduceSpatialMutations(reducedLocations.spatial, {
    chatKey,
    messageId: sourceMessageId,
    lineageKey: sourceLineageKey,
    operation,
    mutations: otherMutations,
  }, baseMap, {
    visibleLocations: [
      ...visibleLocations,
      ...namedBase,
      ...(reducedLocations.spatial.locations || []),
    ],
  });

  for (const item of reducedLocations.rejected || []) rejected.push({ stage: 'spatial-reducer', reason: item.reason });
  for (const item of reducedOther.rejected || []) rejected.push({ stage: 'spatial-reducer', reason: item.reason });

  // (The reducer already records lastCaptureMessage for an applied capture.)
  const next = reducedOther.spatial;

  return {
    spatial: next,
    applied: [...reducedLocations.applied, ...reducedOther.applied],
    rejected,
    proposedCount: (Array.isArray(rawSpatialMutations) ? rawSpatialMutations.length : 0) + supplemented.added,
    acceptedCount: accepted.length,
    indexDelta: {
      changedLocationIds: [
        ...(reducedLocations.indexDelta?.changedLocationIds || []),
        ...(reducedOther.indexDelta?.changedLocationIds || []),
      ],
      upsertedLocations: [
        ...(reducedLocations.indexDelta?.upsertedLocations || []),
        ...(reducedOther.indexDelta?.upsertedLocations || []),
      ],
      removedLocationIds: [
        ...(reducedLocations.indexDelta?.removedLocationIds || []),
        ...(reducedOther.indexDelta?.removedLocationIds || []),
      ],
      upsertedRelations: [
        ...(reducedLocations.indexDelta?.upsertedRelations || []),
        ...(reducedOther.indexDelta?.upsertedRelations || []),
      ],
      removedRelationIds: [
        ...(reducedLocations.indexDelta?.removedRelationIds || []),
        ...(reducedOther.indexDelta?.removedRelationIds || []),
      ],
      upsertedRoutes: [
        ...(reducedLocations.indexDelta?.upsertedRoutes || []),
        ...(reducedOther.indexDelta?.upsertedRoutes || []),
      ],
      removedRouteIds: [
        ...(reducedLocations.indexDelta?.removedRouteIds || []),
        ...(reducedOther.indexDelta?.removedRouteIds || []),
      ],
      relationsChanged: Boolean(reducedLocations.indexDelta?.relationsChanged || reducedOther.indexDelta?.relationsChanged),
      routesChanged: Boolean(reducedLocations.indexDelta?.routesChanged || reducedOther.indexDelta?.routesChanged),
    },
  };
}

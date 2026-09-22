import { captureExchangeIndex, evidenceClaimGrounded } from './source-firewall.js';
import {
  authorityRank,
  deriveCoordinate,
  directionFromDelta,
  normalizeCoordinate,
  reduceSpatialMutations,
  validateBounds,
} from './spatial-core.js';
import { validateSpatialEnvelope } from './spatial-wire.js';

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

function norm(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericScenery(name) {
  const n = norm(name);
  if (!n || n.length < 2) return true;
  return GENERIC_SCENERY.has(n);
}

function locationNameGrounded(name, evidence, exchangeById) {
  const needle = norm(name);
  if (!needle) return false;
  for (const item of evidence || []) {
    const source = exchangeById.get(item.sourceMessageId);
    if (!source) continue;
    const haystack = norm(source.text);
    if (needle.length >= 2 && haystack.includes(needle)) return true;
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
  const a = String(stated || '').trim().toLowerCase();
  const b = String(actual || '').trim().toLowerCase();
  const aliases = {
    n: 'north', s: 'south', e: 'east', w: 'west',
    ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
  };
  return (aliases[a] || a) === (aliases[b] || b);
}

function extractExplicitCoordinatesFromText(text) {
  const coords = [];
  if (typeof text !== 'string') return coords;

  // Form 1: [x, y]
  const bracketMatches = text.matchAll(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g);
  for (const match of bracketMatches) {
    coords.push({ x: Number(match[1]), y: Number(match[2]) });
  }

  // Form 2: (x, y)
  const parenMatches = text.matchAll(/\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/g);
  for (const match of parenMatches) {
    coords.push({ x: Number(match[1]), y: Number(match[2]) });
  }

  // Form 3: x=12.4, y=45.0 or x: 12.4, y: 45.0
  const namedMatches = text.matchAll(/x\s*[:=]\s*(-?\d+(?:\.\d+)?)[,\s]+y\s*[:=]\s*(-?\d+(?:\.\d+)?)/gi);
  for (const match of namedMatches) {
    coords.push({ x: Number(match[1]), y: Number(match[2]) });
  }

  return coords;
}

function isCoordinateGroundedInNarration(coord, evidence, exchangeById, decimalStep = 0.1) {
  if (!coordKnown(coord)) return false;
  const tolerance = Math.max(0.1, decimalStep || 0.1);

  for (const item of evidence || []) {
    const source = exchangeById.get(item.sourceMessageId);
    if (!source) continue;
    const explicitList = extractExplicitCoordinatesFromText(source.text);
    for (const exp of explicitList) {
      if (Math.abs(exp.x - coord.x) <= tolerance && Math.abs(exp.y - coord.y) <= tolerance) {
        return true;
      }
    }
  }
  return false;
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

function canonicalDirection(value) {
  const raw = String(value || '').trim().toLowerCase();
  const aliases = {
    n: 'north', s: 'south', e: 'east', w: 'west',
    ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
  };
  return aliases[raw] || raw;
}

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

function routeTravelLanguageGrounded(evidence, exchangeById) {
  for (const text of evidenceSourceTexts(evidence, exchangeById)) {
    const normalized = norm(text);
    if (/\b(?:road|route|trail|path|river|sea|sail|sailing|travel|travelled|traveled|journey|along)\b/u.test(normalized)) {
      return true;
    }
  }
  return false;
}

function straightDistanceLanguageGrounded(evidence, exchangeById) {
  for (const text of evidenceSourceTexts(evidence, exchangeById)) {
    const normalized = norm(text);
    if (/\b(?:straight line|straightline|direct distance|as the crow flies)\b/u.test(normalized)) {
      return true;
    }
  }
  return false;
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
  const routeTravel = routeTravelLanguageGrounded(evidence, exchangeById);
  const straightExplicit = straightDistanceLanguageGrounded(evidence, exchangeById);

  let distanceKm = distanceGrounded ? relative.distanceKm : null;
  let distanceMode = relative.distanceMode;

  if (!distanceGrounded) {
    distanceMode = 'unspecified';
  } else if (routeTravel && !straightExplicit) {
    // A route/road/river/sea travel length is useful relational context, but
    // it is not Cartesian displacement.
    distanceMode = 'route';
  }

  return {
    ok: true,
    relative: {
      ...relative,
      direction: canonicalDirection(relative.direction),
      distanceKm,
      distanceMode,
    },
    mayDeriveStraight: Boolean(
      distanceGrounded
      && distanceKm > 0
      && distanceMode === 'straight_line'
      && (!routeTravel || straightExplicit)
    ),
  };
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
  const rejected = wire.rejected.map(item => ({ stage: 'spatial-wire', ...item }));
  const accepted = [];
  const exchangeById = captureExchangeIndex(exchange);
  const visibleById = new Map((Array.isArray(visibleLocations) ? visibleLocations : []).map(item => [item.id, item]));
  const activeProfile = profile || spatial?.profile || baseMap?.profile || null;

  for (let index = 0; index < wire.mutations.length; index += 1) {
    const proposal = structuredClone(wire.mutations[index]);
    const grounded = groundEvidence(proposal.evidence, exchangeById, evidenceSourceClass);
    if (!grounded.ok) {
      rejected.push({ stage: 'spatial-source-firewall', index, reason: grounded.reason });
      continue;
    }
    proposal.evidence = grounded.evidence;

    if (proposal.action === 'upsert_location') {
      const isUpdate = Boolean(proposal.locationId);
      if (isUpdate && !visibleById.has(proposal.locationId)) {
        rejected.push({ stage: 'spatial-source-firewall', index, reason: 'spatial update target was not in bounded visible context' });
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
        rejected.push({ stage: 'spatial-admission', index, reason: 'generic scenery requires independent persistence/position evidence' });
        continue;
      }

      if (!isUpdate && !locationNameGrounded(proposal.name, proposal.evidence, exchangeById)) {
        rejected.push({ stage: 'spatial-admission', index, reason: 'generated location name is not grounded in accepted narration' });
        continue;
      }

      if (!isUpdate) {
        const nameKey = norm(proposal.name);
        const visibleMatch = [...visibleById.values()].find(item => norm(item?.name) === nameKey);
        if (visibleMatch?.id) proposal.locationId = visibleMatch.id;
      }

      const targetIsUpdate = Boolean(proposal.locationId);

      // Check Coordinate Firewall
      let finalCoord = null;
      let coordGrounded = false;

      if (proposal.coordinate && coordKnown(proposal.coordinate)) {
        const normCoord = normalizeCoordinate(proposal.coordinate);
        if (activeProfile?.bounds && !validateBounds(normCoord.x, normCoord.y, activeProfile.bounds)) {
          rejected.push({ stage: 'spatial-coordinate', index, reason: 'explicit coordinate is outside profile bounds' });
          continue;
        }

        // Automatic coordinate firewall: narrative_explicit only if accepted source text explicitly contains matching x/y
        coordGrounded = isCoordinateGroundedInNarration(normCoord, proposal.evidence, exchangeById, activeProfile?.decimalStep);
        if (coordGrounded) {
          finalCoord = {
            x: normCoord.x,
            y: normCoord.y,
            authority: 'narrative_explicit',
            locked: false,
          };
        } else {
          // Fabricated coordinate proposed by LLM without text evidence
          // Do not accept raw coordinate
          finalCoord = null;
        }
      }

      // Check relative derivation if applicable
      if (proposal.relative) {
        const anchor = visibleById.get(proposal.relative.toLocationId);
        if (!anchor) {
          rejected.push({ stage: 'spatial-relative', index, reason: 'relative anchor was not in bounded visible spatial context' });
          continue;
        }

        const groundedRelative = groundRelativeProposal(
          proposal.relative,
          anchor,
          proposal.evidence,
          exchangeById,
        );
        if (!groundedRelative.ok) {
          rejected.push({ stage: 'spatial-relative', index, reason: groundedRelative.reason });
          continue;
        }
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
              index,
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
        rejected.push({ stage: 'spatial-source-firewall', index, reason: 'relation endpoints must be visible established locations' });
        continue;
      }
      const from = visibleById.get(proposal.fromId);
      const to = visibleById.get(proposal.toId);
      if (proposal.direction && coordKnown(from.coordinate) && coordKnown(to.coordinate) && activeProfile?.trueNorthLocked === true) {
        const actual = directionFromDelta(
          to.coordinate.x - from.coordinate.x,
          to.coordinate.y - from.coordinate.y,
          activeProfile,
        );
        if (actual && !directionsCompatible(proposal.direction, actual)) {
          rejected.push({ stage: 'spatial-true-north', index, reason: 'relation direction conflicts with authoritative coordinate delta' });
          continue;
        }
      }
      accepted.push(proposal);
      continue;
    }

    if (proposal.action === 'upsert_route') {
      if (isGenericScenery(proposal.name)) {
        rejected.push({ stage: 'spatial-admission', index, reason: 'cannot capture generic unnamed route' });
        continue;
      }
      if (!locationNameGrounded(proposal.name, proposal.evidence, exchangeById)) {
        rejected.push({ stage: 'spatial-source-firewall', index, reason: 'route name is not grounded in accepted narration' });
        continue;
      }
      if ((proposal.endpoints || []).some(id => !visibleById.has(id))) {
        rejected.push({ stage: 'spatial-source-firewall', index, reason: 'route endpoints must be visible established locations' });
        continue;
      }
      accepted.push(proposal);
    }
  }

  // Create/update locations before relations so a newly created relation can resolve the generated ID
  const locationMutations = accepted.filter(item => item.action === 'upsert_location');
  const otherMutations = accepted.filter(item => item.action !== 'upsert_location' && !item.__deferredTargetName);
  const reducedLocations = reduceSpatialMutations(spatial, {
    chatKey,
    messageId: sourceMessageId,
    lineageKey: sourceLineageKey,
    operation,
    mutations: locationMutations,
  }, baseMap, { visibleLocations });

  const createdNameToId = new Map();
  for (const item of reducedLocations.applied || []) {
    if (item.action === 'create_location') {
      const loc = reducedLocations.spatial.locations.find(candidate => candidate.id === item.locationId);
      if (loc) createdNameToId.set(norm(loc.name), loc.id);
    }
  }

  for (const deferred of accepted.filter(item => item.__deferredTargetName)) {
    const targetId = createdNameToId.get(norm(deferred.__deferredTargetName));
    if (targetId) otherMutations.push({ ...deferred, toId: targetId, __deferredTargetName: undefined });
  }

  const reducedOther = reduceSpatialMutations(reducedLocations.spatial, {
    chatKey,
    messageId: sourceMessageId,
    lineageKey: sourceLineageKey,
    operation,
    mutations: otherMutations,
  }, baseMap, {
    visibleLocations: [
      ...visibleLocations,
      ...(reducedLocations.spatial.locations || []),
    ],
  });

  for (const item of reducedLocations.rejected || []) rejected.push({ stage: 'spatial-reducer', reason: item.reason });
  for (const item of reducedOther.rejected || []) rejected.push({ stage: 'spatial-reducer', reason: item.reason });

  const next = reducedOther.spatial;
  if ((reducedLocations.applied.length + reducedOther.applied.length) > 0 && operation === 'capture') {
    next.lastCaptureMessage = sourceMessageId;
  }

  return {
    spatial: next,
    applied: [...reducedLocations.applied, ...reducedOther.applied],
    rejected,
    proposedCount: Array.isArray(rawSpatialMutations) ? rawSpatialMutations.length : 0,
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

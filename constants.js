export const SCHEMA_VERSION = 2;
export const SIDECAR_FORMAT = 'world_state_alpha_chat_data';
export const SIDECAR_FORMAT_VERSION = 1;
export const BUNDLE_FORMAT = 'world_state_alpha_bundle';
export const BUNDLE_VERSION = 1;
export const ROLLBACK_JOURNAL_VERSION = 1;

export const RECORD_KINDS = Object.freeze(['fact', 'development']);
export const RECORD_STATUSES = Object.freeze(['active', 'resolved', 'superseded']);
export const RECORD_TRENDS = Object.freeze(['emerging', 'rising', 'stable', 'falling', 'uncertain']);
export const MUTATION_ACTIONS = Object.freeze(['create', 'update', 'resolve', 'supersede', 'noop']);
export const EVIDENCE_SOURCE_CLASSES = Object.freeze([
  'user_narration',
  'assistant_narration',
  'recent_history',
  'elapsed_hint',
  'lore_baseline',
  'manual',
  'rebuild',
  'foreign_import',
]);

export const SPATIAL_AUTHORITIES = Object.freeze([
  'manual',
  'campaign_override',
  'base_canonical',
  'narrative_explicit',
  'derived',
  'relative',
  'unknown',
]);

export const SPATIAL_LOCATION_STATUSES = Object.freeze(['active', 'archived']);
export const SPATIAL_DISTANCE_MODES = Object.freeze(['straight_line', 'route', 'unspecified']);
export const SPATIAL_ADMISSION_REASONS = Object.freeze([
  'named',
  'explicit_position',
  'explicit_coordinate',
  'revisited',
  'persistent_feature',
  'route_landmark',
  'material_event',
]);

export const LIMITS = Object.freeze({
  summaryChars: 700,
  claimChars: 500,
  anchorChars: 120,
  anchorsPerRecord: 20,
  evidenceRefsPerRecord: 32,
  linksPerRecord: 20,
  rollbackEntries: 256,
  checkpoints: 48,
  storageAttempts: 4,
});

export const SPATIAL_LIMITS = Object.freeze({
  nameChars: 120,
  typeChars: 60,
  contextChars: 600,
  notesChars: 400,
  routeRefsPerLocation: 16,
  evidenceRefsPerLocation: 32,
  candidateCap: 64,
  maxLocations: 5000,
  defaultDecimalStep: 0.1,
  promptBudgetTokens: 500,
  maxSelectedLocations: 6,
});

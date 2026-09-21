export const SCHEMA_VERSION = 1;
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

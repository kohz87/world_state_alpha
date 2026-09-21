import fs from 'node:fs';

fs.mkdirSync('dist', { recursive: true });
const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
const payload = {
  status: 'phase7-coexistence-host',
  coreImplemented: true,
  captureImplemented: true,
  relevanceImplemented: true,
  injectionImplemented: true,
  elapsedEvidenceImplemented: true,
  evolutionImplemented: true,
  lazyCatchupImplemented: true,
  manualControlsImplemented: true,
  transferUxImplemented: true,
  rebuildImplemented: true,
  uiImplemented: true,
  evidenceInspectionImplemented: true,
  runtimeImplemented: true,
  hostIntegrated: true,
  coexistenceHardened: true,
  generatedAt: new Date().toISOString(),
  modules: inventory.modules,
  hostEntrypoint: inventory.hostEntrypoint,
  hostFiles: inventory.hostFiles || [],
  assets: inventory.assets || [],
  authorities: [
    'AGENTS.md',
    'WORKFLOW.md',
    'docs/core-contract.md',
    'docs/ARCHITECTURE.md',
    'docs/DATA_MODEL.md',
    'docs/WORKPLAN.md',
    'docs/TEST_PLAN.md',
    'docs/RISK_REGISTER.md'
  ]
};
fs.writeFileSync('dist/world_state_alpha-phase7.json', JSON.stringify(payload, null, 2));
console.log('Wrote dist/world_state_alpha-phase7.json');

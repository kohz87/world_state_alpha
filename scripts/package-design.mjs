import fs from 'node:fs';

fs.mkdirSync('dist', { recursive: true });
const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
const payload = {
  status: 'phase4-lazy-evolution',
  coreImplemented: true,
  captureImplemented: true,
  relevanceImplemented: true,
  injectionImplemented: true,
  elapsedEvidenceImplemented: true,
  evolutionImplemented: true,
  lazyCatchupImplemented: true,
  runtimeImplemented: false,
  hostIntegrated: false,
  generatedAt: new Date().toISOString(),
  modules: inventory.modules,
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
fs.writeFileSync('dist/world_state_alpha-phase4.json', JSON.stringify(payload, null, 2));
console.log('Wrote dist/world_state_alpha-phase4.json');

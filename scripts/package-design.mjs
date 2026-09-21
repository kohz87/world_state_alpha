import fs from 'node:fs';

fs.mkdirSync('dist', { recursive: true });
const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
const payload = {
  status: 'phase2-capture',
  coreImplemented: true,
  captureImplemented: true,
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
fs.writeFileSync('dist/world_state_alpha-phase2.json', JSON.stringify(payload, null, 2));
console.log('Wrote dist/world_state_alpha-phase2.json');

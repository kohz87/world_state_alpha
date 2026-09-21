import fs from 'node:fs';

fs.mkdirSync('dist', { recursive: true });
const payload = {
  status: 'design-only',
  runtimeImplemented: false,
  generatedAt: new Date().toISOString(),
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
fs.writeFileSync('dist/world_state_alpha-design.json', JSON.stringify(payload, null, 2));
console.log('Wrote dist/world_state_alpha-design.json');

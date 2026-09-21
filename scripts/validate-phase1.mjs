import fs from 'node:fs';

const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
const required = [
  'constants.js',
  'hash.js',
  'state-core.js',
  'branch.js',
  'storage.js',
  'transfer.js',
];

for (const file of required) {
  if (!inventory.modules.includes(file)) throw new Error(`Phase 1 module missing from runtime inventory: ${file}`);
  if (!fs.existsSync(file)) throw new Error(`missing Phase 1 module: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  if (/from\s+['"]node:|require\(['"]node:/.test(text)) throw new Error(`browser runtime module imports Node-only API: ${file}`);
  if (/"scope"\s*:/.test(text)) throw new Error(`runtime module contains mandatory scope field: ${file}`);
  await import(new URL(`../${file}`, import.meta.url));
}

console.log(`World State Alpha Phase 1 validation passed: ${required.length} browser-safe core modules.`);

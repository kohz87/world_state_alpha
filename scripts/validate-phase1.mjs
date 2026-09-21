import fs from 'node:fs';

const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
if (inventory.stage !== 'phase1-core') throw new Error('runtime inventory stage mismatch');
if (inventory.hostEntrypoint !== null) throw new Error('Phase 1 must not expose a host entrypoint');

for (const file of inventory.modules) {
  if (!fs.existsSync(file)) throw new Error(`missing Phase 1 module: ${file}`);
  const text = fs.readFileSync(file, 'utf8');
  if (/from\s+['"]node:|require\(['"]node:/.test(text)) throw new Error(`browser runtime module imports Node-only API: ${file}`);
  if (/"scope"\s*:/.test(text)) throw new Error(`runtime module contains mandatory scope field: ${file}`);
  await import(new URL(`../${file}`, import.meta.url));
}

const forbidden = ['capture', 'evolution', 'provider-routing', 'injection', 'ui', 'commands'];
for (const name of forbidden) {
  if (inventory.modules.some(file => file.toLowerCase().includes(name))) {
    throw new Error(`Phase 1 inventory contains later-phase module: ${name}`);
  }
}

console.log(`World State Alpha Phase 1 validation passed: ${inventory.modules.length} browser-safe core modules.`);

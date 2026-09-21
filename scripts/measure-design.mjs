import fs from 'node:fs';

const files = ['docs/core-contract.md', 'docs/ARCHITECTURE.md', 'docs/DATA_MODEL.md'];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  console.log(JSON.stringify({
    file,
    chars: text.length,
    estimatedTokens: Math.ceil(text.length / 4),
  }));
}
console.log('Runtime prompt measurement is not applicable until implementation is authorized.');

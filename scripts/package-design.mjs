import fs from 'node:fs';
import crypto from 'node:crypto';

fs.mkdirSync('dist', { recursive: true });

const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c >>> 0;
}

export function calculateCrc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ buffer[i]) & 0xFF];
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

export function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function createDeterministicZip(fileEntries) {
  const sorted = [...fileEntries].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const localHeaders = [];
  const centralHeaders = [];
  let currentOffset = 0;

  const dosTime = 0x0000;
  const dosDate = 0x5C21; // 2026-01-01

  for (const entry of sorted) {
    const rawName = entry.name.replace(/\\/g, '/');
    const nameBuffer = Buffer.from(rawName, 'utf8');
    const rawData = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8');
    const crc = calculateCrc32(rawData);
    const uncompressedSize = rawData.length;

    // Store entries without compression so archive bytes do not depend on a
    // particular zlib implementation/version. The source files are small.
    const compressedData = rawData;
    const compressedSize = rawData.length;
    const compressionMethod = 0; // STORE

    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(compressionMethod, 8);
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuffer.copy(localHeader, 30);

    localHeaders.push(localHeader, compressedData);

    const centralHeader = Buffer.alloc(46 + nameBuffer.length);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(63, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(compressionMethod, 10);
    centralHeader.writeUInt16LE(dosTime, 12);
    centralHeader.writeUInt16LE(dosDate, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0x81a40000, 38);
    centralHeader.writeUInt32LE(currentOffset, 42);
    nameBuffer.copy(centralHeader, 46);

    centralHeaders.push(centralHeader);

    currentOffset += localHeader.length + compressedData.length;
  }

  const centralDirectoryOffset = currentOffset;
  const centralDirectoryBuffer = Buffer.concat(centralHeaders);
  const centralDirectorySize = centralDirectoryBuffer.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(sorted.length, 8);
  eocd.writeUInt16LE(sorted.length, 10);
  eocd.writeUInt32LE(centralDirectorySize, 12);
  eocd.writeUInt32LE(centralDirectoryOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localHeaders, centralDirectoryBuffer, eocd]);
}

export function buildReleasePackage() {
  const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
  const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

  const fileList = [...new Set([
    ...inventory.modules,
    ...(inventory.assets || []),
    ...(inventory.hostFiles || []),
    'runtime-modules.json',
  ])].sort();

  const fileEntries = [];
  const manifestFiles = [];

  for (const relativePath of fileList) {
    if (!fs.existsSync(relativePath)) {
      throw new Error(`Package file missing: ${relativePath}`);
    }
    const content = fs.readFileSync(relativePath);
    fileEntries.push({ name: relativePath, content });
    manifestFiles.push({
      path: relativePath,
      size: content.length,
      sha256: sha256Hex(content),
    });
  }

  const archiveName = `world_state_alpha-${pkg.version}.zip`;
  const archiveBuffer = createDeterministicZip(fileEntries);
  const archiveSha256 = sha256Hex(archiveBuffer);

  fs.writeFileSync(`dist/${archiveName}`, archiveBuffer);

  const releaseManifest = {
    name: 'world_state_alpha',
    version: pkg.version,
    manifestVersion: manifest.version,
    stage: inventory.stage,
    archive: archiveName,
    archiveSha256,
    archiveBytes: archiveBuffer.length,
    fileCount: manifestFiles.length,
    files: manifestFiles,
    authorities: [
      'AGENTS.md',
      'WORKFLOW.md',
      'docs/core-contract.md',
      'docs/ARCHITECTURE.md',
      'docs/DATA_MODEL.md',
      'docs/WORKPLAN.md',
      'docs/TEST_PLAN.md',
      'docs/RISK_REGISTER.md',
      'docs/LIVE_ACCEPTANCE.md'
    ]
  };

  const manifestJson = JSON.stringify(releaseManifest, null, 2) + '\n';
  fs.writeFileSync(`dist/world_state_alpha-${pkg.version}-manifest.json`, manifestJson);
  fs.writeFileSync('dist/release-manifest.json', manifestJson);
  fs.writeFileSync('dist/world_state_alpha-phase8.json', manifestJson);

  return {
    archiveName,
    archiveSha256,
    archiveBytes: archiveBuffer.length,
    fileCount: manifestFiles.length,
    manifestJson,
  };
}

const isDirectRun = !process.env.NODE_TEST_CONTEXT
  && String(process.argv[1] || '').replace(/\\/g, '/').endsWith('/scripts/package-design.mjs');

if (isDirectRun) {
  const result = buildReleasePackage();
  console.log(`Wrote dist/${result.archiveName} (${result.archiveBytes} bytes, sha256: ${result.archiveSha256})`);
  console.log(`Wrote dist/release-manifest.json (${result.fileCount} files)`);
}

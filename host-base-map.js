import { parseBaseMap } from './spatial-base-map.js';

export async function storeBaseMapSource(adapter, rawBaseMap) {
  if (!adapter || typeof adapter.uploadJsonFile !== 'function') {
    throw new Error('storage adapter with uploadJsonFile is required');
  }

  const parsed = parseBaseMap(rawBaseMap);
  const digest = parsed.digest;
  const filename = `world-state-alpha-basemap-${digest}.json`;

  const payload = {
    format: 'world_state_alpha_base_map',
    version: 1,
    digest,
    baseMap: parsed,
  };

  const uploadResult = await adapter.uploadJsonFile(filename, payload);
  const path = uploadResult?.path || filename;

  const pointer = {
    id: parsed.id,
    name: parsed.name,
    version: parsed.version,
    digest,
    path,
  };

  return {
    baseMap: parsed,
    pointer,
  };
}

export async function loadBaseMapSource(adapter, pointer) {
  if (!pointer?.path) return null;
  if (!adapter || typeof adapter.fetchJsonFile !== 'function') return null;

  try {
    const raw = await adapter.fetchJsonFile(pointer.path);
    if (!raw) return null;

    const candidate = raw.baseMap || raw;
    const parsed = parseBaseMap(candidate);

    if (pointer.digest && parsed.digest !== pointer.digest) {
      throw new Error('World State Alpha base map digest mismatch for pointer: ' + pointer.id);
    }

    return parsed;
  } catch (error) {
    console.warn('[World State Alpha] failed to load base map source safely:', pointer?.id, error);
    return null;
  }
}

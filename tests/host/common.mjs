// Shared setup for host scenarios: a copied runtime, a host, and a saved sidecar.
import { createHost, prepareHost } from './harness.mjs';

export async function setup({ chat, settings = {}, sidecar = null, revision = 1 } = {}) {
  const layout = prepareHost();
  process.on('exit', layout.cleanup);
  const mod = file => import(layout.url(file));
  const core = await mod('state-core.js');
  const branch = await mod('branch.js');
  const storage = await mod('storage.js');
  const hostStorage = await mod('host-storage.js');
  const host = createHost({ chat });
  const chatKey = 'chat:a.png:c1';
  const sidecarPath = hostStorage.worldStateHostDeterministicPath(storage.makeSidecarPath(chatKey));
  globalThis.window = { confirm: () => true, prompt: () => 'note' };
  globalThis.__extension_settings.world_state_alpha = { ...settings };
  const save = (state, rev, appVersion = 'saved') => {
    const text = storage.encodeSidecar({ chatKey, state, revision: rev, appVersion });
    host.files.set(sidecarPath, text);
    return text;
  };
  if (sidecar) {
    const text = save(sidecar, revision);
    globalThis.__extension_settings.world_state_alpha.dataFiles = {
      [chatKey]: { path: sidecarPath, revision, checksum: JSON.parse(text).checksum },
    };
  }
  return { layout, mod, core, branch, storage, host, chatKey, sidecarPath, save };
}

export async function start(env, { settle = 60 } = {}) {
  const index = await env.mod('index.js');
  await new Promise(resolve => setTimeout(resolve, 5));
  await env.host.eventSource.emit('APP_READY');
  await new Promise(resolve => setTimeout(resolve, settle));
  return index;
}

export function server(env) {
  return env.storage.decodeSidecar(env.host.files.get(env.sidecarPath), { expectedChatKey: env.chatKey });
}

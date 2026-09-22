import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dispatchWorldStateRequest,
  selectedWorldStateProfileId,
  worldStateInflightCount,
  worldStateProfileOptions,
} from '../provider-routing.js';

const payload = {
  systemPrompt: 'system',
  prompt: 'payload',
  responseLength: 777,
  quietToLoud: false,
  instructOverride: true,
  trimNames: false,
};

function fixture(profileId = '') {
  const calls = { host: [], profile: [] };
  const profiles = [{ id: 'fast', name: 'Fast', supported: true, model: 'model-a' }];
  const ctx = {
    extensionSettings: {
      world_state_alpha: { connectionProfile: profileId },
      connectionManager: { profiles, selectedProfile: 'roleplay' },
      disabledExtensions: [],
    },
    generateRaw(options) {
      calls.host.push(options);
      return Promise.resolve('{"mutations":[]}');
    },
    ConnectionManagerRequestService: {
      getProfile(id) {
        const profile = profiles.find(item => item.id === id);
        if (!profile) throw new Error('missing');
        return profile;
      },
      isProfileSupported(profile) {
        return profile.supported !== false;
      },
      sendRequest(...args) {
        calls.profile.push(args);
        return Promise.resolve({ content: '{"mutations":[]}' });
      },
    },
  };
  return { ctx, calls, profiles };
}

test('default World State route uses host generateRaw exactly once without settings mutation', async () => {
  const { ctx, calls } = fixture();
  const before = structuredClone(ctx.extensionSettings);
  const result = await dispatchWorldStateRequest(ctx, payload);
  assert.equal(result.text, '{"mutations":[]}');
  assert.equal(result.receipt.route, 'default');
  assert.equal(calls.host.length, 1);
  assert.equal(calls.host[0], payload);
  assert.equal(calls.profile.length, 0);
  assert.deepEqual(ctx.extensionSettings, before);
});

test('selected Connection Profile is request-scoped and does not alter RP selection', async () => {
  const { ctx, calls } = fixture('fast');
  const before = structuredClone(ctx.extensionSettings);
  const route = { profileId: 'fast' };
  const result = await dispatchWorldStateRequest(ctx, payload, { route });
  assert.equal(result.receipt.route, 'profile');
  assert.equal(calls.host.length, 0);
  assert.equal(calls.profile.length, 1);
  const [id, messages, maxTokens, custom] = calls.profile[0];
  assert.equal(id, 'fast');
  assert.equal(maxTokens, 777);
  assert.deepEqual(messages, [
    { role: 'system', content: 'system' },
    { role: 'user', content: 'payload' },
  ]);
  assert.equal(custom.stream, false);
  assert.ok(custom.signal instanceof AbortSignal);
  assert.deepEqual(ctx.extensionSettings, before);
  assert.equal(selectedWorldStateProfileId(ctx), 'fast');
});

test('profile options expose supported SillyTavern profiles and preserve a missing selection', () => {
  const { ctx, profiles } = fixture('fast');
  profiles.push(
    { id: 'slow', name: 'Slow but careful', supported: true },
    { id: 'image-only', name: 'Image only', supported: false },
    { id: '', name: 'Invalid', supported: true },
  );
  assert.deepEqual(worldStateProfileOptions(ctx), [
    { id: '', name: 'Use current roleplay connection' },
    { id: 'fast', name: 'Fast' },
    { id: 'slow', name: 'Slow but careful' },
  ]);

  ctx.extensionSettings.world_state_alpha.connectionProfile = 'deleted';
  assert.deepEqual(worldStateProfileOptions(ctx).at(-1), {
    id: 'deleted',
    name: 'Unavailable profile (deleted)',
  });

  ctx.extensionSettings.disabledExtensions.push('connection-manager');
  assert.deepEqual(worldStateProfileOptions(ctx), [
    { id: '', name: 'Use current roleplay connection' },
    { id: 'deleted', name: 'Unavailable profile (deleted)' },
  ]);
});

test('missing selected profile fails closed with no fallback', async () => {
  const { ctx, calls } = fixture('deleted');
  await assert.rejects(
    dispatchWorldStateRequest(ctx, payload),
    error => error?.code === 'WORLD_STATE_PROFILE_UNAVAILABLE',
  );
  assert.equal(calls.host.length + calls.profile.length, 0);
});

test('profile edit invalidates the pinned route', async () => {
  const { ctx, profiles, calls } = fixture('fast');
  const route = { profileId: 'fast' };
  await dispatchWorldStateRequest(ctx, payload, { route });
  profiles[0].model = 'model-b';
  await assert.rejects(
    dispatchWorldStateRequest(ctx, payload, { route }),
    error => error?.code === 'WORLD_STATE_PROFILE_CHANGED',
  );
  assert.equal(calls.profile.length, 1);
  assert.equal(calls.host.length, 0);
});

test('stale scope rejects provider output and cleans inflight accounting', async () => {
  const { ctx, calls } = fixture();
  let current = true;
  ctx.generateRaw = async options => {
    calls.host.push(options);
    current = false;
    return '{"mutations":[]}';
  };
  await assert.rejects(
    dispatchWorldStateRequest(ctx, payload, { isCurrent: () => current }),
    error => error?.code === 'WORLD_STATE_ROUTE_CANCELLED',
  );
  assert.equal(calls.host.length, 1);
  assert.equal(worldStateInflightCount(), 0);
});

test('pre-stale scope performs zero provider calls', async () => {
  const { ctx, calls } = fixture();
  await assert.rejects(
    dispatchWorldStateRequest(ctx, payload, { isCurrent: () => false }),
    error => error?.code === 'WORLD_STATE_ROUTE_CANCELLED',
  );
  assert.equal(calls.host.length + calls.profile.length, 0);
});

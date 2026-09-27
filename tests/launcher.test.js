import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  WORLD_STATE_LAUNCHER_ID,
  WORLD_STATE_LAUNCHER_STORAGE_KEY,
  clampLauncherPosition,
  defaultLauncherPosition,
  mountWorldStateLauncher,
  readLauncherPosition,
  saveLauncherPosition,
} from '../launcher.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: key => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    map,
  };
}

function fakeDom() {
  const listeners = new Map();
  const element = {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {} },
    isConnected: false,
    rect: { left: 18, top: 700, width: 46, height: 46 },
    setAttribute(name, value) { this[name] = value; },
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type) { listeners.delete(type); },
    getBoundingClientRect() { return this.rect; },
    remove() { this.isConnected = false; body.children.delete(this); },
  };
  const body = {
    children: new Set(),
    appendChild(child) { child.isConnected = true; this.children.add(child); },
  };
  const doc = {
    body,
    createElement: () => element,
    getElementById: id => [...body.children].find(child => child.id === id) || null,
    documentElement: { clientWidth: 1280, clientHeight: 800 },
  };
  const winListeners = new Map();
  const win = {
    innerWidth: 1280,
    innerHeight: 800,
    addEventListener(type, fn) { winListeners.set(type, fn); },
    removeEventListener(type) { winListeners.delete(type); },
  };
  return { doc, win, element, listeners, winListeners, body };
}

test('launcher positions are clamped inside the viewport', () => {
  assert.deepEqual(clampLauncherPosition({ left: -40, top: 5000 }, { width: 400, height: 800 }, { width: 46, height: 46 }), { left: 8, top: 746 });
  assert.deepEqual(clampLauncherPosition({ left: 120.4, top: 300.6 }, { width: 400, height: 800 }, { width: 46, height: 46 }), { left: 120, top: 301 });
});

test('launcher position persistence is per-browser, namespaced, and tolerant of bad data', () => {
  assert.equal(WORLD_STATE_LAUNCHER_STORAGE_KEY.startsWith('world_state_alpha_'), true);
  const storage = memoryStorage();
  assert.equal(readLauncherPosition(storage), null);
  saveLauncherPosition({ left: 33.6, top: 90.2 }, storage);
  assert.deepEqual(readLauncherPosition(storage), { left: 34, top: 90 });
  assert.equal(readLauncherPosition(memoryStorage({ [WORLD_STATE_LAUNCHER_STORAGE_KEY]: '{bad' })), null);
  assert.doesNotThrow(() => saveLauncherPosition({ left: 1, top: 1 }, { setItem() { throw new Error('quota'); } }));
});

test('launcher opens the panel on click, suppresses the click after a drag, and saves the dragged position', () => {
  const { doc, win, element, listeners, body } = fakeDom();
  const storage = memoryStorage();
  let opened = 0;
  const controller = mountWorldStateLauncher({ onOpen: () => { opened += 1; }, doc, win, storage });
  assert.equal(element.id, WORLD_STATE_LAUNCHER_ID);
  assert.equal(body.children.size, 1);

  listeners.get('click')({ preventDefault() {} });
  assert.equal(opened, 1);

  let reopened = 0;
  assert.equal(mountWorldStateLauncher({ onOpen: () => { reopened += 1; }, doc, win, storage }), controller, 'mounting twice reuses the same button');
  listeners.get('click')({ preventDefault() {} });
  assert.equal(reopened, 1, 'a remount replaces the open handler instead of keeping a stale one');
  assert.equal(opened, 1);

  listeners.get('pointerdown')({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 30, clientY: 710 });
  listeners.get('pointermove')({ pointerId: 1, clientX: 230, clientY: 410, preventDefault() {} });
  element.rect = { left: 218, top: 400, width: 46, height: 46 };
  listeners.get('pointerup')({ pointerId: 1, preventDefault() {} });
  listeners.get('click')({ preventDefault() {} });
  assert.equal(reopened, 1, 'the click that ends a drag does not open the panel');
  assert.deepEqual(readLauncherPosition(storage), { left: 218, top: 400 });
  assert.equal(element.dataset.positioned, 'true');

  controller.destroy();
  assert.equal(body.children.size, 0);
});

test('a transient viewport shrink clamps the button but never overwrites the saved spot', () => {
  const { doc, win, element, listeners, winListeners } = fakeDom();
  const storage = memoryStorage();
  mountWorldStateLauncher({ onOpen() {}, doc, win, storage });
  listeners.get('pointerdown')({ pointerId: 1, pointerType: 'touch', clientX: 40, clientY: 720 });
  listeners.get('pointermove')({ pointerId: 1, clientX: 40, clientY: 640, preventDefault() {} });
  element.rect = { left: 18, top: 700, width: 46, height: 46 };
  listeners.get('pointerup')({ pointerId: 1, preventDefault() {} });
  assert.deepEqual(readLauncherPosition(storage), { left: 18, top: 700 });

  doc.documentElement.clientHeight = 400; // e.g. on-screen keyboard
  winListeners.get('resize')();
  assert.equal(element.style.top, '346px');
  assert.deepEqual(readLauncherPosition(storage), { left: 18, top: 700 }, 'resize does not persist');

  doc.documentElement.clientHeight = 800;
  winListeners.get('resize')();
  assert.equal(element.style.top, '700px', 'the button returns once the viewport grows back');
});

test('a drag interrupted by pointercancel still keeps the dragged position', () => {
  const { doc, win, element, listeners } = fakeDom();
  const storage = memoryStorage();
  mountWorldStateLauncher({ onOpen() {}, doc, win, storage });
  listeners.get('pointerdown')({ pointerId: 7, pointerType: 'touch', clientX: 40, clientY: 720 });
  listeners.get('pointermove')({ pointerId: 7, clientX: 200, clientY: 300, preventDefault() {} });
  element.rect = { left: 178, top: 280, width: 46, height: 46 };
  listeners.get('pointercancel')({ pointerId: 7 });
  assert.deepEqual(readLauncherPosition(storage), { left: 178, top: 280 });
});

test('launcher is World-State-owned, needs no other extension, and does not observe the DOM', () => {
  const source = fs.readFileSync('launcher.js', 'utf8');
  const css = fs.readFileSync('ui.css', 'utf8');
  assert.doesNotMatch(source, /MutationObserver|setInterval|watchdog|registerSlash|SlashCommand|npc_state|npc-state|NPCState|Ukiyo|Megumin/);
  assert.match(css, /#world_state_alpha_launcher\.world-state-alpha-launcher \{[\s\S]*?left: max\(18px/);
  assert.match(css, /#world_state_alpha_launcher\.world-state-alpha-launcher \{[\s\S]*?z-index: 1000;/, 'stays below host drawers and popups');
  assert.match(fs.readFileSync('scripts/validate-phase7.mjs', 'utf8'), /readFileSync\('launcher\.js'/, 'Phase 7 coexistence scan covers the button module');
  const inventory = JSON.parse(fs.readFileSync('runtime-modules.json', 'utf8'));
  assert.ok(inventory.modules.includes('launcher.js'));
  const index = fs.readFileSync('index.js', 'utf8');
  assert.match(index, /showLauncher: true/);
  assert.match(index, /world_state_alpha_show_launcher/);
  assert.match(index, /settings\.showLauncher !== false && settings\.enabled !== false/, 'hidden when World State is disabled');
  assert.match(index, /floating button unavailable/, 'button failures cannot block hydration');
});

test('default spot is computed in viewport pixels (SillyTavern collapses <html> to 0px on narrow screens)', () => {
  assert.deepEqual(defaultLauncherPosition({ width: 1280, height: 800 }, { width: 46, height: 46 }), { left: 18, top: 680 });
  assert.deepEqual(defaultLauncherPosition({ width: 1180, height: 820 }, { width: 46, height: 46 }), { left: 18, top: 700 });
  assert.deepEqual(defaultLauncherPosition({ width: 820, height: 1180 }, { width: 46, height: 46 }), { left: 18, top: 567 });
  assert.deepEqual(defaultLauncherPosition({ width: 390, height: 844 }, { width: 46, height: 46 }), { left: 18, top: 399 });
});

test('without a saved spot the button is placed in pixels on mount and re-placed on resize', () => {
  const { doc, win, element, winListeners } = fakeDom();
  doc.documentElement.clientWidth = 390;
  doc.documentElement.clientHeight = 844;
  mountWorldStateLauncher({ onOpen() {}, doc, win, storage: memoryStorage() });
  assert.equal(element.style.left, '18px');
  assert.equal(element.style.top, '399px', 'narrow screens get an explicit mid-height top, not a CSS percentage');
  assert.equal(element.dataset.positioned, 'true');

  doc.documentElement.clientWidth = 1280;
  doc.documentElement.clientHeight = 800;
  winListeners.get('resize')();
  assert.equal(element.style.top, '680px');
});

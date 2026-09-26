// World State floating launcher: one movable button that opens the existing
// panel. It is UI-only (position lives in this browser's localStorage), has no
// knowledge of other extensions, and defaults to the left edge so it does not
// sit on top of launchers that conventionally use the bottom-right corner.

export const WORLD_STATE_LAUNCHER_ID = 'world_state_alpha_launcher';
export const WORLD_STATE_LAUNCHER_STORAGE_KEY = 'world_state_alpha_launcher_position_v1';

const DRAG_THRESHOLD_PX = 5;
const VIEWPORT_MARGIN_PX = 8;
const CLICK_SUPPRESS_MS = 450;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampLauncherPosition(position = {}, viewport = {}, size = {}, margin = VIEWPORT_MARGIN_PX) {
  const safeMargin = Math.max(0, finite(margin, VIEWPORT_MARGIN_PX));
  const maxLeft = Math.max(safeMargin, finite(viewport.width) - Math.max(0, finite(size.width)) - safeMargin);
  const maxTop = Math.max(safeMargin, finite(viewport.height) - Math.max(0, finite(size.height)) - safeMargin);
  return {
    left: Math.round(Math.min(maxLeft, Math.max(safeMargin, finite(position.left, safeMargin)))),
    top: Math.round(Math.min(maxTop, Math.max(safeMargin, finite(position.top, maxTop)))),
  };
}

function defaultStorage() {
  try { return globalThis.localStorage; } catch { return null; }
}

export function readLauncherPosition(storage = defaultStorage()) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(WORLD_STATE_LAUNCHER_STORAGE_KEY) || 'null');
    if (!parsed || !Number.isFinite(Number(parsed.left)) || !Number.isFinite(Number(parsed.top))) return null;
    return { left: Math.round(Number(parsed.left)), top: Math.round(Number(parsed.top)) };
  } catch {
    return null;
  }
}

export function saveLauncherPosition(position, storage = defaultStorage()) {
  try {
    storage?.setItem?.(WORLD_STATE_LAUNCHER_STORAGE_KEY, JSON.stringify({
      left: Math.round(finite(position?.left)),
      top: Math.round(finite(position?.top)),
    }));
  } catch {
    // Position persistence is best-effort UI convenience only.
  }
}

function launcherIconHtml() {
  return '<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false"><circle cx="24" cy="24" r="15"></circle>' +
    '<path d="M12 19l8-7 11 3 6 9-5 10-12 2-9-8z"></path>' +
    '<circle cx="20" cy="12" r="2.5"></circle><circle cx="31" cy="15" r="2.5"></circle>' +
    '<circle cx="37" cy="24" r="2.5"></circle><circle cx="32" cy="34" r="2.5"></circle>' +
    '<circle cx="20" cy="36" r="2.5"></circle><circle cx="11" cy="28" r="2.5"></circle></svg>';
}

export function mountWorldStateLauncher({
  onOpen,
  doc = globalThis.document,
  win = globalThis,
  storage = defaultStorage(),
} = {}) {
  if (!doc?.body || typeof doc.createElement !== 'function') return null;
  const existing = doc.getElementById?.(WORLD_STATE_LAUNCHER_ID);
  if (existing?.__worldStateLauncher) {
    existing.__worldStateLauncher.setOnOpen(onOpen);
    return existing.__worldStateLauncher;
  }
  existing?.remove?.();

  const button = doc.createElement('button');
  button.type = 'button';
  button.id = WORLD_STATE_LAUNCHER_ID;
  button.className = 'world-state-alpha-launcher';
  button.title = 'World State — drag to move, click to open';
  button.setAttribute('aria-label', 'Open World State. Drag to move.');
  button.innerHTML = launcherIconHtml();

  let drag = null;
  let suppressClickUntil = 0;
  let openHandler = onOpen;
  // The operator's chosen spot. Resizes clamp the displayed position against
  // it but never overwrite it, so a transient shrink (on-screen keyboard,
  // narrowed window) does not permanently move the button.
  let preferred = null;

  // position:fixed is laid out against the layout viewport, not the
  // pinch-zoomed visual viewport.
  function viewport() {
    return {
      width: finite(doc.documentElement?.clientWidth, 0) || finite(win.innerWidth, 0),
      height: finite(doc.documentElement?.clientHeight, 0) || finite(win.innerHeight, 0),
    };
  }

  function applyPosition(position) {
    if (!button.isConnected) return null;
    const rect = button.getBoundingClientRect();
    const clamped = clampLauncherPosition(position, viewport(), { width: rect.width, height: rect.height });
    button.style.left = clamped.left + 'px';
    button.style.top = clamped.top + 'px';
    button.dataset.positioned = 'true';
    return clamped;
  }

  function onResize() {
    if (preferred) applyPosition(preferred);
  }

  function commitDraggedPosition() {
    const rect = button.getBoundingClientRect();
    const clamped = applyPosition({ left: rect.left, top: rect.top });
    if (!clamped) return;
    preferred = clamped;
    saveLauncherPosition(clamped, storage);
  }

  function onPointerDown(event) {
    if (event.isPrimary === false || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const rect = button.getBoundingClientRect();
    drag = { pointerId: event.pointerId, startX: finite(event.clientX), startY: finite(event.clientY), left: rect.left, top: rect.top, moved: false };
    try { button.setPointerCapture?.(event.pointerId); } catch { /* optional */ }
  }

  function onPointerMove(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = finite(event.clientX) - drag.startX;
    const dy = finite(event.clientY) - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    event.preventDefault?.();
    button.classList.add('is-dragging');
    applyPosition({ left: drag.left + dx, top: drag.top + dy });
  }

  function finishDrag(event) {
    try { button.releasePointerCapture?.(event.pointerId); } catch { /* optional */ }
    button.classList.remove('is-dragging');
    drag = null;
  }

  function onPointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    finishDrag(event);
    if (!moved) return;
    event.preventDefault?.();
    commitDraggedPosition();
    suppressClickUntil = Date.now() + CLICK_SUPPRESS_MS;
  }

  function onPointerCancel(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    finishDrag(event);
    if (moved) commitDraggedPosition();
  }

  function onClick(event) {
    event.preventDefault?.();
    if (Date.now() < suppressClickUntil) return;
    if (typeof openHandler === 'function') openHandler();
  }

  button.addEventListener('pointerdown', onPointerDown);
  button.addEventListener('pointermove', onPointerMove);
  button.addEventListener('pointerup', onPointerUp);
  button.addEventListener('pointercancel', onPointerCancel);
  button.addEventListener('click', onClick);
  win.addEventListener?.('resize', onResize);
  doc.body.appendChild(button);

  preferred = readLauncherPosition(storage);
  if (preferred) {
    const restore = () => applyPosition(preferred);
    if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(restore);
    else restore();
  }

  const controller = Object.freeze({
    element: button,
    setOnOpen(next) {
      openHandler = next;
    },
    destroy() {
      button.removeEventListener('pointerdown', onPointerDown);
      button.removeEventListener('pointermove', onPointerMove);
      button.removeEventListener('pointerup', onPointerUp);
      button.removeEventListener('pointercancel', onPointerCancel);
      button.removeEventListener('click', onClick);
      win.removeEventListener?.('resize', onResize);
      delete button.__worldStateLauncher;
      button.remove();
    },
  });
  button.__worldStateLauncher = controller;
  return controller;
}

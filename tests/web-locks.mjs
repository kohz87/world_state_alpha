// Runs `fn` as in a browser without the Web Locks API (an insecure context). Node 24 provides
// navigator.locks and Node 22 does not, so tests of the no-locks path hide it explicitly.
export async function withoutWebLocks(fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
  try {
    return await fn();
  } finally {
    if (had) Object.defineProperty(globalThis, 'navigator', had);
    else delete globalThis.navigator;
  }
}

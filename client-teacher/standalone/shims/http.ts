// 'http': nothing listens on a port here; the page talks to the server through ../bus.ts and ../api.ts
export function createServer(_app?: unknown) {
  return { listen(_port: unknown, cb?: () => void) { cb?.(); return this; }, on() { return this; } };
}
export default { createServer };

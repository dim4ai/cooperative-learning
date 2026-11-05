import crypto from 'crypto';

// Requests to start a demo lesson are counted per address. Too many and the address is refused
// for a while, even when a slot is free; each repeat doubles the pause, knocking during a pause
// extends it, and quiet time forgives it step by step.
const ATTEMPTS_PER_WINDOW = 6;
const WINDOW_MS = 60 * 1000;
const FIRST_PAUSE_MS = 60 * 1000;
const MAX_PAUSE_MS = 30 * 60 * 1000;
const MAX_LEVEL = 6;
const FORGIVE_STEP_MS = 10 * 60 * 1000;

interface Entry { windowStart: number; count: number; level: number; pausedUntil: number; lastAt: number }

export type ThrottleResult = { ok: true } | { ok: false; retryAfterMs: number; newPause: boolean };

const pauseOf = (level: number) => Math.min(FIRST_PAUSE_MS * 2 ** (level - 1), MAX_PAUSE_MS);

export class Throttle {
  private entries = new Map<string, Entry>();

  attempt(key: string, now = Date.now()): ThrottleResult {
    const e = this.entries.get(key) ?? { windowStart: now, count: 0, level: 0, pausedUntil: 0, lastAt: now };
    this.entries.set(key, e);
    if (now < e.pausedUntil) {
      e.lastAt = now;
      e.pausedUntil = now + pauseOf(e.level);
      return { ok: false, retryAfterMs: pauseOf(e.level), newPause: false };
    }
    const calm = now - Math.max(e.lastAt, e.pausedUntil);
    e.level = Math.max(0, e.level - Math.floor(calm / FORGIVE_STEP_MS));
    e.lastAt = now;
    if (now - e.windowStart >= WINDOW_MS) { e.windowStart = now; e.count = 0; }
    e.count += 1;
    if (e.count <= ATTEMPTS_PER_WINDOW) return { ok: true };
    e.level = Math.min(MAX_LEVEL, e.level + 1);
    e.count = 0;
    e.windowStart = now;
    e.pausedUntil = now + pauseOf(e.level);
    return { ok: false, retryAfterMs: pauseOf(e.level), newPause: true };
  }

  /** Forgets addresses that have nothing left to forgive */
  sweep(now = Date.now()) {
    for (const [key, e] of this.entries) {
      const calm = now - Math.max(e.lastAt, e.pausedUntil);
      if (calm >= FORGIVE_STEP_MS * (e.level + 1)) this.entries.delete(key);
    }
  }
}

/** One network for IPv6: a single customer gets a whole /64, so a single address means nothing */
export function ipNetwork(ip: string): string {
  const v = ip.replace(/^::ffff:/i, '');
  if (!v.includes(':')) return v;
  const [h, t] = v.split('::');
  const head = h ? h.split(':') : [];
  const tail = t ? t.split(':') : [];
  const groups = [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill('0'), ...tail];
  return groups.slice(0, 4).map(g => g.toLowerCase().replace(/^0+(?=.)/, '')).join(':');
}

/** Addresses are stored only like this: enough to recognise one, not to read it back */
export function hashIp(ip: string, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`demo-ip:${ipNetwork(ip)}`).digest('hex').slice(0, 16);
}

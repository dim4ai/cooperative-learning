// 'crypto' for the server running in the page: random ids and hashes that only have to be consistent
// within this tab — nothing here protects anything

type Bytes = Uint8Array & { toString(enc?: string): string };

function bytes(a: Uint8Array): Bytes {
  const b = a as Bytes;
  b.toString = (enc?: string) => {
    if (enc === 'hex') return [...a].map(x => x.toString(16).padStart(2, '0')).join('');
    const b64 = btoa(String.fromCharCode(...a));
    return enc === 'base64url' ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64;
  };
  return b;
}

export function randomBytes(n: number): Bytes {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return bytes(a);
}

export const randomUUID = () => globalThis.crypto.randomUUID();

export function randomInt(min: number, max?: number): number {
  const [lo, hi] = max === undefined ? [0, min] : [min, max];
  return lo + Math.floor(Math.random() * (hi - lo));
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** 32 bytes from a string, the same each time (FNV-1a, eight lanes) */
function digestOf(s: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let lane = 0; lane < 8; lane++) {
    let h = (0x811c9dc5 ^ (lane * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    out.set([h >>> 24, (h >>> 16) & 255, (h >>> 8) & 255, h & 255], lane * 4);
  }
  return out;
}

class Hash {
  private text = '';
  constructor(private key = '') {}
  update(data: unknown) { this.text += typeof data === 'string' ? data : String(data); return this; }
  digest(enc?: string) { const d = bytes(digestOf(this.key + '\u0000' + this.text)); return enc ? d.toString(enc) : d; }
}

export const createHash = (_alg: string) => new Hash();
export const createHmac = (_alg: string, key: string) => new Hash(String(key));
export type { Hash };

export default { randomBytes, randomUUID, randomInt, timingSafeEqual, createHash, createHmac };

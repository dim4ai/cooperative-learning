// Encryption of the teacher's journal, all of it in the browser (WebCrypto).
//
//   password ──PBKDF2──▶ master secret ──HKDF──┬─▶ auth key: goes to the server instead of the password
//                                              └─▶ wrap key: never leaves the browser
//   journal key (random, AES-256-GCM) is stored on the server encrypted by the wrap key;
//   the journal itself — encrypted by the journal key.
//
// AES-256 itself can't be brute-forced, but anyone holding the ciphertext can guess the password
// instead: that's why the slow PBKDF2 and the password checks (passwordStrength.ts) matter.
// The journal key is separate so that changing the password only rewraps it.

/** Raising it means a new login scheme: the server can only tell the auth key apart by comparing */
const PBKDF2_ITERATIONS = 1_000_000;
const SCHEME = 'co-learn/v1';

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(b: ArrayBuffer | Uint8Array): string {
  const bytes = new Uint8Array(b);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
const randomIv = () => crypto.getRandomValues(new Uint8Array(12));

export interface PasswordKeys {
  authKey: string;
  wrapKey: CryptoKey; // not extractable, lives in the tab's memory only
}

export async function derivePasswordKeys(email: string, password: string): Promise<PasswordKeys> {
  const material = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const salt = enc.encode(`${SCHEME}/${email.trim().toLowerCase()}`);
  const master = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS }, material, 256);
  const hkdf = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const params = (info: string) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: enc.encode(`${SCHEME}/${info}`) });
  const authKey = hex(await crypto.subtle.deriveBits(params('auth'), hkdf, 256));
  const wrapKey = await crypto.subtle.deriveKey(params('wrap'), hkdf, { name: 'AES-GCM', length: 256 }, false, ['wrapKey', 'unwrapKey']);
  return { authKey, wrapKey };
}

/** What the server keeps; it can't read any of it */
export interface Envelope {
  v: 1;
  key: { iv: string; ct: string }; // the journal key, wrapped by the password
  body: { iv: string; ct: string }; // the journal
}

export function generateJournalKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function wrapJournalKey(journalKey: CryptoKey, wrapKey: CryptoKey): Promise<Envelope['key']> {
  const iv = randomIv();
  const ct = await crypto.subtle.wrapKey('raw', journalKey, wrapKey, { name: 'AES-GCM', iv });
  return { iv: toB64(iv), ct: toB64(ct) };
}

/** Throws if the wrap key doesn't fit, i.e. the password is wrong */
export function unwrapJournalKey(key: Envelope['key'], wrapKey: CryptoKey, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey('raw', fromB64(key.ct), wrapKey, { name: 'AES-GCM', iv: fromB64(key.iv) },
    { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
}

export async function encryptBody(value: unknown, journalKey: CryptoKey): Promise<Envelope['body']> {
  const iv = randomIv(); // a fresh one for every save: reusing an IV with one key breaks GCM
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, journalKey, enc.encode(JSON.stringify(value)));
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function decryptBody<T>(body: Envelope['body'], journalKey: CryptoKey): Promise<T> {
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(body.iv) }, journalKey, fromB64(body.ct));
  return JSON.parse(dec.decode(plain));
}

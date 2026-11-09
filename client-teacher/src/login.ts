// Logging in: the password stays in the browser; the server gets a key derived from it, and
// another key from the same password opens the journal.
import { derivePasswordKeys } from './journalCrypto';

export interface Teacher {
  id: number;
  email: string;
  name: string;
}

export type LoginResult =
  | { ok: true; teacher: Teacher; token: string; wrapKey: CryptoKey }
  | { ok: false; error: 'wrong' | 'tooMany' };

export async function logIn(email: string, password: string): Promise<LoginResult> {
  const { authKey, wrapKey } = await derivePasswordKeys(email, password);
  const post = (extra: object) => fetch(`${import.meta.env.VITE_API_URL}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email.trim(), authKey, ...extra }),
  });
  let res = await post({});
  // an account made before this scheme: the password goes to the server once, to replace its hash
  if (res.status === 428) res = await post({ password });
  if (res.status === 429) return { ok: false, error: 'tooMany' };
  if (!res.ok) return { ok: false, error: 'wrong' };
  const { teacher, token } = await res.json();
  return { ok: true, teacher, token, wrapKey };
}

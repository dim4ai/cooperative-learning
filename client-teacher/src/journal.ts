// The teacher's journal: all classes in one encrypted record on the server. Opened here, in the
// browser: the keys and the decrypted journal live in this module's memory, so they're gone when
// the tab closes, and nothing readable is ever written to disk or sent anywhere.
import { useSyncExternalStore } from 'react';
import {
  decryptBody, derivePasswordKeys, encryptBody, generateJournalKey, unwrapJournalKey, wrapJournalKey,
} from './journalCrypto';
import type { Envelope } from './journalCrypto';

export interface JournalStudent {
  id: string;
  name: string;      // as the teacher writes it; classmates and the server never see it
  uuids: string[];   // profiles in students' browsers (a new one appears if a browser was cleaned)
  seat: string | null;
}
export interface JournalClass {
  id: string;
  name: string;
  capacity: number; // 0 — seating wasn't saved yet
  students: JournalStudent[];
}
export interface JournalData {
  classes: JournalClass[];
}

export type JournalStatus =
  | 'loading'
  | 'none'        // not created yet
  | 'locked'      // exists, but the key isn't in memory (page reloaded, idle): needs the password
  | 'open'
  | 'unavailable'; // no connection, or the server has no journal table

export class WrongPassword extends Error {}
export class WeakPassword extends Error {}
export class JournalConflict extends Error {}

const API = import.meta.env.VITE_API_URL;

interface State {
  status: JournalStatus;
  data: JournalData | null;
  saveError: string;
}

let state: State = { status: 'loading', data: null, saveError: '' };
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function useJournal(): State {
  return useSyncExternalStore(subscribe, () => state);
}

// Never written anywhere
let wrapKey: CryptoKey | null = null;
let journalKey: CryptoKey | null = null;
let envelope: Envelope | null = null;
let version = 0;
let token = '';

function request(path: string, method = 'GET', body?: unknown) {
  return fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function fetchEnvelope(): Promise<boolean> {
  const res = await request('/journal');
  if (!res.ok) return false;
  const { journal } = await res.json();
  envelope = journal ? JSON.parse(journal.data) : null;
  version = journal?.version ?? 0;
  return true;
}

async function openEnvelope(key: CryptoKey) {
  journalKey = await unwrapJournalKey(envelope!.key, key);
  wrapKey = key;
  set({ status: 'open', data: await decryptBody<JournalData>(envelope!.body, journalKey), saveError: '' });
}

/** After login the wrap key is at hand; after a page reload there's none and the journal stays locked */
export async function loadJournal(sessionToken: string, key?: CryptoKey) {
  token = sessionToken;
  if (key) wrapKey = key;
  try {
    if (!await fetchEnvelope()) { set({ status: 'unavailable' }); return; }
    if (!envelope) set({ status: 'none' });
    else if (wrapKey) await openEnvelope(wrapKey);
    else set({ status: 'locked' });
  } catch {
    wrapKey = null;
    set({ status: envelope ? 'locked' : 'unavailable' });
  }
}

export function lockJournal() {
  wrapKey = null;
  journalKey = null;
  if (state.status === 'open') set({ status: 'locked', data: null, saveError: '' });
}

export function forgetJournal() {
  wrapKey = null;
  journalKey = null;
  envelope = null;
  version = 0;
  token = '';
  set({ status: 'loading', data: null, saveError: '' });
}

export async function unlockJournal(email: string, password: string) {
  const { wrapKey: key } = await derivePasswordKeys(email, password);
  try {
    await openEnvelope(key);
  } catch {
    throw new WrongPassword();
  }
}

async function put(baseVersion: number, next: Envelope) {
  const res = await request('/journal', 'PUT', { version: baseVersion, data: JSON.stringify(next) });
  if (res.status === 409) throw new JournalConflict();
  if (!res.ok) throw new Error(`journal save: ${res.status}`);
  version = (await res.json()).version;
  envelope = next;
}

/** `vet` runs once the password is known to be right: it is the moment to refuse a weak one */
export async function createJournal(email: string, password: string, vet: () => Promise<void>) {
  const { wrapKey: key, authKey } = await derivePasswordKeys(email, password);
  // The journal gets locked by exactly what was typed, so a typo must not get through
  const check = await request('/password/check', 'POST', { authKey });
  if (check.status === 401) throw new WrongPassword();
  if (!check.ok) throw new Error(`password check: ${check.status}`);
  await vet();
  const fresh = await generateJournalKey();
  const data: JournalData = { classes: [] };
  await put(0, { v: 1, key: await wrapJournalKey(fresh, key), body: await encryptBody(data, fresh) });
  await openEnvelope(key);
}

// Saves go one at a time: each is made from the version the previous one produced
let queue: Promise<void> = Promise.resolve();

export function updateJournal(change: (data: JournalData) => JournalData) {
  if (!state.data || !journalKey) return;
  const data = change(state.data);
  set({ data });
  const key = journalKey;
  queue = queue.then(async () => {
    if (journalKey !== key || !envelope) return; // locked in the meantime
    try {
      await put(version, { ...envelope, body: await encryptBody(state.data, key) });
      if (state.saveError) set({ saveError: '' });
    } catch (e) {
      set({ saveError: e instanceof JournalConflict
        ? 'Журнал изменён в другом окне. Обновите страницу, эти изменения не сохранились'
        : 'Не удалось сохранить журнал. Изменения сохранятся со следующим действием' });
    }
  });
}

/** Rewraps the journal key by the new password; the server takes the hash and the journal together */
export async function changePassword(email: string, current: string, next: string) {
  await queue;
  const oldKeys = await derivePasswordKeys(email, current);
  const newKeys = await derivePasswordKeys(email, next);
  let journal: { version: number; data: string } | null = null;
  if (envelope) {
    let extractable: CryptoKey;
    try {
      extractable = await unwrapJournalKey(envelope.key, oldKeys.wrapKey, true);
    } catch {
      throw new WrongPassword();
    }
    const rewrapped: Envelope = { ...envelope, key: await wrapJournalKey(extractable, newKeys.wrapKey) };
    journal = { version, data: JSON.stringify(rewrapped) };
  }
  const res = await request('/password', 'POST', { authKey: oldKeys.authKey, newAuthKey: newKeys.authKey, journal });
  if (res.status === 401) throw new WrongPassword();
  if (res.status === 409) throw new JournalConflict();
  if (!res.ok) throw new Error(`password change: ${res.status}`);
  await loadJournal(token, newKeys.wrapKey);
}

/** Seat plan for the server: only who sits where, without names */
export function seatPlanOf(cls: JournalClass): { capacity?: number; seats: Record<string, string> } {
  const seats: Record<string, string> = {};
  for (const s of cls.students) if (s.seat) for (const u of s.uuids) seats[u] = s.seat;
  return { capacity: cls.capacity || undefined, seats };
}

export function newId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)), x => x.toString(16).padStart(2, '0')).join('');
}

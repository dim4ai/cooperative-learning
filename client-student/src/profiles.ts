// Who has used this browser: a list of profiles in localStorage. No logins, nothing about them is
// stored on the server. The uuid goes to the lesson; the teacher links it to a line in their
// journal, and from then on the student lands on their seat. The student sees themselves by the
// profile's name, the teacher by `teacherName`, classmates by `nick`; both default to the name.
import { saveAvatar } from './avatars';

export interface Profile {
  uuid: string;
  name: string;
  avatar: string | null;
  teacherName?: string;
  nick?: string;
}

const KEY = 'profiles';

/** Most recently used first */
export function profiles(): Profile[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function save(list: Profile[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* private mode */ }
}

function newUuid(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The profile with this name, made if there's none; without storage (private mode) the uuid lasts until reload */
function profileOf(name: string): Profile {
  const list = profiles();
  const found = list.find(p => p.name === name);
  if (found) return found;
  const fresh: Profile = { uuid: newUuid(), name, avatar: null };
  save([fresh, ...list]);
  return fresh;
}

/** Student entered under this name: its avatar becomes the current one, and it goes to the top */
export function enterProfile(name: string) {
  const profile = profileOf(name);
  saveAvatar(profile.avatar);
  save([profile, ...profiles().filter(p => p.uuid !== profile.uuid)]);
}

export function profileUuid(name: string): string | null {
  return name ? profileOf(name).uuid : null;
}

/** Empty fields fall back to the profile's name */
export function profileNames(name: string): { teacherName: string; nick: string } {
  const p = profiles().find(x => x.name === name);
  return { teacherName: p?.teacherName?.trim() || name, nick: p?.nick?.trim() || name };
}

export function saveProfileNames(name: string, names: { teacherName?: string; nick?: string }) {
  save(profiles().map(p => p.name === name ? { ...p, ...names } : p));
}

export function saveProfileAvatar(name: string, avatar: string | null) {
  save(profiles().map(p => p.name === name ? { ...p, avatar } : p));
}

export function forgetProfile(uuid: string): Profile[] {
  const list = profiles().filter(p => p.uuid !== uuid);
  save(list);
  return list;
}

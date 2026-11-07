// How the teacher looks to students: a name to call them by, and a photo or a picture from the
// avatar set. Kept in this browser and, once saved there, in the encrypted profile; in a lesson it goes to the
// students through the server's memory only, like the video does.
import { useSyncExternalStore } from 'react';
import { AVATARS, setTeacherLook, TEACHER_TITLE_MAX } from './avatars';

export interface TeacherProfile {
  title: string;
  avatar: string | null; // id from the avatar set, used when there's no photo
  photo: string | null;  // data URL of a small round picture
}

const KEY = 'teacherProfile';
const EMPTY: TeacherProfile = { title: '', avatar: null, photo: null };

function clean(v: unknown): TeacherProfile {
  const { title, avatar, photo } = (v ?? {}) as Partial<TeacherProfile>;
  return {
    title: typeof title === 'string' ? title.slice(0, TEACHER_TITLE_MAX) : '',
    avatar: typeof avatar === 'string' && AVATARS[avatar] ? avatar : null,
    photo: typeof photo === 'string' && photo.startsWith('data:image/') ? photo : null,
  };
}

function load(): TeacherProfile {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? clean(JSON.parse(raw)) : EMPTY;
  } catch {
    return EMPTY;
  }
}

let profile = load();
setTeacherLook({ title: profile.title.trim(), photo: profile.photo });
const listeners = new Set<() => void>();

export function getTeacherProfile(): TeacherProfile {
  return profile;
}

export function useTeacherProfile(): TeacherProfile {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => profile);
}

export function setTeacherProfile(next: TeacherProfile) {
  profile = clean(next);
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* private mode or full: stays for this tab */ }
  setTeacherLook({ title: profile.title.trim(), photo: profile.photo });
  listeners.forEach(l => l());
}

/** The profile's copy always replaces this browser's; this browser's goes there only when saved */
export function adoptTeacherProfile(fromJournal: unknown) {
  setTeacherProfile(clean(fromJournal));
}

export function sameProfile(a: TeacherProfile | undefined, b: TeacherProfile | undefined): boolean {
  const key = (p?: TeacherProfile) => JSON.stringify(clean(p));
  return key(a) === key(b);
}

/** What students get: name and photo (a set picture goes as the avatar id, like a student's) */
export function lookOf(p: TeacherProfile) {
  return { title: p.title.trim(), photo: p.photo };
}

const PHOTO_SIZE = 192;

/** A photo file → a small round picture (the face in the middle), as a data URL */
export async function makeRoundPhoto(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = PHOTO_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(PHOTO_SIZE / 2, PHOTO_SIZE / 2, PHOTO_SIZE / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, PHOTO_SIZE, PHOTO_SIZE);
  bitmap.close();
  // WebP keeps the round edge transparent and is small; a browser that can't write it gives PNG
  return canvas.toDataURL('image/webp', 0.85);
}

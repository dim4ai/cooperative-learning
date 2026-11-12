// server/src/db.ts for the server running in the page: the demo lesson lives in memory, no accounts,
// no journal; what the database would keep is dropped, apart from the demo's feedback (./mailer.ts)
import type { VideoMode, Lesson, DemoRecord } from '../../../server/src/db';
export type { VideoMode, Lesson, DemoRecord, Teacher, JournalRecord, LoadSample } from '../../../server/src/db';

export const VIDEO_MODES: readonly VideoMode[] = ['all', 'teacherSees', 'teacher', 'none'];
export const isAuthKey = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
export const MAX_LESSONS_PER_TEACHER = 1000;
export class LessonLimitError extends Error {}

export const hasJournal = false;
export const hasPasswordReset = false;
export const hasDemo = true;

export async function migrate() {}

const lessonsByCode = new Map<string, Lesson>();
let lastLessonId = 0;

export async function createLesson(teacherId: number | null = null, videoMode: VideoMode = 'all'): Promise<Lesson> {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const a = new Uint8Array(10);
  crypto.getRandomValues(a);
  const code = Array.from(a, b => alphabet[b % alphabet.length]).join('');
  const lesson: Lesson = { id: ++lastLessonId, code, teacherId, videoMode };
  lessonsByCode.set(code, lesson);
  return lesson;
}

export async function getLessonByCode(code: string) { return lessonsByCode.get(code) ?? null; }
export async function setLessonVideoMode(code: string, videoMode: VideoMode) {
  const l = lessonsByCode.get(code);
  if (l) l.videoMode = videoMode;
  return videoMode;
}
export async function deleteLesson(code: string) { lessonsByCode.delete(code); }
export async function cleanupExpiredLessons() { return 0; }

export async function saveDemo(_d: DemoRecord) {}
export async function loadCurrentDemos(): Promise<DemoRecord[]> { return []; }
export async function saveBooking() {}
export async function loadCurrentBookings() { return []; }
export async function saveDemoFeedback() {}
export async function addDemoIpStats() {}
export async function saveLoadSample() {}
export async function cleanupDemoLogs() {}

// accounts: there are none in the demo
export async function verifyTeacher() { return null; }
export async function getTeacherSessionVersion() { return null; }
export async function checkPassword() { return false; }
export async function changePassword() { return null; }
export async function getJournal() { return null; }
export async function saveJournal() { return null; }
export async function startPasswordReset() { return null; }
export async function peekPasswordReset() { return 'wrong code' as const; }
export async function finishPasswordReset() { return null; }

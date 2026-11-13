import 'dotenv/config';
import { createServer } from 'http';
import crypto from 'crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Server, type Socket } from 'socket.io';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import {
  verifyTeacher, checkPassword, getTeacherSessionVersion, createLesson, LessonLimitError, migrate, VIDEO_MODES, type VideoMode, getLessonByCode, cleanupExpiredLessons, setLessonVideoMode,
  isAuthKey, getJournal, saveJournal, changePassword, hasJournal,
  hasPasswordReset, startPasswordReset, peekPasswordReset, finishPasswordReset,
  hasDemo, deleteLesson, saveDemo, loadCurrentDemos, saveBooking, loadCurrentBookings, saveDemoFeedback, addDemoIpStats, saveLoadSample, cleanupDemoLogs,
  type DemoRecord,
} from './db';
import {
  parseMaterial, MaterialError, MAX_MATERIAL_JSON_BYTES, mediaCatalog, emptySlidesState, blockSlides, currentScene,
  studentScenes, studentScene, scenesMedia, allowedHashes, type SlidesState, type Material,
} from './slides';
import type { Block, Scene } from './slides';
import { MediaRelay, type ChunkMsg } from './mediaRelay';
import { Throttle, hashIp } from './demoGuard';
import { BOTS, SOLO_SEATS, SOLO_MIN_SEATS, scatteredSeat, soloBlockOpen, BotRun } from './demoBots';
import { bookableStarts, isHeld, peakTaken, type BookingMode, type BookingRecord } from './booking';
import { createSampler } from './loadSampler';
import { canSendMail, sendMail, canSendFeedback, cleanFeedback, sendFeedback, sendDemoFeedback, FEEDBACK_PER_IP_PER_HOUR } from './mailer';
import { RecordingTap } from './recorder';
import { parsePoll, parseChoice, teacherView, studentView, newRun, answersOpen, timeUp, POLL_MAX_SECONDS, type PollRun } from './poll';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

const LIVEKIT_URL = requireEnv('LIVEKIT_URL');
const LIVEKIT_WS_URL = requireEnv('LIVEKIT_WS_URL');
const API_KEY = requireEnv('LIVEKIT_API_KEY');
const API_SECRET = requireEnv('LIVEKIT_API_SECRET');
const JWT_SECRET = requireEnv('JWT_SECRET');

const livekit = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);

// Teacher session tokens: signed with teacherId + sessionVersion, capped at TOKEN_TTL_SECONDS
// absolute, and additionally cut short after IDLE_TIMEOUT_MS with no authenticated use at all
// (see verifyTeacherToken). Logging in bumps session_version in the DB, which instantly
// invalidates any older token — that's what stops a shared password from keeping two sessions
// alive at once. Both timings live in .env (not hardcoded) so they can be tuned without a deploy.
const TOKEN_TTL_SECONDS = Number(process.env.TOKEN_TTL_SECONDS) || 24 * 60 * 60;
const IDLE_TIMEOUT_MS = (Number(process.env.IDLE_TIMEOUT_MINUTES) || 60) * 60 * 1000;

interface TeacherTokenPayload { teacherId: number; sessionVersion: number }

function signTeacherToken(teacherId: number, sessionVersion: number): string {
  return jwt.sign({ teacherId, sessionVersion }, JWT_SECRET, { expiresIn: TOKEN_TTL_SECONDS });
}

const lastTeacherActivity = new Map<number, number>();

async function verifyTeacherToken(token: string): Promise<number | null> {
  let payload: TeacherTokenPayload;
  try {
    payload = jwt.verify(token, JWT_SECRET) as TeacherTokenPayload;
  } catch {
    return null;
  }
  const currentVersion = await getTeacherSessionVersion(payload.teacherId).catch(() => null);
  if (currentVersion === null || currentVersion !== payload.sessionVersion) return null;
  const last = lastTeacherActivity.get(payload.teacherId);
  if (last !== undefined && Date.now() - last > IDLE_TIMEOUT_MS) {
    lastTeacherActivity.delete(payload.teacherId);
    return null;
  }
  lastTeacherActivity.set(payload.teacherId, Date.now());
  return payload.teacherId;
}

interface AuthedRequest extends Request { teacherId?: number; demoCode?: string }

// A demo lesson has no account: the one who started it holds a token for that lesson alone
function signDemoToken(code: string): string {
  return jwt.sign({ demoCode: code }, JWT_SECRET, { audience: 'demo', expiresIn: Math.round(DEMO_LESSON_MS / 1000) + 2 * 60 * 60 });
}

function verifyDemoToken(token: unknown): string | null {
  if (typeof token !== 'string' || !token) return null;
  try {
    return (jwt.verify(token, JWT_SECRET, { audience: 'demo' }) as { demoCode?: string }).demoCode ?? null;
  } catch {
    return null;
  }
}

const bearerToken = (req: Request) => {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
};

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = bearerToken(req);
  const teacherId = token ? await verifyTeacherToken(token) : null;
  if (teacherId === null) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.teacherId = teacherId;
  next();
}

async function requireTeacherOrDemo(req: AuthedRequest, res: Response, next: NextFunction) {
  const demoCode = verifyDemoToken(bearerToken(req));
  if (demoCode) { req.demoCode = demoCode; next(); return; }
  await requireAuth(req, res, next);
}

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});
// The lesson structure (slides JSON) may be a few MB; everything else is small
const smallJson = express.json();
const materialJson = express.json({ limit: MAX_MATERIAL_JSON_BYTES });
// The teacher's journal: ciphertext the server can't read, one per teacher
const MAX_JOURNAL_BYTES = Number(process.env.MAX_JOURNAL_BYTES) || 1024 * 1024;
const journalJson = express.json({ limit: MAX_JOURNAL_BYTES + 4096 });
app.use((req, res, next) => (
  /^\/lessons\/[^/]+\/material$/.test(req.path) ? materialJson
  : req.path === '/journal' || req.path === '/password' || req.path === '/password/reset' ? journalJson
  : smallJson
)(req, res, next));

app.post('/login', async (req, res) => {
  const ip = clientIpFromReq(req);
  if (isLockedOut(loginAttempts, ip)) {
    res.status(429).json({ error: 'too many attempts' });
    return;
  }
  const { email, authKey, password } = req.body ?? {};
  if (typeof email !== 'string' || !isAuthKey(authKey)) {
    res.status(400).json({ error: 'email and authKey are required' });
    return;
  }
  const teacher = await verifyTeacher(email, authKey, password).catch(() => null);
  if (teacher === 'upgrade') {
    res.status(428).json({ error: 'send the password once' });
    return;
  }
  if (!teacher) {
    recordFailedAttempt(loginAttempts, ip);
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }
  clearAttempts(loginAttempts, ip);
  const token = signTeacherToken(teacher.id, teacher.sessionVersion);
  res.json({ teacher: { id: teacher.id, email: teacher.email, name: teacher.name }, token });
});

/** Students' video never goes to other students: a child's picture could be recorded and passed on
 *  by a classmate. 'all' stays readable (old lessons, old clients) but means «only the teacher sees» */
function safeVideoMode(mode: VideoMode): VideoMode {
  return mode === 'all' ? 'teacherSees' : mode;
}

app.post('/lessons', requireAuth, async (req: AuthedRequest, res) => {
  const requested = (req.body as { videoMode?: unknown } | undefined)?.videoMode;
  const videoMode: VideoMode = safeVideoMode(VIDEO_MODES.includes(requested as VideoMode) ? requested as VideoMode : 'teacherSees');
  // The class's code from the last time: the same group comes in by the same code
  const { reuse, strict } = (req.body ?? {}) as { reuse?: unknown; strict?: unknown };
  if (typeof reuse === 'string' && reuse.length <= 40) {
    const old = await getLessonByCode(reuse).catch(() => null);
    if (old && old.teacherId === req.teacherId && !demos.has(old.code)) {
      const live = lessons.get(old.code);
      if (live && !live.ended) { res.json({ lesson: old, reused: true }); return; } // still on: just back in
      const full = realLessonRefusal(videoMode);
      if (full) { res.status(429).json({ error: full }); return; }
      const mode = await setLessonVideoMode(old.code, videoMode).catch(() => null);
      if (mode === null) { res.status(500).json({ error: 'failed to create lesson' }); return; }
      res.json({ lesson: { ...old, videoMode: mode }, reused: true });
      return;
    }
    // A typed code that isn't this teacher's: no new lesson in its place, joining tells why
    if (strict === true) { res.status(404).json({ error: 'not reusable' }); return; }
  }
  const full = realLessonRefusal(videoMode);
  if (full) { res.status(429).json({ error: full }); return; }
  const lesson = await createLesson(req.teacherId!, videoMode).catch(e => e as Error);
  if (lesson instanceof LessonLimitError) {
    res.status(429).json({ error: 'too many lessons' });
    return;
  }
  if (lesson instanceof Error) {
    res.status(500).json({ error: 'failed to create lesson' });
    return;
  }
  res.json({ lesson });
});

const isJournalData = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_JOURNAL_BYTES;

app.get('/journal', requireAuth, async (req: AuthedRequest, res) => {
  if (!hasJournal) { res.status(503).json({ error: 'journal unavailable' }); return; }
  const journal = await getJournal(req.teacherId!).catch(() => undefined);
  if (journal === undefined) { res.status(500).json({ error: 'failed to load journal' }); return; }
  res.json({ journal });
});

app.put('/journal', requireAuth, async (req: AuthedRequest, res) => {
  if (!hasJournal) { res.status(503).json({ error: 'journal unavailable' }); return; }
  const { version, data } = req.body ?? {};
  if (!Number.isInteger(version) || version < 0 || !isJournalData(data)) {
    res.status(400).json({ error: 'version and data are required' });
    return;
  }
  const saved = await saveJournal(req.teacherId!, version, data).catch(() => undefined);
  if (saved === undefined) { res.status(500).json({ error: 'failed to save journal' }); return; }
  if (saved === null) { res.status(409).json({ error: 'journal has changed' }); return; }
  res.json({ version: saved });
});

// Password change: the journal's key rewrapped by the new password comes along. A forgotten
// password is reset by mail instead (/password/forgot below).
app.post('/password', requireAuth, async (req: AuthedRequest, res) => {
  const ip = clientIpFromReq(req);
  if (isLockedOut(loginAttempts, ip)) {
    res.status(429).json({ error: 'too many attempts' });
    return;
  }
  const { authKey, newAuthKey, journal } = req.body ?? {};
  const journalOk = journal === null || (Number.isInteger(journal?.version) && isJournalData(journal?.data));
  if (!isAuthKey(authKey) || !isAuthKey(newAuthKey) || !journalOk) {
    res.status(400).json({ error: 'authKey, newAuthKey and journal are required' });
    return;
  }
  const result = await changePassword(req.teacherId!, authKey, newAuthKey, journal).catch(() => null);
  if (result === 'wrong password') {
    recordFailedAttempt(loginAttempts, ip);
    res.status(401).json({ error: 'wrong password' });
    return;
  }
  if (result === 'conflict') { res.status(409).json({ error: 'journal has changed' }); return; }
  if (result === null) { res.status(500).json({ error: 'failed to change password' }); return; }
  clearAttempts(loginAttempts, ip);
  res.json({ ok: true });
});

// Forgotten password: a code by mail, then a new password. The answer to «send the code» is the
// same whether such an account exists or not, so it can't be used to find out who's registered.
const resetAttempts = new Map<string, AttemptEntry>();
const isEmail = (v: unknown): v is string => typeof v === 'string' && v.length <= 254 && /^[^\s@]+@[^\s@]+$/.test(v);
const isResetCode = (v: unknown): v is string => typeof v === 'string' && /^\d{6}$/.test(v);

app.post('/password/forgot', async (req, res) => {
  const ip = clientIpFromReq(req);
  if (isLockedOut(resetAttempts, ip)) { res.status(429).json({ error: 'too many attempts' }); return; }
  if (!hasPasswordReset || !canSendMail()) { res.status(503).json({ error: 'password reset unavailable' }); return; }
  const email = (req.body ?? {}).email;
  if (!isEmail(email)) { res.status(400).json({ error: 'email is required' }); return; }
  recordFailedAttempt(resetAttempts, ip); // every request counts: no more than a few letters a minute from one place
  const reset = await startPasswordReset(email).catch(e => { console.error('password reset:', e); return null; });
  res.json({ ok: true });
  if (!reset) return;
  // sent after the answer, so its timing doesn't tell that the account exists
  sendMail(reset.email, `Код для смены пароля: ${reset.code}`, [
    'Здравствуйте!',
    '',
    `Код для смены пароля на teacher.co-learn.ru: ${reset.code}`,
    '',
    'Код действует 15 минут. Если вы не просили сменить пароль, просто не обращайте внимания на это письмо: без кода пароль не изменить.',
    '',
    'Кооперативное обучение',
  ].join('\n')).catch(e => console.error('password reset mail:', e));
});

app.post('/password/reset/check', async (req, res) => {
  const ip = clientIpFromReq(req);
  if (isLockedOut(resetAttempts, ip)) { res.status(429).json({ error: 'too many attempts' }); return; }
  const { email, code } = req.body ?? {};
  if (!isEmail(email) || !isResetCode(code)) { res.status(400).json({ error: 'email and code are required' }); return; }
  const result = await peekPasswordReset(email, code).catch(() => undefined);
  if (result === undefined) { res.status(500).json({ error: 'failed to check the code' }); return; }
  if (result === 'wrong code') {
    recordFailedAttempt(resetAttempts, ip);
    res.status(401).json({ error: 'wrong code' });
    return;
  }
  // the journal is ciphertext: opening it takes the recovery code, which only the teacher has
  res.json({ journal: result });
});

app.post('/password/reset', async (req, res) => {
  const ip = clientIpFromReq(req);
  if (isLockedOut(resetAttempts, ip)) { res.status(429).json({ error: 'too many attempts' }); return; }
  const { email, code, newAuthKey, journal } = req.body ?? {};
  const journalOk = journal === null || (Number.isInteger(journal?.version) && isJournalData(journal?.data));
  if (!isEmail(email) || !isResetCode(code) || !isAuthKey(newAuthKey) || !journalOk) {
    res.status(400).json({ error: 'email, code, newAuthKey and journal are required' });
    return;
  }
  const result = await finishPasswordReset(email, code, newAuthKey, journal).catch(e => { console.error('password reset:', e); return null; });
  if (result === 'wrong code') {
    recordFailedAttempt(resetAttempts, ip);
    res.status(401).json({ error: 'wrong code' });
    return;
  }
  if (result === 'conflict') { res.status(409).json({ error: 'journal has changed' }); return; }
  if (result === null) { res.status(500).json({ error: 'failed to reset the password' }); return; }
  clearAttempts(resetAttempts, ip);
  res.json({ ok: true });
});

// A journal is encrypted by the password as typed: a typo there would lock it for good
app.post('/password/check', requireAuth, async (req: AuthedRequest, res) => {
  const ip = clientIpFromReq(req);
  if (isLockedOut(loginAttempts, ip)) {
    res.status(429).json({ error: 'too many attempts' });
    return;
  }
  const { authKey } = req.body ?? {};
  if (!isAuthKey(authKey)) { res.status(400).json({ error: 'authKey is required' }); return; }
  const ok = await checkPassword(req.teacherId!, authKey).catch(() => null);
  if (ok === null) { res.status(500).json({ error: 'failed to check password' }); return; }
  if (!ok) {
    recordFailedAttempt(loginAttempts, ip);
    res.status(401).json({ error: 'wrong password' });
    return;
  }
  clearAttempts(loginAttempts, ip);
  res.json({ ok: true });
});

// ---------- lesson material (structure only; the file stays in the teacher's browser) ----------

// Server-wide limits, so one teacher (or a dozen) can't eat the server's memory
const MAX_MATERIALS_PER_TEACHER = 3;
const MAX_MATERIALS_TOTAL_BYTES = 300 * 1024 * 1024;

async function ownLesson(req: AuthedRequest, res: Response): Promise<string | null> {
  const given = String(req.params.code);
  const dbLesson = await getLessonByCode(joinAliases.get(given) ?? given).catch(() => null);
  if (!dbLesson) { res.status(404).json({ error: 'lesson not found' }); return null; }
  const owner = demos.has(dbLesson.code) ? req.demoCode === dbLesson.code
    : !req.demoCode && (dbLesson.teacherId === null || dbLesson.teacherId === req.teacherId);
  if (!owner) { res.status(403).json({ error: 'not your lesson' }); return null; }
  return dbLesson.code;
}

app.post('/lessons/:code/material', requireTeacherOrDemo, async (req: AuthedRequest, res) => {
  const code = await ownLesson(req, res);
  if (!code) return;
  let material: Material;
  try { material = parseMaterial(req.body, req.teacherId ?? null); } catch (e) {
    if (e instanceof MaterialError) { res.status(400).json({ error: e.message }); return; }
    throw e;
  }
  const others = [...lessons.entries()].filter(([c, l]) => c !== code && l.material);
  if (material.teacherId !== null && others.filter(([, l]) => l.material!.teacherId === material.teacherId).length >= MAX_MATERIALS_PER_TEACHER) {
    res.status(429).json({ error: 'too many lessons with material' }); return;
  }
  if (others.reduce((n, [, l]) => n + l.material!.bytes, 0) + material.bytes > MAX_MATERIALS_TOTAL_BYTES) {
    res.status(503).json({ error: 'server busy' }); return;
  }
  const lesson = getLessonRuntime(code, req.teacherId ?? null);
  if (!lesson) { res.status(429).json({ error: 'too many open lessons' }); return; }
  const same = lesson.material?.id === material.id;
  const runningLive = lesson.block && isLiveBlock(lesson.block) ? lesson.block : null;
  keepLiveBlocks(material, lesson.material, same);
  setMaterial(code, lesson, material, { keepState: same });
  if (runningLive && !same) resumeBlock(lesson, runningLive);
  console.log(`[${code}] material ${same ? 'resent' : 'loaded'}: "${material.title}", ${material.media.size} media, ${Math.round(material.bytes / 1024)} KB`);
  res.json({ ok: true });
});

app.delete('/lessons/:code/material', requireTeacherOrDemo, async (req: AuthedRequest, res) => {
  const code = await ownLesson(req, res);
  if (!code) return;
  const lesson = lessons.get(code);
  if (lesson) {
    // the tasks added during the lesson stay without the file
    const live = lesson.material?.blocks.filter(b => isLiveBlock(b.id)) ?? [];
    const runningLive = lesson.block && isLiveBlock(lesson.block) ? lesson.block : null;
    setMaterial(code, lesson, live.length ? liveMaterial(live) : null);
    if (runningLive) resumeBlock(lesson, runningLive);
  }
  res.json({ ok: true });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 5e6, // a task's starting board may carry pictures (block:add)
});

type Role = 'teacher' | 'student' | 'board';
type Stage = 'waiting' | 'group' | 'individual' | 'pairs' | 'fours';
const STAGES: readonly Stage[] = ['waiting', 'group', 'individual', 'pairs', 'fours'];

interface Participant {
  id: string;
  name: string;
  role: Role;
  livekitRoom: string | null;
  uuid: string | null; // the student's profile in their browser; only teachers get to see it
  avatar: string | null; // id of a picture from the clients' built-in set (avatars/<id>.svg)
  newcomer?: boolean; // not let into the class yet: seen and heard by the teacher only
  teacherName?: string; // a student's name for the teacher; never sent to classmates
  bot?: boolean; // a simulated student of the solo demo: no socket behind the id
  quiet?: boolean; // a teacher in a group's room unseen and unheard: listens and watches the board only
}

// Seating
export interface Seat {
  id: string;
  groupIndex: number;
  row: number;   // 0 = верхняя пара, 1 = нижняя пара
  col: number;   // 0 = левый, 1 = правый
  occupant: string | null;
  reserved: boolean; // kept by the seat plan for a certain student
  extra?: number; // on an added desk (0, 1) for newcomers to a class with a saved seating
}

type UnderstoodMark = 'yes' | 'no';

// Everything scoped to one lesson (one teacher + their students). Keyed by lesson code.
interface LessonRuntime {
  videoMode: VideoMode; // from the DB, fixed for the lesson
  teacherId: number | null; // owner, for the per-teacher limit
  stage: Stage;
  atDesks: boolean;                // before the lesson: the teacher let those seated go to their fours
  timerEndsAt: number | null;      // the stage timer's end while it runs (the teacher starts it), else null
  timerTotalMs: number | null;     // the block's time, as set; null: no timer
  timerLeftMs: number | null;      // what is left while the timer stands (not started yet, or paused)
  timerBeeps: NodeJS.Timeout[];    // the signals to everyone: 15 s before that end, and at it
  activity: Map<string, Activity>; // the running work block: student name → how much they talked and wrote
  activitySent: NodeJS.Timeout | null; // a send to the teacher is due
  activitySince: number;           // counting began (the stage or block began)
  participants: Map<string, Participant>;
  seats: Seat[];
  seatPlan: Map<string, string>; // from the teacher's journal, in memory only: student uuid → seat id
  sharedTexts: Map<string, string>; // per livekit room name
  boards: Map<string, Map<string, BoardObject>>; // per livekit room name: uid → object JSON, in z-order
  roomsByBlock: Map<string, Map<string, string>>; // work block id → student name → the room they wrote in there
  boardConnections: Map<string, { room: string }>; // board-only (mobile webview) viewers
  polls: Map<string, PollRun>;     // the answers to each poll block, by block id
  material: Material | null;
  slides: SlidesState;
  closed: boolean;                 // no new students: only those who have been here get back in
  seen: Set<string>;               // uuids of the students who have been in this lesson
  joinCode: string | null;         // replaced by the teacher: the code newcomers need now
  block: string | null;            // the lesson block running now (null: no lesson file, or not started)
  marks: Map<string, UnderstoodMark>; // the last "всем понятно?": student name → their answer
  vote: NodeJS.Timeout | null;     // while the question is on the students' screens
  relay: MediaRelay;
  emptySince: number | null;
  visited: boolean; // someone has been in: from then on it holds its place until it's over
  noTeacherSince: number | null; // since when no teacher is in (left, or never came yet); null while one is in
  ended: boolean;                  // the lesson was ended — dropped from memory as soon as nobody is left
  afterUntil: number | null;       // after-lesson chat in fours (teacher gone) lasts until; then the lesson ends
  afterTimer: NodeJS.Timeout | null;
  bots: BotRun | null;             // the solo demo's simulated class
  teacherLook: TeacherLook | null; // the teacher's name and photo for students, in memory only
  startedAt: number | null;        // «Начать урок» was pressed (the stage left 'waiting'); null again once it's over
  rec: RecordingTap;               // the teacher records: students' traffic is copied to them (recorder.ts)
}

interface TeacherLook { title: string; photo: string | null }
const TEACHER_TITLE_MAX = 40;
const TEACHER_PHOTO_MAX = 200_000; // a small picture made in the teacher's browser
function teacherLookOf(v: unknown): TeacherLook | null {
  const { title, photo } = (v ?? {}) as { title?: unknown; photo?: unknown };
  if (typeof title !== 'string') return null;
  const okPhoto = photo === null || (typeof photo === 'string' && photo.length <= TEACHER_PHOTO_MAX
    && /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(photo));
  if (!okPhoto) return null;
  return { title: title.trim().slice(0, TEACHER_TITLE_MAX), photo: photo as string | null };
}

const lessons = new Map<string, LessonRuntime>();

// ---------- limits for the whole server ----------
// Refusals only ever touch a new lesson or a new arrival: nothing already running is cut off.
// Upper bounds on real lessons are separate from the demo pool, so demos can't use up their place.
const envNumber = (name: string, fallback: number) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};
const MAX_REAL_LESSONS = envNumber('MAX_REAL_LESSONS', 2);
const MAX_REAL_VIDEO_LESSONS = envNumber('MAX_REAL_VIDEO_LESSONS', 1);
const MAX_STUDENTS_PER_LESSON = envNumber('MAX_STUDENTS_PER_LESSON', 32);
const MAX_PARTICIPANTS_TOTAL = envNumber('MAX_PARTICIPANTS_TOTAL', 500);

/** Holds a place: someone is in, or was and may come back (the absent-teacher rule ends it otherwise) */
function holdsPlace(code: string, lesson: LessonRuntime): boolean {
  return !lesson.ended && (lesson.visited || !isEmpty(code, lesson));
}

const realPeople = (l: LessonRuntime) => [...l.participants.values()].filter(p => !p.bot);

function realLessonRefusal(videoMode: VideoMode): 'server full' | 'video full' | null {
  const live = [...lessons.entries()].filter(([c, l]) => !demos.has(c) && holdsPlace(c, l)).map(([, l]) => l);
  if (live.length >= MAX_REAL_LESSONS) return 'server full';
  if (videoMode !== 'none' && live.filter(l => l.videoMode !== 'none').length >= MAX_REAL_VIDEO_LESSONS) return 'video full';
  return null;
}

/** Why this person can't come in now, if so. Checked right before joining, with no await in between. */
function joinRefusal(code: string, videoMode: VideoMode, role: Role, uuid: string | null): string | null {
  const lesson = lessons.get(code);
  if (role !== 'teacher' && demos.get(code)?.videoMode === 'solo') return 'lesson full'; // the class is simulated
  if (role === 'board') return null;
  if (role === 'student') {
    const others = lesson ? [...lesson.participants.values()].filter(p => p.role === 'student' && (!uuid || p.uuid !== uuid)) : [];
    if (others.length >= MAX_STUDENTS_PER_LESSON) return 'lesson full';
    const total = [...lessons.values()].reduce((n, l) => n + realPeople(l).length, 0);
    if (total >= MAX_PARTICIPANTS_TOTAL) return 'server full';
  }
  if (demos.has(code) || (lesson && holdsPlace(code, lesson))) return null;
  return realLessonRefusal(videoMode);
}

// ---------- demo lessons ----------
// No account and so no journal. A lesson is booked for a set time: the class is gathered in
// advance, so the place has to be certain before anyone is told to come.
const MINUTE_MS = 60 * 1000;
const DEMO_LESSON_MS = envNumber('DEMO_LESSON_MINUTES', 60) * MINUTE_MS;
const DEMO_NO_STUDENTS_MS = envNumber('DEMO_NO_STUDENTS_MINUTES', 15) * MINUTE_MS; // counted from the start
const DEMO_OPENS_EARLY_MS = envNumber('DEMO_OPENS_EARLY_MINUTES', 15) * MINUTE_MS;
const DEMO_NO_SHOW_MS = envNumber('DEMO_NO_SHOW_MINUTES', 15) * MINUTE_MS; // counted from the start
const DEMO_NO_SHOW_BAR_MS = envNumber('DEMO_NO_SHOW_BAR_HOURS', 24) * 60 * MINUTE_MS;
const DEMO_BOOK_AHEAD_MS = envNumber('DEMO_BOOK_AHEAD_DAYS', 7) * 24 * 60 * MINUTE_MS;
const DEMO_BOOK_STEP_MS = envNumber('DEMO_BOOK_STEP_MINUTES', 30) * MINUTE_MS;
const DEMO_ENDED_REMEMBERED_MS = 10 * MINUTE_MS; // those who come back after the end are told so, not sent looking
const DEMO_SLOTS: Record<BookingMode, number> = { teacher: envNumber('DEMO_CAMERA_SLOTS', 3), none: envNumber('DEMO_AUDIO_SLOTS', 10) };

const demos = new Map<string, DemoRecord>();
const bookings = new Map<string, BookingRecord>();
const DEMO_SOLO_MS = envNumber('DEMO_SOLO_MINUTES', 30) * MINUTE_MS;
const DEMO_SOLO_ABSENT_MS = envNumber('DEMO_SOLO_ABSENT_MINUTES', 2) * MINUTE_MS;
const DEMO_SOLO_NO_TEACHER_MS = envNumber('DEMO_SOLO_NO_TEACHER_MINUTES', 1) * MINUTE_MS;
// Started and never joined is what a script does, the page joins by itself. Repeating that mustn't hold places.
const DEMO_SOLO_EMPTY_BAR_MS = envNumber('DEMO_SOLO_EMPTY_BAR_MINUTES', 10) * MINUTE_MS;
const DEMO_SOLO_MAX = envNumber('DEMO_SOLO_MAX', 50);
const DEMO_SOLO_PER_IP = envNumber('DEMO_SOLO_PER_IP', 3); // a school shares one address
const SOLO_STAGES = ['waiting', 'group', 'individual', 'pairs', 'fours'];
const demoThrottle = new Throttle();
const demoIpCounts = new Map<string, { attempts: number; refused: number; penalties: number }>();

function saveDemoLater(d: DemoRecord) {
  saveDemo(d).catch(e => console.error('!!! demo lesson not saved:', e));
}

function saveBookingLater(b: BookingRecord) {
  saveBooking(b).catch(e => console.error('!!! booking not saved:', e));
}

const demosRunning = (mode: BookingMode) => [...demos.values()].filter(d => d.videoMode === mode && d.endedAt === null).length;
const opensAt = (startsAt: number) => startsAt - DEMO_OPENS_EARLY_MS;
const bookingWindow = (startsAt: number) => ({ from: opensAt(startsAt), to: startsAt + DEMO_LESSON_MS });

function placesLeft(mode: BookingMode, startsAt: number): number {
  const held = [...bookings.values()].filter(b => isHeld(b) && b.videoMode === mode).map(b => bookingWindow(b.startsAt));
  return DEMO_SLOTS[mode] - peakTaken(held, bookingWindow(startsAt));
}

/** The door opens: from here on the booking is a running demo lesson. Safe to call more than once. */
function openBooking(b: BookingRecord) {
  if (b.status !== 'booked') return;
  b.status = 'open';
  const demo: DemoRecord = {
    code: b.code, ipHash: b.ipHash, videoMode: b.videoMode, createdAt: Date.now(), endsAt: b.startsAt + DEMO_LESSON_MS,
    firstStudentAt: null, peakStudents: 0, endedAt: null, endReason: null, cooldownUntil: 0, slotFreeAt: 0,
  };
  demos.set(b.code, demo);
  saveDemoLater(demo);
  saveBookingLater(b);
  console.log(`[${b.code}] booked demo open (${b.videoMode})`);
}

/** Marks the demo as over; safe to call from every path that ends a lesson */
function stopBots(lesson: LessonRuntime) {
  lesson.bots?.stop();
  lesson.bots = null;
  for (const [id, p] of lesson.participants) if (p.bot) lesson.participants.delete(id);
}

function closeDemo(code: string, reason: string) {
  const demo = demos.get(code);
  if (!demo || demo.endedAt !== null) return;
  const now = Date.now();
  demo.endedAt = now;
  demo.endReason = reason;
  demo.cooldownUntil = now + DEMO_ENDED_REMEMBERED_MS;
  demo.slotFreeAt = now;
  saveDemoLater(demo);
  const booking = bookings.get(code);
  if (booking?.status === 'open') {
    booking.status = 'over';
    saveBookingLater(booking);
  }
  deleteLesson(code).catch(e => console.error('!!! demo lesson code not deleted:', e));
  console.log(`[${code}] demo over (${reason}): peak ${demo.peakStudents} students`);
}

function demoEndInfo(demo: DemoRecord) {
  return { reason: demo.endReason };
}

/** The simulated class comes in by itself: nothing here is connected to anybody */
function startBots(code: string, lesson: LessonRuntime) {
  const fast = !!demos.get(code)?.fast;
  lesson.atDesks = false; // the simulated class waits in the room, as its script expects
  createSeats(lesson, SOLO_SEATS);
  broadcastSeats(code, lesson);
  const bots = new BotRun({
    seat(i) {
      const { name, avatar } = BOTS[i];
      const id = `bot:${i}`;
      if (lesson.seats.some(s => s.occupant === name)) return;
      if (!lesson.participants.has(id)) lesson.participants.set(id, { id, name, role: 'student', livekitRoom: null, uuid: null, avatar, bot: true });
      // testing (?fast): straight to the first two desks, as if the teacher had gathered them
      const seat = fast ? lesson.seats.filter(s => !s.occupant && s.extra === undefined && s.groupIndex < 2)[0] : scatteredSeat(lesson.seats);
      if (seat) seat.occupant = name;
      broadcastSeats(code, lesson);
      broadcastState(code, lesson);
    },
    rooms: () => [...new Set(realBotRooms(lesson))].sort(),
    write: (room, obj, author) => applyBoardOp(lesson, room, { t: 'add', obj }, author ?? 'Ученик', false, ''),
    talk: (name, ms) => noteTalk(lesson, name, ms),
    members: room => [...lesson.participants.values()].filter(p => p.bot && p.livekitRoom === room).map(p => p.name),
    call(room, note, who) {
      for (const id of socketsOf(lesson, 'teacher')) io.sockets.sockets.get(id)?.emit('callTeacher', { room, calling: true, note, who });
    },
    say(room, clip) {
      // to the teacher wherever they are: on coming into the room mid-line they hear the rest of it
      for (const id of socketsOf(lesson, 'teacher')) io.sockets.sockets.get(id)?.emit('demoVoice', { room, ...clip, now: Date.now() });
    },
    vote(name, choice) {
      const cur = currentPoll(lesson);
      if (!cur || !answersOpen(cur.run) || cur.run.answers.has(name)) return;
      cur.run.answers.set(name, [choice]);
      sendPollToTeachers(lesson);
    },
  });
  lesson.bots = bots;
  bots.seatEveryone(fast);
}

const realBotRooms = (lesson: LessonRuntime) =>
  [...lesson.participants.values()].filter(p => p.bot && p.livekitRoom).map(p => p.livekitRoom!);

function soloReached(code: string, stage: string) {
  const demo = demos.get(code);
  if (demo?.videoMode !== 'solo' || SOLO_STAGES.indexOf(stage) <= SOLO_STAGES.indexOf(demo.reached ?? 'waiting')) return;
  demo.reached = stage;
  saveDemoLater(demo);
}

const demoStart = (demo: DemoRecord) => demo.endsAt - DEMO_LESSON_MS;

function demoStudentCame(demo: DemoRecord, students: number) {
  const first = demo.firstStudentAt === null;
  if (first) demo.firstStudentAt = Date.now();
  if (students > demo.peakStudents) demo.peakStudents = students;
  if (first) saveDemoLater(demo);
}

function countDemoIp(ipHash: string, field: 'attempts' | 'refused' | 'penalties') {
  const counts = demoIpCounts.get(ipHash) ?? { attempts: 0, refused: 0, penalties: 0 };
  counts[field] += 1;
  demoIpCounts.set(ipHash, counts);
}

const isUuid = (v: unknown): v is string =>
  typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

// Lessons of one teacher held in memory at once. Lessons nobody is in are dropped first
// (they come back empty — seating, boards and material start over); only lessons that
// actually have people in them count against the limit.
const MAX_OPEN_LESSONS_PER_TEACHER = Number(process.env.MAX_OPEN_LESSONS_PER_TEACHER) || 5;

/** Nobody connected, including sockets still in the middle of joining */
function isEmpty(code: string, lesson: LessonRuntime): boolean {
  return realPeople(lesson).length === 0 && lesson.boardConnections.size === 0 && !io.sockets.adapter.rooms.get(code)?.size;
}

function dropLesson(code: string, why: string) {
  const lesson = lessons.get(code);
  if (!lesson) return;
  closeDemo(code, why);
  stopBots(lesson);
  lesson.relay.dispose();
  if (lesson.afterTimer) clearTimeout(lesson.afterTimer);
  if (lesson.activitySent) clearTimeout(lesson.activitySent);
  for (const t of lesson.timerBeeps) clearTimeout(t);
  if (lesson.joinCode) joinAliases.delete(lesson.joinCode);
  lessons.delete(code);
  console.log(`[${code}] dropped from memory (${why})`);
}

/** The lesson's runtime, created if needed; null if the teacher already has too many open lessons */
function getLessonRuntime(code: string, teacherId: number | null): LessonRuntime | null {
  let lesson = lessons.get(code);
  if (lesson) return lesson;
  if (teacherId !== null) {
    const mine = [...lessons.entries()].filter(([, l]) => l.teacherId === teacherId);
    if (mine.length >= MAX_OPEN_LESSONS_PER_TEACHER) {
      const empty = mine.filter(([c, l]) => isEmpty(c, l)).sort(([, a], [, b]) => (a.emptySince ?? 0) - (b.emptySince ?? 0));
      const excess = mine.length - MAX_OPEN_LESSONS_PER_TEACHER + 1;
      if (empty.length < excess) return null;
      for (const [c] of empty.slice(0, excess)) dropLesson(c, 'teacher opened another lesson');
    }
  }
  lesson = {
    videoMode: 'teacherSees',
    teacherId,
    stage: 'waiting',
    atDesks: true, // those seated wait at their desks until the teacher calls everyone in
    timerEndsAt: null,
    timerTotalMs: null,
    timerLeftMs: null,
    timerBeeps: [],
    activity: new Map(),
    activitySent: null,
    activitySince: Date.now(),
    participants: new Map(),
    seats: [],
    seatPlan: new Map(),
    sharedTexts: new Map(),
    boards: new Map(),
    roomsByBlock: new Map(),
    boardConnections: new Map(),
    polls: new Map(),
    material: null,
    slides: emptySlidesState(),
    closed: false,
    seen: new Set(),
    joinCode: null,
    block: null,
    marks: new Map(),
    vote: null,
    relay: new MediaRelay(io, code),
    emptySince: Date.now(),
    visited: false,
    noTeacherSince: Date.now(),
    ended: false,
    teacherLook: null,
    startedAt: null,
    rec: new RecordingTap(),
    afterUntil: null,
    afterTimer: null,
    bots: null,
  };
  lessons.set(code, lesson);
  return lesson;
}

// LiveKit room names must be unique across ALL lessons, so every room is prefixed with the lesson code.
function roomName(code: string, base: string): string {
  return `${code}:${base}`;
}

function createSeats(lesson: LessonRuntime, n: number) {
  const prev = new Map(lesson.seats.map(s => [s.id, s.occupant]));
  const extras = lesson.seats.filter(s => s.extra !== undefined);
  const planned = new Set(lesson.seatPlan.values());
  lesson.seats = [];
  const numGroups = Math.floor(n / 4);
  for (let g = 0; g < numGroups; g++) {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const id = `g${g}r${row}c${col}`;
        lesson.seats.push({ id, groupIndex: g, row, col, occupant: prev.get(id) ?? null, reserved: planned.has(id) });
      }
    }
  }
  for (const s of extras) lesson.seats.push({ ...s, groupIndex: numGroups + s.extra! });
}

// A class with a saved seating keeps its seats for its students. Anyone else goes to an added desk
// until the teacher has talked to them and found them a place. Two desks at most: whoever comes
// after that waits for a seat, so a crowd with the code can't take over the lesson.
const MAX_EXTRA_DESKS = 2;

function freeExtraSeat(lesson: LessonRuntime): Seat | undefined {
  const free = lesson.seats.find(s => s.extra !== undefined && !s.occupant);
  if (free) return free;
  const desks = new Set(lesson.seats.filter(s => s.extra !== undefined).map(s => s.extra)).size;
  if (desks >= MAX_EXTRA_DESKS) return undefined;
  const groupIndex = Math.max(-1, ...lesson.seats.map(s => s.groupIndex)) + 1;
  const added: Seat[] = [];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 2; col++) {
    added.push({ id: `x${desks}r${row}c${col}`, groupIndex, row, col, occupant: null, reserved: false, extra: desks });
  }
  lesson.seats.push(...added);
  return added[0];
}

function dropEmptyExtraDesks(lesson: LessonRuntime) {
  for (let desk = MAX_EXTRA_DESKS - 1; desk >= 0; desk--) {
    const seats = lesson.seats.filter(s => s.extra === desk);
    if (seats.some(s => s.occupant)) return;
    lesson.seats = lesson.seats.filter(s => s.extra !== desk);
  }
}

/** Where this student belongs now. A newcomer has a room of their own, where only the teacher comes */
function roomOf(code: string, lesson: LessonRuntime, p: Participant): string {
  const seat = lesson.seats.find(s => s.occupant === p.name);
  const base = isNewcomer(lesson, p) || lesson.stage === 'individual' ? `individual-${p.name}`
    : lesson.stage === 'pairs' && seat ? `pair-g${seat.groupIndex}-r${seat.row}`
    : (lesson.stage === 'fours' || lesson.atDesks) && seat ? `fours-${seat.groupIndex + 1}` : 'main-room';
  return roomName(code, base);
}

async function placeStudent(code: string, lesson: LessonRuntime, p: Participant) {
  const room = roomOf(code, lesson, p);
  if (p.livekitRoom === room) return;
  await prepareRoom(lesson, room);
  await sendToRoom(code, lesson, p.id, room);
}

/** Camera for the teacher's map, through the main room: not for someone the class mustn't see yet */
async function sendMonitor(code: string, lesson: LessonRuntime, p: Participant) {
  if (lesson.videoMode === 'teacherSees' || !canVideo(lesson, p.role) || isNewcomer(lesson, p)) return;
  const mainRoom = roomName(code, 'main-room');
  io.sockets.sockets.get(p.id)?.emit('monitor', { url: LIVEKIT_WS_URL, token: await makeCameraOnlyToken(p.name, mainRoom), room: mainRoom });
}

/** Seats changed or someone came: newcomers take the free places of the added desks, in order of arrival */
async function settleSeats(code: string, lesson: LessonRuntime) {
  if (lesson.seatPlan.size) {
    const taken = new Set(lesson.seats.map(s => s.occupant));
    for (const p of lesson.participants.values()) {
      if (p.role !== 'student' || taken.has(p.name)) continue;
      const seat = freeExtraSeat(lesson);
      if (!seat) break;
      seat.occupant = p.name;
    }
  }
  dropEmptyExtraDesks(lesson);
  broadcastSeats(code, lesson);
  // Taken to a seat of the class, or a seating came and they aren't in it: they change sides
  const changed = [...lesson.participants.values()].filter(p => p.role === 'student' && !p.bot && !!p.newcomer !== isNewcomer(lesson, p));
  for (const p of changed) {
    p.newcomer = isNewcomer(lesson, p);
    await placeStudent(code, lesson, p);
    await sendMonitor(code, lesson, p);
  }
  if (changed.length) broadcastState(code, lesson);
  await settleDesks(code, lesson);
}

/** Before the lesson the seated are at their desks: a change of seat is a change of room */
async function settleDesks(code: string, lesson: LessonRuntime) {
  if (!lesson.atDesks) return;
  for (const p of lesson.participants.values()) if (p.role === 'student') await placeStudent(code, lesson, p);
  broadcastState(code, lesson);
}

/** The teacher walked up to a desk and the class is called back: they come along */
async function bringTeachersToMain(code: string, lesson: LessonRuntime) {
  const room = roomName(code, 'main-room');
  for (const id of socketsOf(lesson, 'teacher')) await sendToRoom(code, lesson, id, room);
}

const MAX_CAPACITY = MAX_STUDENTS_PER_LESSON;
const MAX_NICK = 20;

/** Whether this seat is kept for someone other than this student */
function reservedForOther(lesson: LessonRuntime, seat: Seat, uuid: string | null): boolean {
  return seat.reserved && (uuid === null || lesson.seatPlan.get(uuid) !== seat.id);
}

/** Sit this student on their planned seat, if they have one and it's free */
function seatByPlan(lesson: LessonRuntime, p: Participant): boolean {
  const seatId = p.uuid ? lesson.seatPlan.get(p.uuid) : undefined;
  const seat = lesson.seats.find(s => s.id === seatId);
  if (!seat || seat.occupant) return false;
  for (const s of lesson.seats) if (s.occupant === p.name) s.occupant = null;
  seat.occupant = p.name;
  return true;
}

function applySeatPlan(lesson: LessonRuntime, capacity: unknown, plan: unknown) {
  // grows only: the teacher may have added seats in this lesson, and nobody loses theirs
  if (Number.isInteger(capacity) && (capacity as number) > lesson.seats.length && (capacity as number) <= MAX_CAPACITY) {
    createSeats(lesson, capacity as number);
  }
  const entries = plan && typeof plan === 'object' ? Object.entries(plan).slice(0, MAX_CAPACITY) : [];
  lesson.seatPlan = new Map(entries.filter((e): e is [string, string] => isUuid(e[0]) && typeof e[1] === 'string'));
  const planned = new Set(lesson.seatPlan.values());
  for (const seat of lesson.seats) seat.reserved = planned.has(seat.id);
  for (const p of lesson.participants.values()) if (p.role === 'student') seatByPlan(lesson, p);
}

/** Students are told apart by uuid; one more "Кот" in the lesson becomes "Кот 2" */
function uniqueName(lesson: LessonRuntime, name: string, uuid: string | null): string {
  const taken = new Set([...lesson.participants.values()].filter(p => p.role === 'student' && (!uuid || p.uuid !== uuid)).map(p => p.name));
  let unique = name;
  for (let n = 2; taken.has(unique); n++) unique = `${name} ${n}`;
  return unique;
}

/** Added desks are the teacher's business; a student there sees only their own seat */
function seatsFor(lesson: LessonRuntime, p: Participant): Seat[] {
  return p.role === 'teacher' ? lesson.seats : lesson.seats.filter(s => s.extra === undefined || s.occupant === p.name);
}

function broadcastSeats(code: string, lesson: LessonRuntime) {
  for (const p of lesson.participants.values()) io.sockets.sockets.get(p.id)?.emit('seats', seatsFor(lesson, p));
}

/** A class with a saved seating lets in only those on a seat of the class */
function isNewcomer(lesson: LessonRuntime, p: Participant): boolean {
  return p.role === 'student' && lesson.seatPlan.size > 0 && !lesson.seats.some(s => s.occupant === p.name && s.extra === undefined);
}

const inClass = (lesson: LessonRuntime) => Array.from(lesson.participants.values()).filter(p => p.role === 'student' && !isNewcomer(lesson, p));

// ---------- Голосование (poll.ts) ----------

/** The poll of the running block and its answers so far */
function currentPoll(lesson: LessonRuntime) {
  const block = lesson.stage === 'waiting' ? null : lesson.material?.blocks.find(b => b.id === lesson.block);
  if (!block?.poll) return null;
  let run = lesson.polls.get(block.id);
  if (!run) {
    run = newRun(block.poll); lesson.polls.set(block.id, run);
    closeOnTime(lesson, block.id, run);
  }
  return { blockId: block.id, poll: block.poll, run };
}

/** When the time to answer runs out, everyone hears of it at once: answers close on the screens */
const pollTimers = new WeakMap<PollRun, NodeJS.Timeout>();
function closeOnTime(lesson: LessonRuntime, blockId: string, run: PollRun) {
  clearTimeout(pollTimers.get(run));
  if (run.endsAt === null) return;
  pollTimers.set(run, setTimeout(() => {
    pollTimers.delete(run);
    if (lesson.polls.get(blockId) === run && currentPoll(lesson)?.run === run) sendPoll(lesson);
  }, Math.max(0, run.endsAt - Date.now()) + 50));
}

function sendPoll(lesson: LessonRuntime, to?: Socket) {
  const cur = currentPoll(lesson);
  const sendTo = (id: string) => {
    const p = lesson.participants.get(id);
    const sock = io.sockets.sockets.get(id);
    if (!p || !sock) return;
    sock.emit('poll', !cur ? null : p.role === 'teacher' ? teacherView(cur.blockId, cur.poll, cur.run) : studentView(cur.blockId, cur.poll, cur.run, p.name));
  };
  if (to) return sendTo(to.id);
  for (const id of lesson.participants.keys()) sendTo(id);
}

/** Answers come one by one: the teachers hear of them at most a few times a second */
const pollSent = new WeakMap<LessonRuntime, NodeJS.Timeout>();
function sendPollToTeachers(lesson: LessonRuntime) {
  if (pollSent.has(lesson)) return;
  pollSent.set(lesson, setTimeout(() => {
    pollSent.delete(lesson);
    const cur = currentPoll(lesson);
    for (const id of socketsOf(lesson, 'teacher')) io.sockets.sockets.get(id)?.emit('poll', cur && teacherView(cur.blockId, cur.poll, cur.run));
  }, 300));
}

function demoState(code: string) {
  const demo = demos.get(code);
  if (!demo || demo.endedAt !== null) return null;
  return { endsAt: demo.endsAt, solo: demo.videoMode === 'solo', noStudentsAt: demo.firstStudentAt === null ? demoStart(demo) + DEMO_NO_STUDENTS_MS : null };
}

function lessonStateBase(code: string, lesson: LessonRuntime) {
  return {
    stage: lesson.stage,
    atDesks: lesson.atDesks,
    videoMode: lesson.videoMode,
    timerEndsAt: lesson.timerEndsAt,
    timer: { totalMs: lesson.timerTotalMs, leftMs: lesson.timerLeftMs },
    afterUntil: lesson.afterUntil,
    demo: demoState(code),
    now: Date.now(), // the clients' clocks may be off; the demo's times are the server's
  };
}

/** Who this participant sees: a newcomer is seen by the teacher only (and by themselves) */
function participantsSeenBy(lesson: LessonRuntime, viewer: Participant | null) {
  const everyone = Array.from(lesson.participants.values()).map(p => ({
    id: p.id, name: p.name, role: p.role, livekitRoom: p.livekitRoom, avatar: p.avatar,
  }));
  if (viewer?.role === 'teacher') return everyone;
  const newcomers = new Set(Array.from(lesson.participants.values()).filter(p => isNewcomer(lesson, p)).map(p => p.id));
  return everyone.filter(o => !newcomers.has(o.id) || o.id === viewer?.id);
}

function broadcastState(code: string, lesson: LessonRuntime) {
  const state = lessonStateBase(code, lesson);
  for (const p of lesson.participants.values()) {
    io.sockets.sockets.get(p.id)?.emit('state', { ...state, participants: participantsSeenBy(lesson, p) });
  }
  for (const id of lesson.boardConnections.keys()) {
    io.sockets.sockets.get(id)?.emit('state', { ...state, participants: participantsSeenBy(lesson, null) });
  }
  // Only for the teacher: a student's uuid is what seats them, classmates must not learn it
  const uuids = Object.fromEntries(Array.from(lesson.participants.values()).filter(p => p.uuid).map(p => [p.id, p.uuid]));
  const names = Object.fromEntries(Array.from(lesson.participants.values()).filter(p => p.teacherName).map(p => [p.name, p.teacherName]));
  for (const id of socketsOf(lesson, 'teacher')) {
    const sock = io.sockets.sockets.get(id);
    sock?.emit('studentUuids', uuids);
    sock?.emit('studentNames', names);
  }
}

// ---------- recording (recorder.ts) ----------

const recordingLive = (lesson: LessonRuntime) => lesson.startedAt !== null && !lesson.ended && !lesson.afterUntil;

/** What a student has on screen now, as the events that brought it there */
function studentSnapshot(code: string, lesson: LessonRuntime, p: Participant): [string, unknown][] {
  const out: [string, unknown][] = [
    ['state', { ...lessonStateBase(code, lesson), participants: participantsSeenBy(lesson, p) }],
    ['seats', seatsFor(lesson, p)],
    ['slides:view', studentSlidesView(lesson)],
    ['earlierBoards', earlierBoardsFor(lesson, p)],
  ];
  if (lesson.teacherLook) out.push(['teacherLook', lesson.teacherLook]);
  if (p.livekitRoom) {
    out.push(['livekit', { url: LIVEKIT_WS_URL, room: p.livekitRoom }]);
    out.push(['sharedText', { room: p.livekitRoom, text: lesson.sharedTexts.get(p.livekitRoom) ?? '' }]);
    out.push(['boardState', boardState(lesson, p.livekitRoom)]);
  }
  const poll = currentPoll(lesson);
  if (poll) out.push(['poll', studentView(poll.blockId, poll.poll, poll.run, p.name)]);
  return out;
}

/** Recording runs while a teacher records and the lesson is on; `fresh` — a teacher (re)joined it */
function updateRecording(code: string, lesson: LessonRuntime, fresh = false) {
  const tap = lesson.rec;
  const live = tap.listeners.size > 0 && recordingLive(lesson);
  if (live && (!tap.active || fresh)) {
    tap.active = true;
    for (const p of lesson.participants.values()) {
      if (p.role === 'student' && !p.bot) tap.snapshot(p.name, studentSnapshot(code, lesson, p));
    }
  } else if (!live && tap.active) {
    flushRecording(lesson);
    tap.active = false;
  }
  const status = { live: recordingLive(lesson), startedAt: lesson.startedAt, now: Date.now() };
  for (const id of tap.listeners) io.sockets.sockets.get(id)?.emit('rec:status', status);
  syncRecordingRooms(lesson).catch(e => console.error('recording rooms:', e));
}

function flushRecording(lesson: LessonRuntime) {
  const entries = lesson.rec.take();
  if (!entries.length) return;
  for (const id of lesson.rec.listeners) io.sockets.sockets.get(id)?.emit('rec:events', entries);
}

/** Listens in a room for the recording: hears everyone, publishes nothing, nobody sees it there */
async function makeRecorderToken(room: string): Promise<string> {
  const token = new AccessToken(API_KEY, API_SECRET, { identity: `~rec-${crypto.randomBytes(4).toString('hex')}` });
  token.addGrant({ roomJoin: true, room, canPublish: false, canPublishData: false, canSubscribe: true, hidden: true });
  return await token.toJwt();
}

/** The teacher's browser listens to every room where someone of the lesson is */
async function syncRecordingRooms(lesson: LessonRuntime) {
  const tap = lesson.rec;
  const rooms = tap.active
    ? [...new Set([...lesson.participants.values()].filter(p => !p.bot && p.livekitRoom).map(p => p.livekitRoom!))].sort()
    : [];
  const key = rooms.join('\n');
  if (key === tap.rooms) return;
  tap.rooms = key;
  const list = await Promise.all(rooms.map(async room => ({ room, token: await makeRecorderToken(room) })));
  if (tap.rooms !== key) return; // changed again meanwhile: the newer list goes out instead
  for (const id of tap.listeners) io.sockets.sockets.get(id)?.emit('rec:rooms', { url: LIVEKIT_WS_URL, rooms: list });
}

setInterval(() => {
  for (const lesson of lessons.values()) {
    if (!lesson.rec.listeners.size) continue;
    flushRecording(lesson);
    syncRecordingRooms(lesson).catch(e => console.error('recording rooms:', e));
  }
}, 500);

// ---------- slides ----------

function socketsOf(lesson: LessonRuntime, role: Role): string[] {
  return Array.from(lesson.participants.values()).filter(p => p.role === role).map(p => p.id);
}

/** End of the lesson (teacher's button, or the teacher has been gone too long): material is
 *  forgotten, students are told and sent away; once nobody is left the lesson leaves memory. */
function endLesson(code: string, lesson: LessonRuntime, why: string) {
  closeDemo(code, why);
  stopBots(lesson);
  lesson.ended = true;
  lesson.startedAt = null;
  updateRecording(code, lesson);
  lesson.stage = 'waiting';
  setStageTimer(lesson, null);
  lesson.afterUntil = null;
  if (lesson.afterTimer) { clearTimeout(lesson.afterTimer); lesson.afterTimer = null; }
  setMaterial(code, lesson, null);
  broadcastState(code, lesson);
  for (const id of socketsOf(lesson, 'student')) {
    const s = io.sockets.sockets.get(id);
    s?.emit('lessonEnded');
    s?.disconnect(true); // don't rely on the client leaving by itself
  }
  for (const id of lesson.boardConnections.keys()) io.sockets.sockets.get(id)?.disconnect(true);
  const demo = demos.get(code);
  if (demo) {
    for (const id of socketsOf(lesson, 'teacher')) {
      const s = io.sockets.sockets.get(id);
      s?.emit('demoEnded', demoEndInfo(demo));
      s?.disconnect(true);
    }
  }
  console.log(`[${code}] lesson ended (${why})`);
  dropIfEnded(code);
}

/** An ended lesson (or one in its after-lesson chat) nobody is in any more — nothing to keep */
function dropIfEnded(code: string) {
  setImmediate(() => {
    const lesson = lessons.get(code);
    if (lesson && (lesson.ended || lesson.afterUntil) && isEmpty(code, lesson)) dropLesson(code, 'ended');
  });
}

const MAX_AFTER_LESSON_MINUTES = 15;

/** The teacher ends the lesson but lets students talk in their fours for a few minutes.
 *  Fresh LiveKit rooms (no token the teacher ever got opens them) and the teacher is sent away
 *  and can't rejoin until it's over — «Учитель покинул занятие» must be true. */
async function startAfterLesson(code: string, lesson: LessonRuntime, minutes: number) {
  lesson.afterUntil = Date.now() + minutes * 60 * 1000;
  lesson.startedAt = null;
  updateRecording(code, lesson); // the talk after the lesson is not recorded
  lesson.stage = 'fours';
  lesson.atDesks = false;
  setStageTimer(lesson, null);
  setMaterial(code, lesson, null);
  for (const id of socketsOf(lesson, 'teacher')) io.sockets.sockets.get(id)?.disconnect(true);
  await assignFours(code, lesson, 'after-fours');
  broadcastState(code, lesson);
  lesson.afterTimer = setTimeout(() => endLesson(code, lesson, 'after-lesson chat over'), minutes * 60 * 1000);
  console.log(`[${code}] lesson ended, ${minutes} min after-lesson chat`);
}

function teacherMaterial(lesson: LessonRuntime) {
  const m = lesson.material;
  return m && { id: m.id, title: m.title, blocks: m.blocks };
}

function teacherSlidesState(lesson: LessonRuntime) {
  const st = lesson.slides;
  const scene = currentScene(lesson.material, st);
  return {
    block: lesson.block,
    active: st.active,
    blockId: st.blockId,
    index: st.index,
    revealed: scene ? Array.from(st.revealed.get(scene.id) ?? []) : [],
    positions: scene ? st.positions.get(scene.id) ?? {} : {},
  };
}

function studentSlidesView(lesson: LessonRuntime) {
  const s = studentScenes(lesson.material, lesson.slides);
  const block = lesson.material?.blocks.find(b => b.id === lesson.block);
  const work = block && WORK_STAGES.includes(block.type) ? { task: block.task, readOnly: block.sheetReadOnly } : {};
  if (!s) return { active: false, ...work };
  return {
    ...work,
    active: true,
    index: lesson.slides.index,
    count: blockSlides(lesson.material, lesson.slides.blockId).length,
    scene: s.scene,
    next: s.next, // so the client can preload its media
    media: scenesMedia(lesson.material!, s.next ? [s.scene, s.next] : [s.scene]), // name → hash/size/type
  };
}

/** Push slide state to everyone in the lesson; teachers also get the material when it changed */
function broadcastSlides(lesson: LessonRuntime, opts: { material?: boolean } = {}) {
  for (const id of socketsOf(lesson, 'teacher')) {
    const sock = io.sockets.sockets.get(id);
    if (opts.material) sock?.emit('slides:material', teacherMaterial(lesson));
    sock?.emit('slides:state', teacherSlidesState(lesson));
  }
  const view = studentSlidesView(lesson);
  for (const id of socketsOf(lesson, 'student')) io.sockets.sockets.get(id)?.emit('slides:view', view);
  sendEarlierBoards(lesson);
  sendPoll(lesson);
  lesson.relay.setAllowed([...new Set([...allowedHashes(lesson.material, lesson.slides), ...earlierHashes(lesson)])]);
}

// ---------- boards of earlier stages ----------
// The lesson file says which earlier work blocks' boards a block shows: each student sees the one
// they wrote on there themselves — alone, with their pair or their four — only to look at.

const WORK_STAGES: readonly string[] = ['individual', 'pairs', 'fours'];

/** Remember where a student writes in the running work block */
function noteRoom(lesson: LessonRuntime, p: Participant) {
  const block = lesson.material?.blocks.find(b => b.id === lesson.block);
  if (p.role !== 'student' || !p.livekitRoom || !block || !WORK_STAGES.includes(block.type) || block.type !== lesson.stage) return;
  let rooms = lesson.roomsByBlock.get(block.id);
  if (!rooms) { rooms = new Map(); lesson.roomsByBlock.set(block.id, rooms); }
  rooms.set(p.name, p.livekitRoom);
}

function earlierBlocks(lesson: LessonRuntime): Block[] {
  const block = lesson.material?.blocks.find(b => b.id === lesson.block);
  if (!block || !WORK_STAGES.includes(block.type)) return [];
  return block.boardsFrom.map(id => lesson.material!.blocks.find(b => b.id === id)).filter((b): b is Block => !!b);
}

/** Media of the earlier sheets: students may need them again (after a reload, say) */
function earlierHashes(lesson: LessonRuntime): string[] {
  const scenes = earlierBlocks(lesson).flatMap(b => b.slides.map(s => studentScene(s, lesson.slides)));
  return lesson.material ? Object.values(scenesMedia(lesson.material, scenes)).map(m => m.hash) : [];
}

function earlierBoardsFor(lesson: LessonRuntime, p: Participant) {
  const blocks = [];
  const scenes: Scene[] = [];
  for (const b of earlierBlocks(lesson)) {
    const room = lesson.roomsByBlock.get(b.id)?.get(p.name);
    if (!room) continue; // wasn't there then
    const sheets = b.slides.length
      ? b.slides.map(sc => {
          const scene = studentScene(sc, lesson.slides);
          scenes.push(scene);
          return { scene, objects: [...(boardAt(lesson, `${room}#${sc.id}`)?.values() ?? [])] };
        })
      : [{ scene: null, objects: [...(boardAt(lesson, `${room}#${b.id}`)?.values() ?? [])] }];
    blocks.push({ id: b.id, title: b.title, type: b.type, sheets });
  }
  return { blocks, media: lesson.material ? scenesMedia(lesson.material, scenes) : {} };
}

function sendEarlierBoards(lesson: LessonRuntime, only?: string) {
  for (const id of socketsOf(lesson, 'student')) {
    if (only && id !== only) continue;
    const p = lesson.participants.get(id);
    if (p) io.sockets.sockets.get(id)?.emit('earlierBoards', earlierBoardsFor(lesson, p));
  }
}

function setMaterial(code: string, lesson: LessonRuntime, material: Material | null, { keepState = false } = {}) {
  lesson.material = material;
  if (!keepState) {
    lesson.slides = emptySlidesState();
    lesson.block = null;
    setStageTimer(lesson, null);
    lesson.relay.setCatalog(mediaCatalog(material));
    // Opened in the middle of the lesson: pick up from the first block of the stage already running
    const running = material?.blocks.find(b => b.type === lesson.stage);
    if (running) enterBlock(lesson, running);
  }
  broadcastSlides(lesson, { material: true });
  pushBoards(lesson);
}

// ---------- tasks added during the lesson ----------
// The teacher may change the course of the lesson: a new block of any kind goes into the plan right
// after the running one, with or without a lesson file. It lives in the lesson's memory only.

const LIVE_TYPES: readonly string[] = ['group', 'individual', 'pairs', 'fours', 'poll'];
const LIVE_TITLES: Record<string, string> = { group: 'Объяснение', individual: 'Индивидуально', pairs: 'В парах', fours: 'В четвёрках', poll: 'Голосование' };
const isLiveBlock = (id: string) => id.startsWith('live-');
let liveSeq = 0;
const STARTER_MAX_OBJECTS = 500;
const STARTER_MAX_BYTES = 4_000_000;
const lastAdded = new WeakMap<LessonRuntime, { id: string; during: string | null }>();

function liveMaterial(blocks: Block[]): Material {
  return { id: `live:${crypto.randomUUID()}`, title: '', blocks, media: new Map(), bytes: 0, teacherId: null };
}

/** A lesson file (re)sent: the added tasks stay — in their places if it's the same file, after its blocks if not */
function keepLiveBlocks(next: Material, old: Material | null, same: boolean) {
  if (!old?.blocks.some(b => isLiveBlock(b.id))) return;
  if (same) {
    const fresh = new Map(next.blocks.map(b => [b.id, b]));
    const order = old.blocks.map(b => (isLiveBlock(b.id) ? b : fresh.get(b.id))).filter((b): b is Block => !!b);
    next.blocks = [...order, ...next.blocks.filter(b => !order.includes(b))];
  } else next.blocks.push(...old.blocks.filter(b => isLiveBlock(b.id)));
}

/** The added task that was running goes on running under the new material */
function resumeBlock(lesson: LessonRuntime, blockId: string) {
  const block = lesson.material?.blocks.find(b => b.id === blockId);
  if (!block) return;
  const pollStarts = !!block.poll && block.id !== lesson.block && !lesson.polls.has(block.id);
  enterBlock(lesson, block);
  broadcastSlides(lesson);
  pushBoards(lesson);
}

function addLiveBlock(lesson: LessonRuntime, b: { type?: unknown; title?: unknown; task?: unknown; minutes?: unknown; board?: unknown; poll?: unknown }): Block | null {
  if (typeof b.type !== 'string' || !LIVE_TYPES.includes(b.type)) return null;
  const poll = b.type === 'poll' ? parsePoll(b.poll) : undefined;
  if (poll === null) return null;
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const minutes = typeof b.minutes === 'number' && Number.isInteger(b.minutes) && b.minutes >= 1 && b.minutes <= 120 ? b.minutes : null;
  const block: Block = {
    id: `live-${Date.now().toString(36)}-${++liveSeq}`, type: b.type, title: text(b.title, 120) || LIVE_TITLES[b.type],
    task: b.type === 'group' || poll ? '' : text(b.task, 2000), sheetReadOnly: false, boardsFrom: [], duration: minutes, slides: [],
    ...(poll ? { poll } : {}),
  };
  // the teacher's starting board for every room: whole or not at all
  if (!poll && Array.isArray(b.board) && b.board.length) {
    const objs = b.board;
    if (objs.length > STARTER_MAX_OBJECTS || JSON.stringify(objs).length > STARTER_MAX_BYTES) return null;
    if (!objs.every(o => isBoardObject(o) && boardObjectAllowed(o, true))) return null;
    block.starter = objs.map(o => ({ ...(o as BoardObject), author: 'Учитель' }));
  }
  if (!lesson.material) lesson.material = liveMaterial([]);
  const blocks = lesson.material.blocks;
  if (blocks.filter(x => isLiveBlock(x.id)).length >= 100) return null;
  // several added while one block runs line up in the order they were added
  const last = lastAdded.get(lesson);
  const anchor = last && last.during === lesson.block && blocks.some(x => x.id === last.id) ? last.id : lesson.block;
  const at = blocks.findIndex(x => x.id === anchor);
  blocks.splice(at < 0 ? blocks.length : at + 1, 0, block);
  lastAdded.set(lesson, { id: block.id, during: lesson.block });
  return block;
}

/** Make a block the current one. Its slides are on the board at once: in the explanation for all
 *  to see, in a work block as the sheet each group writes on */
function enterBlock(lesson: LessonRuntime, block: Block) {
  const st = lesson.slides;
  if (block.id !== st.blockId) { st.blockId = block.id; st.index = 0; }
  st.active = block.slides.length > 0;
  lesson.block = block.id;
}

async function changeStage(code: string, lesson: LessonRuntime, stage: Stage) {
  const wereAtDesks = lesson.atDesks;
  if (stage !== lesson.stage) resetActivity(lesson); // who talked and wrote is counted for each stage anew
  lesson.stage = stage;
  lesson.atDesks = false;
  if (stage === 'waiting') setStageTimer(lesson, null); // back to the seating: no block runs
  console.log(`[${code}] stage -> ${stage}`);
  if (stage !== 'waiting' && lesson.startedAt === null) { lesson.startedAt = Date.now(); updateRecording(code, lesson); }
  if (stage === 'pairs') await assignPairs(code, lesson);
  else if (stage === 'fours') await assignFours(code, lesson);
  else if (stage === 'individual') await assignIndividual(code, lesson);
  else await sendAllToMain(code, lesson);
  if (wereAtDesks) await bringTeachersToMain(code, lesson);
  broadcastState(code, lesson);
  lesson.bots?.onStage(stage, lesson.block);
  soloReached(code, stage);
  sendPoll(lesson); // a poll is there only while its block runs, not on the seating
}

// ---------- who talks and writes, in pairs and fours ----------
// A student's browser tells how long its own microphone was talking (LiveKit's speaking flag, nothing is
// recorded); the board ops are counted here. The teacher sees both by each student without going to the desk.

interface Activity { talkMs: number; ops: number; lastTalk: number; lastOp: number; lastModAt: number }
const ACTIVITY_SEND_MS = 2000;
const TALK_REPORT_MAX_MS = 6000; // a client reports every few seconds: more than that at once isn't true

function activityOf(lesson: LessonRuntime, name: string): Activity {
  let a = lesson.activity.get(name);
  if (!a) { a = { talkMs: 0, ops: 0, lastTalk: 0, lastOp: 0, lastModAt: 0 }; lesson.activity.set(name, a); }
  return a;
}

function atWork(lesson: LessonRuntime): boolean {
  return lesson.stage === 'individual' || lesson.stage === 'pairs' || lesson.stage === 'fours';
}

function activityPayload(lesson: LessonRuntime) {
  return {
    now: Date.now(),
    since: lesson.activitySince,
    students: Object.fromEntries([...lesson.activity].map(([name, a]) =>
      [name, { talk: Math.round(a.talkMs / 1000), ops: a.ops, lastTalk: a.lastTalk || null, lastOp: a.lastOp || null }])),
  };
}

function sendActivity(lesson: LessonRuntime, to?: Socket) {
  if (to) { to.emit('activity', activityPayload(lesson)); return; }
  if (lesson.activitySent) return; // at most once in a while
  lesson.activitySent = setTimeout(() => {
    lesson.activitySent = null;
    const payload = activityPayload(lesson);
    for (const id of socketsOf(lesson, 'teacher')) io.sockets.sockets.get(id)?.emit('activity', payload);
  }, ACTIVITY_SEND_MS);
}

function resetActivity(lesson: LessonRuntime) {
  lesson.activity = new Map();
  lesson.activitySince = Date.now();
  if (lesson.activitySent) { clearTimeout(lesson.activitySent); lesson.activitySent = null; }
  const payload = activityPayload(lesson);
  for (const id of socketsOf(lesson, 'teacher')) io.sockets.sockets.get(id)?.emit('activity', payload);
}

function noteTalk(lesson: LessonRuntime, name: string, ms: number) {
  if (!atWork(lesson) || !(ms > 0)) return;
  const a = activityOf(lesson, name);
  a.talkMs += Math.min(ms, TALK_REPORT_MAX_MS);
  a.lastTalk = Date.now();
  sendActivity(lesson);
}

/** A stroke, a text, a shape counts once; moving or changing things — once in a couple of seconds */
function noteBoardOp(lesson: LessonRuntime, name: string, kind: unknown) {
  if (!atWork(lesson)) return;
  const a = activityOf(lesson, name);
  const now = Date.now();
  if (kind !== 'add') { if (now - a.lastModAt < 2000) return; a.lastModAt = now; }
  a.ops++;
  a.lastOp = now;
  sendActivity(lesson);
}

// ---------- time of a block ----------
const BEEP_BEFORE_MS = 15_000;

/** Signal to everyone in the lesson; students hear it, they don't see the time */
function beep(lesson: LessonRuntime, kind: 'soon' | 'end') {
  for (const id of lesson.participants.keys()) io.sockets.sockets.get(id)?.emit('stageBeep', kind);
}

/** The block's time starts now (or there's none): the old one's signals are off */
/** A block's time is set, not started: the teacher starts it, after explaining the task, say */
function setStageTimer(lesson: LessonRuntime, minutes: number | null) {
  lesson.timerTotalMs = minutes ? minutes * 60_000 : null;
  lesson.timerLeftMs = lesson.timerTotalMs;
  lesson.timerEndsAt = null;
  scheduleBeeps(lesson);
}

/** The signals to everyone: 15 s before the end and at it, while the timer runs */
function scheduleBeeps(lesson: LessonRuntime) {
  for (const t of lesson.timerBeeps) clearTimeout(t);
  lesson.timerBeeps = [];
  if (lesson.timerEndsAt === null) return;
  const left = lesson.timerEndsAt - Date.now();
  if (left <= 0) return;
  if (left > BEEP_BEFORE_MS * 2) lesson.timerBeeps.push(setTimeout(() => beep(lesson, 'soon'), left - BEEP_BEFORE_MS));
  lesson.timerBeeps.push(setTimeout(() => beep(lesson, 'end'), left));
}

/** The teacher's buttons under the timer */
function timerAction(lesson: LessonRuntime, action: unknown): boolean {
  const now = Date.now();
  const running = lesson.timerEndsAt !== null;
  if (action === 'start') {
    if (running || !lesson.timerLeftMs) return false;
    lesson.timerEndsAt = now + lesson.timerLeftMs;
    lesson.timerLeftMs = null;
  } else if (action === 'pause') {
    if (!running) return false;
    lesson.timerLeftMs = Math.max(0, lesson.timerEndsAt! - now);
    lesson.timerEndsAt = null;
  } else if (action === 'restart') {
    if (!lesson.timerTotalMs) return false;
    lesson.timerEndsAt = now + lesson.timerTotalMs;
    lesson.timerLeftMs = null;
  } else if (action === 'stop') {
    if (!running && !lesson.timerLeftMs) return false;
    lesson.timerEndsAt = null;
    lesson.timerLeftMs = 0;
  } else if (action === 'reset') {
    if (!lesson.timerTotalMs) return false;
    lesson.timerEndsAt = null;
    lesson.timerLeftMs = lesson.timerTotalMs;
  } else if (action === 'plus' || action === 'minus') {
    const d = action === 'plus' ? 60_000 : -60_000;
    const total = (lesson.timerTotalMs ?? 0) + d;
    if (total < 60_000 || total > 180 * 60_000) return false;
    lesson.timerTotalMs = total;
    // the time over already, when the minute is added to a timer that ran out: it counts from now
    if (running) lesson.timerEndsAt = Math.max(lesson.timerEndsAt!, now) + d;
    else lesson.timerLeftMs = Math.max(0, (lesson.timerLeftMs ?? 0) + d);
    if (running && lesson.timerEndsAt! <= now) { lesson.timerEndsAt = null; lesson.timerLeftMs = 0; }
  } else return false;
  scheduleBeeps(lesson);
  return true;
}

/** Where the class is for a block: a poll is answered by everyone together, as in an explanation */
function stageOf(block: Block): Stage | null {
  if (block.type === 'poll') return block.poll ? 'group' : null;
  return STAGES.includes(block.type as Stage) ? block.type as Stage : null;
}

async function startBlock(code: string, lesson: LessonRuntime, blockId: string) {
  const block = lesson.material?.blocks.find(b => b.id === blockId);
  const stage = block && stageOf(block);
  if (!block || !stage) return;
  // pressing the running block again doesn't start its time over
  if (block.id !== lesson.block || lesson.timerTotalMs === null) setStageTimer(lesson, block.duration);
  if (block.id !== lesson.block) resetActivity(lesson);
  // A new explanation is a new topic: last topic's marks would say nothing about it
  if (block.type === 'group' && block.id !== lesson.block) clearMarks(lesson);
  const pollStarts = !!block.poll && block.id !== lesson.block && !lesson.polls.has(block.id);
  enterBlock(lesson, block);
  broadcastSlides(lesson);
  pushBoards(lesson);
  if (stage !== lesson.stage) await changeStage(code, lesson, stage);
  else broadcastState(code, lesson); // the new block's time
  if (pollStarts && block.poll) lesson.bots?.onPoll(block.poll.options.length);
  // the same stage again: everyone stays where they are, and writes there for this block
  for (const p of lesson.participants.values()) noteRoom(lesson, p);
}

// ---------- who may come in ----------
// The lesson's own code stays (its rooms are named by it); a replaced code is only another way in.
// In memory, like the lesson itself: a server restart brings back the original code.
const joinAliases = new Map<string, string>(); // current replacement code → lesson code

async function unusedCode(): Promise<string> {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  for (;;) {
    const code = Array.from(crypto.randomBytes(10), b => alphabet[b % alphabet.length]).join('');
    if (!joinAliases.has(code) && !await getLessonByCode(code).catch(() => null)) return code;
  }
}

function sendEntry(code: string, lesson: LessonRuntime, to?: Socket) {
  const payload = { roomCode: code, joinCode: lesson.joinCode ?? code, closed: lesson.closed };
  if (to) { to.emit('entry', payload); return; }
  for (const id of socketsOf(lesson, 'teacher')) io.sockets.sockets.get(id)?.emit('entry', payload);
}

// ---------- "всем понятно?" at the end of an explanation ----------
const VOTE_SECONDS = 5;
const VOTE_GRACE_MS = 700; // an answer pressed at the last moment is still on its way

function sendMarks(lesson: LessonRuntime, to?: Socket) {
  const payload = { asking: !!lesson.vote, marks: Object.fromEntries(lesson.marks) };
  if (to) { to.emit('understood', payload); return; }
  for (const id of socketsOf(lesson, 'teacher')) io.sockets.sockets.get(id)?.emit('understood', payload);
}

function clearMarks(lesson: LessonRuntime) {
  if (lesson.vote) { clearTimeout(lesson.vote); lesson.vote = null; }
  lesson.marks = new Map();
  for (const id of socketsOf(lesson, 'student')) io.sockets.sockets.get(id)?.emit('understood:closed');
  sendMarks(lesson);
}

/** The simulated class answers so that every picture of the map shows up: a whole desk, a pair, one student */
/** The solo demo's class answers «Всем понятно?»: one says no — Глеб, who will get stuck and call on the next stage too;
 *  two keep silent */
function botAnswers(lesson: LessonRuntime) {
  const seated = lesson.seats.filter(s => s.occupant).map(s => s.occupant!);
  const lost = seated.includes('Глеб') ? 'Глеб' : seated[0];
  // two don't answer at all, as in a real class
  const silent = new Set(['Соня', 'Артём'].filter(n => seated.includes(n) && n !== lost));
  for (const name of seated) if (!silent.has(name)) lesson.marks.set(name, name === lost ? 'no' : 'yes');
}

function finishVote(lesson: LessonRuntime) {
  lesson.vote = null;
  if (lesson.bots) botAnswers(lesson);
  for (const id of socketsOf(lesson, 'student')) io.sockets.sockets.get(id)?.emit('understood:closed');
  sendMarks(lesson);
}

// ---------- shared board ----------
// One Fabric board per LiveKit room. Clients send per-object operations; the server keeps the
// current objects (for latecomers and room switches) and relays each operation to the room.
type BoardObject = Record<string, unknown> & { uid: string; type: string };
const BOARD_MAX_OBJECTS = 3000;
const BOARD_MAX_OP_BYTES = 256 * 1024;
const BOARD_MAX_PICTURE_BYTES = 400_000; // a picture the teacher put on the board (client-teacher BoardPictures.tsx)
const PICTURE_SRC = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

/** Nothing on a board may make the browsers showing it fetch anything: a picture comes inside the object */
function boardObjectAllowed(o: BoardObject, isTeacher: boolean): boolean {
  const size = JSON.stringify(o).length;
  const picture = o.type.toLowerCase() === 'image';
  if (size > (picture ? BOARD_MAX_PICTURE_BYTES : BOARD_MAX_OP_BYTES)) return false;
  if (picture) return isTeacher && typeof o.src === 'string' && PICTURE_SRC.test(o.src);
  if ('src' in o) return false;
  // a pattern fill or stroke would load its source
  for (const v of [o.fill, o.stroke]) if (v && typeof v === 'object') return false;
  return true;
}

/** Each slide or sheet (or block without any) keeps its own drawing, per room */
function boardKey(lesson: LessonRuntime, room: string): string {
  // what was drawn at a desk before the lesson doesn't stay on the lesson's board
  if (!lesson.block) return lesson.atDesks ? `${room}#before` : room;
  const scene = lesson.slides.active ? currentScene(lesson.material, lesson.slides) : null;
  return `${room}#${scene?.id ?? lesson.block}`;
}

/** A room's board for a block; the first look at it lays out the block's starting board, if it has one */
function boardAt(lesson: LessonRuntime, key: string): Map<string, BoardObject> | undefined {
  const board = lesson.boards.get(key);
  if (board) return board;
  const blockId = key.slice(key.lastIndexOf('#') + 1);
  const starter = lesson.material?.blocks.find(b => b.id === blockId)?.starter;
  if (!starter?.length) return undefined;
  const seeded = new Map(starter.map(o => [o.uid as string, { ...o } as BoardObject]));
  lesson.boards.set(key, seeded);
  return seeded;
}

function boardState(lesson: LessonRuntime, room: string): BoardObject[] {
  return Array.from(boardAt(lesson, boardKey(lesson, room))?.values() ?? []);
}

/** The slide or sheet changed: everyone gets its drawing in their room */
function pushBoards(lesson: LessonRuntime) {
  for (const [id, p] of lesson.participants) {
    if (p.livekitRoom) io.sockets.sockets.get(id)?.emit('boardState', boardState(lesson, p.livekitRoom));
  }
  for (const [id, bc] of lesson.boardConnections) {
    io.sockets.sockets.get(id)?.emit('boardState', boardState(lesson, bc.room));
  }
}

function isBoardObject(o: unknown): o is BoardObject {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const { uid, type } = o as Record<string, unknown>;
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 64 && typeof type === 'string' && type.length <= 32;
}

function applyBoardOp(lesson: LessonRuntime, room: string, raw: unknown, author: string, isTeacher: boolean, fromSocket: string) {
  if (!raw || typeof raw !== 'object') return;
  if (!isTeacher && lesson.material?.blocks.find(b => b.id === lesson.block)?.sheetReadOnly) return;
  const op = raw as { t?: unknown; obj?: unknown; uid?: unknown };
  const key = boardKey(lesson, room);
  let board = boardAt(lesson, key);
  if (!board) { board = new Map(); lesson.boards.set(key, board); }

  let out: unknown;
  if (op.t === 'add' || op.t === 'mod') {
    if (!isBoardObject(op.obj) || !boardObjectAllowed(op.obj, isTeacher)) return;
    const prev = board.get(op.obj.uid);
    if (!prev && board.size >= BOARD_MAX_OBJECTS) return;
    // the author is whoever created the object, as the server saw it
    const obj = { ...op.obj, author: (prev?.author as string | undefined) ?? author };
    board.set(obj.uid, obj);
    out = { t: op.t, obj };
  } else if (op.t === 'del') {
    if (typeof op.uid !== 'string' || !board.delete(op.uid)) return;
    out = { t: 'del', uid: op.uid };
  } else if (op.t === 'clear') {
    if (!isTeacher) return;
    board.clear();
    out = { t: 'clear' };
  } else return;
  if (!isTeacher) noteBoardOp(lesson, author, op.t);

  for (const [id, p] of lesson.participants) {
    if (p.livekitRoom === room && id !== fromSocket) io.sockets.sockets.get(id)?.emit('boardOp', out);
  }
  for (const [id, bc] of lesson.boardConnections) {
    if (bc.room === room && id !== fromSocket) io.sockets.sockets.get(id)?.emit('boardOp', out);
  }
}

/** May this participant show their camera in this lesson? */
function canVideo(lesson: LessonRuntime, role: Role): boolean {
  return lesson.videoMode === 'all' || (lesson.videoMode !== 'none' && role === 'teacher');
}

/** Second connection of a student: publishes the camera for the teacher, receives nothing */
async function makeCameraOnlyToken(identity: string, room: string): Promise<string> {
  const token = new AccessToken(API_KEY, API_SECRET, { identity });
  token.addGrant({ roomJoin: true, room, canPublish: true, canPublishData: false, canSubscribe: false,
    canPublishSources: [TrackSource.CAMERA] });
  return await token.toJwt();
}

/** The teacher watches the students' cameras and publishes nothing there */
async function makeCameraViewerToken(identity: string, room: string): Promise<string> {
  const token = new AccessToken(API_KEY, API_SECRET, { identity });
  token.addGrant({ roomJoin: true, room, canPublish: false, canPublishData: false, canSubscribe: true });
  return await token.toJwt();
}

/** The teacher's voice to the whole class: in a room of its own only the teacher speaks, and only the microphone */
async function makeVoiceSpeakerToken(identity: string, room: string): Promise<string> {
  const token = new AccessToken(API_KEY, API_SECRET, { identity });
  token.addGrant({ roomJoin: true, room, canPublish: true, canPublishData: false, canSubscribe: false, canPublishSources: [TrackSource.MICROPHONE] });
  return await token.toJwt();
}

/** ...and every student listens there all lesson long, unseen, saying nothing */
async function makeVoiceListenerToken(identity: string, room: string): Promise<string> {
  const token = new AccessToken(API_KEY, API_SECRET, { identity });
  token.addGrant({ roomJoin: true, room, canPublish: false, canPublishData: false, canSubscribe: true, hidden: true });
  return await token.toJwt();
}

/** The teacher's quiet visit: hidden from the room, may not publish anything */
async function makeQuietToken(identity: string, room: string): Promise<string> {
  const token = new AccessToken(API_KEY, API_SECRET, { identity });
  token.addGrant({ roomJoin: true, room, canPublish: false, canPublishData: false, canSubscribe: true, hidden: true });
  return await token.toJwt();
}

/** Without video the token itself forbids the camera, so no client can switch it on anyway */
async function makeLivekitToken(identity: string, room: string, video = true): Promise<string> {
  const token = new AccessToken(API_KEY, API_SECRET, { identity });
  token.addGrant(video
    ? { roomJoin: true, room, canPublish: true, canSubscribe: true }
    : { roomJoin: true, room, canPublish: true, canSubscribe: true,
        canPublishSources: [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] });
  return await token.toJwt();
}

// LiveKit makes a room by itself when someone joins; the solo demo has no one to wait for it
async function prepareRoom(lesson: LessonRuntime, room: string) {
  if (!lesson.bots) await livekit.createRoom({ name: room }).catch(() => {});
}

async function sendToRoom(code: string, lesson: LessonRuntime, socketId: string, room: string, quiet = false) {
  const participant = lesson.participants.get(socketId);
  if (participant?.bot) { participant.livekitRoom = room; noteRoom(lesson, participant); return; }
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) return;
  if (!participant) return;
  const token = quiet ? await makeQuietToken(participant.name, room) : await makeLivekitToken(participant.name, room, canVideo(lesson, participant.role));
  socket.emit('livekit', { url: LIVEKIT_WS_URL, token, room, quiet });
  participant.livekitRoom = room;
  participant.quiet = quiet || undefined;
  noteRoom(lesson, participant);
  socket.emit('sharedText', { room, text: lesson.sharedTexts.get(room) ?? '' });
  socket.emit('boardState', boardState(lesson, room));
  console.log(`  [${code}] ${participant.name} -> ${room}`);
}

// Assign by seating if seats exist, otherwise fallback to index-based
async function assignPairs(code: string, lesson: LessonRuntime) {
  const students = inClass(lesson);
  const studentByName = new Map(students.map(s => [s.name, s]));

  if (lesson.seats.length > 0) {
    // Group by (groupIndex, row) → pair room
    const pairMap = new Map<string, Seat[]>();
    for (const seat of lesson.seats) {
      if (!seat.occupant || seat.extra !== undefined) continue;
      const key = `pair-g${seat.groupIndex}-r${seat.row}`;
      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key)!.push(seat);
    }
    for (const [base, pairSeats] of pairMap) {
      const room = roomName(code, base);
      await prepareRoom(lesson, room);
      for (const seat of pairSeats) {
        const s = studentByName.get(seat.occupant!);
        if (s) await sendToRoom(code, lesson, s.id, room);
      }
    }
    // Unseated students → fallback pairs
    const seated = new Set(lesson.seats.map(s => s.occupant).filter(Boolean));
    const unseated = students.filter(s => !seated.has(s.name));
    for (let i = 0; i < unseated.length; i += 2) {
      const room = roomName(code, `pair-unseated-${Math.floor(i / 2) + 1}`);
      await prepareRoom(lesson, room);
      for (let j = i; j < Math.min(i + 2, unseated.length); j++) {
        await sendToRoom(code, lesson, unseated[j].id, room);
      }
    }
  } else {
    for (let i = 0; i < students.length; i += 2) {
      const room = roomName(code, `pair-${Math.floor(i / 2) + 1}`);
      await prepareRoom(lesson, room);
      for (let j = i; j < Math.min(i + 2, students.length); j++) {
        await sendToRoom(code, lesson, students[j].id, room);
      }
    }
  }
}

async function assignFours(code: string, lesson: LessonRuntime, prefix = 'fours') {
  const students = inClass(lesson);
  const studentByName = new Map(students.map(s => [s.name, s]));

  if (lesson.seats.length > 0) {
    const groupMap = new Map<number, Seat[]>();
    for (const seat of lesson.seats) {
      if (!seat.occupant || seat.extra !== undefined) continue;
      if (!groupMap.has(seat.groupIndex)) groupMap.set(seat.groupIndex, []);
      groupMap.get(seat.groupIndex)!.push(seat);
    }
    for (const [groupIndex, groupSeats] of groupMap) {
      const room = roomName(code, `${prefix}-${groupIndex + 1}`);
      await prepareRoom(lesson, room);
      for (const seat of groupSeats) {
        const s = studentByName.get(seat.occupant!);
        if (s) await sendToRoom(code, lesson, s.id, room);
      }
    }
    const seated = new Set(lesson.seats.map(s => s.occupant).filter(Boolean));
    const unseated = students.filter(s => !seated.has(s.name));
    for (let i = 0; i < unseated.length; i += 4) {
      const room = roomName(code, `${prefix}-unseated-${Math.floor(i / 4) + 1}`);
      await prepareRoom(lesson, room);
      for (let j = i; j < Math.min(i + 4, unseated.length); j++) {
        await sendToRoom(code, lesson, unseated[j].id, room);
      }
    }
  } else {
    for (let i = 0; i < students.length; i += 4) {
      const room = roomName(code, `${prefix}-${Math.floor(i / 4) + 1}`);
      await prepareRoom(lesson, room);
      for (let j = i; j < Math.min(i + 4, students.length); j++) {
        await sendToRoom(code, lesson, students[j].id, room);
      }
    }
  }
}

async function assignIndividual(code: string, lesson: LessonRuntime) {
  const students = inClass(lesson);
  for (const student of students) {
    const room = roomName(code, `individual-${student.name}`);
    await prepareRoom(lesson, room);
    await sendToRoom(code, lesson, student.id, room);
  }
}

async function sendAllToMain(code: string, lesson: LessonRuntime) {
  const students = inClass(lesson);
  const room = roomName(code, 'main-room');
  await prepareRoom(lesson, room);
  for (const student of students) {
    await sendToRoom(code, lesson, student.id, room);
  }
}

// Brute-force protection, shared by lesson-code guessing (socket) and login (REST):
// 5 failed attempts from one IP -> locked out for a minute. Separate maps per purpose so a
// lockout on one doesn't get cleared by unrelated success on the other.
interface AttemptEntry { failures: number; windowStart: number; lockedUntil: number }
const codeAttempts = new Map<string, AttemptEntry>();
const loginAttempts = new Map<string, AttemptEntry>();
const MAX_FAILURES = 5;
const ATTEMPT_WINDOW_MS = 60 * 1000;
const LOCKOUT_MS = 60 * 1000;

function clientIp(socket: { handshake: { headers: Record<string, unknown>; address: string } }): string {
  const xff = socket.handshake.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return socket.handshake.address;
}

function clientIpFromReq(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return req.socket.remoteAddress ?? 'unknown';
}

function isLockedOut(store: Map<string, AttemptEntry>, key: string): boolean {
  const entry = store.get(key);
  return !!entry && entry.lockedUntil > Date.now();
}

function recordFailedAttempt(store: Map<string, AttemptEntry>, key: string) {
  const now = Date.now();
  const entry = store.get(key) ?? { failures: 0, windowStart: now, lockedUntil: 0 };
  if (now - entry.windowStart > ATTEMPT_WINDOW_MS) {
    entry.failures = 0;
    entry.windowStart = now;
  }
  entry.failures += 1;
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }
  store.set(key, entry);
}

function clearAttempts(store: Map<string, AttemptEntry>, key: string) {
  store.delete(key);
}

function sweepAttempts(store: Map<string, AttemptEntry>) {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.lockedUntil < now && now - entry.windowStart > ATTEMPT_WINDOW_MS) store.delete(key);
  }
}

io.on('connection', async (socket) => {
  const { name, role, lessonId, uuid: rawUuid, token, avatar: rawAvatar, teacherName: rawTeacherName, look: rawLook } = socket.handshake.auth as { name: string; role: Role; lessonId?: string; boardRoom?: string; uuid?: unknown; teacherName?: unknown; token?: string; avatar?: unknown; look?: unknown };
  // only an id from the built-in set travels — never a picture; clients ignore ids they don't know
  const avatar = typeof rawAvatar === 'string' && /^[a-z]{1,20}$/.test(rawAvatar) ? rawAvatar : null;
  const uuid = role === 'student' && isUuid(rawUuid) ? rawUuid : null;
  // What the teacher calls this student. Goes to the teacher only: classmates see `name`, the nick
  const teacherName = role === 'student' && typeof rawTeacherName === 'string' ? rawTeacherName.trim().slice(0, 60) : '';
  const ip = clientIp(socket);

  if (isLockedOut(codeAttempts, ip)) {
    socket.emit('lessonError', { error: 'too many attempts' });
    socket.disconnect(true);
    return;
  }

  if (!lessonId) {
    recordFailedAttempt(codeAttempts, ip);
    socket.emit('lessonError', { error: 'missing lesson code' });
    socket.disconnect(true);
    return;
  }

  function refuseIfDemoOver(code: string): boolean {
    if (demos.get(code)?.endedAt == null) return false;
    socket.emit('lessonError', { error: 'lesson ended' });
    socket.disconnect(true);
    return true;
  }
  if (refuseIfDemoOver(lessonId)) return;

  const dbLesson = await getLessonByCode(joinAliases.get(lessonId) ?? lessonId).catch(() => null);
  if (refuseIfDemoOver(lessonId)) return;
  if (!dbLesson) {
    recordFailedAttempt(codeAttempts, ip);
    socket.emit('lessonError', { error: 'lesson not found' });
    socket.disconnect(true);
    return;
  }
  clearAttempts(codeAttempts, ip);

  const booked = bookings.get(dbLesson.code);
  if (booked?.status === 'booked') {
    if (Date.now() < opensAt(booked.startsAt)) {
      socket.emit('lessonError', { error: 'not open yet', opensAt: opensAt(booked.startsAt), startsAt: booked.startsAt });
      socket.disconnect(true);
      return;
    }
    openBooking(booked);
  }

  // Teacher role is only trusted once backed by a verified token — the client can no longer
  // just claim role: 'teacher'. A teacher also can't control someone else's lesson.
  if (role === 'teacher' && demos.has(dbLesson.code)) {
    if (verifyDemoToken(token) !== dbLesson.code) {
      socket.emit('lessonError', { error: 'unauthorized' });
      socket.disconnect(true);
      return;
    }
  } else if (role === 'teacher') {
    const teacherId = token ? await verifyTeacherToken(token) : null;
    if (teacherId === null) {
      socket.emit('lessonError', { error: 'unauthorized' });
      socket.disconnect(true);
      return;
    }
    if (dbLesson.teacherId !== null && dbLesson.teacherId !== teacherId) {
      socket.emit('lessonError', { error: 'not your lesson' });
      socket.disconnect(true);
      return;
    }
  }

  const code = dbLesson.code;
  // Only those who have been here get past a closed door or an old code
  const entry = lessons.get(code);
  if (entry && role !== 'teacher' && !(uuid && entry.seen.has(uuid))) {
    const refusal = entry.joinCode && lessonId !== entry.joinCode ? 'code changed' : entry.closed ? 'entry closed' : null;
    if (refusal) {
      socket.emit('lessonError', { error: refusal });
      socket.disconnect(true);
      return;
    }
  }
  // After-lesson chat: the teacher stays out (students were told so); students who drop out don't come back
  const after = lessons.get(code)?.afterUntil;
  if (after) {
    socket.emit('lessonError', role === 'teacher'
      ? { error: 'after lesson', minutesLeft: Math.max(1, Math.ceil((after - Date.now()) / 60000)) }
      : { error: 'lesson ended' });
    socket.disconnect(true);
    return;
  }
  const refusal = joinRefusal(code, dbLesson.videoMode, role, uuid);
  if (refusal) {
    socket.emit('lessonError', { error: refusal });
    socket.disconnect(true);
    return;
  }
  const runtime = getLessonRuntime(code, dbLesson.teacherId);
  if (!runtime) {
    socket.emit('lessonError', { error: 'too many open lessons' });
    socket.disconnect(true);
    return;
  }
  const lesson: LessonRuntime = runtime;
  lesson.videoMode = safeVideoMode(dbLesson.videoMode);
  socket.join(code);
  if (role === 'teacher' && rawLook !== undefined) {
    const look = teacherLookOf(rawLook);
    if (look) { lesson.teacherLook = look; socket.to(code).emit('teacherLook', look); }
  }
  if (lesson.teacherLook) socket.emit('teacherLook', lesson.teacherLook);

  // Board-only connection: mobile student viewing/drawing the board via WebView, as a second
  // socket alongside their normal 'student' connection. The room it may attach to is NOT taken
  // from the client as-is — it must match a room that participant is actually currently assigned
  // to server-side (set by sendToRoom), otherwise anyone who knows the lesson code could request
  // any other group's room name and read/draw on it while staying invisible (no participants entry).
  if (role === 'board') {
    const requestedRoom = (socket.handshake.auth as { boardRoom?: string }).boardRoom ?? '';
    const owner = Array.from(lesson.participants.values())
      .find(p => p.role === 'student' && p.name === name && p.livekitRoom === requestedRoom);
    if (!owner) {
      socket.emit('lessonError', { error: 'not your board' });
      socket.disconnect(true);
      return;
    }
    const boardRoom = requestedRoom;
    lesson.boardConnections.set(socket.id, { room: boardRoom });
    console.log(`+ [${code}] board viewer: ${name} @ ${boardRoom}`);
    socket.on('boardSync', () => socket.emit('boardState', boardState(lesson, boardRoom)));
    socket.on('boardOp', (op: unknown) => applyBoardOp(lesson, boardRoom, op, name, false, socket.id));
    socket.on('disconnect', () => {
      lesson.boardConnections.delete(socket.id);
      console.log(`- [${code}] board viewer: ${name} @ ${boardRoom}`);
      dropIfEnded(code);
    });
    return;
  }

  async function finishJoin(effectiveName: string) {
    if (socket.disconnected) return; // left while we were looking things up — nothing to add
    const participant: Participant = { id: socket.id, name: effectiveName, role, livekitRoom: null, uuid, avatar, teacherName };
    lesson.participants.set(socket.id, participant);
    lesson.visited = true;
    const demo = demos.get(code);
    if (demo && role === 'student') demoStudentCame(demo, socketsOf(lesson, 'student').length);
    if (uuid && role === 'student') lesson.seen.add(uuid);
    if (seatByPlan(lesson, participant)) broadcastSeats(code, lesson);
    console.log(`+ [${code}] ${role}: ${effectiveName}`);
    if (role === 'student') {
      // While the teacher records, what goes to this student and comes from them is copied (recorder.ts).
      // socket.io writes every packet for this connection here, broadcasts included
      const client = socket.client as unknown as { writeToEngine: (packets: unknown[], opts: unknown) => void };
      const write = client.writeToEngine.bind(client);
      client.writeToEngine = (packets, opts) => { lesson.rec.out(effectiveName, packets); write(packets, opts); };
      socket.onAny((ev: string, ...args: unknown[]) => lesson.rec.in(effectiveName, ev, args));
    }
    // Registered before any await below: a socket that leaves mid-join must not stay as a ghost participant
    socket.on('disconnect', () => {
      lesson.relay.removePeer(socket.id);
      lesson.participants.delete(socket.id);
      if (lesson.participants.size === 0) lesson.emptySince = Date.now();
      if (role === 'teacher' && socketsOf(lesson, 'teacher').length === 0) lesson.noTeacherSince = Date.now();
      if (lesson.rec.listeners.delete(socket.id)) updateRecording(code, lesson);
      dropIfEnded(code);
      if (role === 'student') {
        for (const seat of lesson.seats) {
          if (seat.occupant === effectiveName) seat.occupant = null;
        }
        settleSeats(code, lesson).catch(e => console.error('seats not settled:', e));
      }
      console.log(`- [${code}] ${role}: ${effectiveName}`);
      broadcastState(code, lesson);
    });
    // The seating saved in the teacher's journal. Comes without names: the server only learns
    // which uuid sits where, the journal stays in the teacher's browser.
    socket.on('seatPlan', ({ capacity, seats }: { capacity?: unknown; seats?: unknown } = {}) => {
      if (role !== 'teacher') return;
      applySeatPlan(lesson, capacity, seats);
      settleSeats(code, lesson).catch(e => console.error('seats not settled:', e));
    });

    if (role === 'teacher') socket.emit('joined'); // the lines above are listening now: the plan may come
    broadcastState(code, lesson);
    socket.emit('seats', seatsFor(lesson, participant));

    lesson.emptySince = null;
    lesson.ended = false; // someone came (back) — it's a live lesson again
    if (role === 'teacher') {
      lesson.noTeacherSince = null;
      const booking = bookings.get(code);
      if (booking && !booking.teacherCame) { booking.teacherCame = true; saveBookingLater(booking); }
      if (demos.get(code)?.videoMode === 'solo' && !lesson.bots) startBots(code, lesson);
    }
    if (role === 'teacher') {
      socket.emit('slides:material', teacherMaterial(lesson));
      socket.emit('slides:state', teacherSlidesState(lesson));
      sendMarks(lesson, socket);
      sendEntry(code, lesson, socket);
      sendActivity(lesson, socket);
    } else {
      socket.emit('slides:view', studentSlidesView(lesson));
      sendEarlierBoards(lesson, socket.id);
    }
    sendPoll(lesson, socket);
    // Media relay (see mediaRelay.ts). Registered right away: a student's first wants come with its first view.
    if (role === 'teacher') {
      // the teacher's browser has this lesson file open and can send its media
      socket.on('media:source', ({ materialId }: { materialId?: string } = {}) => {
        if (lesson.material && materialId === lesson.material.id) lesson.relay.addTeacher(socket.id);
      });
    } else {
      socket.on('media:want', ({ hashes }: { hashes?: unknown } = {}) => lesson.relay.want(socket.id, hashes));
      socket.on('media:have', ({ hashes }: { hashes?: unknown } = {}) => lesson.relay.addHoldings(socket.id, hashes));
    }
    socket.on('media:chunk', (msg: ChunkMsg, ack?: (r: object) => void) => {
      if (typeof ack === 'function') lesson.relay.onChunk(socket.id, msg, ack);
    });

    const mainRoom = roomName(code, 'main-room');
    await livekit.createRoom({ name: mainRoom }).catch(() => {});
    // Monitor token — student stays visible to teacher in main-room even during pair work.
    // It only carries the camera, so without video there is nothing to monitor.
    if (lesson.videoMode === 'teacherSees') {
      // A room of its own: no token but the teacher's can watch it, so classmates can't see each other
      const camsRoom = roomName(code, 'class-cams');
      await livekit.createRoom({ name: camsRoom }).catch(() => {});
      if (role === 'teacher') {
        socket.emit('classCams', { url: LIVEKIT_WS_URL, token: await makeCameraViewerToken(effectiveName, camsRoom), room: camsRoom });
      } else if (role === 'student') {
        socket.emit('monitor', { url: LIVEKIT_WS_URL, token: await makeCameraOnlyToken(effectiveName, camsRoom), room: camsRoom });
      }
    }
    if (role === 'student') {
      await settleSeats(code, lesson); // first of all: a newcomer must not show up in the class even for a moment
      participant.newcomer = isNewcomer(lesson, participant);
      await sendMonitor(code, lesson, participant);
      await placeStudent(code, lesson, participant);
      broadcastState(code, lesson);
    } else {
      await sendToRoom(code, lesson, socket.id, mainRoom);
    }

    // «Говорить всем»: while students work in their rooms the teacher can still speak to all of them.
    // The solo demo has no sound at all.
    if (!lesson.bots && (role === 'teacher' || role === 'student')) {
      const voiceRoom = roomName(code, 'voice');
      await livekit.createRoom({ name: voiceRoom }).catch(() => {});
      const token = role === 'teacher' ? await makeVoiceSpeakerToken(effectiveName, voiceRoom) : await makeVoiceListenerToken(effectiveName, voiceRoom);
      socket.emit('teacherVoice', { url: LIVEKIT_WS_URL, token, room: voiceRoom });
    }

    socket.on('setCapacity', (n: number) => {
      if (role !== 'teacher' || !Number.isInteger(n) || n < 0) return;
      // the solo demo's class needs a desk per four of its bots at least
      const capacity = lesson.bots ? Math.max(Math.min(Math.ceil(n / 4) * 4, MAX_CAPACITY), SOLO_MIN_SEATS) : Math.min(n, MAX_CAPACITY);
      createSeats(lesson, capacity);
      // bots whose seats are gone find new ones, as when the teacher sends them off
      if (lesson.bots) for (const b of BOTS) if (!lesson.seats.some(s => s.occupant === b.name)) lesson.bots.onUnseated(b.name);
      broadcastSeats(code, lesson);
      settleDesks(code, lesson).catch(e => console.error('desks not settled:', e));
      console.log(`[${code}] capacity -> ${capacity} (${capacity / 4} groups)`);
    });

    socket.on('claimSeat', (seatId: string) => {
      if (role !== 'student' || lesson.seatPlan.size) return; // a saved seating isn't up to the students
      const target = lesson.seats.find(s => s.id === seatId);
      if (target && reservedForOther(lesson, target, uuid)) return; // stay where you are
      // Release current seat
      const current = lesson.seats.find(s => s.occupant === effectiveName);
      if (current) current.occupant = null;
      // Claim new seat if free
      if (target && !target.occupant) target.occupant = effectiveName;
      broadcastSeats(code, lesson);
      settleDesks(code, lesson).catch(e => console.error('desks not settled:', e));
    });

    socket.on('clearSeat', (seatId: string) => {
      if (role !== 'teacher') return;
      const seat = lesson.seats.find(s => s.id === seatId);
      if (seat?.occupant) lesson.bots?.onUnseated(seat.occupant);
      if (seat) seat.occupant = null;
      settleSeats(code, lesson).catch(e => console.error('seats not settled:', e));
    });

    socket.on('moveSeat', async ({ studentName, toSeatId }: { studentName: string; toSeatId: string }) => {
      if (role !== 'teacher') return;
      const from = lesson.seats.find(s => s.occupant === studentName);
      const to = lesson.seats.find(s => s.id === toSeatId);
      if (!to || to === from || (to.occupant && !from)) return;
      if (from) from.occupant = to.occupant; // into a taken seat they swap
      to.occupant = studentName;
      await settleSeats(code, lesson);
      // Was waiting for a seat, and the others are at work already
      const moved = [...lesson.participants.values()].find(p => p.name === studentName);
      if (!from && moved) { await placeStudent(code, lesson, moved); broadcastState(code, lesson); }
    });

    // Before the lesson: those seated wait at their desks, or everyone comes back to the class
    socket.on('desks:set', async ({ on }: { on?: unknown } = {}) => {
      if (role !== 'teacher' || lesson.stage !== 'waiting' || lesson.block || lesson.bots) return;
      if (typeof on !== 'boolean' || on === lesson.atDesks) return;
      lesson.atDesks = on;
      console.log(`[${code}] at desks -> ${on}`);
      for (const p of lesson.participants.values()) if (p.role === 'student') await placeStudent(code, lesson, p);
      if (!on) {
        await bringTeachersToMain(code, lesson);
        // they were talking at their desks; now the teacher speaks
        for (const id of socketsOf(lesson, 'student')) io.sockets.sockets.get(id)?.emit('muted');
      }
      broadcastState(code, lesson);
    });

    socket.on('timer', (action: unknown) => {
      if (role !== 'teacher' || lesson.stage === 'waiting') return;
      if (timerAction(lesson, action)) broadcastState(code, lesson);
    });

    socket.on('setStage', async (stage: Stage) => {
      if (role !== 'teacher' || !STAGES.includes(stage)) return;
      await changeStage(code, lesson, stage);
    });

    // The teacher's browser records the lesson: from now on it hears every room and gets students' traffic
    socket.on('rec:on', () => {
      if (role !== 'teacher') return;
      lesson.rec.listeners.add(socket.id);
      lesson.rec.rooms = ''; // the full list of rooms again, for this socket too
      updateRecording(code, lesson, true);
    });
    socket.on('rec:off', () => {
      if (role !== 'teacher' || !lesson.rec.listeners.delete(socket.id)) return;
      socket.emit('rec:rooms', { url: LIVEKIT_WS_URL, rooms: [] });
      updateRecording(code, lesson);
    });

    // With a lesson file the teacher goes through its blocks; the stage follows the block
    socket.on('block:start', async ({ blockId }: { blockId: string }) => {
      if (role !== 'teacher') return;
      if (lesson.bots && !soloBlockOpen(String(blockId))) return; // the solo demo skips it: pale in the plan
      await startBlock(code, lesson, blockId);
    });

    // A task the lesson file doesn't have: into the plan after the running one, and started at once if asked
    socket.on('block:add', async (b: { type?: unknown; title?: unknown; task?: unknown; minutes?: unknown; board?: unknown; poll?: unknown; start?: unknown } = {}, ack?: unknown) => {
      if (role !== 'teacher') return;
      const block = addLiveBlock(lesson, b ?? {});
      if (typeof ack === 'function') ack({ ok: !!block });
      if (!block) return;
      console.log(`[${code}] task added: ${block.type} "${block.title}"`);
      broadcastSlides(lesson, { material: true });
      if (b.start === true) await startBlock(code, lesson, block.id);
    });

    // Everyone is here: nobody new gets in. Those who dropped out still can
    socket.on('entry:close', ({ closed }: { closed?: unknown } = {}) => {
      if (role !== 'teacher' || demos.has(code)) return;
      lesson.closed = closed === true;
      sendEntry(code, lesson);
    });

    // The code got out: a new one for those still to come, those here carry on
    socket.on('entry:newCode', async () => {
      if (role !== 'teacher' || demos.has(code)) return;
      const next = await unusedCode();
      if (lesson.joinCode) joinAliases.delete(lesson.joinCode);
      lesson.joinCode = next;
      joinAliases.set(next, code);
      console.log(`[${code}] join code replaced`);
      sendEntry(code, lesson);
    });

    socket.on('understood:ask', () => {
      if (role !== 'teacher' || lesson.stage !== 'group' || lesson.vote) return;
      lesson.marks = new Map();
      lesson.vote = setTimeout(() => finishVote(lesson), VOTE_SECONDS * 1000 + VOTE_GRACE_MS);
      for (const id of socketsOf(lesson, 'student')) io.sockets.sockets.get(id)?.emit('understood:ask', { seconds: VOTE_SECONDS });
      sendMarks(lesson);
    });

    socket.on('understood:answer', (answer: unknown) => {
      const name = lesson.participants.get(socket.id)?.name;
      if (role !== 'student' || !lesson.vote || !name || lesson.marks.has(name)) return;
      if (answer === 'yes' || answer === 'no') lesson.marks.set(name, answer);
    });

    socket.on('understood:clear', () => {
      if (role === 'teacher') clearMarks(lesson);
    });

    socket.on('sharedTextUpdate', ({ room, text }: { room: string; text: string }) => {
      if (role !== 'student') return;
      lesson.sharedTexts.set(room, text);
      for (const [id, p] of lesson.participants) {
        if (p.livekitRoom === room && id !== socket.id) {
          io.sockets.sockets.get(id)?.emit('sharedText', { room, text });
        }
      }
    });

    socket.on('boardSync', () => {
      const room = lesson.participants.get(socket.id)?.livekitRoom;
      if (room) socket.emit('boardState', boardState(lesson, room));
    });

    socket.on('boardOp', (op: unknown) => {
      const participant = lesson.participants.get(socket.id);
      if (!participant?.livekitRoom || participant.quiet) return;
      applyBoardOp(lesson, participant.livekitRoom, op, participant.name, role === 'teacher', socket.id);
    });

    socket.on('poll:answer', ({ blockId, choice }: { blockId?: unknown; choice?: unknown } = {}) => {
      const name = lesson.participants.get(socket.id)?.name;
      const cur = currentPoll(lesson);
      if (role !== 'student' || !name || !cur || cur.blockId !== blockId || !answersOpen(cur.run)) return;
      const picked = parseChoice(cur.poll, choice);
      if (!picked) return;
      cur.run.answers.set(name, picked);
      socket.emit('poll', studentView(cur.blockId, cur.poll, cur.run, name));
      sendPollToTeachers(lesson);
    });

    // the results to the class: answers are closed while they're shown
    socket.on('poll:reveal', ({ revealed }: { revealed?: unknown } = {}) => {
      const cur = currentPoll(lesson);
      if (role !== 'teacher' || !cur) return;
      cur.run.revealed = revealed === true;
      sendPoll(lesson);
    });

    // more time to answer, or a limit where there was none: seconds from now, or from the end still to come
    socket.on('poll:time', ({ add }: { add?: unknown } = {}) => {
      const cur = currentPoll(lesson);
      const sec = Math.round(Number(add));
      if (role !== 'teacher' || !cur || !(sec >= 5 && sec <= POLL_MAX_SECONDS)) return;
      const now = Date.now();
      cur.run.endsAt = (cur.run.endsAt !== null && !timeUp(cur.run, now) ? cur.run.endsAt : now) + sec * 1000;
      closeOnTime(lesson, cur.blockId, cur.run);
      sendPoll(lesson);
    });

    socket.on('poll:untimed', () => {
      const cur = currentPoll(lesson);
      if (role !== 'teacher' || !cur) return;
      cur.run.endsAt = null;
      closeOnTime(lesson, cur.blockId, cur.run);
      sendPoll(lesson);
    });

    socket.on('joinPair', async ({ room, quiet }: { room: string; quiet?: boolean }) => {
      if (role !== 'teacher') return;
      // straight from one group to another: the first one was left all the same
      const was = lesson.participants.get(socket.id)?.livekitRoom;
      if (was && was !== room) lesson.bots?.onLeave(was);
      // quietly: the group neither sees nor hears the teacher, a call for help stays on
      if (quiet) { await sendToRoom(code, lesson, socket.id, room, true); return; }
      await visitOpenly(room);
    });

    // A quiet visitor shows up in the same room
    socket.on('revealSelf', async () => {
      const me = lesson.participants.get(socket.id);
      if (role !== 'teacher' || !me?.quiet || !me.livekitRoom) return;
      await visitOpenly(me.livekitRoom);
    });

    async function visitOpenly(room: string) {
      await sendToRoom(code, lesson, socket.id, room);
      // Dismiss call indicator for this room on teacher side
      socket.emit('callTeacher', { room, calling: false });
      lesson.bots?.onVisit(room);
      // Notify students in the pair room that teacher is coming
      for (const [id, p] of lesson.participants) {
        if (p.livekitRoom === room && p.role === 'student') {
          io.sockets.sockets.get(id)?.emit('teacherJoined');
        }
      }
    }

    socket.on('leavePair', async () => {
      if (role !== 'teacher') return;
      const was = lesson.participants.get(socket.id)?.livekitRoom;
      await sendToRoom(code, lesson, socket.id, roomName(code, 'main-room'));
      if (was) lesson.bots?.onLeave(was);
    });

    socket.on('mute', ({ target }: { target: string | 'all' }) => {
      if (role !== 'teacher') return;
      for (const [id, p] of lesson.participants) {
        if (p.role === 'student' && (target === 'all' || p.name === target)) {
          io.sockets.sockets.get(id)?.emit('muted');
        }
      }
    });

    // the student's browser: how long its microphone was talking since the last report
    socket.on('activity:talk', ({ ms }: { ms?: unknown } = {}) => {
      const p = lesson.participants.get(socket.id);
      if (role !== 'student' || !p?.livekitRoom || typeof ms !== 'number') return;
      noteTalk(lesson, p.name, ms);
    });

    socket.on('callTeacher', ({ room }: { room: string }) => {
      for (const [id, p] of lesson.participants) {
        if (p.role === 'teacher') {
          io.sockets.sockets.get(id)?.emit('callTeacher', { room, calling: true });
        }
      }
    });

    socket.on('dismissCall', ({ room }: { room: string }) => {
      for (const [id, p] of lesson.participants) {
        if (p.role === 'teacher') {
          io.sockets.sockets.get(id)?.emit('callTeacher', { room, calling: false });
        }
      }
    });

    // Teacher presents slides: navigate, reveal hidden objects, move ✋ objects.
    socket.on('slides:goto', ({ index }: { index: number }) => {
      if (role !== 'teacher' || !lesson.slides.active || !Number.isInteger(index)) return;
      const count = blockSlides(lesson.material, lesson.slides.blockId).length;
      lesson.slides.index = Math.max(0, Math.min(count - 1, index));
      broadcastSlides(lesson);
      pushBoards(lesson);
    });

    socket.on('slides:reveal', ({ uid, on }: { uid: string; on: boolean }) => {
      if (role !== 'teacher') return;
      const scene = currentScene(lesson.material, lesson.slides);
      if (!scene || !scene.objects.some(o => o.uid === uid && o.studentHidden)) return;
      const set = lesson.slides.revealed.get(scene.id) ?? new Set<string>();
      if (on) set.add(uid); else set.delete(uid);
      lesson.slides.revealed.set(scene.id, set);
      broadcastSlides(lesson);
    });

    socket.on('slides:move', ({ uid, left, top }: { uid: string; left: number; top: number }) => {
      if (role !== 'teacher') return; // students get to move objects in pair work later
      if (!Number.isFinite(left) || !Number.isFinite(top)) return;
      const scene = currentScene(lesson.material, lesson.slides);
      const obj = scene?.objects.find(o => o.uid === uid && o.studentDraggable);
      if (!scene || !obj) return;
      lesson.slides.positions.set(scene.id, { ...lesson.slides.positions.get(scene.id), [uid]: { left, top } });
      const msg = { sceneId: scene.id, uid, left, top };
      const visibleToStudents = !obj.studentHidden || lesson.slides.revealed.get(scene.id)?.has(uid);
      for (const p of lesson.participants.values()) {
        if (p.id === socket.id || (p.role === 'student' && !visibleToStudents)) continue;
        io.sockets.sockets.get(p.id)?.emit('slides:move', msg);
      }
    });

    // End of the lesson: the lesson material is forgotten, everyone goes back to seating
    // { chatMinutes }: 0 — end now; 1..15 — students talk in their fours that long first
    socket.on('endLesson', async (opts?: unknown, ack?: unknown) => {
      if (typeof opts === 'function') { ack = opts; opts = undefined; }
      if (role !== 'teacher') return;
      const m = Math.round(Number((opts as { chatMinutes?: unknown } | undefined)?.chatMinutes) || 0);
      // a demo ends on its hour: no after-lesson chat past it
      const minutes = demos.has(code) ? 0 : Math.min(MAX_AFTER_LESSON_MINUTES, Math.max(0, m));
      closeDemo(code, 'by the teacher');
      const demo = demos.get(code);
      if (typeof ack === 'function') ack(demo ? demoEndInfo(demo) : undefined); // the teacher leaves the lesson either way
      if (minutes > 0 && socketsOf(lesson, 'student').length > 0) await startAfterLesson(code, lesson, minutes);
      else endLesson(code, lesson, 'by the teacher');
    });

  }

  // a nick fits on a seat tile; the client is told if it was cut
  const effectiveName = role === 'student' ? uniqueName(lesson, String(name).slice(0, MAX_NICK), uuid) : name;
  if (effectiveName !== name) socket.emit('myName', effectiveName);
  await finishJoin(effectiveName);
});

cleanupExpiredLessons().then(n => { if (n) console.log(`cleaned up ${n} expired lesson code(s)`); }).catch(() => {});
// One rule for the lesson's life in memory: no teacher for this long (they left — closed the tab,
// lost the network — or never came) and the lesson is over, as if «Завершить урок» was pressed:
// whoever is still in is sent away and the lesson leaves memory. Long enough to reboot a router.
// The code stays valid in the DB; coming back starts from an empty seating.
const TEACHER_ABSENT_MS = (Number(process.env.TEACHER_ABSENT_MINUTES) || 15) * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [code, lesson] of lessons) {
    if (lesson.ended || lesson.afterUntil || !lesson.noTeacherSince) continue;
    const away = now - lesson.noTeacherSince;
    if (away <= (demos.get(code)?.videoMode === 'solo' ? DEMO_SOLO_ABSENT_MS : TEACHER_ABSENT_MS)) continue;
    const booking = bookings.get(code);
    if (booking && now < booking.startsAt + DEMO_NO_SHOW_MS) continue; // the class gathers before the teacher is due
    if (isEmpty(code, lesson)) dropLesson(code, 'no teacher');
    else endLesson(code, lesson, 'no teacher');
  }
}, Math.min(30_000, TEACHER_ABSENT_MS / 3));

setInterval(() => {
  cleanupExpiredLessons().then(n => { if (n) console.log(`cleaned up ${n} expired lesson code(s)`); }).catch(() => {});
  sweepAttempts(codeAttempts); sweepAttempts(loginAttempts); sweepAttempts(resetAttempts);
  cleanupDemoLogs().catch(e => console.error('!!! demo logs not cleaned up:', e));
}, 6 * 60 * 60 * 1000);

// ---------- demo: starting one, its clock, feedback ----------

function refuseDemo(res: Response, status: number, ipHash: string, error: string, retryAfterMs: number) {
  countDemoIp(ipHash, 'refused');
  res.status(status).json({ error, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) });
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const isBookingMode = (v: unknown): v is BookingMode => v === 'teacher' || v === 'none';

function bookingOf(req: Request): BookingRecord | null {
  const token = bearerToken(req);
  if (!token) return null;
  const hash = hashToken(token);
  return [...bookings.values()].find(b => b.tokenHash === hash) ?? null;
}

const bookingView = (b: BookingRecord) => ({
  code: b.code, videoMode: b.videoMode, startsAt: b.startsAt, opensAt: opensAt(b.startsAt),
  endsAt: b.startsAt + DEMO_LESSON_MS, status: b.status, now: Date.now(),
});

// Trying it alone: at any moment, nothing to wait for and no media, so nothing that can run out
app.post('/demo/solo', async (req, res) => {
  const ipHash = hashIp(clientIpFromReq(req), JWT_SECRET);
  countDemoIp(ipHash, 'attempts');
  const throttled = demoThrottle.attempt(ipHash);
  if (!throttled.ok) { refuseDemo(res, 429, ipHash, 'slow down', throttled.retryAfterMs); return; }
  if (!hasDemo) { res.status(503).json({ error: 'demo unavailable' }); return; }
  const barred = Math.max(0, ...[...demos.values()]
    .filter(d => d.ipHash === ipHash && d.endReason === 'teacher never came').map(d => d.cooldownUntil - Date.now()));
  if (barred > 0) { refuseDemo(res, 429, ipHash, 'barred', barred); return; }
  const running = [...demos.values()].filter(d => d.videoMode === 'solo' && d.endedAt === null);
  if (running.length >= DEMO_SOLO_MAX) { refuseDemo(res, 503, ipHash, 'busy', MINUTE_MS); return; }
  if (running.filter(d => d.ipHash === ipHash).length >= DEMO_SOLO_PER_IP) { refuseDemo(res, 429, ipHash, 'ip busy', MINUTE_MS); return; }

  const now = Date.now();
  const pendingKey = `pending:${crypto.randomUUID()}`;
  const demo: DemoRecord = {
    code: pendingKey, ipHash, videoMode: 'solo', createdAt: now, endsAt: now + DEMO_SOLO_MS, firstStudentAt: now,
    peakStudents: BOTS.length, endedAt: null, endReason: null, cooldownUntil: 0, slotFreeAt: 0, reached: 'waiting',
    ...(req.query?.fast ? { fast: true } : {}),
  };
  demos.set(pendingKey, demo);
  try {
    const lesson = await createLesson(null, 'none');
    demo.code = lesson.code;
    demos.set(lesson.code, demo);
    demos.delete(pendingKey);
    await saveDemo(demo);
    console.log(`[${lesson.code}] solo demo started, address ${ipHash}`);
    res.json({ code: lesson.code, token: signDemoToken(lesson.code) });
  } catch (e) {
    console.error('!!! solo demo not created:', e);
    demos.delete(pendingKey);
    demos.delete(demo.code);
    res.status(500).json({ error: 'failed to create lesson' });
  }
});

app.get('/demo/slots', (_req, res) => {
  if (!hasDemo) { res.status(503).json({ error: 'demo unavailable' }); return; }
  const now = Date.now();
  const slots = bookableStarts(now, DEMO_BOOK_STEP_MS, DEMO_BOOK_AHEAD_MS)
    .map(startsAt => ({ startsAt, teacher: placesLeft('teacher', startsAt) > 0, none: placesLeft('none', startsAt) > 0 }));
  res.json({ slots, now });
});

app.post('/demo/bookings', async (req, res) => {
  const ipHash = hashIp(clientIpFromReq(req), JWT_SECRET);
  countDemoIp(ipHash, 'attempts');
  const throttled = demoThrottle.attempt(ipHash);
  if (!throttled.ok) {
    if (throttled.newPause) {
      countDemoIp(ipHash, 'penalties');
      console.log(`demo: address ${ipHash} paused for ${Math.round(throttled.retryAfterMs / 1000)}s`);
    }
    refuseDemo(res, 429, ipHash, 'slow down', throttled.retryAfterMs);
    return;
  }
  if (!hasDemo) { res.status(503).json({ error: 'demo unavailable' }); return; }

  const { startsAt, videoMode } = (req.body ?? {}) as { startsAt?: unknown; videoMode?: unknown };
  const now = Date.now();
  if (!isBookingMode(videoMode) || typeof startsAt !== 'number' || !bookableStarts(now, DEMO_BOOK_STEP_MS, DEMO_BOOK_AHEAD_MS).includes(startsAt)) {
    res.status(400).json({ error: 'bad time' });
    return;
  }
  const mine = [...bookings.values()].filter(b => b.ipHash === ipHash);
  if (mine.some(isHeld)) { refuseDemo(res, 409, ipHash, 'ip busy', 0); return; }
  const barred = Math.max(0, ...mine.map(b => b.barUntil - now));
  if (barred > 0) { refuseDemo(res, 429, ipHash, 'barred', barred); return; }
  if (placesLeft(videoMode, startsAt) <= 0) { refuseDemo(res, 409, ipHash, 'no slots', 0); return; }

  // The place is taken before the first await, so a burst of requests can't slip past the checks
  const pendingKey = `pending:${crypto.randomUUID()}`;
  const token = crypto.randomBytes(24).toString('base64url');
  const booking: BookingRecord = {
    code: pendingKey, tokenHash: hashToken(token), ipHash, videoMode, startsAt, createdAt: now,
    status: 'booked', teacherCame: false, barUntil: 0,
  };
  bookings.set(pendingKey, booking);
  try {
    const lesson = await createLesson(null, videoMode);
    booking.code = lesson.code;
    bookings.set(lesson.code, booking);
    bookings.delete(pendingKey);
    await saveBooking(booking);
    console.log(`[${lesson.code}] demo booked (${videoMode}) for ${new Date(startsAt).toISOString()}, address ${ipHash}`);
    res.json({ token, booking: bookingView(booking) });
  } catch (e) {
    console.error('!!! booking not created:', e);
    bookings.delete(pendingKey);
    bookings.delete(booking.code);
    res.status(500).json({ error: 'failed to book' });
  }
});

app.get('/demo/bookings/mine', (req, res) => {
  const booking = bookingOf(req);
  if (!booking) { res.status(404).json({ error: 'not found' }); return; }
  res.json({ booking: bookingView(booking) });
});

// The teacher's way in: the token that runs the lesson is only given once the door is open
app.post('/demo/bookings/mine/enter', (req, res) => {
  const booking = bookingOf(req);
  if (!booking) { res.status(404).json({ error: 'not found' }); return; }
  if (!isHeld(booking)) { res.status(410).json({ error: 'over' }); return; }
  if (Date.now() < opensAt(booking.startsAt)) { res.status(409).json({ error: 'not open yet' }); return; }
  openBooking(booking);
  res.json({ code: booking.code, token: signDemoToken(booking.code) });
});

app.delete('/demo/bookings/mine', (req, res) => {
  const booking = bookingOf(req);
  if (!booking) { res.status(404).json({ error: 'not found' }); return; }
  if (!isHeld(booking)) { res.status(410).json({ error: 'over' }); return; }
  const wasOpen = booking.status === 'open';
  booking.status = 'cancelled';
  saveBookingLater(booking);
  if (wasOpen) {
    const lesson = lessons.get(booking.code);
    if (lesson) endLesson(booking.code, lesson, 'cancelled');
    else closeDemo(booking.code, 'cancelled');
  } else {
    deleteLesson(booking.code).catch(e => console.error('!!! booked lesson code not deleted:', e));
  }
  console.log(`[${booking.code}] booking cancelled`);
  res.json({ ok: true });
});

app.post('/demo/feedback', async (req, res) => {
  const code = verifyDemoToken(bearerToken(req));
  if (!code) { res.status(401).json({ error: 'unauthorized' }); return; }
  const { rating: rawRating, comment, email } = req.body ?? {};
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const rating = Number.isInteger(rawRating) && rawRating >= 1 && rawRating <= 5 ? rawRating as number : null;
  // a mark, or some words, or both
  if (rawRating != null && rating === null) { res.status(400).json({ error: 'bad rating' }); return; }
  if (rating === null && !text(comment, 4000)) { res.status(400).json({ error: 'empty feedback' }); return; }
  const saved = await saveDemoFeedback(code, rating, text(comment, 4000), text(email, 200)).then(() => true, () => false);
  if (!saved) { res.status(500).json({ error: 'failed to save feedback' }); return; }
  res.json({ ok: true });
  // a copy to our box, after the answer: the review is kept whatever the mail does
  if (canSendFeedback()) {
    const demo = demos.get(code);
    sendDemoFeedback({ code, rating, comment: text(comment, 4000), email: text(email, 200), solo: demo?.videoMode === 'solo', reached: demo?.reached ?? null })
      .catch(e => console.error('demo feedback letter not sent:', (e as Error).message));
  }
});

// ---------- «Написать нам»: an error, an idea or a review from our apps, mailed to our box ----------
// No login needed (the editor has none); a few letters an hour per address.
const feedbackTimes = new Map<string, number[]>();
app.post('/feedback', async (req, res) => {
  if (!canSendFeedback()) { res.status(503).json({ error: 'not configured' }); return; }
  const letter = cleanFeedback(req.body, req.headers['user-agent']);
  if ('error' in letter) { res.status(400).json({ error: letter.error }); return; }
  const ip = clientIpFromReq(req);
  const now = Date.now();
  const recent = (feedbackTimes.get(ip) ?? []).filter(t => now - t < 3_600_000);
  if (recent.length >= FEEDBACK_PER_IP_PER_HOUR) { res.status(429).json({ error: 'too many' }); return; }
  recent.push(now);
  feedbackTimes.set(ip, recent);
  try {
    await sendFeedback(letter);
    res.json({ ok: true });
  } catch (e) {
    console.error('feedback letter not sent:', (e as Error).message);
    res.status(502).json({ error: 'not sent' });
  }
});
// old entries go, so the map doesn't grow with every address that ever wrote
setInterval(() => {
  const now = Date.now();
  for (const [ip, ts] of feedbackTimes) if (!ts.some(t => now - t < 3_600_000)) feedbackTimes.delete(ip);
}, 10 * 60_000).unref();

// Last in the chain, after every route. Clients only look at the status (413 is
// "the lesson is too big"), so it stays; the details stay in the server log.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) { next(err); return; }
  const raw = (err as { status?: unknown } | null)?.status;
  const status = typeof raw === 'number' && raw >= 400 && raw < 500 ? raw : 500;
  if (status === 500) console.error('!!! request failed:', err);
  res.status(status).json({ error: status === 500 ? 'server error' : status === 413 ? 'too large' : 'bad request' });
});

function bookingTick(now: number) {
  for (const [key, b] of bookings) {
    if (key.startsWith('pending:')) continue;
    if (b.status === 'booked' && now >= opensAt(b.startsAt)) openBooking(b);
    if (b.status === 'open' && !b.teacherCame && now >= b.startsAt + DEMO_NO_SHOW_MS) {
      b.status = 'no show';
      b.barUntil = now + DEMO_NO_SHOW_BAR_MS;
      saveBookingLater(b);
      const lesson = lessons.get(b.code);
      if (lesson) endLesson(b.code, lesson, 'no teacher');
      else closeDemo(b.code, 'no teacher');
    }
    if (!isHeld(b) && b.barUntil <= now) bookings.delete(key);
  }
}

const serverStartedAt = Date.now(); // after a restart lessons are out of memory until their teacher reconnects

function demoTick() {
  const now = Date.now();
  bookingTick(now);
  for (const [code, demo] of demos) {
    if (code.startsWith('pending:')) continue;
    if (demo.endedAt !== null) {
      if (demo.cooldownUntil <= now && demo.slotFreeAt <= now) demos.delete(code);
      continue;
    }
    // A request alone doesn't hold a place: without this, a few addresses could fill the pool for free
    if (demo.videoMode === 'solo' && !lessons.has(code) && now - Math.max(demo.createdAt, serverStartedAt) >= DEMO_SOLO_NO_TEACHER_MS) {
      closeDemo(code, 'teacher never came');
      demo.cooldownUntil = now + DEMO_SOLO_EMPTY_BAR_MS;
      saveDemoLater(demo);
      continue;
    }
    const reason = now >= demo.endsAt ? 'time is up'
      : demo.firstStudentAt === null && now - demoStart(demo) >= DEMO_NO_STUDENTS_MS ? 'no students' : null;
    if (!reason) continue;
    const lesson = lessons.get(code);
    if (lesson) endLesson(code, lesson, reason);
    else closeDemo(code, reason);
  }
}
setInterval(demoTick, 5000);

// One line a minute on how the machine copes: what the demo is run to find out
const LOAD_SAMPLE_MS = 60 * 1000;
const sampleMachine = createSampler();
sampleMachine();
setInterval(() => {
  const machine = sampleMachine();
  const now = Date.now();
  const all = [...lessons.entries()].filter(([c, l]) => holdsPlace(c, l));
  const people = all.flatMap(([, l]) => realPeople(l));
  if (hasDemo) {
    saveLoadSample({
      cpuPct: machine?.cpuPct ?? null, memUsedMb: machine?.memUsedMb ?? null, rxPps: machine?.rxPps ?? null,
      txPps: machine?.txPps ?? null, udpDropped: machine?.udpDropped ?? null,
      realLessons: all.filter(([c]) => !demos.has(c)).length,
      demoCamera: demosRunning('teacher'), demoAudio: demosRunning('none'),
      teachers: people.filter(p => p.role === 'teacher').length, students: people.filter(p => p.role === 'student').length,
    }).catch(e => console.error('!!! load sample not saved:', e));
    for (const [ipHash, c] of demoIpCounts) {
      addDemoIpStats(ipHash, c.attempts, c.refused, c.penalties).catch(e => console.error('!!! demo stats not saved:', e));
    }
    demoIpCounts.clear();
  }
  demoThrottle.sweep();
}, LOAD_SAMPLE_MS);

const PORT = Number(process.env.PORT) || 13113;
migrate()
  .catch(e => console.error('!!! DB migration failed — lessons work, but only with video (no lessons.video_mode):', e))
  .then(async () => {
    if (!hasDemo) return;
    for (const demo of await loadCurrentDemos()) demos.set(demo.code, demo);
    for (const booking of await loadCurrentBookings()) bookings.set(booking.code, booking); // a restart mustn't free places
  })
  .catch(e => console.error('!!! demo lessons not restored:', e))
  .finally(() => httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`)));

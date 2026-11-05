import 'dotenv/config';
import { createServer } from 'http';
import crypto from 'crypto';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import {
  verifyTeacher, getTeacherSessionVersion, createLesson, LessonLimitError, migrate, VIDEO_MODES, type VideoMode, getLessonByCode, cleanupExpiredLessons,
  isAuthKey, getJournal, saveJournal, changePassword, hasJournal,
  hasDemo, deleteLesson, saveDemo, loadCurrentDemos, saveDemoFeedback, addDemoIpStats, saveLoadSample, cleanupDemoLogs,
  type DemoRecord,
} from './db';
import {
  parseMaterial, MaterialError, MAX_MATERIAL_JSON_BYTES, mediaCatalog, emptySlidesState, blockSlides, currentScene,
  studentScenes, scenesMedia, allowedHashes, type SlidesState, type Material,
} from './slides';
import { MediaRelay, type ChunkMsg } from './mediaRelay';
import { Throttle, hashIp } from './demoGuard';
import { createSampler } from './loadSampler';

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
  : req.path === '/journal' || req.path === '/password' ? journalJson
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

app.post('/lessons', requireAuth, async (req: AuthedRequest, res) => {
  const requested = (req.body as { videoMode?: unknown } | undefined)?.videoMode;
  const videoMode: VideoMode = VIDEO_MODES.includes(requested as VideoMode) ? requested as VideoMode : 'all';
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
// password can't be reset here — that's not built yet, and the journal would stay closed anyway.
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

// ---------- lesson material (structure only; the file stays in the teacher's browser) ----------

// Server-wide limits, so one teacher (or a dozen) can't eat the server's memory
const MAX_MATERIALS_PER_TEACHER = 3;
const MAX_MATERIALS_TOTAL_BYTES = 300 * 1024 * 1024;

async function ownLesson(req: AuthedRequest, res: Response): Promise<string | null> {
  const dbLesson = await getLessonByCode(String(req.params.code)).catch(() => null);
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
  setMaterial(code, lesson, material, { keepState: same });
  console.log(`[${code}] material ${same ? 'resent' : 'loaded'}: "${material.title}", ${material.media.size} media, ${Math.round(material.bytes / 1024)} KB`);
  res.json({ ok: true });
});

app.delete('/lessons/:code/material', requireTeacherOrDemo, async (req: AuthedRequest, res) => {
  const code = await ownLesson(req, res);
  if (!code) return;
  const lesson = lessons.get(code);
  if (lesson) setMaterial(code, lesson, null);
  res.json({ ok: true });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
});

type Role = 'teacher' | 'student' | 'board';
type Stage = 'waiting' | 'group' | 'individual' | 'pairs' | 'fours';

interface Participant {
  id: string;
  name: string;
  role: Role;
  livekitRoom: string | null;
  uuid: string | null; // the student's profile in their browser; only teachers get to see it
  avatar: string | null; // id of a picture from the clients' built-in set (avatars/<id>.svg)
}

// Seating
export interface Seat {
  id: string;
  groupIndex: number;
  row: number;   // 0 = верхняя пара, 1 = нижняя пара
  col: number;   // 0 = левый, 1 = правый
  occupant: string | null;
  reserved: boolean; // kept by the seat plan for a certain student
}

interface Poll {
  question: string;
  options: string[];
  votes: Map<string, number>;
}

// Everything scoped to one lesson (one teacher + their students). Keyed by lesson code.
interface LessonRuntime {
  videoMode: VideoMode; // from the DB, fixed for the lesson
  teacherId: number | null; // owner, for the per-teacher limit
  stage: Stage;
  timerEndsAt: number | null;
  participants: Map<string, Participant>;
  seats: Seat[];
  seatPlan: Map<string, string>; // from the teacher's journal, in memory only: student uuid → seat id
  sharedTexts: Map<string, string>; // per livekit room name
  boards: Map<string, Map<string, BoardObject>>; // per livekit room name: uid → object JSON, in z-order
  boardConnections: Map<string, { room: string }>; // board-only (mobile webview) viewers
  currentPoll: Poll | null;
  material: Material | null;
  slides: SlidesState;
  relay: MediaRelay;
  emptySince: number | null;
  visited: boolean; // someone has been in: from then on it holds its place until it's over
  noTeacherSince: number | null; // since when no teacher is in (left, or never came yet); null while one is in
  ended: boolean;                  // the lesson was ended — dropped from memory as soon as nobody is left
  afterUntil: number | null;       // after-lesson chat in fours (teacher gone) lasts until; then the lesson ends
  afterTimer: NodeJS.Timeout | null;
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

function realLessonRefusal(videoMode: VideoMode): 'server full' | 'video full' | null {
  const live = [...lessons.entries()].filter(([c, l]) => !demos.has(c) && holdsPlace(c, l)).map(([, l]) => l);
  if (live.length >= MAX_REAL_LESSONS) return 'server full';
  if (videoMode !== 'none' && live.filter(l => l.videoMode !== 'none').length >= MAX_REAL_VIDEO_LESSONS) return 'video full';
  return null;
}

/** Why this person can't come in now, if so. Checked right before joining, with no await in between. */
function joinRefusal(code: string, videoMode: VideoMode, role: Role, uuid: string | null): string | null {
  const lesson = lessons.get(code);
  if (role === 'board') return null;
  if (role === 'student') {
    const others = lesson ? [...lesson.participants.values()].filter(p => p.role === 'student' && (!uuid || p.uuid !== uuid)) : [];
    if (others.length >= MAX_STUDENTS_PER_LESSON) return 'lesson full';
    const total = [...lessons.values()].reduce((n, l) => n + l.participants.size, 0);
    if (total >= MAX_PARTICIPANTS_TOTAL) return 'server full';
  }
  if (demos.has(code) || (lesson && holdsPlace(code, lesson))) return null;
  return realLessonRefusal(videoMode);
}

// ---------- demo lessons ----------
// Anyone can start one, no account and so no journal. A lesson takes a slot from the moment of
// the button; a finished one frees its slot after a random pause and bars its address for a while.
const MINUTE_MS = 60 * 1000;
const DEMO_LESSON_MS = envNumber('DEMO_LESSON_MINUTES', 60) * MINUTE_MS;
const DEMO_NO_STUDENTS_MS = envNumber('DEMO_NO_STUDENTS_MINUTES', 10) * MINUTE_MS;
const DEMO_COOLDOWN_MS = envNumber('DEMO_COOLDOWN_MINUTES', 60) * MINUTE_MS;
const DEMO_EMPTY_COOLDOWN_MS = envNumber('DEMO_EMPTY_COOLDOWN_MINUTES', 10) * MINUTE_MS;
const DEMO_SLOT_PAUSE_MIN_MS = envNumber('DEMO_SLOT_PAUSE_MIN_MINUTES', 3) * MINUTE_MS;
const DEMO_SLOT_PAUSE_MAX_MS = envNumber('DEMO_SLOT_PAUSE_MAX_MINUTES', 5) * MINUTE_MS;
const DEMO_SLOTS = { teacher: envNumber('DEMO_CAMERA_SLOTS', 3), none: envNumber('DEMO_AUDIO_SLOTS', 10) };

type DemoMode = keyof typeof DEMO_SLOTS;

const demos = new Map<string, DemoRecord>();
const demoThrottle = new Throttle();
const demoIpCounts = new Map<string, { attempts: number; refused: number; penalties: number }>();

function saveDemoLater(d: DemoRecord) {
  saveDemo(d).catch(e => console.error('!!! demo lesson not saved:', e));
}

const holdsSlot = (d: DemoRecord, now: number) => d.endedAt === null || d.slotFreeAt > now;
const demoSlotsTaken = (mode: DemoMode, now = Date.now()) =>
  [...demos.values()].filter(d => d.videoMode === mode && holdsSlot(d, now)).length;

/** When a slot of this kind is sure to be free. The exact random moment isn't given away. */
function nextDemoSlotMs(mode: DemoMode, now: number): number {
  const times = [...demos.values()].filter(d => d.videoMode === mode && holdsSlot(d, now))
    .map(d => (d.endedAt ?? d.endsAt) + DEMO_SLOT_PAUSE_MAX_MS - now);
  return Math.max(30_000, Math.min(...times));
}

/** Marks the demo as over; safe to call from every path that ends a lesson */
function closeDemo(code: string, reason: string) {
  const demo = demos.get(code);
  if (!demo || demo.endedAt !== null) return;
  const now = Date.now();
  demo.endedAt = now;
  demo.endReason = reason;
  demo.cooldownUntil = now + (demo.firstStudentAt === null ? DEMO_EMPTY_COOLDOWN_MS : DEMO_COOLDOWN_MS);
  demo.slotFreeAt = now + DEMO_SLOT_PAUSE_MIN_MS + Math.random() * (DEMO_SLOT_PAUSE_MAX_MS - DEMO_SLOT_PAUSE_MIN_MS);
  saveDemoLater(demo);
  deleteLesson(code).catch(e => console.error('!!! demo lesson code not deleted:', e));
  console.log(`[${code}] demo over (${reason}): peak ${demo.peakStudents} students`);
}

function demoEndInfo(demo: DemoRecord) {
  return { reason: demo.endReason, retryAfterSeconds: Math.max(0, Math.ceil((demo.cooldownUntil - Date.now()) / 1000)) };
}

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
  return lesson.participants.size === 0 && lesson.boardConnections.size === 0 && !io.sockets.adapter.rooms.get(code)?.size;
}

function dropLesson(code: string, why: string) {
  const lesson = lessons.get(code);
  if (!lesson) return;
  closeDemo(code, why);
  lesson.relay.dispose();
  if (lesson.afterTimer) clearTimeout(lesson.afterTimer);
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
    videoMode: 'all',
    teacherId,
    stage: 'waiting',
    timerEndsAt: null,
    participants: new Map(),
    seats: [],
    seatPlan: new Map(),
    sharedTexts: new Map(),
    boards: new Map(),
    boardConnections: new Map(),
    currentPoll: null,
    material: null,
    slides: emptySlidesState(),
    relay: new MediaRelay(io, code),
    emptySince: Date.now(),
    visited: false,
    noTeacherSince: Date.now(),
    ended: false,
    afterUntil: null,
    afterTimer: null,
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
}

const MAX_CAPACITY = MAX_STUDENTS_PER_LESSON;

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

function broadcastSeats(code: string, lesson: LessonRuntime) {
  io.to(code).emit('seats', lesson.seats);
}

function pollResults(lesson: LessonRuntime) {
  if (!lesson.currentPoll) return null;
  const poll = lesson.currentPoll;
  const counts = poll.options.map((_, i) =>
    Array.from(poll.votes.values()).filter(v => v === i).length
  );
  return { question: poll.question, options: poll.options, counts, total: poll.votes.size };
}

function demoState(code: string) {
  const demo = demos.get(code);
  if (!demo || demo.endedAt !== null) return null;
  return { endsAt: demo.endsAt, noStudentsAt: demo.firstStudentAt === null ? demo.createdAt + DEMO_NO_STUDENTS_MS : null };
}

function broadcastState(code: string, lesson: LessonRuntime) {
  io.to(code).emit('state', {
    stage: lesson.stage,
    videoMode: lesson.videoMode,
    timerEndsAt: lesson.timerEndsAt,
    afterUntil: lesson.afterUntil,
    demo: demoState(code),
    now: Date.now(), // the clients' clocks may be off; the demo's times are the server's
    participants: Array.from(lesson.participants.values()).map(p => ({
      id: p.id, name: p.name, role: p.role, livekitRoom: p.livekitRoom, avatar: p.avatar,
    })),
  });
  // Only for the teacher: a student's uuid is what seats them, classmates must not learn it
  const uuids = Object.fromEntries(Array.from(lesson.participants.values()).filter(p => p.uuid).map(p => [p.id, p.uuid]));
  for (const id of socketsOf(lesson, 'teacher')) io.sockets.sockets.get(id)?.emit('studentUuids', uuids);
}

// ---------- slides ----------

function socketsOf(lesson: LessonRuntime, role: Role): string[] {
  return Array.from(lesson.participants.values()).filter(p => p.role === role).map(p => p.id);
}

/** End of the lesson (teacher's button, or the teacher has been gone too long): material is
 *  forgotten, students are told and sent away; once nobody is left the lesson leaves memory. */
function endLesson(code: string, lesson: LessonRuntime, why: string) {
  closeDemo(code, why);
  lesson.ended = true;
  lesson.stage = 'waiting';
  lesson.timerEndsAt = null;
  lesson.currentPoll = null;
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
  lesson.stage = 'fours';
  lesson.timerEndsAt = null;
  lesson.currentPoll = null;
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
    active: st.active,
    blockId: st.blockId,
    index: st.index,
    revealed: scene ? Array.from(st.revealed.get(scene.id) ?? []) : [],
    positions: scene ? st.positions.get(scene.id) ?? {} : {},
  };
}

function studentSlidesView(lesson: LessonRuntime) {
  const s = studentScenes(lesson.material, lesson.slides);
  if (!s) return { active: false };
  return {
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
  lesson.relay.setAllowed(allowedHashes(lesson.material, lesson.slides));
}

function setMaterial(code: string, lesson: LessonRuntime, material: Material | null, { keepState = false } = {}) {
  lesson.material = material;
  if (!keepState) {
    lesson.slides = emptySlidesState();
    lesson.relay.setCatalog(mediaCatalog(material));
  }
  broadcastSlides(lesson, { material: true });
}

// ---------- shared board ----------
// One Fabric board per LiveKit room. Clients send per-object operations; the server keeps the
// current objects (for latecomers and room switches) and relays each operation to the room.
type BoardObject = Record<string, unknown> & { uid: string; type: string };
const BOARD_MAX_OBJECTS = 3000;
const BOARD_MAX_OP_BYTES = 256 * 1024;

function boardState(lesson: LessonRuntime, room: string): BoardObject[] {
  return Array.from(lesson.boards.get(room)?.values() ?? []);
}

function isBoardObject(o: unknown): o is BoardObject {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const { uid, type } = o as Record<string, unknown>;
  return typeof uid === 'string' && uid.length > 0 && uid.length <= 64 && typeof type === 'string' && type.length <= 32;
}

function applyBoardOp(lesson: LessonRuntime, room: string, raw: unknown, author: string, isTeacher: boolean, fromSocket: string) {
  if (!raw || typeof raw !== 'object') return;
  const op = raw as { t?: unknown; obj?: unknown; uid?: unknown };
  let board = lesson.boards.get(room);
  if (!board) { board = new Map(); lesson.boards.set(room, board); }

  let out: unknown;
  if (op.t === 'add' || op.t === 'mod') {
    if (!isBoardObject(op.obj) || JSON.stringify(op.obj).length > BOARD_MAX_OP_BYTES) return;
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

/** Without video the token itself forbids the camera, so no client can switch it on anyway */
async function makeLivekitToken(identity: string, room: string, video = true): Promise<string> {
  const token = new AccessToken(API_KEY, API_SECRET, { identity });
  token.addGrant(video
    ? { roomJoin: true, room, canPublish: true, canSubscribe: true }
    : { roomJoin: true, room, canPublish: true, canSubscribe: true,
        canPublishSources: [TrackSource.MICROPHONE, TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO] });
  return await token.toJwt();
}

async function sendToRoom(code: string, lesson: LessonRuntime, socketId: string, room: string) {
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) return;
  const participant = lesson.participants.get(socketId);
  if (!participant) return;
  const token = await makeLivekitToken(participant.name, room, canVideo(lesson, participant.role));
  socket.emit('livekit', { url: LIVEKIT_WS_URL, token, room });
  participant.livekitRoom = room;
  socket.emit('sharedText', { room, text: lesson.sharedTexts.get(room) ?? '' });
  socket.emit('boardState', boardState(lesson, room));
  console.log(`  [${code}] ${participant.name} -> ${room}`);
}

// Assign by seating if seats exist, otherwise fallback to index-based
async function assignPairs(code: string, lesson: LessonRuntime) {
  const students = Array.from(lesson.participants.values()).filter(p => p.role === 'student');
  const studentByName = new Map(students.map(s => [s.name, s]));

  if (lesson.seats.length > 0) {
    // Group by (groupIndex, row) → pair room
    const pairMap = new Map<string, Seat[]>();
    for (const seat of lesson.seats) {
      if (!seat.occupant) continue;
      const key = `pair-g${seat.groupIndex}-r${seat.row}`;
      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key)!.push(seat);
    }
    for (const [base, pairSeats] of pairMap) {
      const room = roomName(code, base);
      await livekit.createRoom({ name: room }).catch(() => {});
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
      await livekit.createRoom({ name: room }).catch(() => {});
      for (let j = i; j < Math.min(i + 2, unseated.length); j++) {
        await sendToRoom(code, lesson, unseated[j].id, room);
      }
    }
  } else {
    for (let i = 0; i < students.length; i += 2) {
      const room = roomName(code, `pair-${Math.floor(i / 2) + 1}`);
      await livekit.createRoom({ name: room }).catch(() => {});
      for (let j = i; j < Math.min(i + 2, students.length); j++) {
        await sendToRoom(code, lesson, students[j].id, room);
      }
    }
  }
}

async function assignFours(code: string, lesson: LessonRuntime, prefix = 'fours') {
  const students = Array.from(lesson.participants.values()).filter(p => p.role === 'student');
  const studentByName = new Map(students.map(s => [s.name, s]));

  if (lesson.seats.length > 0) {
    const groupMap = new Map<number, Seat[]>();
    for (const seat of lesson.seats) {
      if (!seat.occupant) continue;
      if (!groupMap.has(seat.groupIndex)) groupMap.set(seat.groupIndex, []);
      groupMap.get(seat.groupIndex)!.push(seat);
    }
    for (const [groupIndex, groupSeats] of groupMap) {
      const room = roomName(code, `${prefix}-${groupIndex + 1}`);
      await livekit.createRoom({ name: room }).catch(() => {});
      for (const seat of groupSeats) {
        const s = studentByName.get(seat.occupant!);
        if (s) await sendToRoom(code, lesson, s.id, room);
      }
    }
    const seated = new Set(lesson.seats.map(s => s.occupant).filter(Boolean));
    const unseated = students.filter(s => !seated.has(s.name));
    for (let i = 0; i < unseated.length; i += 4) {
      const room = roomName(code, `${prefix}-unseated-${Math.floor(i / 4) + 1}`);
      await livekit.createRoom({ name: room }).catch(() => {});
      for (let j = i; j < Math.min(i + 4, unseated.length); j++) {
        await sendToRoom(code, lesson, unseated[j].id, room);
      }
    }
  } else {
    for (let i = 0; i < students.length; i += 4) {
      const room = roomName(code, `${prefix}-${Math.floor(i / 4) + 1}`);
      await livekit.createRoom({ name: room }).catch(() => {});
      for (let j = i; j < Math.min(i + 4, students.length); j++) {
        await sendToRoom(code, lesson, students[j].id, room);
      }
    }
  }
}

async function assignIndividual(code: string, lesson: LessonRuntime) {
  const students = Array.from(lesson.participants.values()).filter(p => p.role === 'student');
  for (const student of students) {
    const room = roomName(code, `individual-${student.name}`);
    await livekit.createRoom({ name: room }).catch(() => {});
    await sendToRoom(code, lesson, student.id, room);
  }
}

async function sendAllToMain(code: string, lesson: LessonRuntime) {
  const students = Array.from(lesson.participants.values()).filter(p => p.role === 'student');
  const room = roomName(code, 'main-room');
  await livekit.createRoom({ name: room }).catch(() => {});
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
  const { name, role, lessonId, uuid: rawUuid, token, avatar: rawAvatar } = socket.handshake.auth as { name: string; role: Role; lessonId?: string; boardRoom?: string; uuid?: unknown; token?: string; avatar?: unknown };
  // only an id from the built-in set travels — never a picture; clients ignore ids they don't know
  const avatar = typeof rawAvatar === 'string' && /^[a-z]{1,20}$/.test(rawAvatar) ? rawAvatar : null;
  const uuid = role === 'student' && isUuid(rawUuid) ? rawUuid : null;
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

  const dbLesson = await getLessonByCode(lessonId).catch(() => null);
  if (refuseIfDemoOver(lessonId)) return;
  if (!dbLesson) {
    recordFailedAttempt(codeAttempts, ip);
    socket.emit('lessonError', { error: 'lesson not found' });
    socket.disconnect(true);
    return;
  }
  clearAttempts(codeAttempts, ip);

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
  lesson.videoMode = dbLesson.videoMode;
  socket.join(code);

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
    const participant: Participant = { id: socket.id, name: effectiveName, role, livekitRoom: null, uuid, avatar };
    lesson.participants.set(socket.id, participant);
    lesson.visited = true;
    const demo = demos.get(code);
    if (demo && role === 'student') demoStudentCame(demo, socketsOf(lesson, 'student').length);
    if (seatByPlan(lesson, participant)) broadcastSeats(code, lesson);
    console.log(`+ [${code}] ${role}: ${effectiveName}`);
    // Registered before any await below: a socket that leaves mid-join must not stay as a ghost participant
    socket.on('disconnect', () => {
      lesson.relay.removePeer(socket.id);
      lesson.participants.delete(socket.id);
      if (lesson.participants.size === 0) lesson.emptySince = Date.now();
      if (role === 'teacher' && socketsOf(lesson, 'teacher').length === 0) lesson.noTeacherSince = Date.now();
      dropIfEnded(code);
      if (role === 'student') {
        for (const seat of lesson.seats) {
          if (seat.occupant === effectiveName) seat.occupant = null;
        }
        io.to(code).emit('seats', lesson.seats);
      }
      console.log(`- [${code}] ${role}: ${effectiveName}`);
      broadcastState(code, lesson);
    });
    // The seating saved in the teacher's journal. Comes without names: the server only learns
    // which uuid sits where, the journal stays in the teacher's browser.
    socket.on('seatPlan', ({ capacity, seats }: { capacity?: unknown; seats?: unknown } = {}) => {
      if (role !== 'teacher') return;
      applySeatPlan(lesson, capacity, seats);
      broadcastSeats(code, lesson);
    });

    if (role === 'teacher') socket.emit('joined'); // the lines above are listening now: the plan may come
    broadcastState(code, lesson);
    socket.emit('seats', lesson.seats);

    lesson.emptySince = null;
    lesson.ended = false; // someone came (back) — it's a live lesson again
    if (role === 'teacher') lesson.noTeacherSince = null;
    if (role === 'teacher') {
      socket.emit('slides:material', teacherMaterial(lesson));
      socket.emit('slides:state', teacherSlidesState(lesson));
    } else {
      socket.emit('slides:view', studentSlidesView(lesson));
    }
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
    } else if (role === 'student' && canVideo(lesson, role)) {
      socket.emit('monitor', { url: LIVEKIT_WS_URL, token: await makeCameraOnlyToken(effectiveName, mainRoom), room: mainRoom });
    }
    await sendToRoom(code, lesson, socket.id, mainRoom);

    socket.on('setCapacity', (n: number) => {
      if (role !== 'teacher' || !Number.isInteger(n) || n < 0) return;
      const capacity = Math.min(n, MAX_CAPACITY);
      createSeats(lesson, capacity);
      broadcastSeats(code, lesson);
      console.log(`[${code}] capacity -> ${capacity} (${capacity / 4} groups)`);
    });

    socket.on('claimSeat', (seatId: string) => {
      if (role !== 'student') return;
      const target = lesson.seats.find(s => s.id === seatId);
      if (target && reservedForOther(lesson, target, uuid)) return; // stay where you are
      // Release current seat
      const current = lesson.seats.find(s => s.occupant === effectiveName);
      if (current) current.occupant = null;
      // Claim new seat if free
      if (target && !target.occupant) target.occupant = effectiveName;
      broadcastSeats(code, lesson);
    });

    socket.on('clearSeat', (seatId: string) => {
      if (role !== 'teacher') return;
      const seat = lesson.seats.find(s => s.id === seatId);
      if (seat) seat.occupant = null;
      broadcastSeats(code, lesson);
    });

    socket.on('moveSeat', ({ studentName, toSeatId }: { studentName: string; toSeatId: string }) => {
      if (role !== 'teacher') return;
      const from = lesson.seats.find(s => s.occupant === studentName);
      const to = lesson.seats.find(s => s.id === toSeatId);
      if (!to || to.occupant) return;
      if (from) from.occupant = null;
      to.occupant = studentName;
      broadcastSeats(code, lesson);
    });

    socket.on('setStage', async (stage: Stage) => {
      if (role !== 'teacher') return;
      lesson.stage = stage;
      console.log(`[${code}] stage -> ${stage}`);
      if (stage === 'pairs') await assignPairs(code, lesson);
      else if (stage === 'fours') await assignFours(code, lesson);
      else if (stage === 'individual') await assignIndividual(code, lesson);
      else await sendAllToMain(code, lesson);
      broadcastState(code, lesson);
    });

    socket.on('startTimer', (seconds: number) => {
      if (role !== 'teacher') return;
      lesson.timerEndsAt = Date.now() + seconds * 1000;
      broadcastState(code, lesson);
    });

    socket.on('stopTimer', () => {
      if (role !== 'teacher') return;
      lesson.timerEndsAt = null;
      broadcastState(code, lesson);
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
      if (!participant?.livekitRoom) return;
      applyBoardOp(lesson, participant.livekitRoom, op, participant.name, role === 'teacher', socket.id);
    });

    socket.on('startPoll', ({ question, options }: { question: string; options: string[] }) => {
      if (role !== 'teacher') return;
      lesson.currentPoll = { question, options, votes: new Map() };
      io.to(code).emit('poll', { question, options, myVote: null });
      io.to(code).emit('pollResults', pollResults(lesson));
    });

    socket.on('vote', ({ optionIndex }: { optionIndex: number }) => {
      if (role !== 'student' || !lesson.currentPoll) return;
      lesson.currentPoll.votes.set(effectiveName, optionIndex);
      socket.emit('poll', { question: lesson.currentPoll.question, options: lesson.currentPoll.options, myVote: optionIndex });
      io.to(code).emit('pollResults', pollResults(lesson));
    });

    socket.on('stopPoll', () => {
      if (role !== 'teacher') return;
      lesson.currentPoll = null;
      io.to(code).emit('poll', null);
      io.to(code).emit('pollResults', null);
    });

    socket.on('joinPair', async ({ room }: { room: string }) => {
      if (role !== 'teacher') return;
      await sendToRoom(code, lesson, socket.id, room);
      // Dismiss call indicator for this room on teacher side
      socket.emit('callTeacher', { room, calling: false });
      // Notify students in the pair room that teacher is coming
      for (const [id, p] of lesson.participants) {
        if (p.livekitRoom === room && p.role === 'student') {
          io.sockets.sockets.get(id)?.emit('teacherJoined');
        }
      }
    });

    socket.on('leavePair', async () => {
      if (role !== 'teacher') return;
      await sendToRoom(code, lesson, socket.id, roomName(code, 'main-room'));
    });

    socket.on('mute', ({ target }: { target: string | 'all' }) => {
      if (role !== 'teacher') return;
      for (const [id, p] of lesson.participants) {
        if (p.role === 'student' && (target === 'all' || p.name === target)) {
          io.sockets.sockets.get(id)?.emit('muted');
        }
      }
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

    // Teacher presents slides: open/close, navigate, reveal hidden objects, move ✋ objects.
    socket.on('slides:open', ({ blockId }: { blockId?: string } = {}) => {
      if (role !== 'teacher' || !lesson.material) return;
      const st = lesson.slides;
      const target = blockId ?? st.blockId ?? lesson.material.blocks.find(b => b.slides.length)?.id ?? null;
      if (target !== st.blockId) { st.blockId = target; st.index = 0; }
      st.active = blockSlides(lesson.material, st.blockId).length > 0;
      broadcastSlides(lesson);
    });

    socket.on('slides:close', () => {
      if (role !== 'teacher') return;
      lesson.slides.active = false;
      broadcastSlides(lesson);
    });

    socket.on('slides:goto', ({ blockId, index }: { blockId: string; index: number }) => {
      if (role !== 'teacher') return;
      const count = blockSlides(lesson.material, blockId).length;
      if (!count || !Number.isInteger(index)) return;
      lesson.slides.blockId = blockId;
      lesson.slides.index = Math.max(0, Math.min(count - 1, index));
      broadcastSlides(lesson);
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

  await finishJoin(name);
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
    if (lesson.ended || lesson.afterUntil || !lesson.noTeacherSince || now - lesson.noTeacherSince <= TEACHER_ABSENT_MS) continue;
    if (isEmpty(code, lesson)) dropLesson(code, 'no teacher');
    else endLesson(code, lesson, 'no teacher');
  }
}, Math.min(30_000, TEACHER_ABSENT_MS / 3));

setInterval(() => {
  cleanupExpiredLessons().then(n => { if (n) console.log(`cleaned up ${n} expired lesson code(s)`); }).catch(() => {});
  sweepAttempts(codeAttempts); sweepAttempts(loginAttempts);
  cleanupDemoLogs().catch(e => console.error('!!! demo logs not cleaned up:', e));
}, 6 * 60 * 60 * 1000);

// ---------- demo: starting one, its clock, feedback ----------

function refuseDemo(res: Response, status: number, ipHash: string, error: string, retryAfterMs: number) {
  countDemoIp(ipHash, 'refused');
  res.status(status).json({ error, retryAfterSeconds: Math.ceil(retryAfterMs / 1000) });
}

app.post('/demo/lessons', async (req, res) => {
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

  const videoMode: DemoMode = (req.body as { videoMode?: unknown } | undefined)?.videoMode === 'none' ? 'none' : 'teacher';
  const now = Date.now();
  const mine = [...demos.values()].filter(d => d.ipHash === ipHash);
  const running = mine.find(d => d.endedAt === null);
  if (running) { refuseDemo(res, 409, ipHash, 'ip busy', running.endsAt - now + DEMO_COOLDOWN_MS); return; }
  const barred = Math.max(0, ...mine.map(d => d.cooldownUntil - now));
  if (barred > 0) { refuseDemo(res, 429, ipHash, 'cooldown', barred); return; }
  if (demoSlotsTaken(videoMode, now) >= DEMO_SLOTS[videoMode]) {
    refuseDemo(res, 429, ipHash, 'no slots', nextDemoSlotMs(videoMode, now));
    return;
  }

  // The place is taken before the first await, so a burst of requests can't slip past the checks
  const pendingKey = `pending:${crypto.randomUUID()}`;
  const demo: DemoRecord = {
    code: pendingKey, ipHash, videoMode, createdAt: now, endsAt: now + DEMO_LESSON_MS, firstStudentAt: null,
    peakStudents: 0, endedAt: null, endReason: null, cooldownUntil: 0, slotFreeAt: 0,
  };
  demos.set(pendingKey, demo);
  try {
    const lesson = await createLesson(null, videoMode);
    demo.code = lesson.code;
    demos.set(lesson.code, demo);
    demos.delete(pendingKey);
    await saveDemo(demo);
    console.log(`[${lesson.code}] demo started (${videoMode}), address ${ipHash}`);
    res.json({ lesson, token: signDemoToken(lesson.code), endsAt: demo.endsAt });
  } catch (e) {
    console.error('!!! demo lesson not created:', e);
    demos.delete(pendingKey);
    demos.delete(demo.code);
    res.status(500).json({ error: 'failed to create lesson' });
  }
});

app.post('/demo/feedback', async (req, res) => {
  const code = verifyDemoToken(bearerToken(req));
  if (!code) { res.status(401).json({ error: 'unauthorized' }); return; }
  const { rating, comment, email } = req.body ?? {};
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) { res.status(400).json({ error: 'rating is required' }); return; }
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const saved = await saveDemoFeedback(code, rating, text(comment, 4000), text(email, 200)).then(() => true, () => false);
  if (!saved) { res.status(500).json({ error: 'failed to save feedback' }); return; }
  res.json({ ok: true });
});

// Last in the chain, after every route. Clients only look at the status (413 is
// "the lesson is too big"), so it stays; the details stay in the server log.
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) { next(err); return; }
  const raw = (err as { status?: unknown } | null)?.status;
  const status = typeof raw === 'number' && raw >= 400 && raw < 500 ? raw : 500;
  if (status === 500) console.error('!!! request failed:', err);
  res.status(status).json({ error: status === 500 ? 'server error' : status === 413 ? 'too large' : 'bad request' });
});

function demoTick() {
  const now = Date.now();
  for (const [code, demo] of demos) {
    if (code.startsWith('pending:')) continue;
    if (demo.endedAt !== null) {
      if (demo.cooldownUntil <= now && demo.slotFreeAt <= now) demos.delete(code);
      continue;
    }
    const reason = now >= demo.endsAt ? 'time is up'
      : demo.firstStudentAt === null && now - demo.createdAt >= DEMO_NO_STUDENTS_MS ? 'no students' : null;
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
  const people = all.flatMap(([, l]) => [...l.participants.values()]);
  if (hasDemo) {
    saveLoadSample({
      cpuPct: machine?.cpuPct ?? null, memUsedMb: machine?.memUsedMb ?? null, rxPps: machine?.rxPps ?? null,
      txPps: machine?.txPps ?? null, udpDropped: machine?.udpDropped ?? null,
      realLessons: all.filter(([c]) => !demos.has(c)).length,
      demoCamera: demoSlotsTaken('teacher', now), demoAudio: demoSlotsTaken('none', now),
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
    for (const demo of await loadCurrentDemos()) demos.set(demo.code, demo); // a restart mustn't free slots or addresses
  })
  .catch(e => console.error('!!! demo lessons not restored:', e))
  .finally(() => httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`)));

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
  listStudents, createStudent, getStudentsForDevice, linkDevice,
} from './db';
import {
  parseMaterial, MaterialError, MAX_MATERIAL_JSON_BYTES, mediaCatalog, emptySlidesState, blockSlides, currentScene,
  studentScenes, scenesMedia, allowedHashes, type SlidesState, type Material,
} from './slides';
import { MediaRelay, type ChunkMsg } from './mediaRelay';

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

interface AuthedRequest extends Request { teacherId?: number }

async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const teacherId = token ? await verifyTeacherToken(token) : null;
  if (teacherId === null) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.teacherId = teacherId;
  next();
}

const app = express();
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});
// The lesson structure (slides JSON) may be a few MB; everything else is small
const smallJson = express.json();
const materialJson = express.json({ limit: MAX_MATERIAL_JSON_BYTES });
app.use((req, res, next) => (/^\/lessons\/[^/]+\/material$/.test(req.path) ? materialJson : smallJson)(req, res, next));

app.post('/login', async (req, res) => {
  const ip = clientIpFromReq(req);
  if (isLockedOut(loginAttempts, ip)) {
    res.status(429).json({ error: 'too many attempts' });
    return;
  }
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }
  const teacher = await verifyTeacher(email, password).catch(() => null);
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

app.get('/students', requireAuth, async (req: AuthedRequest, res) => {
  const students = await listStudents(req.teacherId!).catch(() => null);
  if (!students) {
    res.status(500).json({ error: 'failed to load students' });
    return;
  }
  res.json({ students });
});

app.post('/students', requireAuth, async (req: AuthedRequest, res) => {
  const { name } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  const student = await createStudent(req.teacherId!, name.trim()).catch(() => null);
  if (!student) {
    res.status(500).json({ error: 'failed to create student' });
    return;
  }
  res.json({ student });
});

// ---------- lesson material (structure only; the file stays in the teacher's browser) ----------

// Server-wide limits, so one teacher (or a dozen) can't eat the server's memory
const MAX_MATERIALS_PER_TEACHER = 3;
const MAX_MATERIALS_TOTAL_BYTES = 300 * 1024 * 1024;

async function ownLesson(req: AuthedRequest, res: Response): Promise<string | null> {
  const dbLesson = await getLessonByCode(String(req.params.code)).catch(() => null);
  if (!dbLesson) { res.status(404).json({ error: 'lesson not found' }); return null; }
  if (dbLesson.teacherId !== null && dbLesson.teacherId !== req.teacherId) { res.status(403).json({ error: 'not your lesson' }); return null; }
  return dbLesson.code;
}

app.post('/lessons/:code/material', requireAuth, async (req: AuthedRequest, res) => {
  const code = await ownLesson(req, res);
  if (!code) return;
  let material: Material;
  try { material = parseMaterial(req.body, req.teacherId ?? null); } catch (e) {
    if (e instanceof MaterialError) { res.status(400).json({ error: e.message }); return; }
    throw e;
  }
  const others = [...lessons.entries()].filter(([c, l]) => c !== code && l.material);
  if (others.filter(([, l]) => l.material!.teacherId === material.teacherId).length >= MAX_MATERIALS_PER_TEACHER) {
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

app.delete('/lessons/:code/material', requireAuth, async (req: AuthedRequest, res) => {
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
  deviceId: string | null;
  studentId: number | null;
  avatar: string | null; // id of a picture from the clients' built-in set (avatars/<id>.svg)
}

// Seating
export interface Seat {
  id: string;
  groupIndex: number;
  row: number;   // 0 = верхняя пара, 1 = нижняя пара
  col: number;   // 0 = левый, 1 = правый
  occupant: string | null;
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
  sharedTexts: Map<string, string>; // per livekit room name
  boards: Map<string, Map<string, BoardObject>>; // per livekit room name: uid → object JSON, in z-order
  boardConnections: Map<string, { room: string }>; // board-only (mobile webview) viewers
  currentPoll: Poll | null;
  material: Material | null;
  slides: SlidesState;
  relay: MediaRelay;
  emptySince: number | null;
  noTeacherSince: number | null; // since when no teacher is in (left, or never came yet); null while one is in
  ended: boolean;                  // the lesson was ended — dropped from memory as soon as nobody is left
  afterUntil: number | null;       // after-lesson chat in fours (teacher gone) lasts until; then the lesson ends
  afterTimer: NodeJS.Timeout | null;
}

const lessons = new Map<string, LessonRuntime>();

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
    sharedTexts: new Map(),
    boards: new Map(),
    boardConnections: new Map(),
    currentPoll: null,
    material: null,
    slides: emptySlidesState(),
    relay: new MediaRelay(io, code),
    emptySince: Date.now(),
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
  lesson.seats = [];
  const numGroups = Math.floor(n / 4);
  for (let g = 0; g < numGroups; g++) {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const id = `g${g}r${row}c${col}`;
        lesson.seats.push({ id, groupIndex: g, row, col, occupant: prev.get(id) ?? null });
      }
    }
  }
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

function broadcastState(code: string, lesson: LessonRuntime) {
  io.to(code).emit('state', {
    stage: lesson.stage,
    videoMode: lesson.videoMode,
    timerEndsAt: lesson.timerEndsAt,
    afterUntil: lesson.afterUntil,
    participants: Array.from(lesson.participants.values()).map(p => ({
      id: p.id, name: p.name, role: p.role, livekitRoom: p.livekitRoom, identified: p.studentId !== null, avatar: p.avatar,
    })),
  });
}

// ---------- slides ----------

function socketsOf(lesson: LessonRuntime, role: Role): string[] {
  return Array.from(lesson.participants.values()).filter(p => p.role === role).map(p => p.id);
}

/** End of the lesson (teacher's button, or the teacher has been gone too long): material is
 *  forgotten, students are told and sent away; once nobody is left the lesson leaves memory. */
function endLesson(code: string, lesson: LessonRuntime, why: string) {
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
  return lesson.videoMode === 'all' || (lesson.videoMode === 'teacher' && role === 'teacher');
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
  const { name, role, lessonId, deviceId, token, avatar: rawAvatar } = socket.handshake.auth as { name: string; role: Role; lessonId?: string; boardRoom?: string; deviceId?: string; token?: string; avatar?: unknown };
  // only an id from the built-in set travels — never a picture; clients ignore ids they don't know
  const avatar = typeof rawAvatar === 'string' && /^[a-z]{1,20}$/.test(rawAvatar) ? rawAvatar : null;
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

  const dbLesson = await getLessonByCode(lessonId).catch(() => null);
  if (!dbLesson) {
    recordFailedAttempt(codeAttempts, ip);
    socket.emit('lessonError', { error: 'lesson not found' });
    socket.disconnect(true);
    return;
  }
  clearAttempts(codeAttempts, ip);

  // Teacher role is only trusted once backed by a verified token — the client can no longer
  // just claim role: 'teacher'. A teacher also can't control someone else's lesson.
  if (role === 'teacher') {
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

  // Students can be recognized by this device (localStorage UUID), scoped to this lesson's
  // teacher, so returning students don't need to re-type their name and the teacher doesn't
  // need to guess who just joined. A shared device can be linked to several students, in
  // which case the client is asked to pick which one before the join completes.
  async function finishJoin(effectiveName: string, studentId: number | null, resolvedDeviceId: string | null) {
    if (socket.disconnected) return; // left while we were looking things up — nothing to add
    lesson.participants.set(socket.id, { id: socket.id, name: effectiveName, role, livekitRoom: null, deviceId: resolvedDeviceId, studentId, avatar });
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
    if (canVideo(lesson, role)) {
      const monToken = await makeLivekitToken(effectiveName, mainRoom);
      socket.emit('monitor', { url: LIVEKIT_WS_URL, token: monToken, room: mainRoom });
    }
    await sendToRoom(code, lesson, socket.id, mainRoom);

    socket.on('setCapacity', (n: number) => {
      if (role !== 'teacher') return;
      createSeats(lesson, n);
      broadcastSeats(code, lesson);
      console.log(`[${code}] capacity -> ${n} (${n / 4} groups)`);
    });

    socket.on('claimSeat', (seatId: string) => {
      if (role !== 'student') return;
      // Release current seat
      const current = lesson.seats.find(s => s.occupant === effectiveName);
      if (current) current.occupant = null;
      // Claim new seat if free
      const target = lesson.seats.find(s => s.id === seatId);
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

    // Teacher recognizes an unidentified (or misidentified) participant as a specific
    // roster student; links that participant's device so future joins auto-resolve.
    socket.on('adoptParticipant', async ({ participantId, studentId: sid, studentName }: { participantId: string; studentId: number; studentName: string }) => {
      if (role !== 'teacher') return;
      const target = lesson.participants.get(participantId);
      if (!target || !target.deviceId) return;
      await linkDevice(sid, target.deviceId).catch(() => {});
      target.name = studentName;
      target.studentId = sid;
      broadcastState(code, lesson);
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
      const minutes = Math.min(MAX_AFTER_LESSON_MINUTES, Math.max(0, m));
      if (typeof ack === 'function') ack(); // the teacher leaves the lesson either way
      if (minutes > 0 && socketsOf(lesson, 'student').length > 0) await startAfterLesson(code, lesson, minutes);
      else endLesson(code, lesson, 'by the teacher');
    });

  }

  if (role === 'student' && deviceId && dbLesson.teacherId) {
    const candidates = await getStudentsForDevice(dbLesson.teacherId, deviceId).catch(() => []);
    if (candidates.length === 1) {
      await finishJoin(candidates[0].name, candidates[0].id, deviceId);
      return;
    }
    if (candidates.length > 1) {
      socket.emit('chooseIdentity', candidates.map(c => ({ id: c.id, name: c.name })));
      socket.once('confirmIdentity', async ({ studentId: chosenId }: { studentId: number }) => {
        const chosen = candidates.find(c => c.id === chosenId);
        await finishJoin(chosen ? chosen.name : name, chosen ? chosen.id : null, deviceId);
      });
      return;
    }
  }

  await finishJoin(name, null, deviceId ?? null);
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
}, 6 * 60 * 60 * 1000);

const PORT = Number(process.env.PORT) || 13113;
migrate()
  .catch(e => console.error('!!! DB migration failed — lessons work, but only with video (no lessons.video_mode):', e))
  .finally(() => httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`)));

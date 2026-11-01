import 'dotenv/config';
import { createServer } from 'http';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Server } from 'socket.io';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import {
  verifyTeacher, getTeacherSessionVersion, createLesson, getLessonByCode, cleanupExpiredLessons,
  listStudents, createStudent, getStudentsForDevice, linkDevice,
} from './db';

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
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
  next();
});
app.use(express.json());

app.post('/login', async (req, res) => {
  const { email, password } = req.body ?? {};
  if (typeof email !== 'string' || typeof password !== 'string') {
    res.status(400).json({ error: 'email and password are required' });
    return;
  }
  const teacher = await verifyTeacher(email, password).catch(() => null);
  if (!teacher) {
    res.status(401).json({ error: 'invalid credentials' });
    return;
  }
  const token = signTeacherToken(teacher.id, teacher.sessionVersion);
  res.json({ teacher: { id: teacher.id, email: teacher.email, name: teacher.name }, token });
});

app.post('/lessons', requireAuth, async (req: AuthedRequest, res) => {
  const lesson = await createLesson(req.teacherId!).catch(() => null);
  if (!lesson) {
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
  stage: Stage;
  timerEndsAt: number | null;
  participants: Map<string, Participant>;
  seats: Seat[];
  sharedTexts: Map<string, string>; // per livekit room name
  boardSnapshots: Map<string, unknown>; // per livekit room name
  boardConnections: Map<string, { room: string }>; // board-only (mobile webview) viewers
  currentPoll: Poll | null;
}

const lessons = new Map<string, LessonRuntime>();

function getLessonRuntime(code: string): LessonRuntime {
  let lesson = lessons.get(code);
  if (!lesson) {
    lesson = {
      stage: 'waiting',
      timerEndsAt: null,
      participants: new Map(),
      seats: [],
      sharedTexts: new Map(),
      boardSnapshots: new Map(),
      boardConnections: new Map(),
      currentPoll: null,
    };
    lessons.set(code, lesson);
  }
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
    timerEndsAt: lesson.timerEndsAt,
    participants: Array.from(lesson.participants.values()).map(p => ({
      id: p.id, name: p.name, role: p.role, livekitRoom: p.livekitRoom, identified: p.studentId !== null,
    })),
  });
}

async function makeLivekitToken(identity: string, room: string): Promise<string> {
  const token = new AccessToken(API_KEY, API_SECRET, { identity });
  token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  return await token.toJwt();
}

async function sendToRoom(code: string, lesson: LessonRuntime, socketId: string, room: string) {
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) return;
  const participant = lesson.participants.get(socketId);
  if (!participant) return;
  const token = await makeLivekitToken(participant.name, room);
  socket.emit('livekit', { url: LIVEKIT_WS_URL, token, room });
  participant.livekitRoom = room;
  socket.emit('sharedText', { room, text: lesson.sharedTexts.get(room) ?? '' });
  const snapshot = lesson.boardSnapshots.get(room);
  if (snapshot) socket.emit('boardElements', snapshot);
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

async function assignFours(code: string, lesson: LessonRuntime) {
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
      const room = roomName(code, `fours-${groupIndex + 1}`);
      await livekit.createRoom({ name: room }).catch(() => {});
      for (const seat of groupSeats) {
        const s = studentByName.get(seat.occupant!);
        if (s) await sendToRoom(code, lesson, s.id, room);
      }
    }
    const seated = new Set(lesson.seats.map(s => s.occupant).filter(Boolean));
    const unseated = students.filter(s => !seated.has(s.name));
    for (let i = 0; i < unseated.length; i += 4) {
      const room = roomName(code, `fours-unseated-${Math.floor(i / 4) + 1}`);
      await livekit.createRoom({ name: room }).catch(() => {});
      for (let j = i; j < Math.min(i + 4, unseated.length); j++) {
        await sendToRoom(code, lesson, unseated[j].id, room);
      }
    }
  } else {
    for (let i = 0; i < students.length; i += 4) {
      const room = roomName(code, `fours-${Math.floor(i / 4) + 1}`);
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

// Brute-force protection on lesson codes: 5 failed attempts from one IP -> locked out for a minute.
interface AttemptEntry { failures: number; windowStart: number; lockedUntil: number }
const codeAttempts = new Map<string, AttemptEntry>();
const MAX_FAILURES = 5;
const ATTEMPT_WINDOW_MS = 60 * 1000;
const LOCKOUT_MS = 60 * 1000;

function clientIp(socket: { handshake: { headers: Record<string, unknown>; address: string } }): string {
  const xff = socket.handshake.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0].trim();
  return socket.handshake.address;
}

function isLockedOut(ip: string): boolean {
  const entry = codeAttempts.get(ip);
  return !!entry && entry.lockedUntil > Date.now();
}

function recordFailedAttempt(ip: string) {
  const now = Date.now();
  const entry = codeAttempts.get(ip) ?? { failures: 0, windowStart: now, lockedUntil: 0 };
  if (now - entry.windowStart > ATTEMPT_WINDOW_MS) {
    entry.failures = 0;
    entry.windowStart = now;
  }
  entry.failures += 1;
  if (entry.failures >= MAX_FAILURES) {
    entry.lockedUntil = now + LOCKOUT_MS;
  }
  codeAttempts.set(ip, entry);
}

function clearAttempts(ip: string) {
  codeAttempts.delete(ip);
}

function sweepAttempts() {
  const now = Date.now();
  for (const [ip, entry] of codeAttempts) {
    if (entry.lockedUntil < now && now - entry.windowStart > ATTEMPT_WINDOW_MS) codeAttempts.delete(ip);
  }
}

io.on('connection', async (socket) => {
  const { name, role, lessonId, deviceId, token } = socket.handshake.auth as { name: string; role: Role; lessonId?: string; boardRoom?: string; deviceId?: string; token?: string };
  const ip = clientIp(socket);

  if (isLockedOut(ip)) {
    socket.emit('lessonError', { error: 'too many attempts' });
    socket.disconnect(true);
    return;
  }

  if (!lessonId) {
    recordFailedAttempt(ip);
    socket.emit('lessonError', { error: 'missing lesson code' });
    socket.disconnect(true);
    return;
  }

  const dbLesson = await getLessonByCode(lessonId).catch(() => null);
  if (!dbLesson) {
    recordFailedAttempt(ip);
    socket.emit('lessonError', { error: 'lesson not found' });
    socket.disconnect(true);
    return;
  }
  clearAttempts(ip);

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
  const lesson = getLessonRuntime(code);
  socket.join(code);

  // Board-only connection: mobile student viewing/drawing the board via WebView
  if (role === 'board') {
    const boardRoom = (socket.handshake.auth as { boardRoom?: string }).boardRoom ?? '';
    lesson.boardConnections.set(socket.id, { room: boardRoom });
    console.log(`+ [${code}] board viewer: ${name} @ ${boardRoom}`);
    const snapshot = lesson.boardSnapshots.get(boardRoom);
    if (snapshot) socket.emit('boardElements', snapshot);
    socket.on('boardElements', (elements: unknown) => {
      lesson.boardSnapshots.set(boardRoom, elements);
      for (const [id, p] of lesson.participants) {
        if (p.livekitRoom === boardRoom) {
          io.sockets.sockets.get(id)?.emit('boardElements', elements);
        }
      }
      for (const [id, bc] of lesson.boardConnections) {
        if (bc.room === boardRoom && id !== socket.id) {
          io.sockets.sockets.get(id)?.emit('boardElements', elements);
        }
      }
    });
    socket.on('disconnect', () => {
      lesson.boardConnections.delete(socket.id);
      console.log(`- [${code}] board viewer: ${name} @ ${boardRoom}`);
    });
    return;
  }

  // Students can be recognized by this device (localStorage UUID), scoped to this lesson's
  // teacher, so returning students don't need to re-type their name and the teacher doesn't
  // need to guess who just joined. A shared device can be linked to several students, in
  // which case the client is asked to pick which one before the join completes.
  async function finishJoin(effectiveName: string, studentId: number | null, resolvedDeviceId: string | null) {
    lesson.participants.set(socket.id, { id: socket.id, name: effectiveName, role, livekitRoom: null, deviceId: resolvedDeviceId, studentId });
    console.log(`+ [${code}] ${role}: ${effectiveName}`);
    broadcastState(code, lesson);
    socket.emit('seats', lesson.seats);

    const mainRoom = roomName(code, 'main-room');
    await livekit.createRoom({ name: mainRoom }).catch(() => {});
    // Monitor token — student stays visible to teacher in main-room even during pair work
    const monToken = await makeLivekitToken(effectiveName, mainRoom);
    socket.emit('monitor', { url: LIVEKIT_WS_URL, token: monToken, room: mainRoom });
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

    socket.on('boardElements', (elements: unknown) => {
      const participant = lesson.participants.get(socket.id);
      if (!participant?.livekitRoom) return;
      const room = participant.livekitRoom;
      lesson.boardSnapshots.set(room, elements);
      for (const [id, p] of lesson.participants) {
        if (p.livekitRoom === room && id !== socket.id) {
          io.sockets.sockets.get(id)?.emit('boardElements', elements);
        }
      }
      for (const [id, bc] of lesson.boardConnections) {
        if (bc.room === room) {
          io.sockets.sockets.get(id)?.emit('boardElements', elements);
        }
      }
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

    socket.on('disconnect', () => {
      lesson.participants.delete(socket.id);
      if (role === 'student') {
        for (const seat of lesson.seats) {
          if (seat.occupant === effectiveName) seat.occupant = null;
        }
        io.to(code).emit('seats', lesson.seats);
      }
      console.log(`- [${code}] ${role}: ${effectiveName}`);
      broadcastState(code, lesson);
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
setInterval(() => {
  cleanupExpiredLessons().then(n => { if (n) console.log(`cleaned up ${n} expired lesson code(s)`); }).catch(() => {});
  sweepAttempts();
}, 6 * 60 * 60 * 1000);

const PORT = 13113;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));

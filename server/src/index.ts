import { createServer } from 'http';
import { Server } from 'socket.io';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const LIVEKIT_URL = 'http://212.118.45.47:7880';
const LIVEKIT_WS_URL = 'wss://d4-claude-voice.duckdns.org:13017';
const API_KEY = 'devkey';
const API_SECRET = 'secret';

const livekit = new RoomServiceClient(LIVEKIT_URL, API_KEY, API_SECRET);

const httpServer = createServer();
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

type Role = 'teacher' | 'student';
type Stage = 'waiting' | 'group' | 'individual' | 'pairs' | 'fours';

interface Participant {
  id: string;
  name: string;
  role: Role;
  livekitRoom: string | null;
}

interface LessonState {
  stage: Stage;
  timerEndsAt: number | null;
  participants: Map<string, Participant>;
}

const state: LessonState = {
  stage: 'waiting',
  timerEndsAt: null,
  participants: new Map(),
};

// Seating
export interface Seat {
  id: string;
  groupIndex: number;
  row: number;   // 0 = верхняя пара, 1 = нижняя пара
  col: number;   // 0 = левый, 1 = правый
  occupant: string | null;
}

let seats: Seat[] = [];

function createSeats(n: number) {
  const prev = new Map(seats.map(s => [s.id, s.occupant]));
  seats = [];
  const numGroups = Math.floor(n / 4);
  for (let g = 0; g < numGroups; g++) {
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const id = `g${g}r${row}c${col}`;
        seats.push({ id, groupIndex: g, row, col, occupant: prev.get(id) ?? null });
      }
    }
  }
}

function broadcastSeats() {
  io.emit('seats', seats);
}

// Shared text per room name
const sharedTexts = new Map<string, string>();

// Whiteboard snapshot per room name
const boardSnapshots = new Map<string, unknown>();

interface Poll {
  question: string;
  options: string[];
  votes: Map<string, number>;
}

let currentPoll: Poll | null = null;

function pollResults() {
  if (!currentPoll) return null;
  const counts = currentPoll.options.map((_, i) =>
    Array.from(currentPoll!.votes.values()).filter(v => v === i).length
  );
  return { question: currentPoll.question, options: currentPoll.options, counts, total: currentPoll.votes.size };
}

function broadcastState() {
  io.emit('state', {
    stage: state.stage,
    timerEndsAt: state.timerEndsAt,
    participants: Array.from(state.participants.values()).map(p => ({
      id: p.id, name: p.name, role: p.role, livekitRoom: p.livekitRoom,
    })),
  });
}

async function makeLivekitToken(identity: string, room: string): Promise<string> {
  const token = new AccessToken(API_KEY, API_SECRET, { identity });
  token.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true });
  return await token.toJwt();
}

async function sendToRoom(socketId: string, room: string) {
  const socket = io.sockets.sockets.get(socketId);
  if (!socket) return;
  const participant = state.participants.get(socketId);
  if (!participant) return;
  const token = await makeLivekitToken(participant.name, room);
  socket.emit('livekit', { url: LIVEKIT_WS_URL, token, room });
  participant.livekitRoom = room;
  socket.emit('sharedText', { room, text: sharedTexts.get(room) ?? '' });
  const snapshot = boardSnapshots.get(room);
  if (snapshot) socket.emit('boardElements', snapshot);
  console.log(`  ${participant.name} -> ${room}`);
}

// Assign by seating if seats exist, otherwise fallback to index-based
async function assignPairs() {
  const students = Array.from(state.participants.values()).filter(p => p.role === 'student');
  const studentByName = new Map(students.map(s => [s.name, s]));

  if (seats.length > 0) {
    // Group by (groupIndex, row) → pair room
    const pairMap = new Map<string, Seat[]>();
    for (const seat of seats) {
      if (!seat.occupant) continue;
      const key = `pair-g${seat.groupIndex}-r${seat.row}`;
      if (!pairMap.has(key)) pairMap.set(key, []);
      pairMap.get(key)!.push(seat);
    }
    for (const [roomName, pairSeats] of pairMap) {
      await livekit.createRoom({ name: roomName }).catch(() => {});
      for (const seat of pairSeats) {
        const s = studentByName.get(seat.occupant!);
        if (s) await sendToRoom(s.id, roomName);
      }
    }
    // Unseated students → fallback pairs
    const seated = new Set(seats.map(s => s.occupant).filter(Boolean));
    const unseated = students.filter(s => !seated.has(s.name));
    for (let i = 0; i < unseated.length; i += 2) {
      const room = `pair-unseated-${Math.floor(i / 2) + 1}`;
      await livekit.createRoom({ name: room }).catch(() => {});
      for (let j = i; j < Math.min(i + 2, unseated.length); j++) {
        await sendToRoom(unseated[j].id, room);
      }
    }
  } else {
    for (let i = 0; i < students.length; i += 2) {
      const room = `pair-${Math.floor(i / 2) + 1}`;
      await livekit.createRoom({ name: room }).catch(() => {});
      for (let j = i; j < Math.min(i + 2, students.length); j++) {
        await sendToRoom(students[j].id, room);
      }
    }
  }
}

async function assignFours() {
  const students = Array.from(state.participants.values()).filter(p => p.role === 'student');
  const studentByName = new Map(students.map(s => [s.name, s]));

  if (seats.length > 0) {
    const groupMap = new Map<number, Seat[]>();
    for (const seat of seats) {
      if (!seat.occupant) continue;
      if (!groupMap.has(seat.groupIndex)) groupMap.set(seat.groupIndex, []);
      groupMap.get(seat.groupIndex)!.push(seat);
    }
    for (const [groupIndex, groupSeats] of groupMap) {
      const room = `fours-${groupIndex + 1}`;
      await livekit.createRoom({ name: room }).catch(() => {});
      for (const seat of groupSeats) {
        const s = studentByName.get(seat.occupant!);
        if (s) await sendToRoom(s.id, room);
      }
    }
    const seated = new Set(seats.map(s => s.occupant).filter(Boolean));
    const unseated = students.filter(s => !seated.has(s.name));
    for (let i = 0; i < unseated.length; i += 4) {
      const room = `fours-unseated-${Math.floor(i / 4) + 1}`;
      await livekit.createRoom({ name: room }).catch(() => {});
      for (let j = i; j < Math.min(i + 4, unseated.length); j++) {
        await sendToRoom(unseated[j].id, room);
      }
    }
  } else {
    for (let i = 0; i < students.length; i += 4) {
      const room = `fours-${Math.floor(i / 4) + 1}`;
      await livekit.createRoom({ name: room }).catch(() => {});
      for (let j = i; j < Math.min(i + 4, students.length); j++) {
        await sendToRoom(students[j].id, room);
      }
    }
  }
}

async function assignIndividual() {
  const students = Array.from(state.participants.values()).filter(p => p.role === 'student');
  for (const student of students) {
    const room = `individual-${student.name}`;
    await livekit.createRoom({ name: room }).catch(() => {});
    await sendToRoom(student.id, room);
  }
}

async function sendAllToMain() {
  const students = Array.from(state.participants.values()).filter(p => p.role === 'student');
  await livekit.createRoom({ name: 'main-room' }).catch(() => {});
  for (const student of students) {
    await sendToRoom(student.id, 'main-room');
  }
}

io.on('connection', async (socket) => {
  const { name, role } = socket.handshake.auth as { name: string; role: Role };

  state.participants.set(socket.id, { id: socket.id, name, role, livekitRoom: null });
  console.log(`+ ${role}: ${name}`);
  broadcastState();
  socket.emit('seats', seats);

  await livekit.createRoom({ name: 'main-room' }).catch(() => {});
  // Monitor token — student stays visible to teacher in main-room even during pair work
  const monToken = await makeLivekitToken(name, 'main-room');
  socket.emit('monitor', { url: LIVEKIT_WS_URL, token: monToken, room: 'main-room' });
  await sendToRoom(socket.id, 'main-room');

  socket.on('setCapacity', (n: number) => {
    if (role !== 'teacher') return;
    createSeats(n);
    broadcastSeats();
    console.log(`capacity -> ${n} (${n / 4} groups)`);
  });

  socket.on('claimSeat', (seatId: string) => {
    if (role !== 'student') return;
    // Release current seat
    const current = seats.find(s => s.occupant === name);
    if (current) current.occupant = null;
    // Claim new seat if free
    const target = seats.find(s => s.id === seatId);
    if (target && !target.occupant) target.occupant = name;
    broadcastSeats();
  });

  socket.on('clearSeat', (seatId: string) => {
    if (role !== 'teacher') return;
    const seat = seats.find(s => s.id === seatId);
    if (seat) seat.occupant = null;
    broadcastSeats();
  });

  socket.on('moveSeat', ({ studentName, toSeatId }: { studentName: string; toSeatId: string }) => {
    if (role !== 'teacher') return;
    const from = seats.find(s => s.occupant === studentName);
    const to = seats.find(s => s.id === toSeatId);
    if (!to || to.occupant) return;
    if (from) from.occupant = null;
    to.occupant = studentName;
    broadcastSeats();
  });

  socket.on('setStage', async (stage: Stage) => {
    if (role !== 'teacher') return;
    state.stage = stage;
    console.log(`stage -> ${stage}`);
    if (stage === 'pairs') await assignPairs();
    else if (stage === 'fours') await assignFours();
    else if (stage === 'individual') await assignIndividual();
    else await sendAllToMain();
    broadcastState();
  });

  socket.on('startTimer', (seconds: number) => {
    if (role !== 'teacher') return;
    state.timerEndsAt = Date.now() + seconds * 1000;
    broadcastState();
  });

  socket.on('stopTimer', () => {
    if (role !== 'teacher') return;
    state.timerEndsAt = null;
    broadcastState();
  });

  socket.on('sharedTextUpdate', ({ room, text }: { room: string; text: string }) => {
    if (role !== 'student') return;
    sharedTexts.set(room, text);
    for (const [id, p] of state.participants) {
      if (p.livekitRoom === room && id !== socket.id) {
        io.sockets.sockets.get(id)?.emit('sharedText', { room, text });
      }
    }
  });

  socket.on('boardElements', (elements: unknown) => {
    const participant = state.participants.get(socket.id);
    if (!participant?.livekitRoom) return;
    const room = participant.livekitRoom;
    boardSnapshots.set(room, elements);
    for (const [id, p] of state.participants) {
      if (p.livekitRoom === room && id !== socket.id) {
        io.sockets.sockets.get(id)?.emit('boardElements', elements);
      }
    }
  });

  socket.on('startPoll', ({ question, options }: { question: string; options: string[] }) => {
    if (role !== 'teacher') return;
    currentPoll = { question, options, votes: new Map() };
    io.emit('poll', { question, options, myVote: null });
    io.emit('pollResults', pollResults());
  });

  socket.on('vote', ({ optionIndex }: { optionIndex: number }) => {
    if (role !== 'student' || !currentPoll) return;
    currentPoll.votes.set(name, optionIndex);
    socket.emit('poll', { question: currentPoll.question, options: currentPoll.options, myVote: optionIndex });
    io.emit('pollResults', pollResults());
  });

  socket.on('stopPoll', () => {
    if (role !== 'teacher') return;
    currentPoll = null;
    io.emit('poll', null);
    io.emit('pollResults', null);
  });

  socket.on('joinPair', async ({ room }: { room: string }) => {
    if (role !== 'teacher') return;
    await sendToRoom(socket.id, room);
    // Dismiss call indicator for this room
    for (const [id, p] of state.participants) {
      if (p.role === 'teacher') {
        io.sockets.sockets.get(id)?.emit('callTeacher', { room, calling: false });
      }
    }
    // Notify students in the pair room that teacher is coming
    for (const [id, p] of state.participants) {
      if (p.livekitRoom === room && p.role === 'student') {
        io.sockets.sockets.get(id)?.emit('teacherJoined');
      }
    }
  });

  socket.on('leavePair', async () => {
    if (role !== 'teacher') return;
    await sendToRoom(socket.id, 'main-room');
  });

  socket.on('callTeacher', ({ room }: { room: string }) => {
    for (const [id, p] of state.participants) {
      if (p.role === 'teacher') {
        io.sockets.sockets.get(id)?.emit('callTeacher', { room, calling: true });
      }
    }
  });

  socket.on('dismissCall', ({ room }: { room: string }) => {
    for (const [id, p] of state.participants) {
      if (p.role === 'teacher') {
        io.sockets.sockets.get(id)?.emit('callTeacher', { room, calling: false });
      }
    }
  });

  socket.on('disconnect', () => {
    state.participants.delete(socket.id);
    console.log(`- ${role}: ${name}`);
    broadcastState();
  });
});

const PORT = 13113;
httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));

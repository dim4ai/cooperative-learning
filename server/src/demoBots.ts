// The solo demo: a teacher with nobody to gather tries the lesson on simulated students. Bots have
// no sockets and no media; all they do is sit down, write on boards and call the teacher, on a
// script tied to the sample lesson (client-teacher/public/demo/parallelogram.colesson).

import { CHAT, CHATTER, CHOCOLATE, SIXTH, TRAP, type FourLine, type TrapLine, EXPLAIN, EXPLAIN_DRAW, FEMALE_VOICES, LOPSIDED_PAIR, VOICE_OF, type DialogueLine, type Draw, type Pt, type SpokenLine } from './demoDialogue';

export type BotStage = 'individual' | 'pairs' | 'fours';
export const BOTS = [
  { name: 'Аня', avatar: 'fox' }, { name: 'Миша', avatar: 'bear' },
  { name: 'Лена', avatar: 'owl' }, { name: 'Тимур', avatar: 'tiger' },
  { name: 'Соня', avatar: 'rabbit' }, { name: 'Артём', avatar: 'penguin' },
  { name: 'Вика', avatar: 'cat' }, { name: 'Глеб', avatar: 'hedgehog' },
];

/** Each bot's own device, as the teacher's journal knows it (client-teacher/src/demo.tsx makes the same journal) */
export const botUuid = (i: number) => `00000000-0000-4000-8000-${(0x100 + i).toString(16).padStart(12, '0')}`;
/** The one who comes in from someone else's device (an aunt's phone): the journal doesn't know it, so he sits apart
 *  until the teacher has talked to him and told the journal who he is */
export const SOLO_NEWCOMER = 'Миша';
export const NEWCOMER_UUID = '00000000-0000-4000-8000-0000000000a1';

/** Twice the class: there is room to move people around, and four desks to gather them from */
export const SOLO_SEATS = 16;
/** The teacher may change the number of seats, but every bot needs one */
export const SOLO_MIN_SEATS = 8;
const SEAT_PAUSE_MS = 4000;
const RESEAT_MS = 2500;
const VISIT_REPLY_MS = 6000;
const AFTER_ANSWER_MS = 8000; // the teacher came on a call: their answer takes a while, then the group goes on
const TALK_TICK_MS = 2000;
const SPOKEN_AFTER_CALLS_MS = 1000; // the last call answered: the dialogue begins, so it's under way when the hint points there
const SPOKEN_LATEST_MS = 90_000; // …or by then anyway
const NEXT_CALL_GAP_MS = 6000; // back in the classroom, a moment to look around before the next bell
const COLORS = ['#1971c2', '#2f9e44', '#9c36b5', '#f08c00'];

interface Line { at: number; text: string } // seconds after the stage began
/** note: what the student asks; reply: what they write after the teacher's visit, if anything */
interface Call { at: number; note: string; reply?: string; by?: 1 | 2 } // by: who of the dialogue asks ({1} or {2})
/** lead: the room where this bot sits gets this script. In its texts {1} is the lead and {2} the partner if they sit
 *  together, else the other one of the room; a line starting with «{1}: » or «{2}: » is said by them, as in a dialogue */
/** talk: how much each one talks, 0…1, in the room's order (lead, partner, then the rest); quietAfter: from then
 *  on (seconds) the room keeps silent — the teacher's map shows it */
/** spoken: a voiced dialogue instead of random talk, heard on coming in (server/src/demoDialogue.ts): from the start
 *  of the stage, its call as it ends and the rest after the teacher's answer; or, with `later`, once all calls are over */
/** dialogue: a voiced one that goes by what the teacher does (see Talk below); explain: one that needs no teacher (Explain) */
interface RoomScript { lines: Line[]; call?: Call; lead?: string; partner?: string; talk?: number[]; quietAfter?: number; spoken?: SpokenLine[]; later?: boolean; dialogue?: DialogueLine[]; explain?: DialogueLine[]; chat?: DialogueLine[]; four?: FourLine[]; trap?: TrapLine[] }

/** The teacher's voice in the dialogues: Татьяна Алексеевна for now (filipp is voiced too) */
const TEACHER_VOICE = 'alena';
const LINE_GAP_MS = 1100;
const PONDER_MS = 5000; // after the teacher's answer: a pause, the teacher may draw the legs, then they count
const THINK_MS = 2500; // asked a question, the teacher thinks a moment before answering
const GREET_GAP_MS = 300; // the teacher came in: hello straight after the line going on
const ARRIVE_MS = 1500; // the teacher comes into a room: their page is there about this much later
const EARLY_CALL_MS = 10_000; // the individual stage: the second call comes 10 s into the teacher's visit to the first
const TALK_START_MS = 10_000; // the first seconds of a stage are quiet: the teacher looks round first
const RECALL_MS = 15_000; // the teacher left without answering: they call again

/** A dialogue that listens: the teacher coming in openly is greeted, one still there when they'd call is asked
 *  straight away, the call waits its turn among the others', and the second part begins once the teacher answered */
interface Talk {
  room: string; lines: DialogueLine[];
  next: number;                 // index of the next line of the course
  phase: 'a' | 'calling' | 'asked' | 'b' | 'done';
  present: boolean; greeted: boolean; busy: boolean;
  saying: DialogueLine | null;  // the line being said now
  gen: number;                  // bumped when a line is broken off: its end is not waited for
  insert: DialogueLine[];       // said before the course goes on
}

/** A dialogue that goes on its own: a teacher coming in openly is greeted, asks how it goes and leaves them to it,
 *  then they pick up where they were, the strong one saying their last line again */
interface Explain {
  lines: DialogueLine[]; next: number;
  greeted: boolean; busy: boolean; gen: number;
  insert: DialogueLine[];
  lastStrong: DialogueLine | null; // the strong one's last line: said again after the teacher's visit
  drawn: Set<string>;              // lines whose drawing is on the board already: not drawn again on repeating
  onBoard: string[];               // uids of what they drew: wiped bit by bit when the talk moves on
}
/** A dialogue that drifts (П4 «Трёп»): checking, chatter, and at the end a hurried list; a teacher coming in openly
 *  before that turns it into real checking */
interface Chat {
  lines: DialogueLine[]; queue: DialogueLine[];
  phase: 'drift' | 'end' | 'checking';
  busy: boolean; gen: number; // gen: bumped when the teacher turns it round: the step already timed is dropped
}

const CHAT_WRITE_MS = 900;        // a list written out one line after another
/** Ч2: where the cards of b10 go, as the line saying it ends (the sheet's ✋ cards: u00337… for 1…6) */
const CARD_UID = ['u00337', 'u00338', 'u00339', 'u00340', 'u00341', 'u00342'];
const YES = [[60, 250], [305, 250], [550, 250], [60, 410], [305, 410]], NO = [[830, 250], [1075, 250], [1320, 250]];
const FOUR_MOVES: Record<string, [number, number[]]> = {
  'c2-01': [1, YES[0]], 'c2-02': [2, YES[1]], 'c2-03': [3, YES[2]], 'c2-08': [3, NO[0]], 'c2-09': [4, YES[2]],
  'c2-12': [5, NO[1]], 'c2-14': [6, NO[2]], 'c2-27': [6, YES[4]],
};
type XY = [number, number];
/** What is drawn while a line is said, in the board's pixels: at — how far into the line; thin — a helper line */
interface FourDraw { at: number; path?: XY[]; thin?: boolean; label?: { text: string; at: XY }; text?: { text: string; at: XY }; dot?: XY }
const FOUR_DRAW: Record<string, FourDraw[]> = {
  // card 3: two parallel lines, AB on one, CD as long on the other — a parallelogram…
  'c2-06': [
    { at: 0.05, path: [[850, 590], [1280, 590]], thin: true }, { at: 0.2, path: [[850, 430], [1280, 430]], thin: true },
    { at: 0.45, path: [[900, 590], [1080, 590]], label: { text: 'A', at: [885, 615] } }, { at: 0.5, label: { text: 'B', at: [1080, 615] } },
    { at: 0.65, path: [[980, 430], [1160, 430]], label: { text: 'D', at: [975, 405] } }, { at: 0.7, label: { text: 'C', at: [1165, 405] } },
    { at: 0.85, path: [[900, 590], [980, 430]] }, { at: 0.9, path: [[1080, 590], [1160, 430]] },
  ],
  // …and the other way: as long, but a trapezoid
  'c2-07': [{ at: 0.4, path: [[1160, 430], [1240, 590]], label: { text: "B'", at: [1255, 615] } }],
  // card 5: one diagonal cut in half, the other not
  'c2-12': [
    { at: 0.15, path: [[880, 520], [1120, 520]], label: { text: 'A', at: [862, 520] } }, { at: 0.2, label: { text: 'C', at: [1140, 520] } },
    { at: 0.3, path: [[940, 508], [940, 532]] }, { at: 0.32, path: [[1060, 508], [1060, 532]] },
    { at: 0.5, path: [[1000, 460], [1000, 630]], label: { text: 'B', at: [1000, 440] } }, { at: 0.55, label: { text: 'D', at: [1000, 652] } },
    { at: 0.75, path: [[880, 520], [1000, 460], [1120, 520], [1000, 630], [880, 520]] },
  ],
  // card 6: angle after angle — the fourth comes out different
  'c2-16': [
    { at: 0.2, path: [[1290, 440], [1230, 610], [1500, 610]] },
    { at: 0.45, path: [[1290, 440], [1480, 420]] },
    { at: 0.65, path: [[1480, 420], [1500, 610]] },
  ],
  // the opposite angles equal straight away: their sides cross
  'c2-17': [
    { at: 0.35, path: [[1520, 560], [1240, 610], [1330, 420]] },
    { at: 0.55, path: [[1230, 470], [1510, 430], [1420, 630]] },
  ],
  // Аня counts
  'c2-22': [{ at: 0.95, text: { text: '∠A + ∠B = 180°', at: [70, 575] } }],
  'c2-24': [{ at: 0.95, text: { text: 'AD ∥ BC', at: [470, 575] } }],
};
/** Ч1: the cards, the attempt at card 3, the teacher's hint drawn as they speak, the trapezoid, the kite and its tail */
const KITE: FourDraw[] = FOUR_DRAW['c2-12'];
Object.assign(FOUR_MOVES, {
  'c1-06': [1, YES[0]], 'c1-07': [2, YES[1]], 'c1-09': [3, YES[2]], 'c1-22': [3, NO[0]], 'c1-23': [4, YES[2]],
  'c1-27': [5, NO[1]], 'c1-35': [6, YES[3]],
});
Object.assign(FOUR_DRAW, {
  'c1-14': [{ at: 0.15, path: [[900, 590], [1080, 590], [1160, 430], [980, 430], [900, 590]] }],
  'c1-ta2': [{ at: 0.45, path: [[850, 590], [1300, 590]] }, { at: 0.65, path: [[850, 430], [1300, 430]] }],
  'c1-ta3': [{ at: 0.45, dot: [900, 590], label: { text: 'A', at: [900, 618] } }, { at: 0.6, dot: [1100, 590], label: { text: 'B', at: [1100, 618] } }],
  'c1-ta4': [{ at: 0.5, dot: [1160, 430], label: { text: 'C', at: [1160, 402] } }],
  'c1-20': [
    { at: 0.2, dot: [960, 430], label: { text: 'D', at: [960, 402] } }, { at: 0.3, dot: [840, 430], label: { text: 'D', at: [840, 402] } },
    { at: 0.5, path: [[840, 430], [900, 590], [1100, 590], [1160, 430], [840, 430]] },
  ],
  'c1-27': KITE.map(d => ({ ...d, at: d.at * 0.6 })),
  'c1-29': [{ at: 0.3, path: [[1000, 668], [985, 698], [1015, 728], [990, 758], [1010, 788]] }],
  'c1-33': [{ at: 0.15, path: [[1290, 440], [1230, 610], [1500, 610], [1480, 420], [1290, 440]] }],
});
/** Lines that start on something new: what was drawn before goes away */
const FOUR_ERASE = new Set(['c2-12', 'c2-17', 'c1-ta2', 'c1-27']);
const TEACHER_COLOR = '#c92a2a';
const FIVE_TAP_MS = 700; // «Дай пятюню!»: the others tap the hand one after another

/** Ч1: a four that calls; the teacher's ready answer is said and drawn, then they go on (the teacher coming in openly
 *  before is not greeted: still there as they'd call, they ask straight away) */
interface Trap {
  lines: TrapLine[]; next: number; names: string[]; onBoard: string[];
  phase: 'a' | 'calling' | 'asked' | 'b';
  present: boolean; busy: boolean; insert: TrapLine[];
}

/** A four going through the cards by itself (Ч2): no teacher in it, no call */
interface Four { lines: FourLine[]; next: number; names: string[]; onBoard: string[] }
const SEGMENT_MS = 300; // a drawn line goes on the board one segment after another
const ERASE_MS = 200;   // and is wiped one object after another
/** Lines that move on to something new: what was drawn before goes away as they begin */
const ERASE_BEFORE = new Set(['p2-21', 'p2-31']);

const OBSERVATIONS = ['AD = BC, по 8 клеток', 'AB = CD', 'AO = OC', 'BO = OD', '∠A = ∠C', '∠B = ∠D'];
const lines = (texts: string[], first: number, gap: number): Line[] => texts.map((text, i) => ({ at: first + i * gap, text }));

/** By room, in room order; a room past the end of the list uses the script from the start of it.
 *  Rooms call some time apart, so the teacher can get to each: three on the individual stage, two in pairs, one in fours
 *  (client-teacher/src/demoHints.tsx, CALLS counts on that). */
const SCRIPT: Record<BotStage, RoomScript[]> = {
  individual: [
    { lines: lines(['AD = BC', 'AB = CD'], 5, 8), call: {
      at: 27, note: 'А стороны и отрезки — это разве не одно и то же?',
      reply: 'Ещё отрезки: AO, OC, BO, OD' } },
    { lines: lines(OBSERVATIONS.slice(0, 3), 8, 9) },
    { lines: lines(['AD = BC', 'AB = CD', 'угол A и угол C ?'], 3, 4), call: {
      // no reply: the teacher writes it on her board
      at: 12, note: 'Я забыла, как записывается равенство углов. Напишите, пожалуйста' } },
    { lines: lines([OBSERVATIONS[0], '∠A = ∠C'], 6, 10), call: {
      at: 40, note: 'Можно записывать только полные углы параллелограмма или и уголки, на которые их делят диагонали?',
      reply: '∠BAC = ∠ACD' } },
    { lines: lines(OBSERVATIONS.slice(2, 5), 9, 8) },
    { lines: lines(OBSERVATIONS.slice(0, 5), 4, 7) },
    { lines: lines(OBSERVATIONS.slice(0, 2), 7, 12) },
    { lines: lines(OBSERVATIONS.slice(1, 4), 5, 9) },
  ],
  pairs: [
    // П1 «Как курица лапкой»: they check their lists, argue about AB = AO and call
    { lead: 'Миша', partner: 'Артём', lines: [], dialogue: CHOCOLATE, talk: [0.55, 0.5] },
    // П2 «Давай я быстро объясню»: Лена explains with triangles drawn on the cells, the other one gets it
    { lead: 'Лена', lines: [], explain: EXPLAIN, talk: [0.6, 0.45] },
    // one does all the talking and the writing, the other hardly gets a word in: heard on coming in
    { lines: [], spoken: LOPSIDED_PAIR, later: true },
    // П4 «Трёп»: they begin checking and drift off; the teacher may listen in, or come in and set them to work
    { lead: 'Тимур', lines: [], chat: CHAT, talk: [0.5, 0.45] },
  ],
  fours: [
    { lines: lines(['Уверены: AB = CD, AD = BC', 'Уверены: AO = OC, BO = OD', 'Сомневаемся: углы'], 4, 6), talk: [0.5, 0.4, 0.35, 0.03], call: {
      at: 15, note: 'В сторонах уверены, а углы на клетках не посчитать. Как быть?' } },
    // talks for a while, then falls silent
    { lines: lines(['Уверены: AB = CD, AD = BC', 'Уверены: AO = OC', 'Сомневаемся: ∠A = ∠C'], 6, 8), talk: [0.45, 0.4, 0.3, 0.3], quietAfter: 30 },
  ],
};

/** The sample lesson's blocks the solo demo goes through; the rest are in the plan, pale and closed
 *  (client-teacher/src/demo.tsx, SOLO_LIVE_BLOCKS). Tasks added during the lesson (live-…) run too. */
export const SOLO_LIVE_BLOCKS = new Set(['b1', 'b2', 'b3', 'b9', 'b10', 'b12']);
export const soloBlockOpen = (id: string) => SOLO_LIVE_BLOCKS.has(id) || id.startsWith('live-');

/** A block of its own, not its stage's usual script. b10 «Точно параллелограмм?»: a stand-in until its dialogue is written */
const BLOCK_SCRIPT: Record<string, RoomScript[]> = {
  b10: [
    // Ч1 «Ловушка трапеции»: the four where Миша sits falls into card 3's trap and calls the teacher
    { lead: 'Миша', lines: [], trap: TRAP, talk: [0.5, 0.45, 0.35, 0.3] },
    // Ч2 «Шестая — самая коварная»: the four where Аня sits goes through the cards by itself
    { lead: 'Аня', lines: [], four: SIXTH, talk: [0.45, 0.4, 0.4, 0.1] },
  ],
};

/** How the class answers the poll «Свойство и признак — одно и то же?» (options: да / нет, разные / иногда совпадают / не знаю),
 *  by bot: the first time all over the place, the second time after the lesson — most moved to «разные» or «иногда» */
const POLL_ANSWERS = [
  { Аня: 1, Миша: 0, Лена: 2, Тимур: 0, Соня: 3, Артём: 1, Вика: 0, Глеб: 3 },
  { Аня: 1, Миша: 2, Лена: 2, Тимур: 1, Соня: 1, Артём: 1, Вика: 2, Глеб: 3 },
] as Record<string, number>[];

/** The bots spread out as far as they can, so nobody starts next to anybody: the teacher gathers them */
export function scatteredSeat<S extends { groupIndex: number; row: number; occupant: string | null }>(seats: S[]): S | undefined {
  const taken = seats.filter(s => s.occupant);
  const crowd = (s: S) => {
    const desk = taken.filter(t => t.groupIndex === s.groupIndex);
    return desk.length * 3 + desk.filter(t => t.row === s.row).length; // first the desk, then the row
  };
  const free = seats.filter(s => !s.occupant);
  const best = Math.min(...free.map(crowd));
  const emptiest = free.filter(s => crowd(s) === best);
  return emptiest[Math.floor(Math.random() * emptiest.length)];
}

export interface BotHost {
  /** A bot takes a seat, if it has none */
  seat(botIndex: number): void;
  /** The rooms of this stage, in a stable order */
  rooms(): string[];
  write(room: string, obj: Record<string, unknown> & { uid: string; type: string }, author?: string): void;
  /** Takes a bot's drawing off the board */
  erase(room: string, uid: string, author?: string): void;
  /** Moves a ✋ object of the sheet in a group's room, as a student dragging it would */
  move(room: string, uid: string, left: number, top: number): void;
  /** «Дай пять»: a bot puts the hand up in its room, a bot taps it */
  five(room: string, name: string): void;
  fiveTap(room: string, name: string): void;
  /** The teacher's drawing on a group's board (the ready answer drawn as it is said) */
  teacherWrite(room: string, obj: Record<string, unknown> & { uid: string; type: string }): void;
  /** A bot talked this long: counted as a real student's microphone would be */
  talk(name: string, ms: number): void;
  /** Names of the bots in a room */
  members(room: string): string[];
  call(room: string, note: string, who?: string): void;
  /** A voiced line begins in a room: the teacher there hears it */
  say(room: string, clip: { src: string; ms: number; who?: string }): void;
  /** A bot raises a hand in the explanation */
  raise(name: string): void;
  /** Given the word, a bot says its line to the class */
  speak(name: string, text: string, clip: { src: string; ms: number }): void;
  /** The call is over without a visit: the teacher is in the room already */
  callOff(room: string): void;
  /** The teacher may answer now: with the ready answer (its text) or in their own words; null: not any more */
  offerReply(room: string, text: string | null): void;
  /** A bot answers the running poll */
  vote(name: string, choice: number): void;
}

/** The bot's own voice if the clip has it, else another of the same sex, else any */
function voiceFor(who: string, lengths: Record<string, number>, stand?: Map<string, string>): string {
  const own = stand?.get(who) ?? VOICE_OF[who] ?? 'kirill';
  if (lengths[own] !== undefined) return own;
  const voices = Object.keys(lengths);
  return voices.find(v => FEMALE_VOICES.has(v) === FEMALE_VOICES.has(own)) ?? voices[0];
}

/** Hands raised in an explanation and what each says when given the word.
 *  The lines are stand-ins: the dialogues come from the lessons session; no voice yet (the clip is silent) */
const HANDS: Record<string, { who: string; id: string; text: string; ms: number }[]> = {
  b9: [
    { who: 'Тимур', id: 'hand-b9-1', ms: 6000, text: 'А разве свойство и признак — не одно и то же? Диагонали делятся пополам — вот и признак.' },
    { who: 'Соня', id: 'hand-b9-2', ms: 6000, text: 'По-моему, разное: свойство — когда уже знаем, что это параллелограмм, а признак — чтобы это доказать.' },
  ],
};
const HAND_FIRST_MS = 5000;
const HAND_GAP_MS = 2500;

export class BotRun {
  private handsRaised = new Set<string>();
  private timers = new Set<NodeJS.Timeout>();
  private stageTimers = new Set<NodeJS.Timeout>();
  private written = new Map<string, { n: number; top: number }>();
  private names = new Map<string, [string, string]>(); // room → who {1} and {2} are there
  private replies = new Map<string, string>();
  // calls come one at a time: the next one only after the teacher has answered this one and come back
  private callQueue: { room: string; at: number; fire: () => void }[] = [];
  private calling: { room: string; visited: boolean } | null = null;
  private stageStart = 0;
  private spoken: { room: string; lines: SpokenLine[] } | null = null;
  private quietRooms = new Set<string>(); // rooms whose random talk stops: their dialogue speaks now
  private afterAnswer = new Map<string, SpokenLine[]>();
  // a dialogue not voiced in someone's own voice: they keep the voice it gave them all the stage, chatter too
  private stand = new Map<string, string>(); // what a room that called says once answered
  private uid = 0;
  private talks = new Map<string, Talk>();
  private explains = new Map<string, Explain>();
  private chats = new Map<string, Chat>();
  private fours = new Map<string, Four>();
  private traps = new Map<string, Trap>();
  private callPending = false; // the next call is timed already
  private stage = '';
  private earlyCalled = false;

  constructor(private host: BotHost) {}

  private after(ms: number, fn: () => void, set = this.stageTimers) {
    const t = setTimeout(() => { set.delete(t); fn(); }, ms);
    set.add(t);
  }

  /** fast (testing): all at once */
  seatEveryone(fast = false) {
    BOTS.forEach((_, i) => this.after(fast ? 300 + i * 100 : 1600 + i * SEAT_PAUSE_MS, () => this.host.seat(i), this.timers));
  }

  /** The teacher sent someone from their seat: as in a real class, they find another one */
  onUnseated(name: string) {
    const i = BOTS.findIndex(b => b.name === name);
    if (i >= 0) this.after(RESEAT_MS, () => this.host.seat(i), this.timers);
  }

  private fill(room: string, text: string): string {
    const [a, b] = this.names.get(room) ?? ['', ''];
    return text.replaceAll('{1}', a).replaceAll('{2}', b);
  }

  /** One line down the board, each room filling up on its own; a dialogue line smaller, in the speaker's colour */
  private write(room: string, text: string, by?: 1 | 2) {
    const w = this.written.get(room) ?? { n: 0, top: 60 };
    const speaker = /^\{([12])\}: /.exec(text)?.[1];
    const [lead, partner] = this.names.get(room) ?? ['', ''];
    const author = ((by ?? Number(speaker ?? 1)) === 2 ? partner : lead) || undefined;
    const fontSize = speaker ? 30 : 40;
    const rows = text.split('\n').length;
    const height = speaker ? rows * 36 + 14 : 72;
    if (w.top + height > 880) w.top = 60;
    this.host.write(room, {
      uid: `bot-${room}-${this.uid++}`, type: 'IText', text: this.fill(room, text), left: speaker ? 760 : 860, top: w.top,
      originX: 'left', originY: 'top', fontSize, fontFamily: 'sans-serif',
      fill: speaker ? COLORS[Number(speaker) - 1] : by ? COLORS[by - 1] : COLORS[w.n % COLORS.length],
    }, author);
    this.written.set(room, { n: w.n + 1, top: w.top + height });
  }

  /** The stage changed: what was going on stops, and the bots start on the new stage's work */
  onStage(stage: string, blockId?: string | null) {
    for (const t of this.stageTimers) clearTimeout(t);
    this.stageTimers.clear();
    this.replies.clear();
    this.callQueue = [];
    this.calling = null;
    this.spoken = null;
    this.quietRooms.clear();
    this.afterAnswer.clear();
    this.stand.clear();
    this.talks.clear();
    this.explains.clear();
    this.chats.clear();
    this.fours.clear();
    this.traps.clear();
    this.callPending = false;
    this.stage = stage;
    this.earlyCalled = false;
    this.stageStart = Date.now();
    this.raiseHands(stage, blockId);
    if (stage !== 'individual' && stage !== 'pairs' && stage !== 'fours') return;
    const script = (blockId && BLOCK_SCRIPT[blockId]) || SCRIPT[stage];
    const rooms = this.host.rooms();
    // a script with a lead goes to that bot's room; the rest, in turn, to the other rooms
    const parts = new Map<string, RoomScript>();
    for (const part of script) {
      const room = part.lead && rooms.find(r => !parts.has(r) && this.host.members(r).includes(part.lead!));
      if (room) parts.set(room, part);
    }
    const rest = script.filter(p => ![...parts.values()].includes(p));
    rooms.filter(r => !parts.has(r)).forEach((r, i) => parts.set(r, rest.length ? rest[i % rest.length] : script[i % script.length]));
    rooms.forEach(room => {
      const part = parts.get(room)!;
      const members = this.host.members(room);
      const lead = part.lead && members.includes(part.lead) ? part.lead : members[0] ?? '';
      // the partner if they sit together; otherwise whoever sits with the lead, so the board matches the pair
      const partner = part.partner && members.includes(part.partner) ? part.partner : members.find(m => m !== lead) ?? lead;
      this.names.set(room, [lead, partner]);
      for (const line of part.lines) this.after(line.at * 1000, () => this.write(room, line.text));
      let callAt = part.call?.at;
      if (part.dialogue) {
        this.quietRooms.add(room);
        this.chatter(room, part, [lead, partner]);
        this.talks.set(room, { room, lines: part.dialogue, next: 0, phase: 'a', present: false, greeted: false, busy: false, saying: null, gen: 0, insert: [] });
        this.after(TALK_START_MS, () => this.step(room));
      } else if (part.explain) {
        this.quietRooms.add(room);
        this.chatter(room, part, [lead, partner]);
        this.explains.set(room, { lines: part.explain, next: 0, greeted: false, busy: false, gen: 0, insert: [], lastStrong: null, drawn: new Set(), onBoard: [] });
        this.after(TALK_START_MS, () => this.explainStep(room));
      } else if (part.trap) {
        this.quietRooms.add(room);
        const lines = part.trap;
        this.traps.set(room, { lines, next: 0, names: this.fourNames(lines.filter((l): l is FourLine => l.who !== 'T'), members, ''), onBoard: [], phase: 'a', present: false, busy: false, insert: [] });
        this.after(TALK_START_MS, () => this.trapStep(room));
      } else if (part.four) {
        this.quietRooms.add(room);
        this.fours.set(room, { lines: part.four, next: 0, names: this.fourNames(part.four, members), onBoard: [] });
        this.after(TALK_START_MS, () => this.fourStep(room));
      } else if (part.chat) {
        this.quietRooms.add(room);
        // the chatter goes by who sits there; boy and girl: the girl is {1}
        const [a, b] = [lead, partner];
        const fa = this.female(a), fb = this.female(b);
        if (fa !== fb && !fa) this.names.set(room, [b, a]);
        let range = fa && fb ? [30, 47] : fa || fb ? [48, 69] : [8, 29];
        // testing: /demo/?fast=b3&trep=mm|ff — that chatter whoever sits there, in voices that fit it
        const search = (globalThis as { location?: { search: string } }).location?.search;
        const force = search ? new URLSearchParams(search).get('trep') : null;
        const [p1, p2] = this.names.get(room)!;
        if (force === 'mm') { range = [8, 29]; this.stand.set(p1, 'anton'); this.stand.set(p2, 'ermil'); }
        if (force === 'ff') { range = [30, 47]; this.stand.set(p1, 'dasha'); this.stand.set(p2, 'masha'); }
        const n = (l: DialogueLine) => Number(l.id.slice(3));
        const queue = part.chat.filter(l => n(l) <= 7 || n(l) >= range[0] && n(l) <= range[1] || n(l) >= 70 && n(l) <= 76);
        this.chats.set(room, { lines: part.chat, queue, phase: 'drift', busy: false, gen: 0 });
        this.after(TALK_START_MS, () => this.chatStep(room));
      } else if (part.spoken?.length && part.later) {
        // the talk to listen to begins once the calls are over: the teacher is free then, and the hint shows them here
        this.chatter(room, { ...part, talk: [0.85, 0.05] }, [lead, partner]);
        this.spoken = { room, lines: part.spoken };
        this.after(SPOKEN_LATEST_MS, () => this.speakNow());
      } else if (part.spoken?.length) {
        // talking from the start; the call comes as their talk runs out, and the rest once they have the answer
        this.quietRooms.add(room);
        this.chatter(room, part, [lead, partner]);
        const took = this.speak(room, part.spoken.filter(l => !l.after));
        const rest = part.spoken.filter(l => l.after);
        if (part.call) { callAt = took / 1000 + 0.8; this.afterAnswer.set(room, rest); }
        else this.after(took, () => this.quietRooms.delete(room));
      } else if (stage !== 'individual') this.chatter(room, part, [...new Set([lead, partner, ...members])]);
      if (part.call) {
        const { note, reply, by } = part.call;
        const at = callAt ?? part.call.at;
        this.callQueue.push({ room, at: at * 1000, fire: () => {
          if (reply) this.replies.set(room, reply);
          this.host.call(room, this.fill(room, note), by ? this.names.get(room)?.[by - 1] : undefined);
        } });
      }
    });
    this.callQueue.sort((a, b) => a.at - b.at);
    this.nextCall();
  }

  /** Talking in the room: one at a time, short phrases out loud, each one as often as their weight says;
   *  counted as a real student's microphone would count it */
  private chatter(room: string, part: RoomScript, order: string[]) {
    const started = Date.now();
    const recent: string[] = [];
    let last = '';
    const tick = () => {
      const quiet = part.quietAfter !== undefined && Date.now() - started > part.quietAfter * 1000;
      if (quiet || this.quietRooms.has(room)) { this.after(TALK_TICK_MS, tick); return; }
      // a conversation takes turns: who has just spoken is less likely to go on, unless they do all the talking anyway
      const weights = order.map((name, i) => (name ? part.talk?.[i] ?? 0.4 : 0) * (name === last ? 0.3 : 1));
      let r = Math.random() * weights.reduce((a, b) => a + b, 0);
      const name = order[Math.max(0, weights.findIndex(w => (r -= w) < 0))];
      last = name;
      const fresh = CHATTER.filter(c => !recent.includes(c.id));
      const phrase = fresh[Math.floor(Math.random() * fresh.length)];
      recent.push(phrase.id);
      if (recent.length > 10) recent.shift();
      const ms = this.voice(room, name, phrase.id, phrase.ms);
      this.after(ms + 800 + Math.random() * 3000, tick);
    };
    this.after(TALK_START_MS + Math.random() * 2000, tick);
  }

  /** One says a clip: heard by the teacher in the room, counted as talk while it lasts; how long it is */
  private voice(room: string, who: string, id: string, lengths: Record<string, number>): number {
    const v = voiceFor(who, lengths, this.stand);
    const ms = lengths[v];
    this.host.say(room, { src: `/demo/voice/${id}-${v}.mp3`, ms, who });
    for (let d = 0; d < ms; d += TALK_TICK_MS) this.after(d, () => this.host.talk(who, Math.min(TALK_TICK_MS, ms - d)));
    return ms;
  }

  private speakNow() {
    if (!this.spoken) return;
    const { room, lines } = this.spoken;
    this.spoken = null;
    this.quietRooms.add(room);
    this.speak(room, lines);
  }

  /** A dialogue line by line: each one heard, counted as talk while it lasts, and written down as it ends; how long it takes */
  private speak(room: string, spoken: SpokenLine[]): number {
    let t = 0;
    for (const line of spoken) {
      const who = this.names.get(room)?.[line.who - 1] ?? '';
      t += line.pause;
      const v = voiceFor(who, line.ms, this.stand);
      if (v !== VOICE_OF[who]) this.stand.set(who, v);
      this.after(t, () => this.voice(room, who, line.id, line.ms));
      t += line.ms[v];
      if (line.write) { const text = line.write, by = line.who; this.after(t, () => this.write(room, text, by)); }
    }
    return t;
  }

  /** The next room calls: the stage's first one at its time in the script, every next one `gap` after the teacher came back */
  private nextCall(gap?: number) {
    const next = this.callQueue.shift();
    if (!next) { if (gap !== undefined) this.after(SPOKEN_AFTER_CALLS_MS, () => this.speakNow()); return; }
    const due = gap ?? Math.max(next.at - (Date.now() - this.stageStart), 0);
    this.callPending = true;
    this.after(due, () => { this.callPending = false; this.calling = { room: next.room, visited: false }; next.fire(); });
  }

  /** The teacher left a room: if it was the one that called, the next one may call after a breath */
  onLeave(room: string) {
    this.talkLeft(room);
    this.trapLeft(room);
    this.explainLeft(room);
    if (!this.calling || this.calling.room !== room || !this.calling.visited) return;
    this.calling = null;
    this.nextCall(NEXT_CALL_GAP_MS);
  }

  /** The teacher came to a room that called: they take the hint and write the fix */
  onVisit(room: string) {
    if (this.calling?.room === room && !this.calling.visited) {
      this.calling.visited = true;
      // on the individual stage the next one calls while the teacher is still busy here, once: someone else needs help too
      if (this.stage === 'individual' && !this.earlyCalled) {
        this.earlyCalled = true;
        this.after(EARLY_CALL_MS, () => { if (this.calling?.room === room && this.callQueue.length) this.nextCall(0); });
      }
    }
    this.talkVisited(room);
    this.explainVisited(room);
    this.chatVisited(room);
    this.trapVisited(room);
    const rest = this.afterAnswer.get(room);
    if (rest) {
      this.afterAnswer.delete(room);
      this.after(AFTER_ANSWER_MS, () => {
        const took = this.speak(room, rest);
        this.after(took + 1500, () => this.quietRooms.delete(room)); // and back to their usual talk
      });
    }
    const reply = this.replies.get(room);
    if (!reply) return;
    this.replies.delete(room);
    this.after(VISIT_REPLY_MS, () => this.write(room, reply));
  }

  // ---------- a dialogue that listens (Talk) ----------
  private id1(t: Talk, id: string) { return t.lines.find(l => l.id === id)!; }

  /** Says the next line if none is being said */
  private step(room: string) {
    const t = this.talks.get(room);
    if (!t || t.busy) return;
    let line = t.insert.shift();
    if (!line) {
      if (t.phase === 'a') {
        const cur = t.lines[t.next];
        if (cur?.id === 'p1-15' && t.present) {
          // the teacher is here: asked straight away, no call
          t.next = t.lines.findIndex(l => l.id === 'p1-18');
          t.phase = 'asked';
          line = this.id1(t, 'p1-33');
          this.host.call(room, line.text, this.names.get(room)?.[0]);
          this.host.callOff(room);
        } else if (cur?.id === 'p1-17' && t.present) {
          // came in just as they were about to call: they ask right away
          t.next++;
          t.phase = 'asked';
          line = cur;
          this.host.call(room, cur.text, this.names.get(room)?.[1]);
          this.host.callOff(room);
        } else if (cur?.id === 'p1-17') {
          // they call: the bell waits its turn among the other rooms'
          t.next = t.lines.findIndex(l => l.id === 'p1-18');
          t.phase = 'calling';
          this.requestCall(room, this.id1(t, 'p1-17').text, 2);
          return;
        } else { line = cur; t.next++; }
      } else if (t.phase === 'b') {
        line = t.lines[t.next];
        if (!line || !/^p1-(1[89]|2\d|3[01])$/.test(line.id)) { t.phase = 'done'; return; } // the dialogue is over: they stay quiet
        t.next++;
      } else return;
    }
    if (!line) return;
    const said = line;
    t.busy = true;
    t.saying = said;
    const ms = this.sayLine(room, said);
    const gen = t.gen;
    this.after(ms, () => {
      if (t.gen !== gen) return; // broken off
      t.busy = false;
      if (said.write && said.who !== 'T') this.write(room, said.write, said.who);
      // asked: the teacher may answer once the question is out
      if (t.phase === 'asked' && !t.insert.length && (said.id === 'p1-33' || said.id === 'p1-17')) { t.phase = 'b'; t.insert.push(this.id1(t, 'p1-ta')); }
      const next = t.insert[0]?.id;
      this.after(next === 'p1-32' ? GREET_GAP_MS : next === 'p1-ta' ? THINK_MS : said.id === 'p1-ta' ? PONDER_MS : LINE_GAP_MS, () => this.step(room));
    });
  }

  // ---------- a dialogue that goes on its own (Explain) ----------
  private explainStep(room: string) {
    const e = this.explains.get(room);
    if (!e || e.busy) return;
    let line = e.insert.shift();
    if (!line) {
      line = e.lines[e.next];
      // «Попробуй сам/сама»: as the partner is
      while (line?.id.endsWith('f')) line = e.lines[++e.next];
      if (!line || !/^p2-([012]\d|3[0-6])f?$/.test(line.id)) return; // the dialogue is over: they stay quiet
      e.next++;
      if (line.id === 'p2-25' && this.female(this.names.get(room)?.[1] ?? '')) line = e.lines.find(l => l.id === 'p2-25f') ?? line;
    }
    const said = line;
    if (said.who === 1 && /^p2-([012]\d|3[0-6])f?$/.test(said.id)) e.lastStrong = said;
    e.busy = true;
    const ms = this.sayLine(room, said);
    const draws = EXPLAIN_DRAW[said.id.replace(/f$/, '')];
    if (draws && !e.drawn.has(said.id)) {
      e.drawn.add(said.id);
      if (ERASE_BEFORE.has(said.id.replace(/f$/, ''))) {
        const author = this.names.get(room)?.[0] || undefined;
        e.onBoard.splice(0).forEach((uid, i) => this.after(i * ERASE_MS, () => this.host.erase(room, uid, author)));
      }
      const by = said.who === 'T' ? 1 : said.who;
      for (const d of draws) this.after(d.at * ms, () => this.draw(room, d, by));
    }
    const gen = e.gen;
    this.after(ms, () => {
      if (e.gen !== gen) return;
      e.busy = false;
      this.after(LINE_GAP_MS, () => this.explainStep(room));
    });
  }

  // ---------- a four by itself (Four) ----------
  /** Who says {1}…{4}: Аня is 4; the others by whose own voice the lines were said in, then whoever is left */
  private fourNames(lines: FourLine[], members: string[], fourth = 'Аня'): string[] {
    const voiceOf = (who: number) => Object.keys(lines.find(l => l.who === who)?.ms ?? {})[0];
    const names = ['', '', '', fourth && members.includes(fourth) ? fourth : ''];
    if (!fourth) { // all four by voice
      let left = [...members];
      for (const who of [1, 2, 3, 4]) {
        const m = left.find(n => VOICE_OF[n] === voiceOf(who)) ?? left.find(n => this.female(n) === FEMALE_VOICES.has(voiceOf(who) ?? '')) ?? left[0] ?? '';
        names[who - 1] = m;
        left = left.filter(n => n !== m);
      }
      return names;
    }
    let left = members.filter(m => m !== names[3]);
    for (const who of [1, 2, 3]) {
      const m = left.find(n => VOICE_OF[n] === voiceOf(who)) ?? left.find(n => this.female(n) === FEMALE_VOICES.has(voiceOf(who) ?? '')) ?? left[0] ?? '';
      names[who - 1] = m;
      left = left.filter(n => n !== m);
    }
    if (!names[3]) names[3] = left[0] ?? names[0];
    return names;
  }

  private fourStep(room: string) {
    const f = this.fours.get(room);
    const line = f?.lines[f.next++];
    if (!f || !line) return; // done: they stay quiet
    const who = f.names[line.who - 1];
    const ms = this.voice(room, who, line.id, line.ms);
    if (FOUR_ERASE.has(line.id)) f.onBoard.splice(0).forEach((uid, i) => this.after(i * ERASE_MS, () => this.host.erase(room, uid, who)));
    for (const d of FOUR_DRAW[line.id] ?? []) this.after(d.at * ms, () => this.fourDraw(room, f.onBoard, d, COLORS[(line.who - 1) % COLORS.length], who));
    const move = FOUR_MOVES[line.id];
    if (move) this.after(ms * 0.8, () => this.host.move(room, CARD_UID[move[0] - 1], move[1][0], move[1][1]));
    if (line.id === 'c2-29') {
      // «Дайте пятюню!»: the hand is up, the others tap it one after another
      this.after(ms * 0.6, () => this.host.five(room, who));
      f.names.filter(n => n && n !== who).forEach((n, i) => this.after(ms + 500 + i * FIVE_TAP_MS + Math.random() * 300, () => this.host.fiveTap(room, n)));
    }
    const gap = line.id === 'c2-29' ? 3 * FIVE_TAP_MS + 2500 : LINE_GAP_MS;
    this.after(ms + gap, () => this.fourStep(room));
  }

  /** author '' — the teacher draws it */
  private fourDraw(room: string, onBoard: string[], d: FourDraw, color: string, author: string) {
    const uid = () => { const u = `bot-${room}-${this.uid++}`; onBoard.push(u); return u; };
    const put = (obj: Record<string, unknown> & { uid: string; type: string }) => author ? this.host.write(room, obj, author) : this.host.teacherWrite(room, obj);
    if (d.dot) put({ uid: uid(), type: 'Circle', radius: 7, left: d.dot[0], top: d.dot[1], originX: 'center', originY: 'center', fill: color, stroke: color, strokeWidth: 1 });
    if (d.path) d.path.slice(1).forEach((p, i) => this.after(i * SEGMENT_MS, () => {
      const [a, b] = [d.path![i], p];
      put({
        uid: uid(), type: 'Line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], left: (a[0] + b[0]) / 2, top: (a[1] + b[1]) / 2,
        originX: 'center', originY: 'center', stroke: d.thin ? '#adb5bd' : color, strokeWidth: d.thin ? 2 : 5, strokeLineCap: 'round',
      });
    }));
    for (const t of [d.label && { ...d.label, size: 28 }, d.text && { ...d.text, size: 34 }]) {
      if (!t) continue;
      put({
        uid: uid(), type: 'IText', text: t.text, left: t.at[0], top: t.at[1], originX: t.size === 28 ? 'center' : 'left', originY: 'center',
        fontSize: t.size, fontWeight: 'bold', fontFamily: 'sans-serif', fill: color,
      });
    }
  }

  // ---------- a four that calls (Trap, Ч1) ----------
  private trapLine(t: Trap, id: string) { return t.lines.find(l => l.id === id)!; }

  private trapStep(room: string) {
    const t = this.traps.get(room);
    if (!t || t.busy) return;
    let line = t.insert.shift();
    if (!line) {
      const cur = t.lines[t.next];
      if (!cur || cur.id === 'c1-38') return; // over (38 on are said only instead of 18–19): they stay quiet
      if (t.phase === 'a' && cur.id === 'c1-18' && t.present) {
        // the teacher is here as they'd call: they ask straight away
        t.phase = 'asked';
        t.insert.push(this.trapLine(t, 'c1-t0'), this.trapLine(t, 'c1-39'));
        line = this.trapLine(t, 'c1-38');
        t.next = t.lines.findIndex(l => l.id === 'c1-ta1');
      } else if (t.phase === 'a' || t.phase === 'b') { line = cur; t.next++; }
      else return;
    }
    const said = line;
    t.busy = true;
    const who = said.who === 'T' ? '' : t.names[said.who - 1];
    let ms: number;
    if (said.who === 'T') {
      const v = said.ms[TEACHER_VOICE] !== undefined ? TEACHER_VOICE : Object.keys(said.ms)[0];
      ms = said.ms[v];
      this.host.say(room, { src: `/demo/voice/${said.id}-${v}.mp3`, ms, who: 'Teacher' });
    } else ms = this.voice(room, who, said.id, said.ms);
    if (said.id === 'c1-39') {
      // asked in the room: the question shows in the teacher's panel as a call would
      this.host.call(room, said.text, t.names[0]);
      this.host.callOff(room);
    }
    if (FOUR_ERASE.has(said.id)) t.onBoard.splice(0).forEach((uid, i) => this.after(i * ERASE_MS, () => this.host.erase(room, uid, who || t.names[0])));
    const color = said.who === 'T' ? TEACHER_COLOR : COLORS[(said.who - 1) % COLORS.length];
    for (const d of FOUR_DRAW[said.id] ?? []) this.after(d.at * ms, () => this.fourDraw(room, t.onBoard, d, color, who));
    const move = FOUR_MOVES[said.id];
    if (move) this.after(ms * 0.8, () => this.host.move(room, CARD_UID[move[0] - 1], move[1][0], move[1][1]));
    this.after(ms, () => {
      t.busy = false;
      if (said.id === 'c1-18' && t.phase === 'a') {
        t.next = t.lines.findIndex(l => l.id === 'c1-ta1');
        if (t.present) { // came in while it was said: no bell, the question straight away
          t.phase = 'asked';
          t.insert.push(this.trapLine(t, 'c1-t0'), this.trapLine(t, 'c1-39'));
          this.after(LINE_GAP_MS, () => this.trapStep(room));
          return;
        }
        // they call: the bell waits its turn among the other rooms'
        t.phase = 'calling';
        this.requestCall(room, this.trapLine(t, 'c1-19').text, 1);
        return;
      }
      if (t.phase === 'asked' && (said.id === 'c1-19' || said.id === 'c1-39')) {
        // asked: the teacher's ready answer, drawn as it is said, and on they go
        t.phase = 'b';
        this.after(THINK_MS, () => this.trapStep(room));
        return;
      }
      if (said.id === 'c1-37') return;
      this.after(LINE_GAP_MS, () => this.trapStep(room));
    });
  }

  private trapVisited(room: string) {
    const t = this.traps.get(room);
    if (!t) return;
    t.present = true;
    if (t.phase !== 'calling') return; // coming in before: not greeted
    // came on the call: «Да. Какие у вас вопросы?» — and the question
    t.phase = 'asked';
    t.insert.push(this.trapLine(t, 'c1-t0'), this.trapLine(t, 'c1-19'));
    this.after(ARRIVE_MS, () => this.trapStep(room));
  }

  private trapLeft(room: string) {
    const t = this.traps.get(room);
    if (!t) return;
    t.present = false;
    if (t.phase !== 'asked') return;
    // gone before the answer: they call again a little later
    t.insert = [];
    t.phase = 'calling';
    this.after(RECALL_MS, () => { if (t.phase === 'calling') this.requestCall(room, this.trapLine(t, 'c1-19').text, 1); });
  }

  // ---------- a dialogue that drifts (Chat) ----------
  private chatStep(room: string, gen = 0) {
    const c = this.chats.get(room);
    if (!c || c.busy || c.gen !== gen) return;
    const line = c.queue.shift();
    if (!line) return; // over: they stay quiet
    if (line.id === 'p4-70') c.phase = 'end'; // too late for the teacher to set them going
    c.busy = true;
    const ms = this.sayLine(room, line);
    this.after(ms, () => {
      c.busy = false;
      if (line.write && line.who !== 'T') {
        const by = line.who;
        line.write.split('; ').forEach((w, i) => this.after(i * CHAT_WRITE_MS, () => this.write(room, w, by)));
      }
      const next = c.queue[0]?.id;
      this.after(next === 'p4-77' ? GREET_GAP_MS : LINE_GAP_MS, () => this.chatStep(room, c.gen));
    });
  }

  /** In openly while they still chat: the line going on is finished, then «Так, как у вас дела?» and they check for real */
  private chatVisited(room: string) {
    const c = this.chats.get(room);
    if (!c || c.phase !== 'drift') return;
    c.phase = 'checking';
    c.queue = c.lines.filter(l => Number(l.id.slice(3)) >= 77);
    const gen = ++c.gen;
    // the line going on ends and steps on by itself; if none, after a moment for the teacher's page to get in
    this.after(ARRIVE_MS, () => this.chatStep(room, gen));
  }

  private female(who: string) { return FEMALE_VOICES.has(this.stand.get(who) ?? VOICE_OF[who] ?? ''); }

  private explainVisited(room: string) {
    const e = this.explains.get(room);
    if (!e || e.greeted || e.next >= e.lines.length) return;
    e.greeted = true;
    // the line going on is finished, then: «Как вы тут?» — they tell, the teacher leaves them to it, and on they go
    const ids = ['p2-tq', 'p2-37', 'p2-38', 'p2-tb', 'p2-39'];
    e.insert.push(...ids.map(id => e.lines.find(l => l.id === id)!));
    if (e.lastStrong) e.insert.push(e.lastStrong); // (none yet: nothing to repeat)
    this.after(ARRIVE_MS, () => this.explainStep(room));
  }

  private explainLeft(room: string) {
    const e = this.explains.get(room);
    if (!e) return;
    // gone before the talk with the teacher was over: what's left of it is not for the empty room
    if (e.insert.some(l => l.who === 'T')) e.insert = e.insert.filter(l => !['p2-tq', 'p2-37', 'p2-38', 'p2-tb'].includes(l.id));
  }

  /** A drawing on the pair's board, in the colour of who draws it */
  private draw(room: string, d: Draw, by: 1 | 2) {
    const onBoard = this.explains.get(room)?.onBoard;
    const uid = () => { const u = `bot-${room}-${this.uid++}`; onBoard?.push(u); return u; };
    const author = this.names.get(room)?.[by - 1] || undefined;
    const color = COLORS[by - 1];
    const px = ([x, y]: Pt) => ({ x: 116 + 56 * x, y: 568 - 56 * y }); // the figure's cells: A is (0, 0), a cell is 56
    const line = (a: { x: number; y: number }, b: { x: number; y: number }, w = 5) => this.host.write(room, {
      uid: uid(), type: 'Line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, left: (a.x + b.x) / 2, top: (a.y + b.y) / 2,
      originX: 'center', originY: 'center', stroke: color, strokeWidth: w, strokeLineCap: 'round',
    }, author);
    if (d.path) d.path.slice(1).forEach((p, i) => this.after(i * SEGMENT_MS, () => line(px(d.path![i]), px(p))));
    if (d.angle) {
      // a right-angle mark: a small square in the corner
      const [c, a, b] = d.angle.map(px), s = 16;
      const u = (p: { x: number; y: number }) => { const l = Math.hypot(p.x - c.x, p.y - c.y); return { x: (p.x - c.x) / l * s, y: (p.y - c.y) / l * s }; };
      const ua = u(a), ub = u(b);
      const p1 = { x: c.x + ua.x, y: c.y + ua.y }, p2 = { x: c.x + ua.x + ub.x, y: c.y + ua.y + ub.y }, p3 = { x: c.x + ub.x, y: c.y + ub.y };
      line(p1, p2, 3); line(p2, p3, 3);
    }
    if (d.ticks) {
      // equal segments: short strokes across the middle, one or two
      for (const [from, to, n] of d.ticks) {
        const a = px(from), b = px(to), l = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = (b.x - a.x) / l, uy = (b.y - a.y) / l, m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, h = 11;
        for (let k = 0; k < n; k++) {
          const off = (k - (n - 1) / 2) * 9, c = { x: m.x + ux * off, y: m.y + uy * off };
          line({ x: c.x - uy * h, y: c.y + ux * h }, { x: c.x + uy * h, y: c.y - ux * h }, 3);
        }
      }
    }
    if (d.fill) {
      const pts = d.fill.map(px);
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      this.host.write(room, {
        uid: uid(), type: 'Polygon', points: pts, left: (Math.min(...xs) + Math.max(...xs)) / 2, top: (Math.min(...ys) + Math.max(...ys)) / 2,
        originX: 'center', originY: 'center', fill: color + '40', stroke: color, strokeWidth: 3,
      }, author);
    }
    if (d.label) {
      const p = px(d.label.at);
      this.host.write(room, {
        uid: uid(), type: 'IText', text: d.label.text, left: p.x, top: p.y,
        originX: 'center', originY: 'center', fontSize: 30, fontWeight: 'bold', fontFamily: 'sans-serif', fill: color,
      }, author);
    }
  }

  /** One line out loud: a student's counted as talk; how long it takes */
  private sayLine(room: string, line: DialogueLine): number {
    if (line.who === 'T') {
      const v = line.ms[TEACHER_VOICE] !== undefined ? TEACHER_VOICE : Object.keys(line.ms)[0];
      this.host.say(room, { src: `/demo/voice/${line.id}-${v}.mp3`, ms: line.ms[v], who: 'Teacher' });
      return line.ms[v];
    }
    const who = this.names.get(room)?.[line.who - 1] ?? '';
    return this.voice(room, who, line.id, line.ms);
  }

  private requestCall(room: string, note: string, by: 1 | 2) {
    this.callQueue.push({ room, at: Date.now() - this.stageStart, fire: () => this.host.call(room, note, this.names.get(room)?.[by - 1]) });
    if (!this.calling && !this.callPending) this.nextCall();
  }

  private talkVisited(room: string) {
    const t = this.talks.get(room);
    if (!t) return;
    t.present = true;
    if (t.phase === 'a' && !t.greeted) {
      t.greeted = true;
      // the line going on is finished, then hello at once
      t.insert.push(this.id1(t, 'p1-32'));
    }
    else if (t.phase === 'calling') {
      // came on the call: «Какой у вас вопрос?» — and the partner asks it
      t.phase = 'asked';
      t.insert.push(this.id1(t, 'p1-tq'), this.id1(t, 'p1-17'));
    }
    // a moment for the teacher's page to get into the room: what's said for them is heard from its start
    this.after(ARRIVE_MS, () => this.step(room));
  }

  private talkLeft(room: string) {
    const t = this.talks.get(room);
    if (!t) return;
    t.present = false;
    if (t.phase !== 'asked') return;
    // gone without an answer: they call again a little later
    this.host.offerReply(room, null);
    t.insert = [];
    t.phase = 'calling';
    this.after(RECALL_MS, () => { if (t.phase === 'calling') this.requestCall(room, this.id1(t, 'p1-17').text, 2); });
  }

  /** The teacher answered: with the ready answer, said in the teacher's voice, or in their own words */
  onReply(room: string, ready: boolean) {
    const t = this.talks.get(room);
    if (!t || t.phase !== 'asked') return;
    this.host.offerReply(room, null);
    t.phase = 'b';
    if (ready) t.insert.push(this.id1(t, 'p1-ta'));
    this.after(ready ? 300 : 1500, () => this.step(room));
  }

  private polls = 0;
  /** A poll began: each bot answers in its own time, a few quick, a few slow */
  /** The explanation of b9: two raise hands, a moment after it starts (raised once: not again on coming back) */
  private raiseHands(stage: string, blockId?: string | null) {
    if (stage !== 'group' || this.handsRaised.has(blockId ?? '')) return;
    const lines = HANDS[blockId ?? ''];
    if (!lines) return;
    this.handsRaised.add(blockId!);
    lines.forEach((l, i) => this.after(HAND_FIRST_MS + i * HAND_GAP_MS, () => this.host.raise(l.who), this.stageTimers));
  }

  /** The teacher gave the word: a bot with a line says it */
  onFloor(name: string) {
    const line = Object.values(HANDS).flat().find(l => l.who === name);
    if (!line) return;
    const v = voiceFor(name, { [VOICE_OF[name] ?? 'kirill']: line.ms });
    this.host.speak(name, line.text, { src: `/demo/voice/${line.id}-${v}.mp3`, ms: line.ms });
    for (let d = 0; d < line.ms; d += TALK_TICK_MS) this.after(d, () => this.host.talk(name, Math.min(TALK_TICK_MS, line.ms - d)));
  }

  onPoll(options: number) {
    const answers = POLL_ANSWERS[Math.min(this.polls++, POLL_ANSWERS.length - 1)];
    const order = [...BOTS].sort(() => Math.random() - 0.5);
    order.forEach((b, i) => {
      const at = 2500 + i * 1800 + Math.random() * 2500 + (i === order.length - 1 ? 5000 : 0); // the last one keeps them waiting
      this.after(at, () => this.host.vote(b.name, Math.min(answers[b.name] ?? 0, options - 1)));
    });
  }

  stop() {
    for (const t of [...this.timers, ...this.stageTimers]) clearTimeout(t);
    this.timers.clear();
    this.stageTimers.clear();
  }
}

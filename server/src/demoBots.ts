// The solo demo: a teacher with nobody to gather tries the lesson on simulated students. Bots have
// no sockets and no media; all they do is sit down, write on boards and call the teacher, on a
// script tied to the sample lesson (client-teacher/public/demo/parallelogram.colesson).

import { ASKS, CHAT, CHATTER, CHOCOLATE, SCISSORS, SIXTH, TRAP, type FourLine, type TrapLine, EXPLAIN, EXPLAIN_DRAW, FEMALE_VOICES, LOPSIDED_PAIR, VOICE_OF, type DialogueLine, type Draw, type Pt, type SpokenLine, type FourDraw, type LineBoard, SIXTH_BOARD, SCISSORS_BOARD, TRAP_BOARD, SHEET_DRAW, CHOCOLATE_BOARD, EXPLAIN_BOARD, CHAT_BOARD, MALE_ADDRESS } from './demoDialogue';

/** The voices the dialogues were written for: who says a four's {1}…{4} goes by these */
const BASE_VOICE_OF = { ...VOICE_OF };
const SPARE_BOY_VOICES = ['filipp'];
/** Each lesson deals the children's voices anew, a boy's among the boys, a girl's among the girls; they keep it all the
 *  lesson. A voice some line has alone of its sex (Миша's kirill in П1) stays with its child: till that line is voiced in all.
 *  The boys have a voice to spare (filipp): five for four, so one of them is left out each lesson. anton is the teacher's */
(() => {
  const lines: { who?: unknown; ms: Record<string, number> }[] = [CHATTER, ASKS, CHAT, TRAP, SIXTH, CHOCOLATE, EXPLAIN, SCISSORS].flat();
  const pinned = new Set<string>();
  for (const l of lines) {
    if (l.who === 'T') continue;
    for (const f of [false, true]) { const vs = Object.keys(l.ms).filter(v => FEMALE_VOICES.has(v) === f); if (vs.length === 1) pinned.add(vs[0]); }
  }
  for (const f of [false, true]) {
    const names = Object.keys(VOICE_OF).filter(n => FEMALE_VOICES.has(VOICE_OF[n]) === f && !pinned.has(VOICE_OF[n]));
    const vs = [...names.map(n => VOICE_OF[n]), ...(f ? [] : SPARE_BOY_VOICES)];
    for (let i = vs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [vs[i], vs[j]] = [vs[j], vs[i]]; }
    names.forEach((n, i) => { VOICE_OF[n] = vs[i]; });
  }
})();

/** A question in parts, each said by one of them */
export type Says = { who: string; text: string; ids?: string[] }[]; // ids: the voiced lines: the bubble is open while they sound
export type BotStage = 'individual' | 'pairs' | 'fours';
/** Where an earlier sheet lies on a group's board: its top left corner and how much smaller it is */
export interface SheetPlace { x: number; y: number; s: number }
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

/** What he says when the teacher comes up to his desk apart (voice-tools/gen_newcomer.py) */
const NEWCOMER_LINE = { id: 'nm-01', text: 'Здравствуйте! Это Миша. Мы сегодня в гостях у тёти, я с её компьютера работаю.',
  ms: { kirill: 6192, zahar: 5712, filipp: 6576, alexander: 6000, ermil: 6048 } as Record<string, number> };

/** A seat for each, two desks: the whole hall fits a screen */
export const SOLO_SEATS = 8;
/** The teacher may change the number of seats, but every bot needs one */
export const SOLO_MIN_SEATS = 8;
const SEAT_PAUSE_MS = 1000;
/** Who comes in after whom: five, then the one from an unknown device, then the last two */
const ARRIVAL = ['Лена', 'Аня', 'Тимур', 'Соня', 'Артём', SOLO_NEWCOMER, 'Вика', 'Глеб'];
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
interface RoomScript { lines: Line[]; call?: Call; lead?: string; partner?: string; talk?: number[]; quietAfter?: number; spoken?: SpokenLine[]; later?: boolean; dialogue?: DialogueLine[]; plan?: TalkPlan; explain?: DialogueLine[]; chat?: DialogueLine[]; four?: FourLine[]; trap?: TrapLine[] }

/** The teacher's voice in the dialogues: Татьяна Алексеевна or Николай Иванович, as chosen when starting */
const TEACHER_VOICES = { f: 'alena', m: 'anton' };
export type TeacherSex = keyof typeof TEACHER_VOICES;
const LINE_GAP_MS = 700; // between lines: 0,7 с (voice editor, 23.11; was 0,6 while each line still loaded in its turn)
const PONDER_MS = 5000; // after the teacher's answer: a pause, the teacher may draw the legs, then they count
const THINK_MS = 2500; // asked a question, the teacher thinks a moment before answering
const GREET_GAP_MS = 300; // the teacher came in: hello straight after the line going on
const ARRIVE_MS = 1500; // the teacher comes into a room: their page is there about this much later
const EARLY_CALL_MS = 10_000; // the individual stage: the second call comes 10 s into the teacher's visit to the first
const TALK_START_MS = 10_000; // the first seconds of a stage are quiet: the teacher looks round first

/** A dialogue that listens: the teacher coming in openly is greeted, one still there when they'd call is asked
 *  straight away, the call waits its turn among the others', and the second part begins once the teacher answered */
/** How a dialogue that calls goes, by its line ids (the text files: ~/temp/П1-курица.txt, П3-ножницы.txt) */
interface TalkPlan {
  greet: string;        // hello to a teacher coming in openly before the call
  cut: string;          // the teacher is still there when they get here: they ask straight away (direct) instead
  direct: string[];
  call: string[];       // the question, said on the call after «Какой у вас вопрос?» (tq)
  callBy: 1 | 2;        // whose tile the bell is by
  after: string;        // the first line once answered…
  last: string;         // …and the last
  tq: string; ta: string; // the teacher's question and ready answer
  toOther?: string;     // said to the other one: its «…f» variant if that's a girl
  legs?: boolean;       // the pale legs of Pythagoras over {2}'s sheet as the answer is said (Миша's pair)
}
const P1_PLAN: TalkPlan = { greet: 'p1-32', cut: 'p1-15', direct: ['p1-33'], call: ['p1-17'], callBy: 2, after: 'p1-18', last: 'p1-31', tq: 'p1-tq', ta: 'p1-ta', toOther: 'p1-21', legs: true };
const P3_PLAN: TalkPlan = { greet: 'p3-38', cut: 'p3-19', direct: ['p3-39', 'p3-40'], call: ['p3-21', 'p3-22'], callBy: 1, after: 'p3-23', last: 'p3-41', tq: 'p3-tq', ta: 'p3-ta', toOther: 'p3-17' };

interface Talk {
  room: string; lines: DialogueLine[]; plan: TalkPlan;
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
const YES = [[60, 172], [305, 172], [550, 172], [60, 250], [305, 250]], NO = [[830, 172], [1075, 172], [1320, 172]]; // the columns of the compact sheet (24.11)
const FOUR_MOVES: Record<string, [number, number[]]> = {
  'c2-01': [1, YES[0]], 'c2-02': [2, YES[1]], 'c2-03': [3, YES[2]], 'c2-08': [3, NO[0]], 'c2-09': [4, YES[2]],
  'c2-12': [5, NO[1]], 'c2-14': [6, NO[2]], 'c2-27': [6, YES[4]],
};
type XY = [number, number];
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
// Ч1 and Ч2 as set in the voice editor, when they were: instead of the above
for (const [pre, board] of [['c1-', TRAP_BOARD], ['c2-', SIXTH_BOARD]] as const) {
  if (!Object.keys(board).length) continue;
  for (const k of Object.keys(FOUR_DRAW)) if (k.startsWith(pre)) delete FOUR_DRAW[k];
  for (const k of Object.keys(FOUR_MOVES)) if (k.startsWith(pre)) delete FOUR_MOVES[k];
  for (const k of [...FOUR_ERASE]) if (k.startsWith(pre)) FOUR_ERASE.delete(k);
  for (const [id, b] of Object.entries(board)) {
    if (b.draw) FOUR_DRAW[id] = b.draw;
    if (b.move) FOUR_MOVES[id] = b.move;
    if (b.erase) FOUR_ERASE.add(id);
  }
}
const TEACHER_COLOR = '#c92a2a';
/** The pairs' boards from the voice editor, by line */
const PAIR_BOARD: Record<string, LineBoard> = { ...SCISSORS_BOARD, ...CHOCOLATE_BOARD, ...EXPLAIN_BOARD, ...CHAT_BOARD };
delete PAIR_BOARD['p1-ta']; // the legs are for the teacher to draw, over the blinking ones (client-teacher demoLegs.tsx)
/** The dialogues whose boards were drawn by hand: the checking marks are in those drawings, none put in print */
const HAND_MARKS = new Set(Object.keys(PAIR_BOARD).filter(id => PAIR_BOARD[id].draw?.length).map(id => id.slice(0, id.indexOf('-'))));
/** The dialogues (by the ids' prefix) whose common list is written by hand */
const HAND_LISTS = new Set([SCISSORS, CHOCOLATE, EXPLAIN, CHAT].flatMap(ls => ls.filter(l => l.write && PAIR_BOARD[l.id]?.draw?.length).map(l => l.id.slice(0, l.id.indexOf('-')))));
/** П2's drawings in the code, till they are drawn in the voice editor */
const EXPLAIN_OLD = !Object.keys(EXPLAIN_BOARD).length;
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

/** The pairs of b3, by who sits at a desk: Миша's is always П1; the other desks get П2–П4 at random (once the lesson
 *  began, nobody is moved any more). {1} and {2} as in each dialogue */
type Role = 'p1' | 'p2' | 'p3' | 'p4';
const PAIR_PART: Record<Role, number> = { p1: 0, p2: 1, p3: 2, p4: 3 }; // SCRIPT.pairs
/** b2 «Что я замечаю»: what each one writes on their sheet, by their part in b3 — what the pair says of it there.
 *  start, gap: seconds; call: they ask the teacher, and write `reply` once the teacher has been;
 *  later: not then, the teacher writes it for them: it is on their sheet on the next stage;
 *  angles: as they ask, bold red arcs in ∠AOB and ∠COD show which angles they mean (only for this stage) */
interface Sheet { lines: string[]; start: number; gap: number; call?: { at: number; note: string; reply?: string[]; later?: boolean; angles?: boolean } }
const SHEETS: Record<string, Sheet> = {
  // Миша, with a mouse at his aunt's: «как курица лапкой», and AB = AO wrong
  'p1-1': { lines: ['AD = BC', 'AB = CD', '∠A = ∠C', '∠B = ∠D', 'AB = AO'], start: 6, gap: 9 },
  // «Пять. Стороны, диагонали, угол» (asked nothing: two calls on this stage, 22.11)
  'p1-2': { lines: ['AD = BC', 'AB = CD', '∠A = ∠C', 'AO = OC', 'BO = OD'], start: 5, gap: 8 },
  // the strong one: everything, and asks about the small angles
  'p2-1': { lines: ['AD = BC', 'AB = CD', 'AO = OC', 'BO = OD', '∠A = ∠C', '∠B = ∠D'], start: 4, gap: 7, call: {
    at: 40, note: 'Можно записывать только полные углы параллелограмма или и уголки, на которые их делят диагонали?', reply: ['∠BAC = ∠ACD'] } },
  // the weak one: «Одну пару сторон нашёл, и всё»
  'p2-2': { lines: ['AD = BC'], start: 18, gap: 0 },
  // П3 «Хоть ножницы нарисуй»: «Я тоже их нашёл и ещё две пары углов» — the vertical ones, after asking how to write angles;
  // «Стороны и диагонали. Четыре штуки»
  'p3-1': { lines: ['AD = BC', 'AB = CD', 'AO = OC', 'BO = OD'], start: 5, gap: 8, call: {
    at: 20, note: 'Не помню, как записывается равенство углов. Напишите, пожалуйста', reply: ['∠AOB = ∠COD', '∠BOC = ∠AOD'], later: true, angles: true } },
  'p3-2': { lines: ['AD = BC', 'AB = CD', 'AO = OC', 'BO = OD'], start: 7, gap: 9 },
  // «Четыре. Стороны и диагонали» — «У меня тоже четыре, только другие… Зато углы» in a scrawl: «Это бэ или восьмёрка?»
  'p4-1': { lines: ['AD = BC', 'AB = CD', 'AO = OC', 'BO = OD'], start: 7, gap: 9 },
  'p4-2': { lines: ['AD = BC', 'AB = CD', '∠A = ∠C', '∠B = ∠D'], start: 6, gap: 10 },
};
const MESSY = new Set(['p1-1', 'p4-2']);
const INKS = ['#1971c2', '#5f3dc4', '#2b8a3e', '#c2255c', '#0c8599', '#e67700', '#862e9c', '#495057']; // each one's pen, by BOTS
const ANY_SHEET: Sheet = { lines: OBSERVATIONS.slice(0, 3), start: 6, gap: 9 };
const SHEET_TOP = 60, SHEET_ROW = 72, SHEET_LEFT = 860, SHEET_FONT = 40; // in the sheet's own pixels
/** The voice's letter names written as the textbook does: «а-бэ» → AB, «цэо-дэ» → COD */
const LETTER: Record<string, string> = { а: 'A', бэ: 'B', цэ: 'C', дэ: 'D', о: 'O' };
export function latinLetters(text: string): string {
  return text.replace(/(?<![а-яё])(?:бэ|цэ|дэ|а|о)(?:-?(?:бэ|цэ|дэ|а|о))+(?![а-яё])/giu, w =>
    w.includes('-') ? w.toLowerCase().split('-').join('').match(/бэ|цэ|дэ|а|о/gu)!.map(x => LETTER[x]).join('') : w)
    .replace(/равно а о(?![а-яё])/gu, 'равно AO'); // said apart, as Миша's call has it
}
const SHEET_BLOCK = 'b2'; // the sheet b3 shows (lesson's boardsFrom)

/** b3: as a line is said, the one checking marks the partner's sheet: ✓, ?, a crossing out, or a line added under the list.
 *  on: whose sheet ({1} or {2}); by: who marks; row: the sheet's line */
interface Mark { at: number; on: 1 | 2; by: 1 | 2; row?: number; mark?: '✓' | '?'; strike?: boolean; add?: string }
const SHEET_MARKS: Record<string, Mark[]> = {
  // «А-дэ равно бэ-цэ — есть. А-бэ равно цэ-дэ — есть. Углы есть… А это что? А-бэ равно а-о?»
  'p1-06': [
    { at: 0.22, on: 1, by: 2, row: 0, mark: '✓' }, { at: 0.42, on: 1, by: 2, row: 1, mark: '✓' },
    { at: 0.58, on: 1, by: 2, row: 2, mark: '✓' }, { at: 0.64, on: 1, by: 2, row: 3, mark: '✓' },
    { at: 0.95, on: 1, by: 2, row: 4, mark: '?' },
  ],
  'p1-18': [{ at: 0.9, on: 1, by: 2, add: 'AB² = 4 + 16 = 20' }],
  'p1-19': [{ at: 0.3, on: 1, by: 1, add: 'AO² = 25 + 4 = 29' }, { at: 0.75, on: 1, by: 1, row: 4, strike: true }],
  // «А-дэ равно бэ-цэ. Это правильно»; then the weak one adds what they work out together
  'p2-05': [{ at: 0.6, on: 2, by: 1, row: 0, mark: '✓' }],
  'p2-20': [{ at: 0.3, on: 2, by: 2, add: 'AB = CD' }],
  'p2-23': [{ at: 0.9, on: 2, by: 2, add: 'AO = OC' }],
  'p2-26': [{ at: 0.95, on: 2, by: 2, add: 'BO = OD' }],
  'p2-34': [{ at: 0.9, on: 2, by: 2, add: '∠A = ∠C' }],
  'lp01': [{ at: 0.9, on: 2, by: 1, row: 0, mark: '✓' }],
  // «Угол а равен углу цэ — вижу. А внизу что? Это бэ или восьмёрка?» — «Бэ»
  'p4-05': [{ at: 0.3, on: 2, by: 1, row: 2, mark: '✓' }, { at: 0.8, on: 2, by: 1, row: 3, mark: '?' }],
  'p4-06': [{ at: 0.9, on: 2, by: 1, row: 3, mark: '✓' }],
};
const MARK_COLOR = { '✓': '#2f9e44', '?': '#e8590c' };
const STRIKE_COLOR = '#c92a2a';

/** Handwriting with a mouse: each letter a few shaky strokes, sizes and slants all over the place. Strokes in a box
 *  of height 1, y down */
type Stroke = [number, number][];
const oval = (cx: number, rx: number, from: number, to: number, n = 12): Stroke =>
  Array.from({ length: n + 1 }, (_, i) => { const t = (from + (to - from) * i / n) * Math.PI / 180; return [cx + rx * Math.cos(t), 0.5 + 0.5 * Math.sin(t)]; });
const TWO: Stroke[] = [[[0.05, 0.2], [0.2, 0.02], [0.4, 0], [0.52, 0.15], [0.5, 0.35], [0.05, 1], [0.58, 1]]];
const GLYPHS: Record<string, Stroke[]> = {
  A: [[[0, 1], [0.3, 0], [0.6, 1]], [[0.13, 0.6], [0.47, 0.6]]],
  B: [[[0, 1], [0, 0], [0.35, 0], [0.5, 0.08], [0.52, 0.25], [0.38, 0.46], [0, 0.47]], [[0.38, 0.46], [0.56, 0.58], [0.58, 0.82], [0.42, 1], [0, 1]]],
  C: [oval(0.3, 0.3, -40, -320)],
  D: [[[0, 0], [0, 1], [0.28, 1], [0.5, 0.85], [0.6, 0.5], [0.5, 0.15], [0.28, 0], [0, 0]]],
  O: [oval(0.3, 0.3, 0, 360)],
  '=': [[[0.05, 0.38], [0.55, 0.38]], [[0.05, 0.66], [0.55, 0.66]]],
  '∠': [[[0.65, 0.15], [0.02, 1], [0.7, 1]]],
  '+': [[[0.3, 0.25], [0.3, 0.85]], [[0.02, 0.55], [0.58, 0.55]]],
  '?': [[[0.05, 0.25], [0.15, 0.05], [0.35, 0], [0.52, 0.1], [0.52, 0.3], [0.3, 0.5], [0.3, 0.7]], [[0.3, 0.92], [0.3, 0.98]]],
  '0': [oval(0.26, 0.24, 0, 360)],
  '1': [[[0.1, 0.2], [0.3, 0], [0.3, 1]]],
  '2': TWO,
  '²': TWO.map(st => st.map(([x, y]) => [x * 0.5, y * 0.5 - 0.1] as [number, number])),
  '3': [[[0.05, 0.1], [0.3, 0], [0.5, 0.12], [0.48, 0.35], [0.25, 0.47], [0.5, 0.58], [0.55, 0.82], [0.35, 1], [0.05, 0.92]]],
  '4': [[[0.45, 1], [0.45, 0], [0, 0.7], [0.6, 0.7]]],
  '5': [[[0.55, 0], [0.1, 0], [0.05, 0.45], [0.35, 0.4], [0.55, 0.6], [0.5, 0.88], [0.3, 1], [0.03, 0.92]]],
  '6': [[[0.5, 0.05], [0.25, 0.1], [0.07, 0.45], [0.05, 0.8], [0.25, 1], [0.5, 0.88], [0.52, 0.62], [0.3, 0.5], [0.07, 0.62]]],
  '7': [[[0.02, 0], [0.58, 0], [0.2, 1]]],
  '8': [[[0.3, 0.47], [0.08, 0.3], [0.12, 0.08], [0.3, 0], [0.48, 0.08], [0.52, 0.3], [0.3, 0.47], [0.06, 0.65], [0.08, 0.92], [0.3, 1], [0.52, 0.92], [0.55, 0.65], [0.3, 0.47]]],
  '9': [[[0.5, 0.4], [0.3, 0.52], [0.08, 0.4], [0.08, 0.12], [0.3, 0], [0.5, 0.12], [0.52, 0.5], [0.4, 1], [0.1, 0.95]]],
};

/** A line in a scrawl from (x, y), its letters h high: a Path, placed by its middle */
function scrawl(uid: string, text: string, x: number, y: number, h: number, color: string) {
  let seed = [...text].reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32 - 0.5; };
  const path: (string | number)[][] = [];
  const xs: number[] = [], ys: number[] = [];
  const at = (cmd: string, px: number, py: number) => {
    const r = (v: number) => Math.round(v * 10) / 10;
    path.push([cmd, r(px), r(py)]); xs.push(px); ys.push(py);
  };
  let cx = x + 0.2 * h;
  for (const ch of text) {
    const g = GLYPHS[ch];
    if (!g) { cx += 0.45 * h; continue; }
    const k = h * (1.05 + 0.45 * rnd()), tilt = 0.45 * rnd(), lift = 0.25 * h * rnd();
    for (const stroke of g) {
      stroke.forEach(([gx, gy], i) => {
        const put = (ux: number, uy: number, shake: number) => {
          const px = cx + (ux + shake * rnd()) * k + (1 - uy) * tilt * k, py = y + lift + (uy + shake * rnd()) * k;
          at(i === 0 && shake > 0.15 ? 'M' : 'L', px, py);
        };
        if (i > 0) { // the mouse wobbles between the points too
          const [px0, py0] = stroke[i - 1];
          put(px0 + (gx - px0) / 3, py0 + (gy - py0) / 3, 0.1);
          put(px0 + (gx - px0) * 2 / 3, py0 + (gy - py0) * 2 / 3, 0.1);
        }
        put(gx, gy, 0.2);
      });
    }
    cx += (Math.max(...g.flat().map(p => p[0])) + 0.25 + 0.2 * rnd()) * k;
  }
  const l = Math.min(...xs), r = Math.max(...xs), t = Math.min(...ys), b = Math.max(...ys);
  return {
    uid, type: 'Path', path, left: (l + r) / 2, top: (t + b) / 2, originX: 'center', originY: 'center',
    fill: '', stroke: color, strokeWidth: Math.max(1.5, h * 0.08), strokeLineCap: 'round', strokeLineJoin: 'round',
  };
}

/** By room, in room order; a room past the end of the list uses the script from the start of it.
 *  Rooms call some time apart, so the teacher can get to each: three on the individual stage, two in pairs, one in fours
 *  (client-teacher/src/demoHints.tsx, CALLS counts on that). */
const SCRIPT: Record<BotStage, RoomScript[]> = {
  // b2 goes by SHEETS; this is for an individual task added during the lesson, room by room
  individual: [
    { lines: lines(['AD = BC', 'AB = CD'], 5, 8), call: {
      at: 27, note: 'А стороны и отрезки — это разве не одно и то же?',
      reply: 'Ещё отрезки: AO, OC, BO, OD' } },
    { lines: lines(OBSERVATIONS.slice(0, 3), 8, 9) },
    { lines: lines(['AD = BC', 'AB = CD', 'угол A и угол C ?'], 3, 4), call: {
      // no reply: the teacher writes it on her board
      at: 12, note: 'Не помню, как записывается равенство углов. Напишите, пожалуйста' } },
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
    { lead: 'Миша', partner: 'Артём', lines: [], dialogue: CHOCOLATE, plan: P1_PLAN, talk: [0.55, 0.5] },
    // П2 «Давай я быстро объясню»: {1} explains with triangles drawn on {2}'s sheet, {2} gets it
    { lines: [], explain: EXPLAIN, talk: [0.6, 0.45] },
    // П3 «Хоть ножницы нарисуй»: vertical angles, a bet on a chocolate bar; they call, and it's a draw
    { lines: [], dialogue: SCISSORS, plan: P3_PLAN, talk: [0.5, 0.5] },
    // П4 «Трёп»: they begin checking and drift off; the teacher may listen in, or come in and set them to work
    { lines: [], chat: CHAT, talk: [0.5, 0.45] },
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
/** The pairs' dialogues fixed to the desks the journal seats them at (null: at random, Миша's desk always P1) */
const FIXED_PAIRS: Partial<Record<Role, [string, string]>> | null = {
  p1: ['Миша', 'Артём'], p2: ['Аня', 'Тимур'], p3: ['Глеб', 'Соня'], p4: ['Лена', 'Вика'],
};

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
  /** more: a further bit of the same stroke (a bot's stroke comes as many short lines) */
  write(room: string, obj: Record<string, unknown> & { uid: string; type: string }, author?: string, more?: boolean): void;
  /** Takes a bot's drawing off the board */
  erase(room: string, uid: string, author?: string): void;
  /** Moves a ✋ object of the sheet in a group's room, as a student dragging it would */
  move(room: string, uid: string, left: number, top: number): void;
  /** «Дай пять»: a bot puts the hand up in its room, a bot taps it */
  five(room: string, name: string): void;
  fiveTap(room: string, name: string): void;
  /** Where someone's earlier sheet lies on their group's board now (index.ts layEarlierSheets); null: it doesn't */
  sheetAt(room: string, name: string): SheetPlace | null;
  /** Who sits with whom: each desk's pair, in seat order */
  deskmates(): string[][];
  /** A bot's whole writing on an earlier block's sheet, instead of its own there if that is less; the teacher's stays */
  pastWrite(name: string, blockId: string, objs: (Record<string, unknown> & { uid: string; type: string })[]): void;
  /** The teacher's drawing on a group's board (the ready answer drawn as it is said) */
  teacherWrite(room: string, obj: Record<string, unknown> & { uid: string; type: string }): void;
  /** A bot talked this long: counted as a real student's microphone would be */
  talk(name: string, ms: number): void;
  /** Names of the bots in a room */
  members(room: string): string[];
  /** says: the question part by part, when two ask it together: each in their own bubble */
  call(room: string, note: string, who?: string, says?: Says): void;
  /** A voiced line begins in a room: the teacher there hears it */
  say(room: string, clip: { src: string; ms: number; who?: string; legs?: SheetPlace | null; next?: string[] }): void;
  /** A bot raises a hand in the explanation */
  raise(name: string): void;
  /** Given the word, a bot says its line to the class */
  speak(name: string, text: string, clip: { src: string; ms: number }): void;
  /** The call is over without a visit: the teacher is in the room already */
  callOff(room: string): void;
  /** The call was answered: its question goes from the teacher's screen */
  callDone(room: string): void;
  /** The teacher may answer now: with the ready answer (its text) or in their own words; null: not any more */
  offerReply(room: string, text: string | null): void;
  /** A bot answers the running poll */
  vote(name: string, choice: number): void;
}

/** The bot's own voice if the clip has it, else another of the same sex, else any */
/** The voiced dialogues, each in the order it is mostly said */
const DIALOGUES: { id: string; who: number | 'T'; ms: Record<string, number> }[][] = [CHAT, TRAP, SIXTH, CHOCOLATE, EXPLAIN, SCISSORS];

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
  private replies = new Map<string, () => void>();
  /** A text-only call's question, voiced: said when the teacher comes to the caller */
  private asks = new Map<string, { line: (typeof ASKS)[number]; who: string }>();
  private roles = new Map<string, { role: Role; who: 1 | 2 }>();
  private sheetRows = new Map<string, { text: string; top: number }[]>(); // name → their b2 sheet's lines
  private marked = new Set<string>(); // room:line whose marks are on the sheets already
  private asking = new Map<string, (ms: number) => void>(); // room → what they show on the board as they ask
  private pairDrawn = new Map<string, string[]>(); // room → what the pair drew from PAIR_BOARD (wiped by `erase`)
  private rowMarks = new Map<string, number>(); // room:owner:row → marks there already, the next one goes left of them
  private listed = new Map<string, number>(); // room → lines of the pair's common list under the sheets
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
  private stage = 'waiting';
  private earlyCalled = false;

  constructor(private host: BotHost, private teacher: TeacherSex = 'f') {}

  /** A teacher's line: the voice it is in */
  private teacherVoice(ms: Record<string, number>) { const v = TEACHER_VOICES[this.teacher]; return ms[v] !== undefined ? v : Object.keys(ms)[0]; }
  /** A line that calls the teacher by name, as it is said to a man; undefined: as written */
  private maleAddress(id: string) { return this.teacher === 'm' ? MALE_ADDRESS[id] : undefined; }
  /** What the teacher reads of a line: the letters as in the textbook (AB, ∠ COD), not as said (а-бэ, цэ-о-дэ) */
  private textOf(l: { id: string; text: string }) { return latinLetters(this.maleAddress(l.id)?.text ?? l.text); }

  private after(ms: number, fn: () => void, set = this.stageTimers) {
    const t = setTimeout(() => { set.delete(t); fn(); }, ms);
    set.add(t);
  }

  private came = false;
  private inRoom: string | null = null; // where the teacher is
  /** The journal is chosen: the class comes in, once */
  comeIn() { if (!this.came) this.seatEveryone(); }

  /** fast (testing): all at once */
  seatEveryone(fast = false) {
    this.came = true;
    ARRIVAL.forEach((name, n) => {
      const i = BOTS.findIndex(b => b.name === name);
      this.after(fast ? 300 + n * 100 : 1200 + n * SEAT_PAUSE_MS, () => this.host.seat(i), this.timers);
    });
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
  /** drawn: the line's own drawing writes it (PAIR_BOARD) */
  private write(room: string, text: string, by?: 1 | 2, drawn = false) {
    const w = this.written.get(room) ?? { n: 0, top: 60 };
    const speaker = /^\{([12])\}: /.exec(text)?.[1];
    const [lead, partner] = this.names.get(room) ?? ['', ''];
    const author = ((by ?? Number(speaker ?? 1)) === 2 ? partner : lead) || undefined;
    if (!speaker && author && this.stage === 'pairs' && this.host.sheetAt(room, author)) { this.listLine(room, this.fill(room, text), author, drawn); return; }
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
    this.asks.clear();
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
    this.marked.clear();
    this.rowMarks.clear();
    this.listed.clear();
    if (stage !== 'individual' && stage !== 'pairs' && stage !== 'fours') return;
    if (stage === 'individual' && blockId === SHEET_BLOCK) { this.sheets(); return; }
    const script = (blockId && BLOCK_SCRIPT[blockId]) || SCRIPT[stage];
    const rooms = this.host.rooms();
    const parts = new Map<string, RoomScript>();
    // pairs: each desk its dialogue, as given out when the lesson began; who is {1} and {2} too
    const fixed = new Map<string, [string, string]>();
    if (script === SCRIPT.pairs) {
      const pairRooms = rooms.map(r => this.host.members(r));
      if (pairRooms.some(ms => ms.some(m => !this.roles.has(m)))) this.assignRoles(true);
      this.pastSheets();
      for (const room of rooms) {
        const ms = this.host.members(room);
        const r = this.roles.get(ms[0] ?? '');
        if (!r || !ms.every(m => this.roles.get(m)?.role === r.role)) continue;
        const one = ms.find(m => this.roles.get(m)!.who === 1) ?? ms[0], two = ms.find(m => m !== one) ?? one;
        parts.set(room, script[PAIR_PART[r.role]]);
        fixed.set(room, [one, two]);
      }
    }
    // a script with a lead goes to that bot's room; the rest, in turn, to the other rooms
    for (const part of script) {
      if ([...parts.values()].includes(part)) continue;
      const room = part.lead && rooms.find(r => !parts.has(r) && this.host.members(r).includes(part.lead!));
      if (room) parts.set(room, part);
    }
    const rest = script.filter(p => ![...parts.values()].includes(p));
    rooms.filter(r => !parts.has(r)).forEach((r, i) => parts.set(r, rest.length ? rest[i % rest.length] : script[i % script.length]));
    rooms.forEach(room => {
      const part = parts.get(room)!;
      const members = this.host.members(room);
      const [lead, partner] = fixed.get(room) ?? (() => {
        const l = part.lead && members.includes(part.lead) ? part.lead : members[0] ?? '';
        // the partner if they sit together; otherwise whoever sits with the lead, so the board matches the pair
        return [l, part.partner && members.includes(part.partner) ? part.partner : members.find(m => m !== l) ?? l];
      })();
      this.names.set(room, [lead, partner]);
      for (const line of part.lines) this.after(line.at * 1000, () => this.write(room, line.text));
      let callAt = part.call?.at;
      if (part.dialogue) {
        this.quietRooms.add(room);
        this.chatter(room, part, [lead, partner]);
        this.talks.set(room, { room, lines: part.dialogue, plan: part.plan ?? P1_PLAN, next: 0, phase: 'a', present: false, greeted: false, busy: false, saying: null, gen: 0, insert: [] });
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
        if (force === 'mm') { range = [8, 29]; this.stand.set(p1, 'zahar'); this.stand.set(p2, 'ermil'); }
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
          if (reply) this.replies.set(room, () => this.write(room, reply));
          this.askCall(room, this.fill(room, note), by ? this.names.get(room)?.[by - 1] : undefined);
        } });
      }
    });
    this.callQueue.sort((a, b) => a.at - b.at);
    this.nextCall();
  }

  // ---------- the sheets of b2, and marks on them in b3 ----------
  /** Who has which part in the pairs, by the desks (Миша's desk: П1). Given out once: the class stays where it sat */
  private assignRoles(again = false) {
    if (this.roles.size && !again) return;
    this.roles.clear();
    const left = (['p2', 'p3', 'p4'] as Role[]).sort(() => Math.random() - 0.5);
    const desks = this.host.deskmates();
    // for now each dialogue at its own desk, as the class sits by the journal, so each can be heard: {1} first
    if (FIXED_PAIRS) {
      const fixed = Object.entries(FIXED_PAIRS) as [Role, [string, string]][];
      const sitting = fixed.filter(([, [x, y]]) => desks.some(d => d.length === 2 && d.includes(x) && d.includes(y)));
      if (sitting.length === fixed.length) {
        for (const [role, [x, y]] of fixed) { this.roles.set(x, { role, who: 1 }); this.roles.set(y, { role, who: 2 }); }
        return;
      }
    }
    for (const desk of desks) {
      if (desk.length !== 2) continue;
      let [a, b] = desk;
      const role: Role | undefined = desk.includes(SOLO_NEWCOMER) ? 'p1' : left.shift();
      if (!role) continue;
      if (b === SOLO_NEWCOMER) [a, b] = [b, a];
      if (role === 'p4' && this.female(b) && !this.female(a)) [a, b] = [b, a]; // the chatter: the girl is {1}
      this.roles.set(a, { role, who: 1 });
      this.roles.set(b, { role, who: 2 });
    }
  }

  private sheetOf(name: string): { sheet: Sheet; messy: boolean } {
    const r = this.roles.get(name);
    const key = r ? `${r.role}-${r.who}` : '';
    return { sheet: SHEETS[key] ?? ANY_SHEET, messy: MESSY.has(key) };
  }
  private messy(name: string) { return this.sheetOf(name).messy && this.roles.has(name); }
  private ink(name: string) { return INKS[Math.max(0, BOTS.findIndex(b => b.name === name)) % INKS.length]; }

  /** One line of a list in the writer's hand: printed, or a scrawl */
  private hand(uid: string, name: string, text: string, x: number, y: number, size: number, color = this.ink(name)) {
    return this.messy(name)
      ? scrawl(uid, text, x, y + size * 0.15, size * 0.8, color)
      : { uid, type: 'IText', text, left: x, top: y, originX: 'left', originY: 'top', fontSize: size, fontFamily: 'sans-serif', fill: color };
  }

  /** b2: each one alone writes their sheet line by line; three ask the teacher something on the way */
  private sheets() {
    this.assignRoles();
    this.sheetRows.clear();
    for (const room of this.host.rooms()) {
      const name = this.host.members(room)[0];
      if (!name) continue;
      this.names.set(room, [name, name]);
      const { sheet } = this.sheetOf(name);
      const put = (text: string) => this.sheetLine(name, text, obj => this.host.write(room, obj, name));
      // drawn by hand in the voice editor: its strokes in their time; the rows still there, for the marks of b3
      const drawn = SHEET_DRAW[this.sheetKey(name)];
      const draw = (list: FourDraw[]) => list.forEach(d => this.after(d.at * 1000, () => this.fourDraw(room, [], d, this.ink(name), name, 1000)));
      if (drawn) { sheet.lines.forEach(t => this.sheetRow(name, t)); draw(drawn.draw); }
      else sheet.lines.forEach((text, i) => this.after((sheet.start + i * sheet.gap) * 1000, () => put(text)));
      if (!sheet.call) continue;
      const { note, reply, later, angles } = sheet.call, at = drawn?.call ?? sheet.call.at;
      this.callQueue.push({ room, at: at * 1000, fire: () => {
        if (angles) this.asking.set(room, ms => this.angleArcs(room, name, ms));
        if (later) { /* the teacher writes it */ }
        else if (drawn) this.replies.set(room, () => { reply?.forEach(t => this.sheetRow(name, t)); draw(drawn.after ?? []); });
        else if (reply) this.replies.set(room, () => reply.forEach((t, i) => this.after(i * 2500, () => put(t))));
        this.askCall(room, note, name);
      } });
    }
    this.callQueue.sort((a, b) => a.at - b.at);
    this.nextCall();
  }

  /** Bold red arcs inside ∠AOB and ∠COD of a sheet from b2 (O(396,456), A(116,568), B(228,344), C(676,344), D(564,568)),
   *  as they are named in a question `ms` long; marks of the moment: not laid on the next stage's board */
  private angleArcs(room: string, name: string, ms: number) {
    const O = [396, 456], r = 52, deg = Math.PI / 180, n = 10;
    ([[158, 214, 0.45], [-22, 34, 0.6]] as const).forEach(([from, to, at]) => {
      const pt = (i: number) => { const a = (from + (to - from) * i / n) * deg; return [O[0] + r * Math.cos(a), O[1] + r * Math.sin(a)]; };
      for (let i = 0; i < n; i++) this.after(at * ms + i * 40, () => {
        const [x1, y1] = pt(i), [x2, y2] = pt(i + 1);
        this.host.write(room, { uid: `mark-${room}-${this.uid++}`, type: 'Line', x1, y1, x2, y2, left: (x1 + x2) / 2, top: (y1 + y2) / 2,
          originX: 'center', originY: 'center', stroke: '#e03131', strokeWidth: 10, strokeLineCap: 'round' }, name, i > 0);
      });
    });
  }

  private sheetKey(name: string) { const r = this.roles.get(name); return r ? `${r.role}-${r.who}` : ''; }
  /** A row of someone's sheet that is drawn by hand: only where it is, for the marks */
  private sheetRow(name: string, text: string) {
    const rows = this.sheetRows.get(name) ?? [];
    rows.push({ text, top: SHEET_TOP + rows.length * SHEET_ROW });
    this.sheetRows.set(name, rows);
  }

  /** The next line down someone's sheet */
  private sheetLine(name: string, text: string, put: (obj: Record<string, unknown> & { uid: string; type: string }) => void) {
    const rows = this.sheetRows.get(name) ?? [];
    const top = SHEET_TOP + rows.length * SHEET_ROW;
    put(this.hand(`bot-${name}-${this.uid++}`, name, text, SHEET_LEFT, top, SHEET_FONT));
    rows.push({ text, top });
    this.sheetRows.set(name, rows);
  }

  /** The sheets of b2 as they would have been, for those with less on them: the teacher skipped it, left it early, went
   *  back to it (it begins anew) and came out again, or a test began at b3 */
  private pastSheets() {
    for (const [name] of this.roles) {
      const { sheet } = this.sheetOf(name);
      const drawn = SHEET_DRAW[this.sheetKey(name)];
      const lines = [...sheet.lines, ...sheet.call?.reply ?? []];
      const objs = new Map<string, Record<string, unknown> & { uid: string; type: string }>(); // a stroke may come in several versions
      const put = (obj: Record<string, unknown> & { uid: string; type: string }) => { objs.set(obj.uid, obj); };
      this.sheetRows.delete(name);
      if (drawn) {
        for (const t of lines) this.sheetRow(name, t);
        for (const d of [...drawn.draw, ...drawn.after ?? []]) this.fourDraw('', [], d, this.ink(name), name, 0, put);
      } else for (const text of lines) this.sheetLine(name, text, put);
      this.host.pastWrite(name, SHEET_BLOCK, [...objs.values()]);
    }
  }

  /** A line is being said in a pair: the marks that go with it, on the sheets */
  private sheetMarks(room: string, id: string, ms: number) {
    const marks = HAND_MARKS.has(id.slice(0, id.indexOf('-'))) ? undefined : SHEET_MARKS[id.replace(/f$/, '')];
    if (!marks || this.marked.has(`${room}:${id}`)) return;
    this.marked.add(`${room}:${id}`);
    const names = this.names.get(room) ?? ['', ''];
    const rowMarks = this.rowMarks;
    for (const m of marks) this.after(m.at * ms, () => {
      const owner = names[m.on - 1], by = names[m.by - 1];
      const at = this.host.sheetAt(room, owner);
      if (!owner || !at) return;
      const X = (x: number) => at.x + x * at.s, Y = (y: number) => at.y + y * at.s;
      const rows = this.sheetRows.get(owner) ?? [];
      const uid = `bot-${room}-${this.uid++}`;
      if (m.add) {
        const top = SHEET_TOP + rows.length * SHEET_ROW;
        rows.push({ text: m.add, top });
        this.sheetRows.set(owner, rows);
        const obj = this.hand(uid, by, m.add, X(SHEET_LEFT), Y(top), SHEET_FONT * at.s);
        this.host.write(room, obj, by);
        return;
      }
      const row = rows[m.row ?? -1];
      if (!row) return;
      const mid = Y(row.top + SHEET_FONT * 0.6);
      if (m.strike) {
        const x1 = X(SHEET_LEFT - 10), x2 = X(SHEET_LEFT + row.text.length * SHEET_FONT * 0.6 + 10);
        this.host.write(room, { uid, type: 'Line', x1, y1: mid, x2, y2: mid, left: (x1 + x2) / 2, top: mid, originX: 'center', originY: 'center',
          stroke: STRIKE_COLOR, strokeWidth: 4, strokeLineCap: 'round' }, by);
      } else if (m.mark) {
        const k = `${room}:${owner}:${m.row}`, n = rowMarks.get(k) ?? 0;
        rowMarks.set(k, n + 1);
        this.host.write(room, { uid, type: 'IText', text: m.mark, left: X(SHEET_LEFT - 40 - n * 44), top: mid, originX: 'center', originY: 'center',
          fontSize: 50 * at.s, fontWeight: 'bold', fontFamily: 'sans-serif', fill: MARK_COLOR[m.mark] }, by);
      }
    });
  }

  /** A pair's line drawn as it is said (PAIR_BOARD, from the voice editor), once. Drawn with the first one's sheet on
   *  the left: if it lies on the right here, the two halves change places */
  private pairBoard(room: string, said: DialogueLine, ms: number) {
    const b = PAIR_BOARD[said.id.replace(/f$/, '')];
    if (!b || this.marked.has(`${room}:${said.id}:board`)) return;
    this.marked.add(`${room}:${said.id}:board`);
    const names = this.names.get(room) ?? ['', ''];
    const onBoard = this.pairDrawn.get(room) ?? [];
    this.pairDrawn.set(room, onBoard);
    const who = said.who === 'T' ? '' : names[said.who - 1];
    if (b.erase) onBoard.splice(0).forEach((uid, i) => this.after(i * ERASE_MS, () => this.host.erase(room, uid, who || names[0])));
    const swap = (this.host.sheetAt(room, names[0])?.x ?? 0) > 0;
    const x = (v: number) => swap ? (v < 800 ? v + 800 : v - 800) : v;
    const map = (p: Pt): Pt => [x(p[0]), p[1]];
    const color = said.who === 'T' ? TEACHER_COLOR : COLORS[said.who - 1];
    for (const d of b.draw ?? []) {
      const m: FourDraw = { ...d, path: d.path?.map(map), dot: d.dot && map(d.dot), label: d.label && { ...d.label, at: map(d.label.at) }, text: d.text && { ...d.text, at: map(d.text.at) } };
      this.after(d.at * ms, () => this.fourDraw(room, onBoard, m, color, who, ms));
    }
  }

  /** Is the pair's common list written by hand in this dialogue (voice editor: a line that writes has its drawing)?
   *  Then none of it in print: the print would lie over the hand, or a line of it go where the hand writes another */
  private drawnLine(id: string) { return HAND_LISTS.has(id.slice(0, id.indexOf('-'))); }

  /** The pair's common list, under the sheets: down a column, then the next one */
  private listLine(room: string, text: string, author: string, drawn = false) {
    const n = this.listed.get(room) ?? 0;
    this.listed.set(room, n + 1);
    const lead = this.names.get(room)?.[0] ?? author;
    // written by hand in the voice editor (the line's drawing): that is on the board already, the print would lie over it
    if (drawn) return;
    if (n === 0) this.host.write(room, { uid: `bot-${room}-${this.uid++}`, type: 'IText', text: 'Общий список', left: 40, top: 472,
      originX: 'left', originY: 'top', fontSize: 24, fontFamily: 'sans-serif', fill: '#64748b' }, lead);
    const col = Math.floor(n / 5), row = n % 5;
    this.host.write(room, this.hand(`bot-${room}-${this.uid++}`, author, text, 40 + col * 420, 510 + row * 76, 44), author);
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

  /** The next lines of the dialogue this clip is in, as they will be heard: the teacher's page fetches them
   *  ahead, or on a slow line each pause grows by its sound's loading (client-teacher DemoVoice.tsx) */
  private nextClips(room: string, id: string): string[] {
    const list = DIALOGUES.find(l => l.some(x => x.id === id));
    if (!list) return [];
    const i = list.findIndex(x => x.id === id), names = this.fours.get(room)?.names ?? this.names.get(room) ?? [];
    return list.slice(i + 1, i + 4).map(l => {
      const v = l.who === 'T' ? this.teacherVoice(l.ms) : voiceFor(names[l.who - 1] ?? '', l.ms, this.stand);
      return `/demo/voice/${l.id}${this.maleAddress(l.id) ? 'n' : ''}-${v}.mp3`;
    });
  }

  /** One says a clip: heard by the teacher in the room, counted as talk while it lasts; how long it is */
  private voice(room: string, who: string, id: string, lengths: Record<string, number>): number {
    const v = voiceFor(who, lengths, this.stand);
    const m = this.maleAddress(id), ms = m?.ms[v] ?? lengths[v];
    this.host.say(room, { src: `/demo/voice/${id}${m?.ms[v] ? 'n' : ''}-${v}.mp3`, ms, who, legs: this.legs(room), next: this.nextClips(room, id) });
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
      this.after(t, () => { this.voice(room, who, line.id, line.ms); this.sheetMarks(room, line.id, line.ms[v]); });
      t += line.ms[v];
      if (line.write) { const text = line.write, by = line.who, drawn = this.drawnLine(line.id); this.after(t, () => this.write(room, text, by, drawn)); }
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
    if (this.inRoom === room) this.inRoom = null;
    this.talkLeft(room);
    this.trapLeft(room);
    this.explainLeft(room);
    if (!this.calling || this.calling.room !== room || !this.calling.visited) return;
    this.calling = null;
    this.nextCall(NEXT_CALL_GAP_MS);
  }

  /** A call whose question is not part of a voiced dialogue: the caller says it aloud when the teacher comes */
  private askCall(room: string, note: string, who?: string) {
    const line = ASKS.find(a => a.text === note);
    const by = who ?? this.names.get(room)?.[0];
    if (line && by) this.asks.set(room, { line, who: by });
    this.host.call(room, note, who, line && by ? [{ who: by, text: note, ids: [line.id] }] : undefined);
  }

  /** The teacher came to a room that called: they take the hint and write the fix */
  onVisit(room: string) {
    // before the lesson the one at the desk apart says who he is
    this.inRoom = room;
    if (this.stage === 'waiting' && room.endsWith(`:individual-${SOLO_NEWCOMER}`)) {
      this.after(ARRIVE_MS, () => {
        if (this.inRoom !== room) return;
        this.host.call(room, NEWCOMER_LINE.text, SOLO_NEWCOMER, [{ who: SOLO_NEWCOMER, text: NEWCOMER_LINE.text, ids: [NEWCOMER_LINE.id] }]); // the bubble by his tile, no bell
        this.host.callOff(room);
        this.voice(room, SOLO_NEWCOMER, NEWCOMER_LINE.id, NEWCOMER_LINE.ms);
      });
    }
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
        this.host.callDone(room);
        const took = this.speak(room, rest);
        this.after(took + 1500, () => this.quietRooms.delete(room)); // and back to their usual talk
      });
    }
    // the question, aloud, as the teacher's page opens; the fix once it is said and heard
    const ask = this.asks.get(room);
    let replyAt = VISIT_REPLY_MS;
    if (ask) {
      this.asks.delete(room);
      const marks = this.asking.get(room);
      this.asking.delete(room);
      this.after(ARRIVE_MS, () => { const ms = this.voice(room, ask.who, ask.line.id, ask.line.ms); marks?.(ms); });
      replyAt = Math.max(VISIT_REPLY_MS, ARRIVE_MS + (ask.line.ms[VOICE_OF[ask.who]] ?? 5000) + 2500);
    }
    const reply = this.replies.get(room);
    if (!reply) { if (ask) this.after(replyAt, () => this.host.callDone(room)); return; }
    this.replies.delete(room);
    this.after(replyAt, () => { this.host.callDone(room); reply(); });
  }

  // ---------- a dialogue that listens (Talk) ----------
  private id1(t: Talk, id: string) { return t.lines.find(l => l.id === id)!; }

  /** Says the next line if none is being said */
  private step(room: string) {
    const t = this.talks.get(room);
    if (!t || t.busy) return;
    const P = t.plan;
    const at = (id: string) => t.lines.findIndex(l => l.id === id);
    const ask = (ids: string[]) => {
      // asked in the room: the question shows in the teacher's panel as a call would
      const said = ids.map(id => this.id1(t, id));
      this.host.call(room, said.map(l => this.textOf(l)).join(' '), this.names.get(room)?.[said[0].who === 2 ? 1 : 0], this.saysOf(room, said));
      this.host.callOff(room);
      t.next = at(P.after);
      t.phase = 'asked';
      t.insert.push(...said.slice(1));
      return said[0];
    };
    let line = t.insert.shift();
    if (!line) {
      if (t.phase === 'a') {
        while (t.lines[t.next]?.id.endsWith('f')) t.next++; // a variant said to a girl: not a line of its own
        const cur = t.lines[t.next];
        // the teacher is here: asked straight away, no call
        if (cur?.id === P.cut && t.present) line = ask(P.direct);
        // came in just as they were about to call: they ask right away
        else if (cur?.id === P.call[0] && t.present) line = ask(P.call);
        else if (cur?.id === P.call[0]) {
          // they call: the bell waits its turn among the other rooms'
          t.next = at(P.after);
          t.phase = 'calling';
          this.requestCall(room, this.callNote(t), P.callBy, this.callSays(t));
          return;
        } else { line = cur; t.next++; }
      } else if (t.phase === 'b') {
        while (t.lines[t.next]?.id.endsWith('f')) t.next++; // a variant said to a girl: not a line of its own
        line = t.lines[t.next];
        if (!line || t.next > at(P.last)) { t.phase = 'done'; return; } // the dialogue is over: they stay quiet
        t.next++;
      } else return;
      // «Ты говорил / говорила», «не прав / права»: as the other one is
      if (line && line.id === P.toOther && this.female(this.names.get(room)?.[line.who === 1 ? 1 : 0] ?? '')) line = this.id1(t, `${P.toOther}f`);
    }
    if (!line) return;
    const said = line;
    t.busy = true;
    t.saying = said;
    const ms = this.sayLine(room, said);
    this.sheetMarks(room, said.id, ms);
    this.pairBoard(room, said, ms);
    const gen = t.gen;
    this.after(ms, () => {
      if (t.gen !== gen) return; // broken off
      t.busy = false;
      if (said.write && said.who !== 'T') said.write.split('|').forEach((w, i) => this.after(i * 700, () => this.write(room, w, said.who as 1 | 2, this.drawnLine(said.id))));
      // asked: the teacher may answer once the question is out
      const asked = [P.direct[P.direct.length - 1], P.call[P.call.length - 1]];
      if (t.phase === 'asked' && !t.insert.length && asked.includes(said.id)) { t.phase = 'b'; t.insert.push(this.id1(t, P.ta)); this.after(THINK_MS, () => this.host.callDone(room)); }
      const next = t.insert[0]?.id;
      this.after(next === P.greet ? GREET_GAP_MS : said.gap ?? (next === P.ta ? THINK_MS : said.id === P.ta ? PONDER_MS : LINE_GAP_MS), () => this.step(room));
    });
  }

  /** A question said by turns: who says what */
  private saysOf(room: string, lines: DialogueLine[]): Says {
    const says: Says = [];
    for (const l of lines) {
      const who = this.names.get(room)?.[l.who === 2 ? 1 : 0] ?? '', last = says[says.length - 1];
      if (last?.who === who) { last.text += ` ${this.textOf(l)}`; last.ids?.push(l.id); } else says.push({ who, text: this.textOf(l), ids: [l.id] });
    }
    return says;
  }
  private callSays(t: Talk) { return this.saysOf(t.room, t.plan.call.map(id => this.id1(t, id))); }
  /** What a call says, by the caller's tile */
  private callNote(t: Talk) { return t.plan.call.map(id => this.textOf(this.id1(t, id))).join(' '); }

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
    this.sheetMarks(room, said.id, ms);
    this.pairBoard(room, said, ms);
    const draws = EXPLAIN_OLD ? EXPLAIN_DRAW[said.id.replace(/f$/, '')] : undefined;
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
        const m = left.find(n => BASE_VOICE_OF[n] === voiceOf(who)) ?? left.find(n => this.female(n) === FEMALE_VOICES.has(voiceOf(who) ?? '')) ?? left[0] ?? '';
        names[who - 1] = m;
        left = left.filter(n => n !== m);
      }
      return names;
    }
    let left = members.filter(m => m !== names[3]);
    for (const who of [1, 2, 3]) {
      const m = left.find(n => BASE_VOICE_OF[n] === voiceOf(who)) ?? left.find(n => this.female(n) === FEMALE_VOICES.has(voiceOf(who) ?? '')) ?? left[0] ?? '';
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
    for (const d of FOUR_DRAW[line.id] ?? []) this.after(d.at * ms, () => this.fourDraw(room, f.onBoard, d, COLORS[(line.who - 1) % COLORS.length], who, ms));
    const move = FOUR_MOVES[line.id];
    if (move) this.after(ms * 0.8, () => this.host.move(room, CARD_UID[move[0] - 1], move[1][0], move[1][1]));
    if (line.id === 'c2-29') {
      // «Дайте пятюню!»: the hand is up, the others tap it one after another
      this.after(ms * 0.6, () => this.host.five(room, who));
      f.names.filter(n => n && n !== who).forEach((n, i) => this.after(ms + 500 + i * FIVE_TAP_MS + Math.random() * 300, () => this.host.fiveTap(room, n)));
    }
    const gap = line.gap ?? (line.id === 'c2-29' ? 3 * FIVE_TAP_MS + 2500 : LINE_GAP_MS);
    this.after(ms + gap, () => this.fourStep(room));
  }

  /** author '' — the teacher draws it */
  /** ms: the length the times are shares of (0: all at once); past: put there as if done earlier, not now */
  /** The strokes the eraser will reach, by `${room}|${key}`: their objects put so far; null: rubbed out already */
  private keyed = new Map<string, string[] | null>();

  private fourDraw(room: string, onBoard: string[], d: FourDraw, color: string, author: string, ms: number, past?: (obj: Record<string, unknown> & { uid: string; type: string }) => void) {
    if (d.color) color = d.color;
    // the eraser: the stroke it reaches goes, every bit of it put so far (and any put later)
    const keyed = `${room || author}|${d.key ?? d.rub}`;
    if (d.rub) {
      if (past) return;
      for (const u of this.keyed.get(keyed) ?? []) { const k = onBoard.indexOf(u); if (k >= 0) onBoard.splice(k, 1); this.host.erase(room, u, author || undefined); }
      this.keyed.set(keyed, null);
      return;
    }
    if (d.key) this.keyed.set(keyed, []);
    const uid = () => {
      const u = `bot-${room || author}-${this.uid++}`; onBoard.push(u);
      if (d.key) { const list = this.keyed.get(keyed); if (list) list.push(u); else { onBoard.pop(); return ''; } }
      return u;
    };
    const put = (obj: Record<string, unknown> & { uid: string; type: string }, more = false) => { if (!obj.uid) return; if (past) past(obj); else if (author) this.host.write(room, obj, author, more); else this.host.teacherWrite(room, obj); };
    const later = (t: number, f: () => void) => past ? f() : this.after(t, f);
    if (d.dot) put({ uid: uid(), type: 'Circle', radius: 7, left: d.dot[0], top: d.dot[1], originX: 'center', originY: 'center', fill: color, stroke: color, strokeWidth: 1 });
    if (d.path) d.path.slice(1).forEach((p, i) => later(d.ts ? (d.ts[i + 1] - d.at) * ms : i * SEGMENT_MS, () => {
      const [a, b] = [d.path![i], p];
      put({
        uid: uid(), type: 'Line', x1: a[0], y1: a[1], x2: b[0], y2: b[1], left: (a[0] + b[0]) / 2, top: (a[1] + b[1]) / 2,
        originX: 'center', originY: 'center', stroke: d.thin && !d.color ? '#adb5bd' : color, strokeWidth: d.thin ? 2 : d.ws ? (d.ws[i] + d.ws[i + 1]) / 2 : 5, strokeLineCap: 'round',
      }, i > 0);
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
      } else if (t.phase === 'a' || t.phase === 'b') {
        line = cur; t.next++;
        while (t.lines[t.next]?.id.endsWith('f')) t.next++; // a variant said to a girl: not a line of its own
        // «Ты был прав / Ты была права»: as Сомневающийся is
        if (line.id === 'c1-22' && this.female(t.names[1])) line = this.trapLine(t, 'c1-22f');
      }
      else return;
    }
    const said = line;
    t.busy = true;
    const who = said.who === 'T' ? '' : t.names[said.who - 1];
    let ms: number;
    if (said.who === 'T') {
      const v = this.teacherVoice(said.ms);
      ms = said.ms[v];
      this.host.say(room, { src: `/demo/voice/${said.id}-${v}.mp3`, ms, who: 'Teacher' });
    } else ms = this.voice(room, who, said.id, said.ms);
    if (said.id === 'c1-39') {
      // asked in the room: the question shows in the teacher's panel as a call would
      this.host.call(room, this.textOf(said), t.names[0], [{ who: t.names[0], text: this.textOf(said), ids: [said.id] }]);
      this.host.callOff(room);
    }
    if (FOUR_ERASE.has(said.id)) t.onBoard.splice(0).forEach((uid, i) => this.after(i * ERASE_MS, () => this.host.erase(room, uid, who || t.names[0])));
    const color = said.who === 'T' ? TEACHER_COLOR : COLORS[(said.who - 1) % COLORS.length];
    for (const d of FOUR_DRAW[said.id] ?? []) this.after(d.at * ms, () => this.fourDraw(room, t.onBoard, d, color, who, ms));
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
        this.requestCall(room, this.trapLine(t, 'c1-19').text, 1, [{ who: t.names[0], text: this.trapLine(t, 'c1-19').text, ids: ['c1-19'] }]);
        return;
      }
      if (t.phase === 'asked' && (said.id === 'c1-19' || said.id === 'c1-39')) {
        // asked: the teacher's ready answer, drawn as it is said, and on they go
        t.phase = 'b';
        this.after(THINK_MS, () => this.host.callDone(room));
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
    // gone before the answer: the teacher came on their call, that's an answer; on they go (said 27.11)
    t.insert = [];
    t.phase = 'b';
    this.host.callDone(room);
    this.after(THINK_MS, () => this.trapStep(room));
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
    this.sheetMarks(room, line.id, ms);
    this.pairBoard(room, line, ms);
    this.after(ms, () => {
      c.busy = false;
      if (line.write && line.who !== 'T') {
        const by = line.who;
        line.write.split('; ').forEach((w, i) => this.after(i * CHAT_WRITE_MS, () => this.write(room, w, by, this.drawnLine(line.id))));
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
    // on {2}'s sheet from b2 (a quarter of the board), else on the board's own figure
    const at = this.host.sheetAt(room, this.names.get(room)?.[1] ?? '') ?? { x: 0, y: 0, s: 1 };
    const k = Math.min(1, at.s * 1.4); // lines and letters a little bolder than the sheet shrunk
    const px = ([x, y]: Pt) => ({ x: at.x + at.s * (116 + 56 * x), y: at.y + at.s * (568 - 56 * y) }); // the figure's cells: A is (0, 0), a cell is 56
    const line = (a: { x: number; y: number }, b: { x: number; y: number }, w0 = 5) => { const w = w0 * k; this.host.write(room, {
      uid: uid(), type: 'Line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, left: (a.x + b.x) / 2, top: (a.y + b.y) / 2,
      originX: 'center', originY: 'center', stroke: color, strokeWidth: w, strokeLineCap: 'round',
    }, author); };
    if (d.path) d.path.slice(1).forEach((p, i) => this.after(i * SEGMENT_MS, () => line(px(d.path![i]), px(p))));
    if (d.angle) {
      // a right-angle mark: a small square in the corner
      const [c, a, b] = d.angle.map(px), s = 16 * at.s;
      const u = (p: { x: number; y: number }) => { const l = Math.hypot(p.x - c.x, p.y - c.y); return { x: (p.x - c.x) / l * s, y: (p.y - c.y) / l * s }; };
      const ua = u(a), ub = u(b);
      const p1 = { x: c.x + ua.x, y: c.y + ua.y }, p2 = { x: c.x + ua.x + ub.x, y: c.y + ua.y + ub.y }, p3 = { x: c.x + ub.x, y: c.y + ub.y };
      line(p1, p2, 3); line(p2, p3, 3);
    }
    if (d.ticks) {
      // equal segments: short strokes across the middle, one or two
      for (const [from, to, n] of d.ticks) {
        const a = px(from), b = px(to), l = Math.hypot(b.x - a.x, b.y - a.y);
        const ux = (b.x - a.x) / l, uy = (b.y - a.y) / l, m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, h = 11 * at.s;
        for (let j = 0; j < n; j++) {
          const off = (j - (n - 1) / 2) * 9 * at.s, c = { x: m.x + ux * off, y: m.y + uy * off };
          line({ x: c.x - uy * h, y: c.y + ux * h }, { x: c.x + uy * h, y: c.y - ux * h }, 3);
        }
      }
    }
    if (d.fill) {
      const pts = d.fill.map(px);
      const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
      this.host.write(room, {
        uid: uid(), type: 'Polygon', points: pts, left: (Math.min(...xs) + Math.max(...xs)) / 2, top: (Math.min(...ys) + Math.max(...ys)) / 2,
        originX: 'center', originY: 'center', fill: color + '40', stroke: color, strokeWidth: 3 * k,
      }, author);
    }
    if (d.label) {
      const p = px(d.label.at);
      this.host.write(room, {
        uid: uid(), type: 'IText', text: d.label.text, left: p.x, top: p.y,
        originX: 'center', originY: 'center', fontSize: 30 * k, fontWeight: 'bold', fontFamily: 'sans-serif', fill: color,
      }, author);
    }
  }

  /** Миша's pair: where the other one's sheet lies (the right one, with no legs drawn on it), for the pale legs over it (client-teacher demoLegs.tsx) */
  private legs(room: string): SheetPlace | null | undefined {
    return this.talks.get(room)?.plan.legs ? this.host.sheetAt(room, this.names.get(room)?.[1] ?? '') : undefined;
  }

  /** One line out loud: a student's counted as talk; how long it takes */
  private sayLine(room: string, line: DialogueLine): number {
    if (line.who === 'T') {
      const v = this.teacherVoice(line.ms);
      this.host.say(room, { src: `/demo/voice/${line.id}-${v}.mp3`, ms: line.ms[v], who: 'Teacher', legs: this.legs(room), next: this.nextClips(room, line.id) });
      return line.ms[v];
    }
    const who = this.names.get(room)?.[line.who - 1] ?? '';
    return this.voice(room, who, line.id, line.ms);
  }

  private requestCall(room: string, note: string, by: 1 | 2, says?: Says) {
    this.callQueue.push({ room, at: Date.now() - this.stageStart, fire: () => this.host.call(room, note, this.names.get(room)?.[by - 1], says) });
    if (!this.calling && !this.callPending) this.nextCall();
  }

  private talkVisited(room: string) {
    const t = this.talks.get(room);
    if (!t) return;
    t.present = true;
    if (t.phase === 'a' && !t.greeted) {
      t.greeted = true;
      // the line going on is finished, then hello at once
      t.insert.push(this.id1(t, t.plan.greet));
    }
    else if (t.phase === 'calling') {
      // came on the call: «Какой у вас вопрос?» — and the partner asks it
      t.phase = 'asked';
      t.insert.push(this.id1(t, t.plan.tq), ...t.plan.call.map(id => this.id1(t, id)));
    }
    // a moment for the teacher's page to get into the room: what's said for them is heard from its start
    this.after(ARRIVE_MS, () => this.step(room));
  }

  private talkLeft(room: string) {
    const t = this.talks.get(room);
    if (!t) return;
    t.present = false;
    if (t.phase !== 'asked') return;
    // gone before a word of answer: the teacher came on their call, that's an answer; on they go (said 27.11)
    t.insert = [];
    this.onReply(room, false);
  }

  /** The teacher answered: with the ready answer, said in the teacher's voice, or in their own words */
  onReply(room: string, ready: boolean) {
    const t = this.talks.get(room);
    if (!t || t.phase !== 'asked') return;
    this.host.offerReply(room, null);
    this.host.callDone(room);
    t.phase = 'b';
    if (ready) t.insert.push(this.id1(t, t.plan.ta));
    this.after(ready ? 300 : 1500, () => this.step(room));
  }

  private polls = 0;
  /** A poll began: each bot answers in its own time, a few quick, a few slow */
  /** The explanation of b9: a hand goes up a moment after it starts; the next one only when the one before has said its line
   *  (raised once: not again on coming back) */
  private raiseHands(stage: string, blockId?: string | null) {
    const first = HANDS[blockId ?? '']?.[0];
    if (stage !== 'group' || !first || this.handsRaised.has(first.id)) return;
    this.after(HAND_FIRST_MS, () => this.raiseHand(first), this.stageTimers);
  }

  private raiseHand(l: { who: string; id: string }) {
    this.handsRaised.add(l.id);
    this.host.raise(l.who);
  }

  /** The teacher gave the word: a bot with a line says it; when it is over, the next hand of that block goes up */
  onFloor(name: string) {
    const lines = Object.values(HANDS).find(ls => ls.some(l => l.who === name));
    const line = lines?.find(l => l.who === name);
    if (!lines || !line) return;
    const v = voiceFor(name, { [VOICE_OF[name] ?? 'kirill']: line.ms });
    this.host.speak(name, line.text, { src: `/demo/voice/${line.id}-${v}.mp3`, ms: line.ms });
    for (let d = 0; d < line.ms; d += TALK_TICK_MS) this.after(d, () => this.host.talk(name, Math.min(TALK_TICK_MS, line.ms - d)));
    const next = lines.find(l => !this.handsRaised.has(l.id));
    if (next) this.after(line.ms + HAND_GAP_MS, () => this.raiseHand(next), this.stageTimers);
  }

  onPoll(options: number) {
    const answers = POLL_ANSWERS[Math.min(this.polls++, POLL_ANSWERS.length - 1)];
    const order = [...BOTS].sort(() => Math.random() - 0.5);
    order.forEach((b, i) => {
      // all in within the demo poll's 20 s (about 16 s at most); the last one keeps them waiting
      const at = 1500 + i * 1500 + Math.random() * 1500 + (i === order.length - 1 ? 2500 : 0);
      this.after(at, () => this.host.vote(b.name, Math.min(answers[b.name] ?? 0, options - 1)));
    });
  }

  stop() {
    for (const t of [...this.timers, ...this.stageTimers]) clearTimeout(t);
    this.timers.clear();
    this.stageTimers.clear();
  }
}

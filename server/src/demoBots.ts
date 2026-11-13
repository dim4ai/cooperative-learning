// The solo demo: a teacher with nobody to gather tries the lesson on simulated students. Bots have
// no sockets and no media; all they do is sit down, write on boards and call the teacher, on a
// script tied to the sample lesson (client-teacher/public/demo/parallelogram.colesson).

import { CHATTER, DISPUTE_PAIR, FEMALE_VOICES, LOPSIDED_PAIR, VOICE_OF, type SpokenLine } from './demoDialogue';

export type BotStage = 'individual' | 'pairs' | 'fours';
export const BOTS = [
  { name: 'Аня', avatar: 'fox' }, { name: 'Миша', avatar: 'bear' },
  { name: 'Лена', avatar: 'owl' }, { name: 'Тимур', avatar: 'tiger' },
  { name: 'Соня', avatar: 'rabbit' }, { name: 'Артём', avatar: 'penguin' },
  { name: 'Вика', avatar: 'cat' }, { name: 'Глеб', avatar: 'hedgehog' },
];

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
interface RoomScript { lines: Line[]; call?: Call; lead?: string; partner?: string; talk?: number[]; quietAfter?: number; spoken?: SpokenLine[]; later?: boolean }

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
    { lines: lines(OBSERVATIONS, 4, 6), talk: [0.55, 0.5] },
    // what the pair said before calling, written down at once: only so the teacher feels how it comes to a call
    { lead: 'Миша', partner: 'Артём', lines: [], spoken: DISPUTE_PAIR, talk: [0.55, 0.5], call: {
      at: 0, by: 2, note: 'Мы спорим: я думаю, что AB = AO — на чертеже они похожи, а {1} говорит, что не равны. Кто прав?' } },
    // one does all the talking and the writing, the other hardly gets a word in: heard on coming in
    { lines: [], spoken: LOPSIDED_PAIR, later: true },
    { lead: 'Тимур', talk: [0.5, 0.45], lines: lines([
      '{1}: AO = OC',
      '{2}: BO = OD',
      '{1}: ∠AOB = ∠COD',
      '{2}: это же вертикальные углы,\nони всегда равны',
      '{1}: ну и что, они же есть\nв параллелограмме',
      '{2}: не знаю, давай спросим',
      '{1}: давай',
    ], 38, 0), call: {
      at: 45, by: 1, note: 'Мы спорим, можно ли брать вертикальные углы при пересечении диагоналей. Я думаю, что ∠AOB = ∠COD можно записать, а {2} говорит, что это не свойство параллелограмма. Кто прав?' } },
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
    { lines: lines(['1 — да', '2 — да', '3 — да?', '4 — да'], 5, 7), talk: [0.5, 0.45, 0.35, 0.2], call: {
      at: 30, note: 'Карточка 3: AB ∥ CD и BC = AD. Мы положили в «Да, точно», а {2} говорит, что это может быть трапеция. Кто прав?' } },
    { lines: lines(['1 — да', '4 — да', '5 — не обязательно', '6 — ?'], 6, 8), talk: [0.45, 0.4, 0.3, 0.3] },
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
  /** A bot talked this long: counted as a real student's microphone would be */
  talk(name: string, ms: number): void;
  /** Names of the bots in a room */
  members(room: string): string[];
  call(room: string, note: string, who?: string): void;
  /** A voiced line begins in a room: the teacher there hears it */
  say(room: string, clip: { src: string; ms: number }): void;
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

export class BotRun {
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

  constructor(private host: BotHost) {}

  private after(ms: number, fn: () => void, set = this.stageTimers) {
    const t = setTimeout(() => { set.delete(t); fn(); }, ms);
    set.add(t);
  }

  seatEveryone() {
    BOTS.forEach((_, i) => this.after(1600 + i * SEAT_PAUSE_MS, () => this.host.seat(i), this.timers));
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
    this.stageStart = Date.now();
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
      if (part.spoken?.length && part.later) {
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
    this.after(1500 + Math.random() * 2000, tick);
  }

  /** One says a clip: heard by the teacher in the room, counted as talk while it lasts; how long it is */
  private voice(room: string, who: string, id: string, lengths: Record<string, number>): number {
    const v = voiceFor(who, lengths, this.stand);
    const ms = lengths[v];
    this.host.say(room, { src: `/demo/voice/${id}-${v}.mp3`, ms });
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
    this.after(due, () => { this.calling = { room: next.room, visited: false }; next.fire(); });
  }

  /** The teacher left a room: if it was the one that called, the next one may call after a breath */
  onLeave(room: string) {
    if (!this.calling || this.calling.room !== room || !this.calling.visited) return;
    this.calling = null;
    this.nextCall(NEXT_CALL_GAP_MS);
  }

  /** The teacher came to a room that called: they take the hint and write the fix */
  onVisit(room: string) {
    if (this.calling?.room === room) this.calling.visited = true;
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

  private polls = 0;
  /** A poll began: each bot answers in its own time, a few quick, a few slow */
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

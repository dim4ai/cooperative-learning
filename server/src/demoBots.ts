// The solo demo: a teacher with nobody to gather tries the lesson on simulated students. Bots have
// no sockets and no media; all they do is sit down, write on boards and call the teacher, on a
// script tied to the sample lesson (client-teacher/public/demo/parallelogram.colesson).

export type BotStage = 'individual' | 'pairs' | 'fours';
export const BOTS = [
  { name: 'Аня', avatar: 'fox' }, { name: 'Миша', avatar: 'bear' },
  { name: 'Лена', avatar: 'owl' }, { name: 'Тимур', avatar: 'tiger' },
  { name: 'Соня', avatar: 'rabbit' }, { name: 'Артём', avatar: 'penguin' },
  { name: 'Вика', avatar: 'cat' }, { name: 'Глеб', avatar: 'hedgehog' },
];

/** Twice the class: there is room to move people around, and four desks to gather them from */
export const SOLO_SEATS = 16;
const SEAT_PAUSE_MS = 2000;
const RESEAT_MS = 2500;
const VISIT_REPLY_MS = 6000;
const COLORS = ['#1971c2', '#2f9e44', '#9c36b5', '#f08c00'];

interface Line { at: number; text: string } // seconds after the stage began
interface RoomScript { lines: Line[]; call?: { at: number; note: string }; onVisit?: string }

const OBSERVATIONS = ['AD = BC, по 8 клеток', 'AB = CD', 'AO = OC', 'BO = OD', '∠A = ∠C', '∠B = ∠D'];
const lines = (texts: string[], first: number, gap: number): Line[] => texts.map((text, i) => ({ at: first + i * gap, text }));

/** By room, in room order; a room past the end of the list uses the script from the start of it */
const SCRIPT: Record<BotStage, RoomScript[]> = {
  individual: [
    { lines: lines(OBSERVATIONS.slice(0, 4), 5, 8) },
    { lines: lines(OBSERVATIONS.slice(0, 3), 8, 9) },
    { lines: lines([OBSERVATIONS[1], OBSERVATIONS[0], OBSERVATIONS[4]], 6, 10) },
    { lines: lines(OBSERVATIONS.slice(0, 5), 4, 7) },
    { lines: lines(OBSERVATIONS.slice(2, 5), 9, 8) },
    { lines: lines(['AD = BC ?'], 10, 0), call: { at: 18, note: 'Не понимаю, что считать' },
      onVisit: 'Считаю клетки: AB — 2 вправо и 4 вверх' },
    { lines: lines(OBSERVATIONS.slice(0, 2), 7, 12) },
    { lines: lines(OBSERVATIONS.slice(1, 4), 5, 9) },
  ],
  pairs: [
    { lines: lines(OBSERVATIONS, 4, 6) },
    { lines: lines([OBSERVATIONS[0], OBSERVATIONS[2], 'AC = BD'], 5, 6),
      call: { at: 20, note: 'Мы посчитали, что диагонали равны. Так?' },
      onVisit: 'Проверили по клеткам: AC ≠ BD. Равны AO и OC' },
    { lines: lines(OBSERVATIONS.slice(1), 6, 7) },
    { lines: lines(OBSERVATIONS.slice(0, 4), 3, 8) },
  ],
  fours: [
    { lines: lines(['Уверены: AB = CD, AD = BC', 'Уверены: AO = OC, BO = OD', 'Сомневаемся: углы'], 4, 7),
      call: { at: 20, note: 'Углы на клетках не посчитать, как быть?' },
      onVisit: 'Углы докажем, а не посчитаем' },
    { lines: lines(['Уверены: AB = CD, AD = BC', 'Уверены: диагонали делятся пополам', 'Сомневаемся: ∠A = ∠C'], 6, 8) },
  ],
};

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
  write(room: string, obj: Record<string, unknown> & { uid: string; type: string }): void;
  call(room: string, note: string): void;
}

export class BotRun {
  private timers = new Set<NodeJS.Timeout>();
  private stageTimers = new Set<NodeJS.Timeout>();
  private written = new Map<string, number>();
  private replies = new Map<string, string>();
  private uid = 0;

  constructor(private host: BotHost) {}

  private after(ms: number, fn: () => void, set = this.stageTimers) {
    const t = setTimeout(() => { set.delete(t); fn(); }, ms);
    set.add(t);
  }

  seatEveryone() {
    BOTS.forEach((_, i) => this.after(800 + i * SEAT_PAUSE_MS, () => this.host.seat(i), this.timers));
  }

  /** The teacher sent someone from their seat: as in a real class, they find another one */
  onUnseated(name: string) {
    const i = BOTS.findIndex(b => b.name === name);
    if (i >= 0) this.after(RESEAT_MS, () => this.host.seat(i), this.timers);
  }

  /** One line down the board, each room filling up on its own */
  private write(room: string, text: string) {
    const n = this.written.get(room) ?? 0;
    this.written.set(room, n + 1);
    this.host.write(room, {
      uid: `bot-${room}-${this.uid++}`, type: 'IText', text, left: 860, top: 60 + (n % 11) * 72,
      originX: 'left', originY: 'top', fontSize: 40, fill: COLORS[n % COLORS.length], fontFamily: 'sans-serif',
    });
  }

  /** The stage changed: what was going on stops, and the bots start on the new stage's work */
  onStage(stage: string) {
    for (const t of this.stageTimers) clearTimeout(t);
    this.stageTimers.clear();
    this.replies.clear();
    if (stage !== 'individual' && stage !== 'pairs' && stage !== 'fours') return;
    const script = SCRIPT[stage];
    this.host.rooms().forEach((room, i) => {
      const part = script[i % script.length];
      for (const line of part.lines) this.after(line.at * 1000, () => this.write(room, line.text));
      if (part.call) {
        const { at, note } = part.call;
        this.after(at * 1000, () => {
          if (part.onVisit) this.replies.set(room, part.onVisit);
          this.host.call(room, note);
        });
      }
    });
  }

  /** The teacher came to a room that called: they take the hint and write the fix */
  onVisit(room: string) {
    const reply = this.replies.get(room);
    if (!reply) return;
    this.replies.delete(room);
    this.after(VISIT_REPLY_MS, () => this.write(room, reply));
  }

  stop() {
    for (const t of [...this.timers, ...this.stageTimers]) clearTimeout(t);
    this.timers.clear();
    this.stageTimers.clear();
  }
}

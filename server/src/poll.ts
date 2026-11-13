// Голосование: a question to the whole class, with one answer or several.
// With one answer each option has its colour, or the teacher marks the right one (green, the rest red).
// With several the teacher marks the right ones and each student's answer gets a colour of how right it is.
// Students don't see what's right, nor how the class answered, until the teacher shows the results;
// nobody but the teacher sees who answered what.

export interface PollOption { text: string; color: string; correct: boolean }
export interface PollPicture { src: string; width: number; height: number }
export interface PollDef { question: string; multi: boolean; options: PollOption[]; picture?: PollPicture }
export interface PollRun { answers: Map<string, number[]>; revealed: boolean }

export const POLL_MAX_OPTIONS = 8;
export const POLL_MIN_OPTIONS = 2;
export const POLL_PICTURE_MAX_BYTES = 400_000; // as a board picture (client-teacher BoardPictures.tsx)
const PICTURE_SRC = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;
const COLOR = /^#[0-9a-f]{6}$/i;

/** How right an answer with several choices is */
export type Grade = 'right' | 'most' | 'some' | 'wrong';
export const GRADE_COLORS: Record<Grade, string> = { right: '#2ecc71', most: '#f1c40f', some: '#e67e22', wrong: '#e74c3c' };

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** What the teacher sent, or null if it isn't a poll */
export function parsePoll(v: unknown): PollDef | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const question = text(o.question, 500);
  if (!Array.isArray(o.options)) return null;
  const options: PollOption[] = [];
  for (const raw of o.options.slice(0, POLL_MAX_OPTIONS)) {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const t = text(r.text, 200);
    if (!t) continue;
    options.push({ text: t, color: typeof r.color === 'string' && COLOR.test(r.color) ? r.color.toLowerCase() : '#3b82f6', correct: r.correct === true });
  }
  if (options.length < POLL_MIN_OPTIONS) return null;
  const multi = o.multi === true;
  // one answer: at most one is right
  if (!multi && options.filter(x => x.correct).length > 1) return null;
  const poll: PollDef = { question, multi, options };
  if (o.picture) {
    const p = o.picture as Record<string, unknown>;
    if (typeof p.src !== 'string' || p.src.length > POLL_PICTURE_MAX_BYTES || !PICTURE_SRC.test(p.src)) return null;
    const w = Number(p.width), h = Number(p.height);
    if (!(w > 0 && w <= 4000 && h > 0 && h <= 4000)) return null;
    poll.picture = { src: p.src, width: Math.round(w), height: Math.round(h) };
  }
  if (!question && !poll.picture) return null;
  return poll;
}

export const hasRight = (poll: PollDef) => poll.options.some(o => o.correct);

/** A student's choice as the server keeps it, or null if it doesn't fit the poll */
export function parseChoice(poll: PollDef, v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const picked = [...new Set(v)].filter((i): i is number => Number.isInteger(i) && i >= 0 && i < poll.options.length).sort((a, b) => a - b);
  if (picked.length !== v.length) return null;
  if (!poll.multi && picked.length > 1) return null;
  return picked;
}

/** Several answers: right ones picked less wrong ones picked, out of all the right ones — ticking everything doesn't pay */
export function grade(poll: PollDef, choice: number[]): Grade | null {
  if (!hasRight(poll)) return null;
  const right = poll.options.map((o, i) => (o.correct ? i : -1)).filter(i => i >= 0);
  const hits = choice.filter(i => poll.options[i].correct).length;
  const misses = choice.length - hits;
  if (hits === right.length && misses === 0) return 'right';
  if (!poll.multi) return 'wrong';
  const score = Math.max(0, hits - misses) / right.length;
  return score >= 0.5 ? 'most' : score > 0 ? 'some' : 'wrong';
}

/** The colour a student's answer shows on the teacher's map */
export function answerColor(poll: PollDef, choice: number[]): string | null {
  if (!choice.length) return null;
  const g = grade(poll, choice);
  if (g) return GRADE_COLORS[g];
  return poll.multi ? '#64748b' : poll.options[choice[0]].color;
}

function counts(poll: PollDef, run: PollRun): number[] {
  const c = poll.options.map(() => 0);
  for (const choice of run.answers.values()) for (const i of choice) c[i]++;
  return c;
}

/** The teacher sees it all: who answered what */
export function teacherView(blockId: string, poll: PollDef, run: PollRun) {
  return {
    blockId, ...poll, revealed: run.revealed, counts: counts(poll, run),
    answers: Object.fromEntries([...run.answers].filter(([, c]) => c.length).map(([name, c]) => [name, { choice: c, color: answerColor(poll, c), grade: grade(poll, c) }])),
  };
}

/** A student sees the question and their own answer; what's right and how the class answered only once shown */
export function studentView(blockId: string, poll: PollDef, run: PollRun, name: string) {
  const mine = run.answers.get(name) ?? [];
  const right = hasRight(poll);
  return {
    blockId, question: poll.question, multi: poll.multi, picture: poll.picture, revealed: run.revealed,
    // with a right answer the colours would give it away: until shown, the options are all alike
    options: poll.options.map(o => ({ text: o.text, color: right && !run.revealed ? null : right ? (o.correct ? GRADE_COLORS.right : GRADE_COLORS.wrong) : o.color, ...(run.revealed && right ? { correct: o.correct } : {}) })),
    mine,
    ...(run.revealed ? { counts: counts(poll, run), total: [...run.answers.values()].filter(c => c.length).length, grade: mine.length ? grade(poll, mine) : null } : {}),
  };
}

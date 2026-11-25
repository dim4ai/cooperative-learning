// The solo demo's hints: one at a time, a bubble beside the very button to press, shown when the
// lesson gets to it and gone once it's done. The lesson screen knows nothing of them: the hints
// find their buttons on the page by the marks they already carry (data-testid, data-hint).
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ClassActivity, Seat } from './SeatingMap';
import type { TeacherSlides } from './LessonSlides';
import type { TeacherPollView } from './pollState';
import { SOLO_LIVE_BLOCKS } from './demo';
import type { Hands } from './HandsPanel';

// ---------- which hint, when ----------

/** prefer: where the bubble goes if it fits — e.g. over the student's own desk, not the one they should move to */
interface Hint { id: string; anchor: string; text: string; prefer?: { side: 'below' | 'above'; align: 'start' | 'end' } }

export interface HintsInput {
  /** the lesson code: what was done is remembered per lesson */
  lesson: string;
  stage: string;
  seats: Seat[];
  students: string[];
  /** in the lesson, without a seat */
  waiting: string[];
  previewOpen: boolean;
  slides: TeacherSlides;
  /** the class map shown in place of the slide (after «Всем понятно?») */
  mapOpen: boolean;
  /** rooms whose bell rings now */
  calling: ReadonlySet<string>;
  /** this stage's calls by room, answered or not */
  calls: Record<string, { note: string }>;
  /** the room the teacher is in, if not the classroom */
  room: string | null;
  /** in that room incognito: the group neither sees nor hears the teacher */
  quiet: boolean;
  /** who talks and writes, by student */
  activity: ClassActivity | null;
  /** the running poll, if a poll runs */
  poll: TeacherPollView | null;
  /** the kind of task whose dialog is open */
  newTask: string | null;
  /** the made-up file window is open */
  lessonPick: boolean;
  /** the class's journal is chosen: the class comes in after that */
  journalChosen: boolean;
  /** the class journal is open */
  journalOpen: boolean;
  /** the «Завершить урок» dialog is open */
  endOpen: boolean;
  /** raised hands, and who has the word */
  hands: Hands;
  /** the group in this room waits for the teacher's answer */
  replyWaits: boolean;
  /** Миша's pair has the answer about Pythagoras: pale legs blink on their board */
  legs?: boolean;
}

/** Desks with somebody at them, in order */
function occupiedDesks(seats: Seat[]): number[] {
  return [...new Set(seats.filter(s => s.occupant && s.extra === undefined).map(s => s.groupIndex))].sort((a, b) => a - b);
}

/** The pair that talks but hardly writes (П4 «Трёп»), and didn't call: the detective has something to look at there */
function chattyPair(x: HintsInput): string | null {
  const pairs = new Map<string, string[]>();
  for (const s of x.seats) {
    if (!s.occupant) continue;
    const room = `${x.lesson}:pair-g${s.groupIndex}-r${s.row}`;
    pairs.set(room, [...(pairs.get(room) ?? []), s.occupant]);
  }
  let best: string | null = null, bestOps = Infinity;
  for (const [room, names] of pairs) {
    if (names.length < 2 || room in x.calls) continue;
    const talk = names.reduce((a, n) => a + (x.activity?.students[n]?.talk ?? 0), 0);
    const ops = names.reduce((a, n) => a + (x.activity?.students[n]?.ops ?? 0), 0);
    if (talk >= 6 && ops < bestOps) { best = room; bestOps = ops; }
  }
  return best;
}

const memory = new Map<string, { done: ReadonlySet<string>; firstSlide: string | null; room?: string | null; backAt?: number }>();

/** How many rooms call on each work stage (server/src/demoBots.ts, SCRIPT) */
const CALLS: Record<string, number> = { individual: 3, pairs: 2, fours: 1 };

/** The lesson's blocks in the server's order, the polls added during the lesson among them */
const planBlocks = (x: HintsInput) => x.slides.material?.blocks ?? x.slides.local?.blocks ?? [];
/** The polls added so far */
const pollsAdded = (x: HintsInput) => planBlocks(x).filter(b => b.type === 'poll').length;

/** The next block the demo goes through, past the pale ones and the polls already run */
function nextBlock(x: HintsInput): string {
  const blocks = planBlocks(x);
  const at = blocks.findIndex(b => b.id === x.slides.state.block);
  // from a poll: on from the block it was added in
  const from = blocks[at]?.type === 'poll' ? blocks.slice(0, at).map(b => b.id).filter(id => SOLO_LIVE_BLOCKS.has(id)).pop() : null;
  const start = from ? blocks.findIndex(b => b.id === from) : at;
  const next = blocks.slice(start + 1).find(b => SOLO_LIVE_BLOCKS.has(b.id));
  return `[data-block-id="${next?.id ?? ''}"]`;
}
const blockSel = (id: string) => `[data-block-id="${id}"]`;

/** How many students the solo demo's class has (server/src/demoBots.ts) */
const CLASS_SIZE = 8;

/** Mostly one hint; a few moments need two at once */
function pickHint(x: HintsInput, done: ReadonlySet<string>): Hint | Hint[] | null {
  const { stage, seats, students, waiting, slides } = x;

  // the end: the class can be let go at once, or after a few minutes' talk in their fours
  if (x.endOpen) return { id: 'end-chat', anchor: '[data-testid="end-chat"]', text:
    'После урока можно дать ребятам несколько минут поболтать в своих четвёрках: вы выйдете и их не услышите. '
    + 'В демо они болтать не станут — урок просто закончится. Выберите любой вариант.' };

  if (stage === 'waiting') {
    // first the lesson, then the class's journal; each hint shows while its button is there
    if (!slides.local) return x.lessonPick
      ? [
          { id: 'lesson-file', anchor: '[data-testid="sample-file"][aria-selected="false"]', text: 'Выберите урок. На настоящем занятии здесь будут ваши файлы.' },
          { id: 'lesson-file-open', anchor: '[data-testid="sample-open"]:not(:disabled)', text: 'Откройте его' },
        ]
      : [
          { id: 'lesson-menu', anchor: '[data-testid="menu-lesson"][aria-expanded="false"]', text: 'Начнём с урока: откройте это меню' },
          { id: 'lesson-open', anchor: '[data-testid="menu-open"]', text: 'Откройте урок' },
        ];
    if (!x.journalChosen) return x.journalOpen
      ? [
          { id: 'journal-class', anchor: '[data-testid="journal"][data-class=""] select[aria-label="Класс"]', text: 'Выберите журнал класса: 8 «Б»' },
          { id: 'journal-class-choose', anchor: '[data-testid="journal"]:not([data-class=""]) [data-testid="journal-choose"]', text: 'Нажмите «Выбрать». После этого ученики начнут заходить.' },
        ]
      : { id: 'journal-first', anchor: '[data-testid="journal-open"]', text: 'Урок открыт. Теперь откройте журнал класса.' };
    const seated = seats.filter(s => s.occupant);
    const allIn = students.length >= CLASS_SIZE && waiting.length === 0 && seated.length >= CLASS_SIZE;
    // one came in from someone else's device: a desk apart, until the teacher has talked to him and told the journal who he is
    const newcomer = seats.find(s => s.extra !== undefined && s.occupant)?.occupant ?? null;
    if (newcomer && !x.previewOpen) {
      const room = `${x.lesson}:individual-${newcomer}`;
      if (x.room === room) return { id: 'newcomer-in', anchor: '[data-hint="room-back"]', text:
        'Это Миша: он зашёл с телефона тёти, поэтому система его не узнала. Вернитесь в класс и отметьте в журнале, кто это.' };
      if (!done.has(`visit:${room}`)) return { id: 'newcomer', anchor: '[data-testid="newcomer-talk"]', text:
        'Кто-то зашёл с незнакомого устройства — его посадили за отдельную парту. Поговорите с ним: 💬' };
      return x.journalOpen
        ? { id: 'journal-link', anchor: '[data-testid="unmatched"] select', text: 'Укажите, кто это — Миша. Он сразу сядет на своё место из журнала.' }
        : { id: 'journal', anchor: '[data-testid="journal-open"]', text: 'Откройте журнал класса и отметьте, кто это.' };
    }
    if (x.journalOpen) return allIn ? { id: 'journal-close', anchor: '[data-testid="journal-choose"]', text: 'Миша на своём месте. Закройте журнал' } : null;
    if (x.previewOpen) {
      if (allIn) return { id: 'back-to-seats', anchor: '[data-testid="tab-seating"]', text: 'Ученики вошли в класс. Вернитесь к рассадке' };
      return done.has('preview-nav') ? null
        : { id: 'preview-nav', anchor: '[data-hint="preview-next"]', text: 'Листайте слайды стрелками ← → на клавиатуре или этими кнопками, блоки урока — стрелками ↑ ↓' };
    }
    if (!allIn) {
      return done.has('preview') ? null
        : { id: 'preview', anchor: '[data-testid="tab-preview"]', text: 'Пока ученики заходят, пролистайте урок: слайды и заметки к каждому блоку' };
    }
    // the class gathers at the two desks where most already sit
    const byDesk = new Map<number, number>();
    for (const s of seated) byDesk.set(s.groupIndex, (byDesk.get(s.groupIndex) ?? 0) + 1);
    const keep = [...byDesk.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 2).map(([g]) => g);
    const stray = seated.find(s => !keep.includes(s.groupIndex));
    if (stray) {
      return {
        id: 'gather', anchor: `[data-seat-occupant="${CSS.escape(stray.occupant!)}"]`,
        text: 'Вы можете перемещать учеников: кликните по ученику, потом по свободному месту за любой партой. Соберите учеников за двумя партами.',
        // over the other row of this desk, inside its width
        prefer: { side: stray.row === 0 ? 'below' : 'above', align: stray.col === 0 ? 'start' : 'end' },
      };
    }
    return { id: 'start', anchor: '[data-hint="start-lesson"]', text: 'Все на своих местах. Можете начинать урок' };
  }

  if (stage === 'group') {
    const block = slides.state.block;
    const polls = pollsAdded(x);
    // a poll of the teacher's own: its dialog, the answers coming in, the results
    if (x.newTask === 'poll') return { id: 'poll-start', anchor: '[data-testid="poll-start"]', text:
      'Вопрос и варианты уже вписаны — можно поправить. Сверху можно добавить картинку. Запускайте: голосование встанет в план сразу после текущего этапа.' };
    if (x.poll && block === x.poll.blockId) {
      const answered = Object.keys(x.poll.answers).length;
      if (!x.poll.revealed) return answered < CLASS_SIZE
        ? { id: 'poll-wait', anchor: '[data-testid="poll-results"]', text: 'Ответы приходят по одному. Вы видите, кто что выбрал; ученики не видят ни чужих ответов, ни итогов.' }
        : { id: 'poll-reveal', anchor: '[data-testid="poll-reveal"]', text: 'Все ответили. Покажите итоги классу: ученики увидят, сколько выбрали каждый вариант, без имён.' };
      if (polls < 2) return { id: 'poll-back', anchor: blockSel('b9'), text:
        'Мнения разделились — значит, есть что разобрать. Вернитесь к объяснению признаков. А в конце урока спросим ещё раз.' };
      return { id: 'end', anchor: '[data-hint="end-lesson"]', text: 'Мнения сдвинулись: урок сработал. Завершите урок и расскажите, что думаете' };
    }
    // b9: hands go up — the teacher hears both, then asks the class what it thinks
    if (block === 'b9' && polls === 0 && x.hands.up.length) return { id: 'hand', anchor: '[data-testid="hand-give"]', text: done.has('hand')
      ? 'Ещё одна рука — дайте слово.'
      : 'Ученики подняли руки — у них вопрос. Дайте слово: нажмите на имя.' };
    if (block === 'b9' && polls === 0 && x.hands.floor) return null; // listening
    if (block === 'b9' && polls === 0 && !done.has('hand')) return null; // the hands are about to go up
    if (block === 'b9' && polls === 0) return { id: 'poll-new', anchor: '[data-testid="menu-task"]', text:
      'Ученики путают свойство и признак: один считает, что это одно и то же, другая — что разное. '
      + 'Узнайте прямо сейчас, что думает весь класс: «Новое задание» → «Голосование».' };
    // the summing up: the same question again
    if (block === 'b12') return polls < 2
      ? { id: 'poll-again', anchor: '[data-testid="menu-task"]', text: 'Итог урока. Задайте классу тот же вопрос ещё раз — посмотрим, изменилось ли мнение: «Новое задание» → «Голосование».' }
      : { id: 'end', anchor: '[data-hint="end-lesson"]', text: 'Завершите урок и расскажите, что думаете' };
    const material = slides.local ?? slides.material;
    const st = slides.state;
    const scenes = (st.active && material?.blocks.find(b => b.id === st.blockId)?.slides) || [];
    const scene = scenes[st.index];
    if (!scene) return null;
    const revealed = new Set(st.revealed);
    const hidden = scene.objects.filter(o => o.studentHidden && !revealed.has(o.uid)).length;
    const { asking, marks } = slides.understood;
    const answered = Object.keys(marks).length > 0;

    if (asking) return null;
    if (answered) {
      return [
        { id: 'next-block', anchor: nextBlock(x), text: 'Выберите следующий блок урока.' },
        // under the second desk of the class, over nobody: the frames it explains are right above
        { id: 'vote-legend', anchor: `[data-group="${occupiedDesks(x.seats)[1] ?? occupiedDesks(x.seats)[0] ?? 0}"]`, prefer: { side: 'below', align: 'start' }, text:
          'Зелёная рамка вокруг ученика — он выбрал «Понятно», красная — «Не понятно», нет рамки — не проголосовал. '
          + 'Вы можете ещё раз объяснить непонятные моменты или перейти к следующему этапу. На следующем этапе есть возможность подойти к ученику индивидуально.' },
      ];
    }
    if (hidden > 0 && !done.has('reveal')) {
      return { id: 'reveal', anchor: '[data-testid="tool-slide"]', text: 'Ответы на этом слайде ученики пока не видят. Дайте подумать, потом выберите ☝ и кликните по ответу' };
    }
    // on every slide until the last: «Всем понятно?» appears only there, at the end of the explanation
    if (st.index < scenes.length - 1) {
      return { id: 'next-slide', anchor: '[data-hint="slide-next"]', text: done.has('next-slide')
        ? `Слайд ${st.index + 1} из ${scenes.length}. Объясняйте и листайте дальше — на последнем слайде появится кнопка «Всем понятно?»`
        : 'Следующий слайд — эта стрелка или клавиша →' };
    }
    return { id: 'ask', anchor: '[data-testid="understood-ask"]', text: 'Последний слайд, объяснение закончено. Теперь спросите класс: всем понятно?' };
  }

  if (stage === 'individual' || stage === 'pairs' || stage === 'fours') {
    // at a student's board
    if (x.room && x.quiet) {
      return { id: 'spy-in', anchor: '[data-testid="quiet-reveal"]', text:
        'Вы здесь инкогнито — посмотрите на детектива справа: ученики вас не видят и не слышат. '
        + 'Послушайте их и посмотрите, что они пишут. Заговорить с ними — «Войти открыто», уйти — «Назад».' };
    }
    if (x.room) {
      const call = x.calls[x.room];
      if (x.legs) return [
        { id: 'draw-legs', anchor: '[data-testid="tool-pen"]', text:
          'Помогите применить теорему Пифагора: нарисуйте ручкой два катета — как бледные линии на доске. '
          + 'К AO — 5 клеток вправо и 2 вверх, к AB — 4 вверх и 2 вправо. Это не обязательно.' },
        { id: `coach:${x.room}`, anchor: '[data-hint="room-back"]', text: 'Когда договорите, возвращайтесь в класс.' },
      ];
      if ([...x.calling].some(r => r !== x.room)) return { id: 'call-elsewhere', anchor: '[data-testid="call-elsewhere-go"]', text:
        'Вас зовут ещё в одну группу — кому-то нужна помощь. Договорите здесь и переходите: «Перейти».' };
      if (x.replyWaits) return { id: 'reply', anchor: '[data-testid="demo-reply-ready"]', text:
        'Ученики ждут ответа. Ответьте своими словами в микрофон — или скажите готовый ответ этой кнопкой.' };
      if (call && /а-бэ/.test(call.note)) return { id: `coach:${x.room}`, anchor: '[data-hint="room-back"]', text: 'Когда договорите, возвращайтесь в класс.' };
      if (call) {
        const back: Hint = { id: `coach:${x.room}`, anchor: '[data-hint="room-back"]', text: 'После ответа ученику возвращайтесь в класс.' };
        // the first time at a student's board: the teacher may write on it
        return done.has('room-back') ? back : [
          { id: 'draw', anchor: '[data-testid="tool-pen"]', text: 'Вы можете писать и рисовать прямо на доске ученика — он сразу это увидит.' },
          back,
        ];
      }
      return done.has('room-back') ? null : { id: 'room-back', anchor: '[data-hint="room-back"]', text: 'Вы у доски учеников. Вернуться в класс — эта кнопка' };
    }
    // in the classroom: a bell first
    const ringing = Object.keys(x.calls).find(r => x.calling.has(r)) ?? [...x.calling][0];
    if (ringing) {
      // what they ask is in the right panel
      return { id: `bell:${ringing}`, anchor: `[data-calling-room="${CSS.escape(ringing)}"]`, text: 'Вас зовут. Нажмите на колокольчик, чтобы подойти' };
    }
    const answered = Object.keys(x.calls).filter(r => done.has(`visit:${r}`)).length;
    if (answered < (CALLS[stage] ?? 2)) return null; // the class works; someone will call
    // the detective: a pair that didn't call, but the map shows something's off there
    if (stage === 'pairs' && !done.has('spy')) {
      const room = chattyPair(x);
      if (room) return { id: 'spy', anchor: `[data-pair-room="${CSS.escape(room)}"]`, text:
        'Посмотрите на эту пару: разговаривают, а на доске почти ничего. '
        + 'Нажмите на пару — вы зайдёте к ним инкогнито, они вас не заметят.' };
    }
    return { id: `next-block:${stage}`, anchor: nextBlock(x), text: stage === 'individual' ? 'Все, кто звал, получили ответ. Дальше — работа в парах'
      : stage === 'pairs' ? 'Этапы с 4-го по 8-й в демо пропущены — нажмите на них в плане, чтобы узнать, что там. Дальше — признаки параллелограмма'
      : 'Четвёрки разобрались. Подведите итог урока' };
  }

  return null;
}

// ---------- the bubble ----------

const BACK_PAUSE_MS = 2500;
const SPY_PAUSE_MS = 9000; // after the last call: time to glance at the strips and lights before the detective's hint
const BUBBLE_W = 250;
const GAP = 12;

interface Box { top: number; left: number; width: number; height: number }
type Side = 'right' | 'left' | 'below' | 'above';

function place(r: Box, bubbleH: number, prefer?: Hint['prefer']): { side: Side; top: number; left: number } {
  const vw = window.innerWidth, vh = window.innerHeight;
  const clampTop = (t: number) => Math.max(8, Math.min(t, vh - bubbleH - 8));
  const clampLeft = (l: number) => Math.max(8, Math.min(l, vw - BUBBLE_W - 8));
  const midY = r.top + r.height / 2 - bubbleH / 2;
  const midX = r.left + r.width / 2 - BUBBLE_W / 2;
  if (prefer) {
    const left = clampLeft(prefer.align === 'start' ? r.left : r.left + r.width - BUBBLE_W);
    if (prefer.side === 'below' && r.top + r.height + GAP + bubbleH < vh) return { side: 'below', top: r.top + r.height + GAP, left };
    if (prefer.side === 'above' && r.top - GAP - bubbleH > 0) return { side: 'above', top: r.top - GAP - bubbleH, left };
  }
  // things in the left sidebar: beside them; the rest: below or above, so the bubble hides nothing in their row
  if (r.left + r.width <= 190) return { side: 'right', top: clampTop(midY), left: r.left + r.width + GAP };
  if (r.top + r.height + GAP + bubbleH < vh) return { side: 'below', top: r.top + r.height + GAP, left: clampLeft(midX) };
  if (r.top - GAP - bubbleH > 0) return { side: 'above', top: r.top - GAP - bubbleH, left: clampLeft(midX) };
  return { side: 'left', top: clampTop(midY), left: Math.max(8, r.left - GAP - BUBBLE_W) };
}

function arrowStyle(side: Side, r: Box, pos: { top: number; left: number }): CSSProperties {
  const s = 8;
  const base: CSSProperties = { position: 'absolute', width: 0, height: 0, border: `${s}px solid transparent` };
  if (side === 'right') return { ...base, left: -2 * s, top: Math.max(10, r.top + r.height / 2 - pos.top - s), borderRightColor: BG };
  if (side === 'left') return { ...base, right: -2 * s, top: Math.max(10, r.top + r.height / 2 - pos.top - s), borderLeftColor: BG };
  const x = Math.max(10, Math.min(r.left + r.width / 2 - pos.left - s, BUBBLE_W - 26));
  return side === 'below' ? { ...base, top: -2 * s, left: x, borderBottomColor: BG } : { ...base, bottom: -2 * s, left: x, borderTopColor: BG };
}

const BG = '#2b3a55';

export function DemoHints(props: HintsInput) {
  // what the teacher has already done once needs no more showing (noted while rendering)
  // kept outside: the lesson screen is built anew whenever the teacher walks into a room
  const mem = memory.get(props.lesson) ?? { done: new Set<string>(), firstSlide: null };
  memory.set(props.lesson, mem);
  const [done, setDoneState] = useState<ReadonlySet<string>>(mem.done);
  const [firstSlide, setFirstSlideState] = useState<string | null>(mem.firstSlide);
  const setDone = (d: ReadonlySet<string>) => { mem.done = d; setDoneState(d); };
  const setFirstSlide = (f: string) => { mem.firstSlide = f; setFirstSlideState(f); };
  const { previewOpen, slides } = props;
  const slideAt = slides.state.active ? `${slides.state.blockId}:${slides.state.index}` : null;
  const now = new Set<string>();
  if (previewOpen) now.add('preview');
  if (slides.state.revealed.length) now.add('reveal');
  if (props.hands.floor) now.add('hand'); // gave someone the word
  if (slideAt && firstSlide && slideAt !== firstSlide) now.add('next-slide');
  // incognito doesn't answer a call: only an open visit does
  if (props.room && props.quiet) { if (props.stage === 'pairs') now.add('spy'); } // the detective's scene is the pairs'
  else if (props.room) { now.add(`visit:${props.room}`); now.add('in-room'); } else if (done.has('in-room')) now.add('room-back');
  if ([...now].some(id => !done.has(id))) setDone(new Set([...done, ...now]));
  if (slideAt && !firstSlide) setFirstSlide(slideAt);

  // leafing through the preview: by the keys or its buttons
  const lesson = props.lesson;
  useEffect(() => {
    if (!previewOpen) return;
    const leafed = () => {
      const m = memory.get(lesson);
      if (!m || m.done.has('preview-nav')) return;
      m.done = new Set([...m.done, 'preview-nav']);
      setDoneState(m.done);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key.startsWith('Arrow')) leafed(); };
    const onClick = (e: MouseEvent) => { if ((e.target as Element).closest?.('[data-testid="lesson-preview"] button')) leafed(); };
    window.addEventListener('keydown', onKey);
    window.addEventListener('click', onClick);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('click', onClick); };
  }, [previewOpen, lesson]);

  // back from a group's board: a breath before the next hint, the teacher looks round the class first;
  // kept in the memory, as the screen is built anew on the way back
  if (props.room !== mem.room) {
    if (mem.room && !props.room) mem.backAt = Date.now();
    mem.room = props.room;
  }
  const sinceBack = Date.now() - (mem.backAt ?? 0);
  let picked = sinceBack < BACK_PAUSE_MS ? null : pickHint(props, done);
  // after the last call: longer, to glance at the strips and lights before the detective's hint
  if (picked && !Array.isArray(picked) && picked.id === 'spy' && sinceBack < SPY_PAUSE_MS) picked = null;
  const waitFor = sinceBack < BACK_PAUSE_MS ? BACK_PAUSE_MS - sinceBack : !picked && sinceBack < SPY_PAUSE_MS ? SPY_PAUSE_MS - sinceBack : 0;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (waitFor <= 0) return;
    const t = setTimeout(() => setTick(n => n + 1), waitFor + 50);
    return () => clearTimeout(t);
  }, [sinceBack < BACK_PAUSE_MS, waitFor > 0, mem.backAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const hints = !picked ? [] : Array.isArray(picked) ? picked : [picked];
  return (<>
    {hints.map(h => <Bubble key={h.id} hint={h} />)}
    {hints.length > 0 && <style>{'@keyframes demoHintRing { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }'}</style>}
  </>);
}

/** One hint: a ring around its button and the bubble beside it */
function Bubble({ hint }: { hint: Hint }) {
  // follow the button: it moves when the page lays out again
  const [measured, setMeasured] = useState<(Box & { anchor: string }) | null>(null);
  const anchor = hint.anchor;
  useEffect(() => {
    if (!anchor) return;
    const measure = () => {
      const r = document.querySelector(anchor)?.getBoundingClientRect();
      setMeasured(prev => {
        if (!r || r.width === 0) return null;
        if (prev && prev.anchor === anchor && prev.top === r.top && prev.left === r.left && prev.width === r.width && prev.height === r.height) return prev;
        return { anchor, top: r.top, left: r.left, width: r.width, height: r.height };
      });
    };
    // a button low on the page leaves no room for the bubble, or is out of sight: bring it to the middle
    const first = requestAnimationFrame(() => {
      const el = document.querySelector(anchor);
      const r = el?.getBoundingClientRect();
      if (el && r && (r.top < 0 || r.bottom + 140 > window.innerHeight)) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      measure();
    });
    const t = setInterval(measure, 300);
    window.addEventListener('resize', measure);
    return () => { cancelAnimationFrame(first); clearInterval(t); window.removeEventListener('resize', measure); };
  }, [anchor]);
  const box = measured && measured.anchor === anchor ? measured : null;

  const [bubble, setBubble] = useState<HTMLDivElement | null>(null);
  const [bubbleH, setBubbleH] = useState(90);
  useEffect(() => {
    if (!bubble) return;
    const ro = new ResizeObserver(() => setBubbleH(bubble.offsetHeight));
    ro.observe(bubble);
    return () => ro.disconnect();
  }, [bubble]);

  const prefer = hint.prefer;
  const pos = useMemo(() => (box ? place(box, bubbleH, prefer) : null), [box, bubbleH, prefer?.side, prefer?.align]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!box || !pos) return null;

  return (
    <>
      <div aria-hidden style={{
        position: 'fixed', top: box.top - 4, left: box.left - 4, width: box.width + 8, height: box.height + 8,
        borderRadius: 8, border: '2px solid #f5a623', pointerEvents: 'none', zIndex: 1900, animation: 'demoHintRing 1.4s ease-in-out infinite',
      }} />
      <div ref={setBubble} role="note" data-testid="demo-hint" data-hint-id={hint.id} data-anchor={hint.anchor} style={{
        position: 'fixed', top: pos.top, left: pos.left, width: BUBBLE_W, boxSizing: 'border-box', zIndex: 1901,
        background: BG, color: '#fff', borderRadius: 8, padding: '10px 12px', fontFamily: 'sans-serif',
        fontSize: 13, lineHeight: 1.4, textAlign: 'left', boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      }}>
        <div style={arrowStyle(pos.side, box, pos)} />
        {hint.text}
      </div>
    </>
  );
}

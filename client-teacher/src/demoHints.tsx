// The solo demo's hints: one at a time, a bubble beside the very button to press, shown when the
// lesson gets to it and gone once it's done. The lesson screen knows nothing of them: the hints
// find their buttons on the page by the marks they already carry (data-testid, data-hint).
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { ClassActivity, Seat } from './SeatingMap';
import type { TeacherSlides } from './LessonSlides';

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
}

/** Desks with somebody at them, in order */
function occupiedDesks(seats: Seat[]): number[] {
  return [...new Set(seats.filter(s => s.occupant && s.extra === undefined).map(s => s.groupIndex))].sort((a, b) => a - b);
}

/** The pair where one does the talking: the detective has something to look at there */
function lopsidedPair(x: HintsInput): string | null {
  const pairs = new Map<string, string[]>();
  for (const s of x.seats) {
    if (!s.occupant) continue;
    const room = `${x.lesson}:pair-g${s.groupIndex}-r${s.row}`;
    pairs.set(room, [...(pairs.get(room) ?? []), s.occupant]);
  }
  let best: string | null = null, bestShare = 1;
  for (const [room, names] of pairs) {
    if (names.length < 2) continue;
    const talk = names.map(n => x.activity?.students[n]?.talk ?? 0);
    const total = talk.reduce((a, b) => a + b, 0);
    const share = total >= 6 ? Math.min(...talk) / total : 0.5;
    if (!best || share < bestShare) { best = room; bestShare = share; }
  }
  return best;
}

const memory = new Map<string, { done: ReadonlySet<string>; firstSlide: string | null; room?: string | null; backAt?: number }>();

/** How many rooms call on each work stage (server/src/demoBots.ts, SCRIPT) */
const CALLS: Record<string, number> = { individual: 3, pairs: 2, fours: 1 };
const NEXT_BLOCK = '[data-testid="plan-block"][data-current] + [data-testid="plan-block"]';

/** How many students the solo demo's class has (server/src/demoBots.ts) */
const CLASS_SIZE = 8;

/** Mostly one hint; a few moments need two at once */
function pickHint(x: HintsInput, done: ReadonlySet<string>): Hint | Hint[] | null {
  const { stage, seats, students, waiting, slides } = x;

  if (stage === 'waiting') {
    const seated = seats.filter(s => s.occupant);
    const allIn = students.length >= CLASS_SIZE && waiting.length === 0 && seated.length >= CLASS_SIZE;
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
    return { id: 'start', anchor: '[data-hint="start-lesson"]', text: 'Все за двумя партами. Можете начинать урок' };
  }

  if (stage === 'group') {
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
        { id: 'next-block', anchor: NEXT_BLOCK, text: 'Выберите следующий блок урока.' },
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
        + 'Посмотрите, что они пишут. Заговорить с ними — «Войти открыто», уйти — «Назад».' };
    }
    if (x.room) {
      const call = x.calls[x.room];
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
      const room = lopsidedPair(x);
      if (room) return { id: 'spy', anchor: `[data-pair-room="${CSS.escape(room)}"]`, text:
        'Посмотрите на эту пару: говорит и пишет в основном один ученик. '
        + 'Нажмите на пару — вы зайдёте к ним инкогнито, они вас не заметят.' };
    }
    if (stage === 'fours') return { id: 'end', anchor: '[data-hint="end-lesson"]', text: 'Это весь цикл урока. Завершите урок и расскажите, что думаете' };
    return { id: `next-block:${stage}`, anchor: NEXT_BLOCK, text: stage === 'individual' ? 'Все, кто звал, получили ответ. Дальше — работа в парах' : 'Дальше пары объединяются в четвёрки' };
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
        borderRadius: 8, border: '2px solid #f5a623', pointerEvents: 'none', zIndex: 900, animation: 'demoHintRing 1.4s ease-in-out infinite',
      }} />
      <div ref={setBubble} role="note" data-testid="demo-hint" data-hint-id={hint.id} style={{
        position: 'fixed', top: pos.top, left: pos.left, width: BUBBLE_W, boxSizing: 'border-box', zIndex: 901,
        background: BG, color: '#fff', borderRadius: 8, padding: '10px 12px', fontFamily: 'sans-serif',
        fontSize: 13, lineHeight: 1.4, textAlign: 'left', boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
      }}>
        <div style={arrowStyle(pos.side, box, pos)} />
        {hint.text}
      </div>
    </>
  );
}

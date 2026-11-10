// The solo demo's hints: one at a time, a bubble beside the very button to press, shown when the
// lesson gets to it and gone once it's done. The lesson screen knows nothing of them: the hints
// find their buttons on the page by the marks they already carry (data-testid, data-hint).
import { useEffect, useMemo, useState } from 'react';
import { setHintsOff, useHintsOff } from './demoHintsOff';
import type { CSSProperties } from 'react';
import type { Seat } from './SeatingMap';
import type { TeacherSlides } from './LessonSlides';

// ---------- which hint, when ----------

/** prefer: where the bubble goes if it fits — e.g. over the student's own desk, not the one they should move to */
interface Hint { id: string; anchor: string; text: string; prefer?: { side: 'below' | 'above'; align: 'start' | 'end' } }

export interface HintsInput {
  stage: string;
  seats: Seat[];
  students: string[];
  /** in the lesson, without a seat */
  waiting: string[];
  previewOpen: boolean;
  slides: TeacherSlides;
  /** the class map shown in place of the slide (after «Всем понятно?») */
  mapOpen: boolean;
}

/** How many students the solo demo's class has (server/src/demoBots.ts) */
const CLASS_SIZE = 8;

function pickHint(x: HintsInput, done: ReadonlySet<string>): Hint | null {
  const { stage, seats, students, waiting, slides } = x;

  if (stage === 'waiting') {
    const seated = seats.filter(s => s.occupant);
    const allIn = students.length >= CLASS_SIZE && waiting.length === 0 && seated.length >= CLASS_SIZE;
    if (x.previewOpen) {
      return allIn ? { id: 'back-to-seats', anchor: '[data-testid="tab-seating"]', text: 'Ученики расселись. Вернитесь к рассадке' } : null;
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
        text: 'Соберите класс за любые две парты: кликните по ученику, потом по свободному месту за другой партой',
        // over the other row of this desk, inside its width
        prefer: { side: stray.row === 0 ? 'below' : 'above', align: stray.col === 0 ? 'start' : 'end' },
      };
    }
    return { id: 'start', anchor: '[data-hint="start-lesson"]', text: 'Все за двумя партами. Начинайте урок' };
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
      return {
        id: 'next-block', anchor: '[data-testid="plan-block"][data-current] + [data-testid="plan-block"]',
        text: x.mapOpen
          ? 'Красная рамка на карте — не понял. Отметки останутся: подойдёте к этим ученикам, когда класс будет работать сам. Выберите следующий блок урока'
          : 'Дальше класс работает сам. Выберите следующий блок урока',
      };
    }
    if (hidden > 0 && !done.has('reveal')) {
      return { id: 'reveal', anchor: '[data-testid="tool-slide"]', text: 'Ответы на этом слайде ученики пока не видят. Дайте подумать, потом возьмите ☝ и кликните по ответу' };
    }
    if (st.index < scenes.length - 1) {
      return done.has('next-slide') ? null : { id: 'next-slide', anchor: '[data-hint="slide-next"]', text: 'Следующий слайд — эта стрелка или клавиша →' };
    }
    return { id: 'ask', anchor: '[data-testid="understood-ask"]', text: 'Последний слайд. Спросите класс: всем понятно?' };
  }

  return null;
}

// ---------- the bubble ----------

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
  const hintsOff = useHintsOff();
  // what the teacher has already done once needs no more showing (noted while rendering)
  const [done, setDone] = useState<ReadonlySet<string>>(new Set());
  const [firstSlide, setFirstSlide] = useState<string | null>(null);
  const { previewOpen, slides } = props;
  const slideAt = slides.state.active ? `${slides.state.blockId}:${slides.state.index}` : null;
  const now = new Set<string>();
  if (previewOpen) now.add('preview');
  if (slides.state.revealed.length) now.add('reveal');
  if (slideAt && firstSlide && slideAt !== firstSlide) now.add('next-slide');
  if ([...now].some(id => !done.has(id))) setDone(new Set([...done, ...now]));
  if (slideAt && !firstSlide) setFirstSlide(slideAt);

  const hint = hintsOff ? null : pickHint(props, done);

  // follow the button: it moves when the page lays out again
  const [measured, setMeasured] = useState<(Box & { anchor: string }) | null>(null);
  const anchor = hint?.anchor;
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

  const prefer = hint?.prefer;
  const pos = useMemo(() => (box ? place(box, bubbleH, prefer) : null), [box, bubbleH, prefer?.side, prefer?.align]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!hint || !box || !pos) return null;

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
        <div style={{ marginTop: 6, textAlign: 'right' }}>
          <button data-testid="demo-hints-off" onClick={() => setHintsOff(true)} style={{
            border: 'none', background: 'transparent', color: '#aab6cc', cursor: 'pointer', fontSize: 11, padding: 0,
          }}>Скрыть подсказки</button>
        </div>
      </div>
      <style>{'@keyframes demoHintRing { 0%, 100% { opacity: 1 } 50% { opacity: 0.35 } }'}</style>
    </>
  );
}

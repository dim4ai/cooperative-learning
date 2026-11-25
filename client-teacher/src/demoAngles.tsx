import { useEffect, useRef, useState } from 'react';

// The solo demo, the last slide of the first explanation: the alternate angles 1 and 2 aren't marked on the drawing.
// Pale and blinking, they show the teacher what to draw; each piece goes once the teacher has drawn over it.

/** The slide «Вспомним из 7 класса» (1600×900) */
export const ANGLES_SCENE = 'u00041';

const PIECES: { x: number; y: number; arc?: string; digit?: string }[] = [
  { x: 448, y: 348, arc: 'M459.8 362.4 A40 40 0 0 1 443.2 330' },
  { x: 419, y: 363, digit: '1' },
  { x: 352, y: 542, arc: 'M340.2 527.6 A40 40 0 0 1 356.8 560' },
  { x: 381, y: 527, digit: '2' },
];
const NEAR = 70; // how far from a piece a stroke still counts as drawing it

export function AnglesGhost({ width }: { width: number }) {
  const ref = useRef<SVGSVGElement>(null);
  const [drawn, setDrawn] = useState<ReadonlySet<number>>(new Set());

  useEffect(() => {
    let box: { l: number; r: number; t: number; b: number } | null = null;
    const grow = (e: PointerEvent) => {
      if (!box) return;
      box = { l: Math.min(box.l, e.clientX), r: Math.max(box.r, e.clientX), t: Math.min(box.t, e.clientY), b: Math.max(box.b, e.clientY) };
    };
    const down = (e: PointerEvent) => {
      box = (e.target as Element).tagName === 'CANVAS' ? { l: e.clientX, r: e.clientX, t: e.clientY, b: e.clientY } : null;
    };
    const up = () => {
      const page = ref.current?.getBoundingClientRect();
      if (!box || !page || Math.max(box.r - box.l, box.b - box.t) < 5) { box = null; return; } // a tap draws nothing
      const k = 1600 / page.width;
      const x = ((box.l + box.r) / 2 - page.left) * k, y = ((box.t + box.b) / 2 - page.top) * k;
      box = null;
      const [near] = PIECES.map((p, i) => ({ i, d: Math.hypot(p.x - x, p.y - y) })).sort((a, b) => a.d - b.d);
      if (near.d < NEAR) setDrawn(s => new Set([...s, near.i]));
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', grow, true);
    window.addEventListener('pointerup', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', grow, true);
      window.removeEventListener('pointerup', up, true);
    };
  }, []);

  return (
    <svg ref={ref} data-testid="angles-ghost" data-left={PIECES.length - drawn.size} viewBox="0 0 1600 900" width={width} height={width * 9 / 16}
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', animation: 'angles-blink 1.4s ease-in-out infinite' }}>
      <style>{'@keyframes angles-blink { 0%, 100% { opacity: 0.15 } 50% { opacity: 0.75 } }'}</style>
      {PIECES.map((p, i) => drawn.has(i) ? null : p.arc
        ? <path key={i} d={p.arc} fill="none" stroke="#2563eb" strokeWidth={6} strokeLinecap="round" />
        : <text key={i} x={p.x} y={p.y + 12} fill="#2563eb" fontSize={36} fontWeight={700} fontStyle="italic" fontFamily="sans-serif" textAnchor="middle">{p.digit}</text>)}
    </svg>
  );
}

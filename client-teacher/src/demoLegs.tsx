import { useEffect, useRef, useState } from 'react';
import type { SheetPlace } from './DemoVoice';

// The solo demo, Миша's pair: the teacher has said «клетки — это катеты». Pale blinking legs over their board
// show where to draw: AO goes 5 cells right along AD and 2 up, AB goes 4 up and 2 right (outside the figure).
// Coordinates of Миша's sheet from b2 (1600×900, a cell is 56: A(116,568), B(228,344), O(396,456)), shrunk to where
// it lies on the pair's board.

const AO = { color: '#e67e22', path: 'M116 568 H396 V456', labels: [{ x: 256, y: 600, t: '5' }, { x: 420, y: 520, t: '2' }] };
const AB = { color: '#8e44ad', path: 'M116 568 V344 H228', labels: [{ x: 90, y: 462, t: '4' }, { x: 172, y: 326, t: '2' }] };

export function LegsGhost({ at }: { at: SheetPlace }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  // over the board's page wherever it sits (it is fitted into the space and moves with the window)
  useEffect(() => {
    const place = () => {
      const host = ref.current?.parentElement;
      const page = host?.querySelector('[data-testid="board"]');
      if (!host || !page) return;
      const h = host.getBoundingClientRect(), p = page.getBoundingClientRect();
      setBox(b => (b && b.left === p.left - h.left && b.top === p.top - h.top && b.width === p.width && b.height === p.height)
        ? b : { left: p.left - h.left, top: p.top - h.top, width: p.width, height: p.height });
    };
    place();
    const t = setInterval(place, 400);
    return () => clearInterval(t);
  }, []);

  return (
    <div ref={ref} data-testid="legs-ghost" style={{ position: 'absolute', pointerEvents: 'none', ...(box ?? { display: 'none' }) }}>
      <style>{'@keyframes legs-blink { 0%, 100% { opacity: 0.15 } 50% { opacity: 0.6 } }'}</style>
      <svg viewBox="0 0 1600 900" width="100%" height="100%" style={{ animation: 'legs-blink 1.4s ease-in-out infinite' }}>
        <g transform={`translate(${at.x} ${at.y}) scale(${at.s})`}>
        {[AO, AB].map(l => (
          <g key={l.path} fill="none" stroke={l.color} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round">
            <path d={l.path} strokeDasharray="22 16" />
            {l.labels.map(s => (
              <text key={s.t + s.x} x={s.x} y={s.y} fill={l.color} stroke="none" fontSize={34} fontWeight={700} fontFamily="sans-serif" textAnchor="middle">{s.t}</text>
            ))}
          </g>
        ))}
        </g>
      </svg>
    </div>
  );
}

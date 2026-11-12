import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// In the demo: a control of the real lesson, shown pale so the visitor knows it is there; a tap tells what it does

const NOTE_W = 230;

export function DemoOff({ note, children, style }: { note: string; children: ReactNode; style?: CSSProperties }) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!at) return;
    const t = setTimeout(() => setAt(null), 5000);
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setAt(null); };
    window.addEventListener('pointerdown', away);
    return () => { clearTimeout(t); window.removeEventListener('pointerdown', away); };
  }, [at]);

  const open = () => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - NOTE_W - 8));
    const below = r.top + r.height / 2 < window.innerHeight / 2; // in the lower half: above the button
    setAt({ top: below ? r.bottom + 6 : r.top - 6, left });
  };

  return (
    <div ref={box} data-testid="demo-off" style={{ position: 'relative', ...style }}>
      {/* what is under the veil can't be pressed: the veil takes the tap */}
      <div aria-hidden style={{ opacity: 0.4, pointerEvents: 'none', filter: 'grayscale(0.6)' }}>{children}</div>
      <button type="button" aria-label={note} onClick={() => (at ? setAt(null) : open())}
        style={{ position: 'absolute', inset: 0, background: 'transparent', border: 'none', cursor: 'help', padding: 0 }} />
      {at && (
        <div role="note" data-testid="demo-off-note" style={{
          position: 'fixed', zIndex: 1000, width: NOTE_W, left: at.left,
          ...(at.top > (box.current?.getBoundingClientRect().top ?? 0) ? { top: at.top } : { bottom: window.innerHeight - at.top }),
          background: '#2b3a55', color: '#fff', fontSize: 13, lineHeight: 1.4, padding: '8px 10px', borderRadius: 8,
          boxShadow: '0 4px 14px rgba(0,0,0,0.25)', textAlign: 'left', fontWeight: 'normal',
        }}>
          <b>В настоящем уроке.</b> {note}
        </div>
      )}
    </div>
  );
}

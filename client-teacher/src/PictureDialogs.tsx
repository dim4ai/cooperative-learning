import { useEffect, useRef, useState, type CSSProperties } from 'react';

// The dialogs of BoardPictures.tsx: a PDF's pages to choose from, a note, the crop frame

export type Crop = { x: number; y: number; w: number; h: number };

export function PageChooser({ pages, onDone }: { pages: { count: number; render: (n: number, w: number) => Promise<string> }; onDone: (n: number | null) => void }) {
  const shown = Math.min(pages.count, 40);
  const [thumbs, setThumbs] = useState<string[]>([]);
  useEffect(() => {
    let stop = false;
    (async () => {
      for (let n = 1; n <= shown && !stop; n++) {
        const t = await pages.render(n, 220).catch(() => '');
        if (!stop) setThumbs(prev => [...prev, t]);
      }
    })();
    return () => { stop = true; };
  }, [pages, shown]);
  return (
    <div style={overlay} onClick={() => onDone(null)}>
      <div role="dialog" aria-label="Страница PDF" data-testid="pdf-pages" onClick={e => e.stopPropagation()} style={{ ...box, width: 760 }}>
        <h3 style={{ margin: 0 }}>Какую страницу вставить?</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, maxHeight: '60vh', overflowY: 'auto' }}>
          {Array.from({ length: shown }, (_, i) => (
            <button key={i} data-testid="pdf-page" onClick={() => onDone(i + 1)} style={{
              width: 130, padding: 4, border: '1px solid #ddd', borderRadius: 6, background: '#fff', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
            }}>
              {thumbs[i] ? <img src={thumbs[i]} alt="" style={{ width: '100%', display: 'block' }} /> : <div style={{ width: '100%', aspectRatio: '0.7', background: '#f3f3f3' }} />}
              <span style={{ fontSize: 12, color: '#555' }}>{i + 1}</span>
            </button>
          ))}
        </div>
        {pages.count > shown && <div style={{ fontSize: 12, color: '#888' }}>Показаны первые {shown} страниц из {pages.count}.</div>}
        <button onClick={() => onDone(null)} style={plain}>Отмена</button>
      </div>
    </div>
  );
}

export function Note({ text, onClose }: { text: string; onClose: () => void }) {
  return (
    <div style={overlay} onClick={onClose}>
      <div role="dialog" onClick={e => e.stopPropagation()} style={{ ...box, width: 380 }}>
        <div style={{ fontSize: 14, lineHeight: 1.45 }}>{text}</div>
        <button onClick={onClose} style={main}>Понятно</button>
      </div>
    </div>
  );
}

type Drag = { kind: 'new' | 'move' | 'nw' | 'ne' | 'sw' | 'se'; x: number; y: number; start: Crop };

/** The picture with a frame over it: drag across it for a new frame, inside it to move it, by a corner to resize */
export function Cropper({ img, action, onDone }: { img: HTMLImageElement; action: string; onDone: (c: Crop | null) => void }) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const whole: Crop = { x: 0, y: 0, w: W, h: H };
  const [crop, setCrop] = useState<Crop>(whole);
  const area = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const fit = () => {
      const k = Math.min((window.innerWidth * 0.86) / W, (window.innerHeight * 0.66) / H, 1.5);
      setView({ w: Math.round(W * k), h: Math.round(H * k) });
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [W, H]);
  const k = view.w / W || 1;

  const at = (e: React.PointerEvent) => {
    const r = area.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(W, (e.clientX - r.left) / k)), y: Math.max(0, Math.min(H, (e.clientY - r.top) / k)) };
  };
  const down = (e: React.PointerEvent, kind: Drag['kind']) => {
    e.stopPropagation();
    e.preventDefault();
    area.current!.setPointerCapture(e.pointerId);
    const p = at(e);
    drag.current = { kind, ...p, start: kind === 'new' ? { x: p.x, y: p.y, w: 0, h: 0 } : crop };
    if (kind === 'new') setCrop({ x: p.x, y: p.y, w: 0, h: 0 });
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = at(e);
    const s = d.start;
    if (d.kind === 'move') {
      setCrop({ ...s, x: Math.max(0, Math.min(W - s.w, s.x + p.x - d.x)), y: Math.max(0, Math.min(H - s.h, s.y + p.y - d.y)) });
      return;
    }
    // the fixed corner stays, the dragged one follows the pointer
    const fx = d.kind === 'new' ? d.x : d.kind === 'nw' || d.kind === 'sw' ? s.x + s.w : s.x;
    const fy = d.kind === 'new' ? d.y : d.kind === 'nw' || d.kind === 'ne' ? s.y + s.h : s.y;
    setCrop({ x: Math.min(fx, p.x), y: Math.min(fy, p.y), w: Math.abs(p.x - fx), h: Math.abs(p.y - fy) });
  };
  const up = () => {
    drag.current = null;
    setCrop(c => (c.w < 8 / k || c.h < 8 / k ? whole : c)); // a click, not a frame: all of it again
  };
  const done = () => {
    const c = { x: Math.round(crop.x), y: Math.round(crop.y), w: Math.round(crop.w), h: Math.round(crop.h) };
    onDone(c.w >= 2 && c.h >= 2 ? c : whole);
  };

  const handle = (kind: Drag['kind'], left: number, top: number) => (
    <div onPointerDown={e => down(e, kind)} style={{
      position: 'absolute', left: left - 7, top: top - 7, width: 14, height: 14, background: '#fff', border: '2px solid #4a90e2',
      borderRadius: 3, cursor: kind === 'nw' || kind === 'se' ? 'nwse-resize' : 'nesw-resize', touchAction: 'none',
    }} />
  );
  const fx = crop.x * k, fy = crop.y * k, fw = crop.w * k, fh = crop.h * k;
  const isWhole = crop.x === 0 && crop.y === 0 && crop.w === W && crop.h === H;

  return (
    <div style={overlay}>
      <div role="dialog" aria-label="Обрезать картинку" data-testid="cropper" style={{ ...box, width: 'auto', maxWidth: '96vw', alignItems: 'center' }}>
        <div style={{ fontSize: 13, color: '#555', alignSelf: 'stretch' }}>Обведите рамкой нужную часть. Рамку можно двигать и тянуть за углы.</div>
        <div ref={area} data-testid="crop-area" onPointerDown={e => down(e, 'new')} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
          style={{ position: 'relative', width: view.w, height: view.h, cursor: 'crosshair', touchAction: 'none', userSelect: 'none', flexShrink: 0 }}>
          <img src={img.src} alt="" draggable={false} style={{ width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }} />
          {/* what is cut off is dimmed: four strips around the frame */}
          <div style={{ ...dim, left: 0, top: 0, width: '100%', height: fy }} />
          <div style={{ ...dim, left: 0, top: fy + fh, width: '100%', bottom: 0 }} />
          <div style={{ ...dim, left: 0, top: fy, width: fx, height: fh }} />
          <div style={{ ...dim, left: fx + fw, top: fy, right: 0, height: fh }} />
          <div data-testid="crop-frame" onPointerDown={e => down(e, isWhole ? 'new' : 'move')} style={{
            position: 'absolute', left: fx, top: fy, width: fw, height: fh, boxSizing: 'border-box',
            border: '2px dashed #4a90e2', cursor: isWhole ? 'crosshair' : 'move', touchAction: 'none',
          }} />
          {handle('nw', fx, fy)}{handle('ne', fx + fw, fy)}{handle('sw', fx, fy + fh)}{handle('se', fx + fw, fy + fh)}
        </div>
        <div style={{ display: 'flex', gap: 8, alignSelf: 'stretch', alignItems: 'center' }}>
          <button data-testid="crop-done" onClick={done} style={main}>{isWhole ? `${action} целиком` : action}</button>
          {!isWhole && <button onClick={() => setCrop(whole)} style={secondary}>Всю картинку</button>}
          <button onClick={() => onDone(null)} style={{ ...plain, marginLeft: 'auto' }}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 12,
  fontFamily: 'sans-serif',
};
const box: CSSProperties = {
  background: '#fff', borderRadius: 10, padding: 16, boxSizing: 'border-box', maxWidth: '100%', maxHeight: '96vh',
  display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 8px 30px rgba(0,0,0,0.3)',
};
const dim: CSSProperties = { position: 'absolute', background: 'rgba(0,0,0,0.45)', pointerEvents: 'none' };
const main: CSSProperties = { padding: '9px 16px', borderRadius: 6, border: 'none', background: '#4a90e2', color: '#fff', fontSize: 14, cursor: 'pointer' };
const secondary: CSSProperties = { padding: '9px 14px', borderRadius: 6, border: '1px solid #c9b99c', background: '#fff', color: '#222', fontSize: 14, cursor: 'pointer' };
const plain: CSSProperties = { border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13 };

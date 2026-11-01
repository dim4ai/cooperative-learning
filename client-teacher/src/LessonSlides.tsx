// Lesson material (the .lesson.zip made in the editor) and presenting its slides to the class.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { socket } from './socket';
import { SlidePlayer, type Positions } from './slides/SlidePlayer';
import type { Scene } from './slides/model';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from './slides/model';

const API = import.meta.env.VITE_API_URL;

export interface MaterialBlock { id: string; type: string; title: string; slides?: Scene[] }
export interface Material { title: string; blocks: MaterialBlock[] }
export interface SlidesState {
  active: boolean;
  blockId: string | null;
  index: number;
  revealed: string[];
  positions: Record<string, { left: number; top: number }>;
}

const INITIAL: SlidesState = { active: false, blockId: null, index: 0, revealed: [], positions: {} };

/** Slide-related server events; mount once per lesson (re-registers after App's socket.off()) */
export function useTeacherSlides(lessonCode: string | null) {
  const [key, setKey] = useState<string | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [state, setState] = useState<SlidesState>(INITIAL);

  useEffect(() => {
    if (!lessonCode) return;
    const onKey = (k: string) => setKey(k);
    const onMaterial = (m: Material | null) => setMaterial(m);
    const onState = (s: SlidesState) => setState(s);
    // another teacher tab moved something
    const onMove = ({ uid, left, top }: { uid: string; left: number; top: number }) =>
      setState(s => ({ ...s, positions: { ...s.positions, [uid]: { left, top } } }));
    socket.on('slides:key', onKey);
    socket.on('slides:material', onMaterial);
    socket.on('slides:state', onState);
    socket.on('slides:move', onMove);
    return () => {
      socket.off('slides:key', onKey);
      socket.off('slides:material', onMaterial);
      socket.off('slides:state', onState);
      socket.off('slides:move', onMove);
      setKey(null); setMaterial(null); setState(INITIAL);
    };
  }, [lessonCode]);

  return { key, material, state, setState };
}

// ---------- sidebar: upload / remove ----------

export function MaterialPanel({ lessonCode, token, material, onUnauthorized }: {
  lessonCode: string; token: string; material: Material | null; onUnauthorized: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${API}/lessons/${lessonCode}/material`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/zip' },
        body: file,
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (res.status === 413) { setError('Файл слишком большой'); return; }
      if (!res.ok) {
        const { error: e } = await res.json().catch(() => ({ error: '' }));
        setError(e === 'not a zip archive' || e === 'no lesson.json in archive' || e === 'unsupported lesson format'
          ? 'Это не файл урока из редактора' : 'Не удалось загрузить урок');
      }
      // success: the server pushes the new material over the socket
    } catch {
      setError('Не удалось связаться с сервером');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function remove() {
    if (!confirm('Убрать урок с сервера?')) return;
    const res = await fetch(`${API}/lessons/${lessonCode}/material`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) onUnauthorized();
  }

  const slideCount = material?.blocks.reduce((n, b) => n + (b.slides?.length ?? 0), 0) ?? 0;

  return (
    <div data-testid="material-panel" style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, color: '#666' }}>Урок</div>
      {material ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis' }} title={material.title}>{material.title}</div>
            <div style={{ fontSize: 10, color: '#888' }}>слайдов: {slideCount}</div>
          </div>
          <button onClick={remove} title="Убрать урок с сервера" style={{ ...miniBtn, color: '#aaa' }}>✕</button>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#777' }}>не загружен</div>
      )}
      <input ref={inputRef} type="file" accept=".zip,application/zip" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} data-testid="material-input" />
      <button onClick={() => inputRef.current?.click()} disabled={busy} style={{
        marginTop: 4, width: '100%', padding: '5px 6px', borderRadius: 4, border: '1px dashed #555',
        background: 'transparent', color: '#aaa', fontSize: 11, cursor: 'pointer', textAlign: 'left',
      }}>
        {busy ? 'Загружаем…' : material ? 'Заменить урок…' : 'Загрузить урок…'}
      </button>
      {error && <div style={{ fontSize: 11, color: '#e74c3c', marginTop: 2 }}>{error}</div>}
    </div>
  );
}

// ---------- group stage: presenting ----------

export function SlidesPresenter({ lessonCode, mediaKey, material, state, setState }: {
  lessonCode: string;
  mediaKey: string | null;
  material: Material | null;
  state: SlidesState;
  setState: (fn: (s: SlidesState) => SlidesState) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 450 });
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const decks = material?.blocks.filter(b => (b.slides?.length ?? 0) > 0) ?? [];
  const deck = decks.find(b => b.id === state.blockId) ?? decks[0];
  const slides = deck?.slides ?? [];
  const index = deck?.id === state.blockId ? state.index : 0;
  const scene = slides[index];

  const goto = useCallback((blockId: string, i: number) => {
    socket.emit('slides:goto', { blockId, index: i });
  }, []);

  // ←/→ (PageUp/PageDown — presentation clickers) switch slides
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!deck || (e.target as HTMLElement).closest('input, textarea, select, .excalidraw')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); if (index < slides.length - 1) goto(deck.id, index + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); if (index > 0) goto(deck.id, index - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deck, index, slides.length, goto]);

  // Moves: show locally at once, send at most every 40 ms (+ the final position)
  const lastSent = useRef(0);
  const pending = useRef<number | undefined>(undefined);
  const onMove = useCallback((uid: string, left: number, top: number) => {
    setState(s => ({ ...s, positions: { ...s.positions, [uid]: { left, top } } }));
    const send = () => { lastSent.current = Date.now(); socket.emit('slides:move', { uid, left, top }); };
    clearTimeout(pending.current);
    if (Date.now() - lastSent.current >= 40) send();
    else pending.current = window.setTimeout(send, 40);
  }, [setState]);

  const revealed = useMemo(() => new Set(state.revealed), [state.revealed]);
  const resolve = useCallback(
    (name: string) => (mediaKey ? `${API}/lessons/${lessonCode}/media/${encodeURIComponent(name)}?k=${mediaKey}` : undefined),
    [lessonCode, mediaKey],
  );
  const width = Math.max(200, Math.floor(Math.min(box.w - 32, ((box.h - 16) * SLIDE_WIDTH) / SLIDE_HEIGHT)));
  const hiddenLeft = scene ? scene.objects.filter(o => o.studentHidden && !revealed.has(o.uid)).length : 0;

  if (!material) {
    return <Centered>Загрузите урок из редактора (слева, «Загрузить урок…»), чтобы показывать слайды</Centered>;
  }
  if (!deck) {
    return <Centered>В уроке «{material.title}» нет слайдов</Centered>;
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#2b2b36' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', color: '#ddd', fontSize: 13, background: '#23232c' }}>
        {decks.length > 1 ? (
          <select value={deck.id} onChange={e => goto(e.target.value, 0)} style={{ fontSize: 13, padding: '3px 6px', borderRadius: 4 }}>
            {decks.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        ) : <span>{deck.title}</span>}
        <button onClick={() => goto(deck.id, index - 1)} disabled={index === 0} style={navBtn} title="Предыдущий (←)">←</button>
        <span data-testid="slide-counter">{index + 1} / {slides.length}</span>
        <button onClick={() => goto(deck.id, index + 1)} disabled={index >= slides.length - 1} style={navBtn} title="Следующий (→)">→</button>
        <span style={{ color: '#999', fontSize: 12, marginLeft: 8 }}>
          {hiddenLeft > 0 ? `Скрыто от учеников: ${hiddenLeft} (бледные) — клик открывает` : ''}
        </span>
        <span style={{ flex: 1 }} />
        {!state.active && (
          <button onClick={() => socket.emit('slides:open', { blockId: deck.id })} style={{ ...navBtn, background: '#2ecc71', color: '#fff', border: 'none' }}>
            Показать классу
          </button>
        )}
        {state.active && <span style={{ color: '#2ecc71', fontSize: 12 }}>● ученики видят</span>}
      </div>
      <div ref={hostRef} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {scene && mediaKey && (
          <div style={{ boxShadow: '0 6px 24px rgba(0,0,0,.4)' }}>
            <SlidePlayer
              key={scene.id}
              scene={scene}
              resolveMedia={resolve}
              role="teacher"
              revealed={revealed}
              positions={state.positions as Positions}
              canDrag
              onToggleReveal={uid => socket.emit('slides:reveal', { uid, on: !revealed.has(uid) })}
              onMove={onMove}
              width={width}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#888', fontSize: 14, padding: 24, textAlign: 'center' }}>
      {children}
    </div>
  );
}

const navBtn: CSSProperties = {
  padding: '3px 10px', borderRadius: 4, border: '1px solid #444', background: '#2e2e3e', color: '#ddd', cursor: 'pointer', fontSize: 13,
};
const miniBtn: CSSProperties = {
  padding: '0 4px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 12,
};

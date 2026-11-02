// Lesson material (the .lesson.zip made in the editor) and presenting its slides to the class.
// The file is opened here, in the teacher's browser; the server gets only its structure and
// relays pictures to students when they need them (see lessonLocal.ts, mediaShare.ts).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { socket } from './socket';
import { SlidePlayer, type Positions } from './slides/SlidePlayer';
import type { Scene } from './slides/model';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from './slides/model';
import {
  readLesson, releaseLesson, lessonForServer, storedLessonFile, storeLessonFile, forgetLessonFile,
  NotALessonError, type LocalLesson,
} from './lessonLocal';
import { serveMedia } from './mediaShare';

const API = import.meta.env.VITE_API_URL;

export interface MaterialBlock { id: string; type: string; title: string; slides?: Scene[] }
/** The lesson as the server knows it */
export interface Material { id: string; title: string; blocks: MaterialBlock[] }
export interface SlidesState {
  active: boolean;
  blockId: string | null;
  index: number;
  revealed: string[];
  positions: Record<string, { left: number; top: number }>;
}

const INITIAL: SlidesState = { active: false, blockId: null, index: 0, revealed: [], positions: {} };

export interface TeacherSlides {
  /** what the server has (null — no lesson loaded) */
  material: Material | null;
  /** the lesson file opened in this browser, if it is the one the server has */
  local: LocalLesson | null;
  state: SlidesState;
  setState: (fn: (s: SlidesState) => SlidesState) => void;
  busy: boolean;
  error: string;
  open: (file: File) => Promise<void>;
  remove: () => Promise<void>;
  /** forget the file kept for this lesson (lesson ended) */
  forget: () => void;
}

function errorText(status: number): string {
  if (status === 413) return 'Урок слишком большой';
  if (status === 429) return 'Уроки открыты уже на трёх других занятиях — завершите их';
  if (status === 503) return 'Сервер сейчас перегружен, попробуйте чуть позже';
  return 'Не удалось открыть урок';
}

/** Slide-related server events; mount once per lesson (re-registers after App's socket.off()) */
export function useTeacherSlides(lessonCode: string | null, token: string | null, onUnauthorized: () => void): TeacherSlides {
  const [material, setMaterial] = useState<Material | null>(null);
  const [known, setKnown] = useState(false); // got the server's answer about the material at least once
  const [file, setFile] = useState<LocalLesson | null>(null);
  const [state, setState] = useState<SlidesState>(INITIAL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<LocalLesson | null>(null);
  fileRef.current = file;
  const auth = useRef({ token, onUnauthorized });
  auth.current = { token, onUnauthorized };

  useEffect(() => {
    if (!lessonCode) return;
    const onMaterial = (m: Material | null) => { setMaterial(m); setKnown(true); };
    const onState = (s: SlidesState) => setState(s);
    // another teacher tab moved something
    const onMove = ({ uid, left, top }: { uid: string; left: number; top: number }) =>
      setState(s => ({ ...s, positions: { ...s.positions, [uid]: { left, top } } }));
    socket.on('slides:material', onMaterial);
    socket.on('slides:state', onState);
    socket.on('slides:move', onMove);
    const stopServing = serveMedia(socket, hash => fileRef.current?.byHash.get(hash));
    return () => {
      socket.off('slides:material', onMaterial);
      socket.off('slides:state', onState);
      socket.off('slides:move', onMove);
      stopServing();
      setMaterial(null); setKnown(false); setState(INITIAL);
    };
  }, [lessonCode]);

  // The file kept from before a page reload
  useEffect(() => {
    if (!lessonCode) return;
    let cancelled = false;
    storedLessonFile(lessonCode).then(async blob => {
      if (!blob || cancelled) return;
      const l = await readLesson(blob).catch(() => null);
      if (cancelled) releaseLesson(l); else if (l) setFile(l);
    });
    return () => { cancelled = true; setFile(f => { releaseLesson(f); return null; }); };
  }, [lessonCode]);

  const send = useCallback(async (l: LocalLesson): Promise<boolean> => {
    const res = await fetch(`${API}/lessons/${lessonCode}/material`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${auth.current.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(lessonForServer(l)),
    });
    if (res.status === 401) { auth.current.onUnauthorized(); return false; }
    if (!res.ok) { setError(errorText(res.status)); return false; }
    return true; // the server pushes the new material over the socket
  }, [lessonCode]);

  // Server and this browser agree on the file → we are a source of its media.
  // Server lost it (restart) but we have it → send the structure again.
  const resent = useRef<string | null>(null);
  useEffect(() => {
    if (!known || !file) return;
    if (material?.id === file.id) socket.emit('media:source', { materialId: file.id });
    else if (!material && resent.current !== file.id) {
      resent.current = file.id;
      send(file).catch(() => {});
    }
  }, [known, material, file, send]);

  const open = useCallback(async (f: File) => {
    if (!lessonCode) return;
    setBusy(true);
    setError('');
    try {
      let l: LocalLesson;
      try { l = await readLesson(f); } catch (e) {
        setError(e instanceof NotALessonError ? 'Это не файл урока из редактора' : 'Не удалось прочитать файл');
        return;
      }
      if (!(await send(l))) { releaseLesson(l); return; }
      resent.current = l.id;
      await storeLessonFile(lessonCode, f);
      setFile(prev => { releaseLesson(prev); return l; });
    } catch {
      setError('Не удалось связаться с сервером');
    } finally {
      setBusy(false);
    }
  }, [lessonCode, send]);

  const forget = useCallback(() => {
    if (lessonCode) forgetLessonFile(lessonCode);
    setFile(prev => { releaseLesson(prev); return null; });
  }, [lessonCode]);

  const remove = useCallback(async () => {
    forget();
    const res = await fetch(`${API}/lessons/${lessonCode}/material`, { method: 'DELETE', headers: { Authorization: `Bearer ${auth.current.token}` } });
    if (res.status === 401) auth.current.onUnauthorized();
  }, [forget, lessonCode]);

  const local = file && material?.id === file.id ? file : null;
  return { material, local, state, setState, busy, error, open, remove, forget };
}

// ---------- sidebar: open / remove ----------

export function MaterialPanel({ slides }: { slides: TeacherSlides }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { material, local, busy, error } = slides;
  const slideCount = material?.blocks.reduce((n, b) => n + (b.slides?.length ?? 0), 0) ?? 0;

  function remove() {
    if (confirm('Убрать урок с занятия?')) slides.remove();
  }

  return (
    <div data-testid="material-panel" style={{ marginTop: 8 }}>
      <div style={{ fontSize: 10, color: '#666' }}>Урок</div>
      {material ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#ddd', overflow: 'hidden', textOverflow: 'ellipsis' }} title={material.title}>{material.title}</div>
            <div style={{ fontSize: 10, color: '#888' }}>слайдов: {slideCount}</div>
          </div>
          <button onClick={remove} title="Убрать урок с занятия" style={{ ...miniBtn, color: '#aaa' }}>✕</button>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#777' }}>не открыт</div>
      )}
      {material && !local && (
        <div data-testid="material-not-local" style={{ fontSize: 11, color: '#e6a23c', marginTop: 2 }}>
          Файл урока не открыт в этом браузере — ученики не получат картинки. Откройте его снова.
        </div>
      )}
      <input ref={inputRef} type="file" accept=".zip,application/zip" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) slides.open(f); e.target.value = ''; }} data-testid="material-input" />
      <button onClick={() => inputRef.current?.click()} disabled={busy} style={{
        marginTop: 4, width: '100%', padding: '5px 6px', borderRadius: 4, border: '1px dashed #555',
        background: 'transparent', color: '#aaa', fontSize: 11, cursor: 'pointer', textAlign: 'left',
      }}>
        {busy ? 'Открываем…' : material && local ? 'Заменить урок…' : 'Открыть урок…'}
      </button>
      {error && <div style={{ fontSize: 11, color: '#e74c3c', marginTop: 2 }}>{error}</div>}
    </div>
  );
}

// ---------- group stage: presenting ----------

export function SlidesPresenter({ slides: teacherSlides }: { slides: TeacherSlides }) {
  const { local, state, setState } = teacherSlides;
  // Without the file here the slides can still be navigated, just without pictures
  const material: { title: string; blocks: MaterialBlock[] } | null = local ?? teacherSlides.material;
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
  const resolve = useCallback((name: string) => local?.urls.get(name), [local]);
  const width = Math.max(200, Math.floor(Math.min(box.w - 32, ((box.h - 16) * SLIDE_WIDTH) / SLIDE_HEIGHT)));
  const hiddenLeft = scene ? scene.objects.filter(o => o.studentHidden && !revealed.has(o.uid)).length : 0;

  if (!material) {
    return <Centered>Откройте урок из редактора (слева, «Открыть урок…»), чтобы показывать слайды</Centered>;
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
        {scene && (
          <div style={{ boxShadow: '0 6px 24px rgba(0,0,0,.4)' }}>
            <SlidePlayer
              key={`${scene.id}:${local ? 'local' : 'none'}`}
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

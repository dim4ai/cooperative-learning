// Lesson material (the .colesson file made in the editor) and presenting its slides to the class.
// The file is opened here, in the teacher's browser; the server gets only its structure and
// relays pictures to students when they need them (see lessonLocal.ts, mediaShare.ts).
import { setRecordingLesson } from './recording';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { socket } from './socket';
import { SlidePlayer, type Positions } from './slides/SlidePlayer';
import { SLIDE_HEIGHT, SLIDE_WIDTH, type Scene } from './slides/model';
import { SharedBoard } from './SharedBoard';
import {
  readLesson, releaseLesson, lessonForServer, storedLessonFile, storeLessonFile, forgetLessonFile,
  NotALessonError, type LocalLesson, type LocalBlock,
} from './lessonLocal';
import { serveMedia } from './mediaShare';

const API = import.meta.env.VITE_API_URL;

export interface MaterialBlock { id: string; type: string; title: string; slides?: Scene[]; teacherNote?: string; task?: string; duration?: number | null }
/** The lesson as the server knows it */
export interface Material { id: string; title: string; blocks: MaterialBlock[] }
/** A task the teacher added during the lesson (server: addLiveBlock); without a file the material is only these */
export const isLiveBlock = (b: { id: string }) => b.id.startsWith('live-');
export const isLiveMaterial = (m: Material | null) => !!m && m.id.startsWith('live:');
export interface SlidesState {
  /** the lesson block running now */
  block: string | null;
  active: boolean;
  blockId: string | null;
  index: number;
  revealed: string[];
  positions: Record<string, { left: number; top: number }>;
}

export type UnderstoodMark = 'yes' | 'no';
export interface Understood { asking: boolean; marks: Record<string, UnderstoodMark> }
const NO_MARKS: Understood = { asking: false, marks: {} };

const INITIAL: SlidesState = { block: null, active: false, blockId: null, index: 0, revealed: [], positions: {} };

export interface TeacherSlides {
  /** what the server has (null — no lesson loaded) */
  material: Material | null;
  /** the lesson file opened in this browser, if it is the one the server has */
  local: LocalLesson | null;
  state: SlidesState;
  understood: Understood;
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
  const [understood, setUnderstood] = useState<Understood>(NO_MARKS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<LocalLesson | null>(null);
  fileRef.current = file;
  useEffect(() => setRecordingLesson(file), [file]);
  const auth = useRef({ token, onUnauthorized });
  auth.current = { token, onUnauthorized };

  useEffect(() => {
    if (!lessonCode) return;
    const onMaterial = (m: Material | null) => { setMaterial(m); setKnown(true); };
    const onState = (s: SlidesState) => setState(s);
    // another teacher tab moved something
    const onMove = ({ uid, left, top }: { uid: string; left: number; top: number }) =>
      setState(s => ({ ...s, positions: { ...s.positions, [uid]: { left, top } } }));
    socket.on('understood', setUnderstood);
    socket.on('slides:material', onMaterial);
    socket.on('slides:state', onState);
    socket.on('slides:move', onMove);
    const stopServing = serveMedia(socket, hash => fileRef.current?.byHash.get(hash));
    return () => {
      socket.off('understood', setUnderstood);
      socket.off('slides:material', onMaterial);
      socket.off('slides:state', onState);
      socket.off('slides:move', onMove);
      stopServing();
      setMaterial(null); setKnown(false); setState(INITIAL); setUnderstood(NO_MARKS);
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
  return { material, local, state, understood, setState, busy, error, open, remove, forget };
}

// ---------- sidebar: open / remove ----------

export function MaterialPanel({ slides }: { slides: TeacherSlides }) {
  const { local, busy, error } = slides;
  const material = isLiveMaterial(slides.material) ? null : slides.material;
  const slideCount = material?.blocks.reduce((n, b) => n + (b.slides?.length ?? 0), 0) ?? 0;

  return (
    <div data-testid="material-panel" style={{ marginTop: 8, textAlign: 'center' }}>
      <div style={{ fontSize: 11, color: '#222' }}>Урок</div>
      {material ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: '#222', overflow: 'hidden', textOverflow: 'ellipsis' }} title={material.title}>{material.title}</div>
            <div style={{ fontSize: 10, color: '#555' }}>слайдов: {slideCount}</div>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#222' }}>не открыт</div>
      )}
      {material && !local && (
        <div data-testid="material-not-local" style={{ fontSize: 11, color: '#b07800', marginTop: 2 }}>
          Файл урока не открыт в этом браузере — ученики не получат картинки. Откройте его снова.
        </div>
      )}
      {busy && <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>Открываем…</div>}
      {error && <div style={{ fontSize: 11, color: '#e74c3c', marginTop: 2 }}>{error}</div>}
    </div>
  );
}

// ---------- the lesson plan and the teacher's notes ----------

const TYPE_LABELS: Record<string, string> = { group: 'объяснение', individual: 'индивидуально', pairs: 'пары', fours: 'четвёрки' };

/** Left panel: the lesson's blocks, in order. The stage follows the block */
/** Time of the running block: what's left, then how much it has run over */
export function LessonPlan({ slides, stage }: { slides: TeacherSlides; stage: string }) {
  // the server's order: the tasks added during the lesson are in it too
  const blocks: MaterialBlock[] = slides.material?.blocks ?? slides.local?.blocks ?? [];
  const current = stage === 'waiting' ? null : slides.state.block;
  return (
    // about five blocks high, the rest scrolls: the sidebar keeps room for what's under the plan
    <div data-testid="lesson-plan" style={{ flex: '0 1 auto', minHeight: 60, maxHeight: 234, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, margin: '8px -4px 0', padding: '0 4px' }}>
      {blocks.map(b => {
        const on = b.id === current;
        return (
          <button key={b.id} data-testid="plan-block" data-current={on || undefined}
            ref={on ? el => el?.scrollIntoView({ block: 'nearest' }) : undefined} onClick={() => socket.emit('block:start', { blockId: b.id })} style={{
            flexShrink: 0, padding: '6px 7px', borderRadius: 6, border: 'none', cursor: 'pointer', textAlign: 'left',
            background: on ? '#4a90e2' : '#fff', color: on ? '#fff' : '#333',
          }}>
            <div style={{ fontSize: 12.5, fontWeight: on ? 'bold' : 'normal', lineHeight: 1.25 }}>{b.title || 'Без названия'}</div>
            <div style={{ fontSize: 10, marginTop: 2, color: on ? '#dbe9fa' : '#777' }}>
              {isLiveBlock(b) && <span data-testid="plan-block-added" title="Добавлено по ходу урока">＋ </span>}
              {TYPE_LABELS[b.type] ?? b.type}{b.duration ? ` · ${b.duration} мин` : ''}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/** Right panel: what this block asks of the teacher */
export function BlockNotes({ slides }: { slides: TeacherSlides }) {
  const { local, material, state } = slides;
  if (!material || !state.block) return null;
  const added = material.blocks.find(b => b.id === state.block && isLiveBlock(b));
  if (added) return (
    <div data-testid="block-notes" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {added.task && <div>
        <div style={noteLabel}>Задание</div>
        <div data-testid="block-task" style={noteText}>{added.task}</div>
      </div>}
      <div style={{ fontSize: 12, color: '#777' }}>Добавлено по ходу урока.</div>
    </div>
  );
  const block = local?.blocks.find(b => b.id === state.block);
  if (!local) return <div style={{ fontSize: 12, color: '#b57600' }}>Заметки лежат в файле урока: откройте его в этом браузере.</div>;
  if (!block) return null;
  const stepNote = (state.blockId === block.id ? block.slides[state.index]?.note : undefined)?.trim();
  return (
    <div data-testid="block-notes" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {block.type !== 'group' && block.slides.length > 1 && <div data-testid="sheet-nav" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#444' }}>
        <span>Лист</span>
        <button onClick={() => socket.emit('slides:goto', { index: state.index - 1 })} disabled={state.index === 0} style={navBtn} title="Предыдущий лист">←</button>
        <span data-testid="sheet-counter">{state.index + 1} / {block.slides.length}</span>
        <button onClick={() => socket.emit('slides:goto', { index: state.index + 1 })} disabled={state.index >= block.slides.length - 1} style={navBtn} title="Следующий лист">→</button>
      </div>}
      {block.task && <div>
        <div style={noteLabel}>Задание</div>
        <div data-testid="block-task" style={noteText}>{block.task}</div>
      </div>}
      <div>
        <div style={noteLabel}>Заметка учителю</div>
        <div data-testid="block-note" style={noteText}>{stepNote || block.teacherNote || 'Здесь заметки нет.'}</div>
      </div>
      <EarlierBoardsNote block={block} blocks={local.blocks} />
    </div>
  );
}

const noteLabel: CSSProperties = { fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 };
const noteText: CSSProperties = { whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.45, color: '#222' };

/** End of an explanation: ask the class, see the answers, drop the marks when they're of no more use */
export function UnderstoodPanel({ understood, canAsk, mapOpen, onToggleMap }: { understood: Understood; canAsk: boolean; mapOpen: boolean; onToggleMap: () => void }) {
  const answers = Object.values(understood.marks);
  const yes = answers.filter(a => a === 'yes').length;
  const no = answers.length - yes;
  const [asked, setAsked] = useState(false);
  useEffect(() => { if (understood.asking) setAsked(true); }, [understood.asking]);
  const hasResult = !understood.asking && (answers.length > 0 || (asked && canAsk));

  return (
    <div data-testid="understood-panel" style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid #e5e5e5', paddingTop: 10 }}>
      {understood.asking && <div style={{ fontSize: 13, color: '#666' }}>Ученики отвечают…</div>}
      {hasResult && (
        <div data-testid="understood-result" style={{ fontSize: 13, color: '#333' }}>
          {no === 0 && <div>Вопросов нет</div>}
          {answers.length > 0 && <><span style={{ color: '#1e8e4e' }}>Поняли: {yes}</span> · <span style={{ color: '#d00000' }}>Не поняли: {no}</span></>}
        </div>
      )}
      {canAsk && !understood.asking && (
        <button data-testid="understood-ask" onClick={() => socket.emit('understood:ask')} style={panelBtn}>Всем понятно?</button>
      )}
      {canAsk && !understood.asking && (
        <button data-testid="understood-map" onClick={onToggleMap} style={{ ...panelBtn, background: '#eef1f5', color: '#333' }}>{mapOpen ? '← К слайду' : 'Карта класса'}</button>
      )}
      {hasResult && answers.length > 0 && (
        <button data-testid="understood-clear" onClick={() => { setAsked(false); socket.emit('understood:clear'); }} style={{ ...panelBtn, background: 'transparent', color: '#777', border: '1px solid #ddd' }}>Сбросить отметки</button>
      )}
    </div>
  );
}

const panelBtn: CSSProperties = { padding: '8px 10px', borderRadius: 6, border: 'none', background: '#4a90e2', color: '#fff', fontSize: 13, cursor: 'pointer' };

// ---------- group stage: the board with the slide under it ----------

export function ExplainBoard({ slides: teacherSlides, readOnly }: { slides: TeacherSlides; readOnly?: boolean }) {
  const { local, state, setState } = teacherSlides;
  // Without the file here the slides can still be navigated, just without pictures
  const material: { blocks: MaterialBlock[] } | null = local ?? teacherSlides.material;
  const slides = (state.active && material?.blocks.find(b => b.id === state.blockId)?.slides) || [];
  const index = state.index;
  const scene = slides[index];

  const goto = useCallback((i: number) => { socket.emit('slides:goto', { index: i }); }, []);

  // ←/→ (PageUp/PageDown — presentation clickers) switch slides
  useEffect(() => {
    if (!slides.length) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); if (index < slides.length - 1) goto(index + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); if (index > 0) goto(index - 1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, slides.length, goto]);

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
  const hiddenLeft = scene ? scene.objects.filter(o => o.studentHidden && !revealed.has(o.uid)).length : 0;

  if (!scene) return <SharedBoard readOnly={readOnly} />;

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 10px', color: '#444', fontSize: 13, background: '#ece2d2', borderBottom: '1px solid #e0d4c0', flexShrink: 0 }}>
        <button onClick={() => goto(index - 1)} disabled={index === 0} style={navBtn} title="Предыдущий (←)">←</button>
        <span data-testid="slide-counter">{index + 1} / {slides.length}</span>
        <button onClick={() => goto(index + 1)} disabled={index >= slides.length - 1} style={navBtn} title="Следующий (→)">→</button>
        {hiddenLeft > 0 && <span data-testid="slide-hidden" style={{ color: '#777', fontSize: 12, marginLeft: 6 }}>Скрыто от учеников: {hiddenLeft}. Откройте инструментом ☝</span>}
      </div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <SharedBoard readOnly={readOnly} underlay={width => (
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
        )} />
      </div>
    </div>
  );
}

const navBtn: CSSProperties = {
  padding: '2px 10px', borderRadius: 4, border: '1px solid #ccc', background: '#fff', color: '#333', cursor: 'pointer', fontSize: 13,
};

// ---------- before the lesson: the teacher looks through the lesson alone ----------

/** Only here: nothing goes to the server, students see nothing of it */
export function LessonPreview({ slides: teacherSlides }: { slides: TeacherSlides }) {
  const { local } = teacherSlides;
  const blocks = local?.blocks ?? [];
  const [blockId, setBlockId] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const block = blocks.find(b => b.id === blockId) ?? blocks[0];
  const scenes = block?.slides ?? [];
  const scene = scenes[Math.min(index, scenes.length - 1)];
  const at = scene ? scenes.indexOf(scene) : 0;

  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [local]);
  const width = Math.floor(Math.min(box.w, box.h * SLIDE_WIDTH / SLIDE_HEIGHT));

  const go = useCallback((i: number) => setIndex(Math.max(0, Math.min(i, scenes.length - 1))), [scenes.length]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea, select')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); go(at + 1); }
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); go(at - 1); }
      // ↑/↓ — the previous / next block, from its first slide
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const i = blocks.findIndex(b => b.id === block?.id) + (e.key === 'ArrowDown' ? 1 : -1);
        if (i >= 0 && i < blocks.length) { setBlockId(blocks[i].id); setIndex(0); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, go, blocks, block]);
  // the chosen block stays in sight in the list
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[data-current]')?.scrollIntoView({ block: 'nearest' });
  }, [block?.id]);

  const resolve = useCallback((name: string) => local?.urls.get(name), [local]);
  const nothingRevealed = useMemo(() => new Set<string>(), []);

  if (!local) return (
    <div data-testid="preview-no-file" style={{ padding: 24, color: '#555', fontSize: 14 }}>
      Чтобы посмотреть урок, откройте его файл в этом браузере: «Открыть урок…» слева.
    </div>
  );

  const note = (scene?.note?.trim()) || block?.teacherNote || '';
  return (
    <div data-testid="lesson-preview" style={{ height: '100%', display: 'flex', minHeight: 0 }}>
      <div ref={listRef} style={{ width: 190, flexShrink: 0, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 4, borderRight: '1px solid #e0d4c0' }}>
        {blocks.map(b => {
          const on = b.id === block?.id;
          return (
            <button key={b.id} data-testid="preview-block" data-current={on || undefined} onClick={() => { setBlockId(b.id); setIndex(0); }} style={{
              flexShrink: 0, padding: '6px 7px', borderRadius: 6, border: '1px solid #d6c8b0', cursor: 'pointer', textAlign: 'left',
              background: on ? '#4a90e2' : '#fff', color: on ? '#fff' : '#333',
            }}>
              <div style={{ fontSize: 12.5, fontWeight: on ? 'bold' : 'normal', lineHeight: 1.25 }}>{b.title || 'Без названия'}</div>
              <div style={{ fontSize: 10, marginTop: 2, color: on ? '#dbe9fa' : '#777' }}>
                {TYPE_LABELS[b.type] ?? b.type}{b.duration ? ` · ${b.duration} мин` : ''}
              </div>
            </button>
          );
        })}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', color: '#444', fontSize: 13, flexShrink: 0 }}>
          {scenes.length > 0 ? (<>
            <button onClick={() => go(at - 1)} disabled={at === 0} style={navBtn} title="Предыдущий (←)">←</button>
            <span data-testid="preview-counter">{at + 1} / {scenes.length}</span>
            <button onClick={() => go(at + 1)} disabled={at >= scenes.length - 1} style={navBtn} title="Следующий (→)">→</button>
          </>) : <span>В этом блоке нет слайдов</span>}
          <span style={{ marginLeft: 'auto', color: '#888', fontSize: 12 }}>← → слайды, ↑ ↓ блоки · ученики этого не видят</span>
        </div>
        {/* the task above the sheet, as the students will have it */}
        {block?.task && (
          <div data-testid="preview-task" style={{
            flexShrink: 0, maxHeight: '30%', overflowY: 'auto', padding: '8px 12px', whiteSpace: 'pre-wrap', margin: '0 12px 8px',
            fontSize: 15, lineHeight: 1.4, color: '#222', background: '#f1f5fb', borderRadius: 6,
          }}>{block.task}</div>
        )}
        <div ref={hostRef} style={{ flex: 1, minHeight: 0, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '0 12px 12px' }}>
          {scene && width > 0 && (
            <div style={{ width, boxShadow: '0 1px 6px rgba(0,0,0,0.15)', background: '#fff' }}>
              <SlidePlayer key={scene.id} scene={scene} resolveMedia={resolve} role="teacher" revealed={nothingRevealed} canDrag={false} width={width} />
            </div>
          )}
        </div>
      </div>
      <div style={{ width: 'min(260px, 24vw)', flexShrink: 0, overflowY: 'auto', padding: 14, boxSizing: 'border-box', borderLeft: '1px solid #e0d4c0', background: '#fbf7f0', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div>
          <div style={noteLabel}>Заметка учителю</div>
          <div data-testid="preview-note" style={noteText}>{note || 'Здесь заметки нет.'}</div>
        </div>
        {block && <EarlierBoardsNote block={block} blocks={blocks} />}
      </div>
    </div>
  );
}

/** Which earlier stages' boards the students see in this block (the lesson file says so) */
function EarlierBoardsNote({ block, blocks }: { block: LocalBlock; blocks: LocalBlock[] }) {
  const titles = block.boardsFrom.map(id => blocks.find(b => b.id === id)).filter(b => !!b).map(b => `«${b!.title || TYPE_LABELS[b!.type] || 'Без названия'}»`);
  if (!titles.length) return null;
  return (
    // after the teacher's note, set a little apart from it
    <div style={{ marginTop: 10 }}>
      <div style={noteLabel}>Ученики видят свои предыдущие доски</div>
      <div data-testid="earlier-boards-note" style={noteText}>{titles.join(', ')}</div>
    </div>
  );
}

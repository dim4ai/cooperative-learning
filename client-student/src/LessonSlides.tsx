// Slides the teacher is showing. The server sends only the current slide (hidden objects
// already removed) and the next one for preloading; moves of ✋ objects come as events.
// Pictures come piece by piece through the server (server/src/mediaRelay.ts) — from the teacher,
// or from a classmate who already has them; once here, we can pass them on to others too.
import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from './socket';
import { SharedBoard } from './SharedBoard';
import { Board, type BoardLink, type BoardObject } from './slides/Board';
import { SlidePlayer, type Positions } from './slides/SlidePlayer';
import type { Scene } from './slides/model';
import { sceneMediaNames } from './slides/model';
import { serveMedia } from './mediaShare';

export interface MediaInfo { hash: string; size: number; type: string }

export type SlidesView = (
  | { active: false }
  | { active: true; index: number; count: number; scene: Scene; next: Scene | null; media: Record<string, MediaInfo> }
) & {
  /** work blocks: what to do, shown above the board */
  task?: string;
  /** work blocks: the sheet is only to look at */
  readOnly?: boolean;
};

/** Boards of earlier stages the lesson shows in this one: what this student's room wrote there */
export interface EarlierBoards {
  blocks: { id: string; title: string; type: string; sheets: { scene: Scene | null; objects: BoardObject[] }[] }[];
  media: Record<string, MediaInfo>;
}
const NO_EARLIER: EarlierBoards = { blocks: [], media: {} };

export interface StudentSlides {
  view: SlidesView;
  earlier: EarlierBoards;
  /** a picture of an earlier sheet by name; asks for it if it isn't here */
  resolveEarlier: (name: string) => string | undefined;
  positions: Positions;
  resolve: (name: string) => string | undefined;
  /** media of the current slide not here yet: 0..1 of its bytes received; null if nothing is missing */
  loading: number | null;
  /** changes whenever a file of the current slide arrives */
  readyKey: string;
}

const NONE: SlidesView = { active: false };
const NO_REVEALED: ReadonlySet<string> = new Set();

interface Incoming { parts: ArrayBuffer[]; got: number; size: number; type: string }

function sceneHashes(view: SlidesView, which: 'scene' | 'next'): string[] {
  if (!view.active) return [];
  const s = which === 'scene' ? view.scene : view.next;
  const out: string[] = [];
  for (const name of sceneMediaNames(s?.objects ?? [])) {
    const h = view.media[name]?.hash;
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

export function useStudentSlides(joined: boolean): StudentSlides {
  const [view, setView] = useState<SlidesView>(NONE);
  const [positions, setPositions] = useState<Positions>({});
  const [earlier, setEarlier] = useState<EarlierBoards>(NO_EARLIER);
  const earlierRef = useRef<EarlierBoards>(NO_EARLIER);
  const [, setTick] = useState(0); // re-render when files arrive / progress moves
  const sceneId = useRef<string | null>(null);
  const viewRef = useRef<SlidesView>(NONE);
  const files = useRef(new Map<string, { blob: Blob; url: string }>()); // hash → received file
  const incoming = useRef(new Map<string, Incoming>());
  const lastTick = useRef(0);

  const bump = useCallback((force: boolean) => {
    const now = Date.now();
    if (!force && now - lastTick.current < 200) return; // progress: a few times a second is plenty
    lastTick.current = now;
    setTick(t => t + 1);
  }, []);

  /** Ask for whatever the current and next slide need and we don't have or aren't getting */
  const wantMissing = useCallback(() => {
    const v = viewRef.current;
    const hashes = [...sceneHashes(v, 'scene'), ...sceneHashes(v, 'next')]
      .filter(h => !files.current.has(h) && !incoming.current.has(h));
    if (hashes.length) socket.emit('media:want', { hashes });
  }, []);

  useEffect(() => {
    if (!joined) return;
    let fresh = true; // first view after (re)connecting: tell the server what we already have
    const onConnect = () => { fresh = true; incoming.current.clear(); };
    const onView = (v: SlidesView) => {
      const id = v.active ? v.scene.id : null;
      if (id !== sceneId.current) setPositions({}); // positions arrive baked into a new scene
      sceneId.current = id;
      viewRef.current = v;
      setView(v);
      if (fresh && files.current.size) socket.emit('media:have', { hashes: [...files.current.keys()] });
      fresh = false;
      wantMissing();
    };
    const onEarlier = (e: EarlierBoards) => { earlierRef.current = e; setEarlier(e); };
    const onMove = ({ sceneId: sid, uid, left, top }: { sceneId: string; uid: string; left: number; top: number }) => {
      if (sid === sceneId.current) setPositions(p => ({ ...p, [uid]: { left, top } }));
    };
    const onBegin = ({ hash, size, type }: { hash: string; size: number; type: string }) => {
      if (!files.current.has(hash)) incoming.current.set(hash, { parts: [], got: 0, size, type });
    };
    const onChunk = ({ hash, data, last }: { hash: string; seq: number; data: ArrayBuffer; last: boolean }, ack?: () => void) => {
      ack?.(); // right away: the server measures how fast we receive
      const inc = incoming.current.get(hash);
      if (!inc) return;
      inc.parts.push(data);
      inc.got += data.byteLength;
      if (last) {
        incoming.current.delete(hash);
        const blob = new Blob(inc.parts, { type: inc.type });
        files.current.set(hash, { blob, url: URL.createObjectURL(blob) });
        bump(true);
      } else bump(false);
    };
    const onAbort = ({ hash }: { hash: string }) => {
      incoming.current.delete(hash);
      setTimeout(wantMissing, 1500); // ask again; the server picks another source
    };
    socket.on('connect', onConnect);
    socket.on('slides:view', onView);
    socket.on('slides:move', onMove);
    socket.on('earlierBoards', onEarlier);
    socket.on('media:begin', onBegin);
    socket.on('media:chunk', onChunk);
    socket.on('media:abort', onAbort);
    const stopServing = serveMedia(socket, hash => files.current.get(hash)?.blob);
    return () => {
      socket.off('connect', onConnect);
      socket.off('slides:view', onView);
      socket.off('slides:move', onMove);
      socket.off('earlierBoards', onEarlier);
      socket.off('media:begin', onBegin);
      socket.off('media:chunk', onChunk);
      socket.off('media:abort', onAbort);
      stopServing();
      for (const f of files.current.values()) URL.revokeObjectURL(f.url);
      files.current.clear();
      incoming.current.clear();
      viewRef.current = NONE;
      setView(NONE); setPositions({});
      earlierRef.current = NO_EARLIER; setEarlier(NO_EARLIER);
      sceneId.current = null;
    };
  }, [joined, wantMissing, bump]);

  const resolve = useCallback((name: string) => {
    const v = viewRef.current;
    const h = v.active ? v.media[name]?.hash : undefined;
    return h ? files.current.get(h)?.url : undefined;
  }, []);

  const resolveEarlier = useCallback((name: string) => {
    const h = earlierRef.current.media[name]?.hash;
    if (!h) return undefined;
    const f = files.current.get(h);
    if (!f && !incoming.current.has(h)) socket.emit('media:want', { hashes: [h] });
    return f?.url;
  }, []);

  const current = sceneHashes(view, 'scene');
  const missing = current.filter(h => !files.current.has(h));
  let loading: number | null = null;
  if (missing.length && view.active) {
    const info = new Map(Object.values(view.media).map(m => [m.hash, m.size]));
    const total = missing.reduce((n, h) => n + (info.get(h) ?? 0), 0);
    const got = missing.reduce((n, h) => n + (incoming.current.get(h)?.got ?? 0), 0);
    loading = total ? got / total : 0;
  }
  const readyKey = `${current.length - missing.length}`;

  const earlierReady = Object.values(earlier.media).filter(m => files.current.has(m.hash)).length;
  return { view, earlier, resolveEarlier, positions, resolve, loading, readyKey: `${readyKey}:${earlierReady}` };
}

/** A work block's board: the task above it, the sheet under what the group writes;
 *  tabs with the boards of earlier stages when the lesson shows them here */
export function WorkBoard({ slides }: { slides: StudentSlides }) {
  const { view, earlier } = slides;
  const [tab, setTab] = useState<string | null>(null); // null: the board of now
  const shown = earlier.blocks.find(b => b.id === tab);
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {view.task && (
        <div data-testid="work-task" style={{
          flexShrink: 0, maxHeight: '30%', overflowY: 'auto', padding: '8px 12px', whiteSpace: 'pre-wrap',
          fontSize: 15, lineHeight: 1.4, color: '#222', background: '#f1f5fb', borderRadius: 6,
        }}>{view.task}</div>
      )}
      {earlier.blocks.length > 0 && (
        <div data-testid="board-tabs" style={{ flexShrink: 0, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          <BoardTab on={!shown} onClick={() => setTab(null)} testId="board-tab-now">Сейчас</BoardTab>
          {earlier.blocks.map(b => (
            <BoardTab key={b.id} on={shown?.id === b.id} onClick={() => setTab(b.id)} testId="board-tab-earlier">
              {b.title || STAGE_TITLES[b.type] || 'Прошлый этап'}
            </BoardTab>
          ))}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        {shown
          ? <EarlierBoard key={shown.id} block={shown} slides={slides} />
          : <SharedBoard readOnly={view.readOnly} underlay={view.active ? width => <SlideUnderlay slides={slides} width={width} /> : undefined} />}
      </div>
    </div>
  );
}

/** The current slide under the teacher's drawing, at the board's page width */
export function SlideUnderlay({ slides, width }: { slides: StudentSlides; width: number }) {
  const { view } = slides;
  if (!view.active) return null;
  return (
    <div data-testid="student-slides" style={{ position: 'relative', width }}>
      <SlidePlayer
        key={`${view.scene.id}:${slides.readyKey}`}
        scene={view.scene}
        resolveMedia={slides.resolve}
        role="student"
        revealed={NO_REVEALED}
        positions={slides.positions}
        canDrag={false}
        width={width}
      />
      {view.count > 1 && <div style={{ position: 'absolute', bottom: 6, right: 8, fontSize: 12, lineHeight: 1, color: '#999' }}>
        {view.index + 1} / {view.count}
      </div>}
      {slides.loading !== null && (
        <div data-testid="slide-loading" style={{ position: 'absolute', bottom: 6, left: 8, fontSize: 12, lineHeight: 1, color: '#999' }}>
          загружаются картинки… {Math.round(slides.loading * 100)}%
        </div>
      )}
    </div>
  );
}

const STAGE_TITLES: Record<string, string> = { individual: 'Индивидуальная работа', pairs: 'Пары', fours: 'Четвёрки' };

function BoardTab({ on, onClick, testId, children }: { on: boolean; onClick: () => void; testId: string; children: React.ReactNode }) {
  return (
    <button onClick={onClick} data-testid={testId} style={{
      padding: '4px 12px', borderRadius: 6, fontSize: 13, cursor: 'pointer',
      border: on ? '1px solid #4a90e2' : '1px solid #d5dbe3',
      background: on ? '#e7f1fc' : '#fff', color: '#222', fontWeight: on ? 600 : 400,
    }}>{children}</button>
  );
}

/** An earlier stage's board as it was left: only to look at, sheet by sheet */
function EarlierBoard({ block, slides }: { block: EarlierBoards['blocks'][number]; slides: StudentSlides }) {
  const [page, setPage] = useState(0);
  const sheet = block.sheets[Math.min(page, block.sheets.length - 1)];
  const link: BoardLink = { send: () => {}, subscribe: (_op, onState) => { onState(sheet.objects); return () => {}; } };
  const scene = sheet.scene;
  return (
    <div data-testid="earlier-board" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <Board key={page} role="student" readOnly link={link} underlay={scene ? width => (
          <SlidePlayer key={`${scene.id}:${slides.readyKey}`} scene={scene} resolveMedia={slides.resolveEarlier} role="student"
            revealed={NO_REVEALED} canDrag={false} width={width} />
        ) : undefined} />
      </div>
      {block.sheets.length > 1 && (
        <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 10, padding: 4, fontSize: 13 }}>
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}>←</button>
          <span>{page + 1} / {block.sheets.length}</span>
          <button disabled={page >= block.sheets.length - 1} onClick={() => setPage(p => p + 1)}>→</button>
        </div>
      )}
    </div>
  );
}

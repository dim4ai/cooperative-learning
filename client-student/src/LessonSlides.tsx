// Slides the teacher is showing. The server sends only the current slide (hidden objects
// already removed) and the next one for preloading; moves of ✋ objects come as events.
// Pictures come piece by piece through the server (server/src/mediaRelay.ts) — from the teacher,
// or from a classmate who already has them; once here, we can pass them on to others too.
import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from './socket';
import { SharedBoard } from './SharedBoard';
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

export interface StudentSlides {
  view: SlidesView;
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
    socket.on('media:begin', onBegin);
    socket.on('media:chunk', onChunk);
    socket.on('media:abort', onAbort);
    const stopServing = serveMedia(socket, hash => files.current.get(hash)?.blob);
    return () => {
      socket.off('connect', onConnect);
      socket.off('slides:view', onView);
      socket.off('slides:move', onMove);
      socket.off('media:begin', onBegin);
      socket.off('media:chunk', onChunk);
      socket.off('media:abort', onAbort);
      stopServing();
      for (const f of files.current.values()) URL.revokeObjectURL(f.url);
      files.current.clear();
      incoming.current.clear();
      viewRef.current = NONE;
      setView(NONE); setPositions({});
      sceneId.current = null;
    };
  }, [joined, wantMissing, bump]);

  const resolve = useCallback((name: string) => {
    const v = viewRef.current;
    const h = v.active ? v.media[name]?.hash : undefined;
    return h ? files.current.get(h)?.url : undefined;
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

  return { view, positions, resolve, loading, readyKey };
}

/** A work block's board: the task above it, the sheet under what the group writes */
export function WorkBoard({ slides }: { slides: StudentSlides }) {
  const { view } = slides;
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {view.task && (
        <div data-testid="work-task" style={{
          flexShrink: 0, maxHeight: '30%', overflowY: 'auto', padding: '8px 12px', whiteSpace: 'pre-wrap',
          fontSize: 15, lineHeight: 1.4, color: '#222', background: '#f1f5fb', borderRadius: 6,
        }}>{view.task}</div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <SharedBoard readOnly={view.readOnly} underlay={view.active ? width => <SlideUnderlay slides={slides} width={width} /> : undefined} />
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

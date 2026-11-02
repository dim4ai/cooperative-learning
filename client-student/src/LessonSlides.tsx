// Slides the teacher is showing. The server sends only the current slide (hidden objects
// already removed) and the next one for preloading; moves of ✋ objects come as events.
// Pictures come piece by piece through the server (server/src/mediaRelay.ts) — from the teacher,
// or from a classmate who already has them; once here, we can pass them on to others too.
import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from './socket';
import { SlidePlayer, type Positions } from './slides/SlidePlayer';
import type { Scene } from './slides/model';
import { SLIDE_HEIGHT, SLIDE_WIDTH, sceneMediaNames } from './slides/model';
import { serveMedia } from './mediaShare';

export interface MediaInfo { hash: string; size: number; type: string }

export type SlidesView =
  | { active: false }
  | { active: true; index: number; count: number; scene: Scene; next: Scene | null; media: Record<string, MediaInfo> };

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

/** The current slide, fitted into the available space */
export function SlideStage({ slides }: { slides: StudentSlides }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 450 });
  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { view } = slides;
  // GroupView overlays the cameras on the right (teacher 200px, self 160px) — keep the slide clear of them
  const CAMERA_COLUMN = 232;
  const width = Math.max(200, Math.floor(Math.min(box.w - 32 - CAMERA_COLUMN, ((box.h - 48) * SLIDE_WIDTH) / SLIDE_HEIGHT)));

  return (
    <div ref={hostRef} data-testid="student-slides" style={{
      width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#2b2b36',
      paddingRight: 232, boxSizing: 'border-box',
    }}>
      {view.active && (
        <div style={{ position: 'relative', boxShadow: '0 6px 24px rgba(0,0,0,.4)' }}>
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
          <div style={{ position: 'absolute', bottom: -22, right: 0, fontSize: 12, color: '#999' }}>
            {view.index + 1} / {view.count}
          </div>
          {slides.loading !== null && (
            <div data-testid="slide-loading" style={{ position: 'absolute', bottom: -22, left: 0, fontSize: 12, color: '#999' }}>
              загружаются картинки… {Math.round(slides.loading * 100)}%
            </div>
          )}
        </div>
      )}
    </div>
  );
}

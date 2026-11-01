// Slides the teacher is showing. The server sends only the current slide (hidden objects
// already removed) and the next one for preloading; moves of ✋ objects come as events.
import { useCallback, useEffect, useRef, useState } from 'react';
import { socket, lessonId } from './socket';
import { SlidePlayer, type Positions } from './slides/SlidePlayer';
import type { Scene } from './slides/model';
import { SLIDE_HEIGHT, SLIDE_WIDTH } from './slides/model';

const API = import.meta.env.VITE_API_URL;

export type SlidesView =
  | { active: false }
  | { active: true; index: number; count: number; scene: Scene; next: Scene | null };

export interface StudentSlides {
  view: SlidesView;
  positions: Positions;
  resolve: (name: string) => string | undefined;
}

const NONE: SlidesView = { active: false };
const NO_REVEALED: ReadonlySet<string> = new Set();

export function useStudentSlides(joined: boolean): StudentSlides {
  const [key, setKey] = useState<string | null>(null);
  const [view, setView] = useState<SlidesView>(NONE);
  const [positions, setPositions] = useState<Positions>({});
  const sceneId = useRef<string | null>(null);

  useEffect(() => {
    if (!joined) return;
    const onKey = (k: string) => setKey(k);
    const onView = (v: SlidesView) => {
      const id = v.active ? v.scene.id : null;
      if (id !== sceneId.current) setPositions({}); // positions arrive baked into a new scene
      sceneId.current = id;
      setView(v);
    };
    const onMove = ({ sceneId: sid, uid, left, top }: { sceneId: string; uid: string; left: number; top: number }) => {
      if (sid === sceneId.current) setPositions(p => ({ ...p, [uid]: { left, top } }));
    };
    socket.on('slides:key', onKey);
    socket.on('slides:view', onView);
    socket.on('slides:move', onMove);
    return () => {
      socket.off('slides:key', onKey);
      socket.off('slides:view', onView);
      socket.off('slides:move', onMove);
      setKey(null); setView(NONE); setPositions({});
      sceneId.current = null;
    };
  }, [joined]);

  const resolve = useCallback(
    (name: string) => (key ? `${API}/lessons/${lessonId}/media/${encodeURIComponent(name)}?k=${key}` : undefined),
    [key],
  );

  // Warm the browser cache with the next slide's images while this one is shown
  useEffect(() => {
    if (!view.active || !view.next) return;
    for (const o of view.next.objects) {
      if (!o.mediaName) continue;
      const url = resolve(o.mediaName);
      if (!url) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous'; // same mode as the player, so the cached copy is reused
      img.src = url;
    }
  }, [view, resolve]);

  return { view, positions, resolve };
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
            key={view.scene.id}
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
        </div>
      )}
    </div>
  );
}

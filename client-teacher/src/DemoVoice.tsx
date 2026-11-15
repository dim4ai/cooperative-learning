import { useEffect, useRef, useState } from 'react';

// The solo demo's voiced dialogues: the server says when a line begins in a room; the teacher hears it only
// at that room's board, coming in mid-line as into a real conversation

interface Clip { room: string; src: string; ms: number; startedAt: number; who?: string } // startedAt: on this computer's clock

const latest = new Map<string, Clip>();
const listeners = new Set<() => void>();

/** From the socket: { room, src, ms, now } with now on the server's clock */
export function demoVoiceHeard(c: { room: string; src: string; ms: number; now: number; who?: string }) {
  latest.set(c.room, { room: c.room, src: c.src, ms: c.ms, startedAt: Date.now(), who: c.who });
  listeners.forEach(f => f());
}

/** Who is saying a line in this room right now (a bot's name, or 'Teacher'): their tile lights up */
export function useDemoSpeaker(room: string | null): string | null {
  const [, setTick] = useState(0);
  useEffect(() => {
    const f = () => setTick(n => n + 1);
    listeners.add(f);
    const t = setInterval(f, 300);
    return () => { listeners.delete(f); clearInterval(t); };
  }, []);
  const c = room ? latest.get(room) : undefined;
  return c?.who && Date.now() - c.startedAt < c.ms ? c.who : null;
}

export function demoVoiceReset() {
  latest.clear();
  listeners.forEach(f => f());
}

let lastStage: string | null = null;

export function DemoVoice({ room, stage }: { room: string | null; stage: string }) {
  const [, setTick] = useState(0);
  // a new stage starts its talk from scratch (not a remount: coming into a room openly rebuilds the screen)
  useEffect(() => { if (lastStage !== null && lastStage !== stage) demoVoiceReset(); lastStage = stage; }, [stage]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const playing = useRef<Clip | null>(null);
  const stopLater = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const f = () => setTick(n => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);

  const clip = room ? latest.get(room) ?? null : null;
  useEffect(() => {
    const stop = () => { audio.current?.pause(); audio.current = null; playing.current = null; };
    clearTimeout(stopLater.current);
    // no room for a moment: the page reconnects (coming in openly, say) — the line goes on unless they stay away
    if (!clip) { if (playing.current) stopLater.current = setTimeout(stop, 2500); return; }
    if (playing.current === clip) return;
    const offset = Date.now() - clip.startedAt;
    if (offset >= clip.ms - 150) { stop(); return; } // over already: silence till the next line
    stop();
    const a = new Audio(clip.src.startsWith('/') ? import.meta.env.BASE_URL + clip.src.slice(1) : clip.src);
    audio.current = a;
    playing.current = clip;
    // coming in mid-line: from where it is now; a line just begun plays from its start (loading takes a moment,
    // and skipping it would swallow the first sounds)
    if (offset > 1000) a.addEventListener('loadedmetadata', () => { a.currentTime = Math.max(0, (Date.now() - clip.startedAt) / 1000); }, { once: true });
    a.play().catch(() => { /* no sound allowed yet: the next line will try again */ });
  }, [clip]);

  useEffect(() => () => { audio.current?.pause(); }, []);
  return null;
}

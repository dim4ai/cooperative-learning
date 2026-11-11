import { useEffect, useRef, useState } from 'react';

// The solo demo's voiced dialogues: the server says when a line begins in a room; the teacher hears it only
// at that room's board, coming in mid-line as into a real conversation

interface Clip { room: string; src: string; ms: number; startedAt: number } // startedAt: on this computer's clock

const latest = new Map<string, Clip>();
const listeners = new Set<() => void>();

/** From the socket: { room, src, ms, now } with now on the server's clock */
export function demoVoiceHeard(c: { room: string; src: string; ms: number; now: number }) {
  latest.set(c.room, { room: c.room, src: c.src, ms: c.ms, startedAt: Date.now() });
  listeners.forEach(f => f());
}

export function demoVoiceReset() {
  latest.clear();
  listeners.forEach(f => f());
}

export function DemoVoice({ room, stage }: { room: string | null; stage: string }) {
  const [, setTick] = useState(0);
  // a new stage starts its talk from scratch
  useEffect(() => demoVoiceReset(), [stage]);
  const audio = useRef<HTMLAudioElement | null>(null);
  const playing = useRef<Clip | null>(null);

  useEffect(() => {
    const f = () => setTick(n => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);

  const clip = room ? latest.get(room) ?? null : null;
  useEffect(() => {
    const stop = () => { audio.current?.pause(); audio.current = null; playing.current = null; };
    if (!clip) { stop(); return; }
    if (playing.current === clip) return;
    const offset = Date.now() - clip.startedAt;
    if (offset >= clip.ms - 150) { stop(); return; } // over already: silence till the next line
    stop();
    const a = new Audio(clip.src);
    audio.current = a;
    playing.current = clip;
    a.addEventListener('loadedmetadata', () => { a.currentTime = Math.max(0, (Date.now() - clip.startedAt) / 1000); }, { once: true });
    a.play().catch(() => { /* no sound allowed yet: the next line will try again */ });
  }, [clip]);

  useEffect(() => () => { audio.current?.pause(); }, []);
  return null;
}

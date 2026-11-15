import { useEffect, useState } from 'react';

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

// One player for the page: the lesson screen is rebuilt now and then (coming into a room openly), the line goes on
const player: { audio: HTMLAudioElement | null; playing: Clip | null; stopLater?: ReturnType<typeof setTimeout> } = { audio: null, playing: null };
const stopPlayer = () => { player.audio?.pause(); player.audio = null; player.playing = null; };

export function DemoVoice({ room, stage }: { room: string | null; stage: string }) {
  const [, setTick] = useState(0);
  // a new stage starts its talk from scratch (not a remount: coming into a room openly rebuilds the screen)
  useEffect(() => { if (lastStage !== null && lastStage !== stage) demoVoiceReset(); lastStage = stage; }, [stage]);

  useEffect(() => {
    const f = () => setTick(n => n + 1);
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, []);

  const clip = room ? latest.get(room) ?? null : null;
  useEffect(() => {
    clearTimeout(player.stopLater);
    // no room for a moment: the page reconnects — the line goes on unless the teacher stays away
    if (!clip) { if (player.playing) player.stopLater = setTimeout(stopPlayer, 2500); return; }
    if (player.playing === clip) return;
    const offset = Date.now() - clip.startedAt;
    if (offset >= clip.ms - 150) { stopPlayer(); return; } // over already: silence till the next line
    stopPlayer();
    const a = new Audio(clip.src.startsWith('/') ? import.meta.env.BASE_URL + clip.src.slice(1) : clip.src);
    player.audio = a;
    player.playing = clip;
    // coming in mid-line: from where it is now; a line just begun plays from its start (loading takes a moment,
    // and skipping it would swallow the first sounds)
    if (offset > 1000) a.addEventListener('loadedmetadata', () => { a.currentTime = Math.max(0, (Date.now() - clip.startedAt) / 1000); }, { once: true });
    a.play().catch(() => { /* no sound allowed yet: the next line will try again */ });
  }, [clip]);

  // gone (the screen rebuilt, or the demo over): silence, unless a new player picks the line up at once
  useEffect(() => () => { clearTimeout(player.stopLater); player.stopLater = setTimeout(stopPlayer, 1500); }, []);
  return null;
}

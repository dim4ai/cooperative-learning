import { useEffect, useState } from 'react';

// The solo demo's voiced dialogues: the server says when a line begins in a room; the teacher hears it only
// at that room's board, coming in mid-line as into a real conversation

/** Where Миша's sheet from b2 lies on his pair's board: its corner and how much smaller (server demoBots.ts) */
export interface SheetPlace { x: number; y: number; s: number }
interface Clip { room: string; src: string; ms: number; startedAt: number; who?: string; legs?: SheetPlace | null; next?: string[] } // startedAt: on this computer's clock

const latest = new Map<string, Clip>();
const listeners = new Set<() => void>();

/** From the socket: { room, src, ms, now } with now on the server's clock */
export function demoVoiceHeard(c: { room: string; src: string; ms: number; now: number; who?: string; legs?: SheetPlace | null; next?: string[] }) {
  latest.set(c.room, { room: c.room, src: c.src, ms: c.ms, startedAt: Date.now(), who: c.who, legs: c.legs, next: c.next });
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

/** Миша's pair, from the teacher's answer till they've counted: pale legs for AB and AO over his sheet (null: none) */
export function useDemoLegs(room: string | null): SheetPlace | null {
  const calc = (): SheetPlace | null => {
    const c = room ? latest.get(room) : undefined;
    return c && /\/p1-(ta|18|19)-/.test(c.src) ? c.legs ?? { x: 0, y: 0, s: 1 } : null;
  };
  const [on, setOn] = useState(calc);
  useEffect(() => {
    const f = () => setOn(prev => { const n = calc(); return JSON.stringify(n) === JSON.stringify(prev) ? prev : n; });
    f();
    listeners.add(f);
    return () => { listeners.delete(f); };
  }, [room]); // eslint-disable-line react-hooks/exhaustive-deps
  return on;
}

export function demoVoiceReset() {
  latest.clear();
  listeners.forEach(f => f());
}

// The lines to come in the room being listened to, fetched while this one plays: on a slow line the pauses
// between lines would otherwise grow by each sound's loading
const fetched = new Map<string, string>(); // src → its sound here (a blob URL)
const urlOf = (src: string) => src.startsWith('/') ? import.meta.env.BASE_URL + src.slice(1) : src;
function fetchAhead(srcs: string[]) {
  for (const src of srcs) {
    if (fetched.has(src)) continue;
    fetched.set(src, '');
    fetch(urlOf(src)).then(r => r.ok ? r.blob() : Promise.reject()).then(b => fetched.set(src, URL.createObjectURL(b))).catch(() => fetched.delete(src));
  }
}

let lastStage: string | null = null;

// One player for the page: the lesson screen is rebuilt now and then (coming into a room openly), the line goes on.
// And one <audio> for all the lines: a tablet (iPad) lets a page sound by itself only through an element that was
// started by a touch, so the first touch starts it with a silent clip, and the lines then take turns in it
const SILENCE = (() => { // a tenth of a second of 8-bit WAV
  const n = 800, le = (v: number, len: number) => String.fromCharCode(...Array.from({ length: len }, (_, i) => (v >> (8 * i)) & 255));
  return 'data:audio/wav;base64,' + btoa('RIFF' + le(36 + n, 4) + 'WAVEfmt ' + le(16, 4) + le(1, 2) + le(1, 2) + le(8000, 4) + le(8000, 4) + le(1, 2) + le(8, 2) + 'data' + le(n, 4) + '\x80'.repeat(n));
})();
const player: { audio: HTMLAudioElement; playing: Clip | null; blocked: boolean; stopLater?: ReturnType<typeof setTimeout> } =
  { audio: new Audio(), playing: null, blocked: false };
const stopPlayer = () => { player.audio.pause(); player.playing = null; player.blocked = false; };

function playClip(clip: Clip, src = fetched.get(clip.src) || urlOf(clip.src)) {
  const a = player.audio;
  player.playing = clip;
  player.blocked = false;
  a.src = src;
  // coming in mid-line: from where it is now; a line just begun plays from its start (loading takes a moment,
  // and skipping it would swallow the first sounds)
  a.onloadedmetadata = Date.now() - clip.startedAt > 1000 ? () => { a.currentTime = Math.max(0, (Date.now() - clip.startedAt) / 1000); } : null;
  a.play().catch((e: Error) => {
    if (player.playing !== clip) return; // another line has taken its place
    if (e.name === 'NotAllowedError') player.blocked = true; // the next touch will let it sound
    else if (src.startsWith('blob:')) playClip(clip, urlOf(clip.src)); // what was fetched ahead won't play: from the network
  });
}

let unlocked = false;
function unlock() {
  const clip = player.playing;
  if (clip && !player.blocked) return; // it sounds already
  if (clip && Date.now() - clip.startedAt < clip.ms - 150) { unlocked = true; playClip(clip); return; }
  if (unlocked && !player.blocked) return;
  player.audio.onloadedmetadata = null;
  player.audio.src = SILENCE;
  player.audio.play().then(() => { unlocked = true; player.blocked = false; }).catch(() => { /* the next touch */ });
}
for (const ev of ['pointerup', 'touchend', 'click', 'keydown']) window.addEventListener(ev, unlock, { capture: true, passive: true });

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
    if (!clip) { stopPlayer(); return; } // left the room: its talk is not heard any more
    if (player.playing === clip) return;
    const offset = Date.now() - clip.startedAt;
    if (offset >= clip.ms - 150) { stopPlayer(); return; } // over already: silence till the next line
    stopPlayer();
    if (clip.next) fetchAhead(clip.next);
    playClip(clip);
  }, [clip]);

  // gone (the screen rebuilt, or the demo over): silence, unless a new player picks the line up at once
  useEffect(() => () => { clearTimeout(player.stopLater); player.stopLater = setTimeout(stopPlayer, 1500); }, []);
  return null;
}

// Recording a lesson, all of it in this browser (recStore.ts keeps the pieces):
//  • the screen — this tab or what the teacher picks, from «Записать» to «Остановить»;
//  • from «Начать урок» to the lesson's end only: every participant's sound, one file per person per
//    room (the server lets this browser listen in every room, invisibly), and the students' actions
//    as the server copies them here (recorder.ts on the server).
import { useSyncExternalStore } from 'react';
import { Room, RoomEvent, Track, type RemoteParticipant, type RemoteTrack, type RemoteTrackPublication } from 'livekit-client';
import { socket } from './socket';
import { ChunkWriter, putMeta, type AudioSegment, type RecordingMeta } from './recStore';

export type VideoState = 'on' | 'off' | 'stopped'; // off: not given or not wanted; stopped: sharing ended

interface State {
  recording: boolean;
  startedAt: number;     // this computer's time
  video: VideoState;
  lessonLive: boolean;   // sound and actions are being recorded now
  error: string;
  justFinished: string | null; // a recording just stopped: offer to save it wherever the teacher is
}

let state: State = { recording: false, startedAt: 0, video: 'off', lessonLive: false, error: '', justFinished: null };
const listeners = new Set<() => void>();
function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach(l => l());
}
export function useRecording(): State {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state);
}

// Names the teacher knows students by, kept up to date by the lesson screen
let names: Record<string, string> = {};
export function setRecordingNames(next: Record<string, string>) {
  names = next;
  if (meta) { meta.names = { ...meta.names, ...next }; }
}

// The lesson's pictures: students get them piece by piece and slides:view names them only by hash,
// so the recording keeps its own copy — the archive then shows the slides without the lesson file
let lesson: { byHash: Map<string, Blob> } | null = null;
let pictureWriters: ChunkWriter[] = [];
export function setRecordingLesson(next: { byHash: Map<string, Blob> } | null) {
  lesson = next;
  keepPictures();
}
function keepPictures() {
  if (!meta || !lesson) return;
  const pictures = (meta.pictures ??= {});
  let added = false;
  for (const [hash, blob] of lesson.byHash) {
    if (pictures[hash]) continue;
    pictures[hash] = blob.type || 'application/octet-stream';
    const w = new ChunkWriter(meta.id, `media:${hash}`);
    w.add(blob);
    pictureWriters.push(w);
    added = true;
  }
  if (added) saveMetaSoon();
}

const SLICE_MS = 2000;

function pickMime(candidates: string[]): string {
  return candidates.find(m => MediaRecorder.isTypeSupported(m)) ?? '';
}
const VIDEO_MIMES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const AUDIO_MIMES = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/webm'];

let meta: RecordingMeta | null = null;
export const currentRecordingId = () => meta?.id ?? null;
let skew = 0; // server − local
const serverNow = () => Date.now() + skew;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveMetaSoon() {
  if (saveTimer || !meta) return;
  saveTimer = setTimeout(() => { saveTimer = null; if (meta) putMeta(meta).catch(e => console.warn('recording meta:', e)); }, 1000);
}

// ---------- screen ----------

let videoRecorder: MediaRecorder | null = null;
let videoWriter: ChunkWriter | null = null;
let screenStream: MediaStream | null = null;
let micStream: MediaStream | null = null;
let audioCtx: AudioContext | null = null;

async function startScreen(): Promise<boolean> {
  try {
    // Chrome offers this very tab first; others show their usual choice of window or screen
    screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: 15 },
      audio: true, // the tab's sound, where the browser gives it: what the teacher hears
      preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'exclude',
    } as DisplayMediaStreamOptions);
  } catch {
    return false;
  }
  const tracks: MediaStreamTrack[] = [...screenStream.getVideoTracks()];
  // The teacher's own voice goes into the video too, mixed with the tab's sound
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  } catch { micStream = null; }
  const sources = [screenStream, micStream].filter((s): s is MediaStream => !!s && s.getAudioTracks().length > 0);
  if (sources.length) {
    audioCtx = new AudioContext();
    const mix = audioCtx.createMediaStreamDestination();
    for (const s of sources) audioCtx.createMediaStreamSource(s).connect(mix);
    tracks.push(...mix.stream.getAudioTracks());
  }
  const mime = pickMime(VIDEO_MIMES);
  videoRecorder = new MediaRecorder(new MediaStream(tracks), {
    ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 2_000_000, audioBitsPerSecond: 96_000,
    // MP4 comes out a keyframe at a time, and a still screen hardly makes any: without this the
    // whole video would wait in memory until «Остановить» and be lost with a closed tab
    videoKeyFrameIntervalDuration: SLICE_MS,
  } as MediaRecorderOptions);
  videoWriter = new ChunkWriter(meta!.id, 'video');
  const writer = videoWriter;
  videoRecorder.ondataavailable = e => writer.add(e.data);
  videoRecorder.start(SLICE_MS);
  meta!.video = { start: serverNow(), mime: videoRecorder.mimeType || mime || 'video/webm' };
  // «Закрыть доступ» in the browser's own bar stops the video; sound and actions go on
  screenStream.getVideoTracks()[0]?.addEventListener('ended', () => { stopScreen(); set({ video: 'stopped' }); });
  return true;
}

function stopScreen(): Promise<void> {
  const rec = videoRecorder;
  videoRecorder = null;
  const finished = rec && rec.state !== 'inactive'
    ? new Promise<void>(resolve => { rec.onstop = () => resolve(); rec.stop(); })
    : Promise.resolve();
  screenStream?.getTracks().forEach(t => t.stop());
  micStream?.getTracks().forEach(t => t.stop());
  screenStream = micStream = null;
  return finished.then(() => { audioCtx?.close().catch(() => {}); audioCtx = null; });
}

// ---------- sound of every room ----------

interface Segment { meta: AudioSegment; recorder: MediaRecorder; writer: ChunkWriter; element: HTMLAudioElement }
interface Listened { room: Room; segments: Map<string, Segment> } // track sid → segment
const rooms = new Map<string, Listened>();
let segmentCount = 0;
const roomBase = (room: string) => room.slice(room.indexOf(':') + 1);
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_');

function startSegment(listened: Listened, roomName: string, track: RemoteTrack, pub: RemoteTrackPublication, p: RemoteParticipant) {
  if (!meta || listened.segments.has(pub.trackSid)) return;
  const mime = pickMime(AUDIO_MIMES);
  const stream = new MediaStream([track.mediaStreamTrack]);
  // Chrome gives a remote track's sound only to something that plays it: a silent player
  const element = new Audio();
  element.muted = true;
  element.srcObject = stream;
  element.play().catch(() => {});
  const recorder = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 32_000 });
  const ext = (recorder.mimeType || mime).includes('ogg') ? 'ogg' : (recorder.mimeType || mime).includes('mp4') ? 'm4a' : 'webm';
  const known = names[p.identity];
  const who = known && known !== p.identity ? `${known} (${p.identity})` : p.identity;
  const file = `звук/${String(++segmentCount).padStart(3, '0')}-${safe(who)}-${safe(roomBase(roomName))}.${ext}`;
  const writer = new ChunkWriter(meta.id, file);
  const seg: AudioSegment = { file, who: p.identity, room: roomBase(roomName), start: serverNow(), end: null, mime: recorder.mimeType || mime };
  recorder.ondataavailable = e => writer.add(e.data);
  recorder.start(SLICE_MS);
  meta.segments.push(seg);
  listened.segments.set(pub.trackSid, { meta: seg, recorder, writer, element });
  saveMetaSoon();
}

function endSegment(listened: Listened, sid: string): Promise<void> {
  const seg = listened.segments.get(sid);
  if (!seg) return Promise.resolve();
  listened.segments.delete(sid);
  seg.meta.end = serverNow();
  seg.element.srcObject = null;
  saveMetaSoon();
  if (seg.recorder.state === 'inactive') return seg.writer.flushed();
  return new Promise<void>(resolve => {
    seg.recorder.onstop = () => resolve();
    seg.recorder.stop();
  }).then(() => seg.writer.flushed());
}

async function listen(url: string, roomName: string, token: string) {
  const room = new Room({ adaptiveStream: false, dynacast: false });
  const listened: Listened = { room, segments: new Map() };
  rooms.set(roomName, listened);
  const want = (pub: RemoteTrackPublication) => { if (pub.kind === Track.Kind.Audio && !pub.isSubscribed) pub.setSubscribed(true); };
  room
    .on(RoomEvent.TrackPublished, pub => want(pub))
    .on(RoomEvent.TrackSubscribed, (track, pub, p) => { if (track.kind === Track.Kind.Audio) startSegment(listened, roomName, track, pub, p); })
    .on(RoomEvent.TrackUnsubscribed, (_t, pub) => { endSegment(listened, pub.trackSid); });
  try {
    await room.connect(url, token, { autoSubscribe: false });
    for (const p of room.remoteParticipants.values()) for (const pub of p.trackPublications.values()) want(pub);
  } catch (e) {
    console.warn('recording: room not opened', roomName, e);
    if (rooms.get(roomName) === listened) rooms.delete(roomName);
  }
}

async function unlisten(roomName: string) {
  const listened = rooms.get(roomName);
  if (!listened) return;
  rooms.delete(roomName);
  await Promise.all([...listened.segments.keys()].map(sid => endSegment(listened, sid)));
  await listened.room.disconnect();
}

function syncRooms({ url, rooms: wanted }: { url: string; rooms: { room: string; token: string }[] }) {
  const keep = new Set(wanted.map(r => r.room));
  for (const r of [...rooms.keys()]) if (!keep.has(r)) unlisten(r);
  for (const r of wanted) if (!rooms.has(r.room)) listen(url, r.room, r.token);
}

// ---------- students' actions ----------

let eventsWriter: ChunkWriter | null = null;
let eventLines: string[] = [];
let eventBytes = 0;
let eventsTimer: ReturnType<typeof setInterval> | null = null;

function flushEvents() {
  if (!eventLines.length || !eventsWriter) return;
  eventsWriter.add(new Blob([eventLines.join('')], { type: 'application/x-ndjson' }));
  eventLines = [];
  eventBytes = 0;
}

function onEvents(entries: unknown[]) {
  for (const e of entries) {
    const line = JSON.stringify(e) + '\n';
    eventLines.push(line);
    eventBytes += line.length;
  }
  if (eventBytes > 256 * 1024) flushEvents();
}

function onStatus({ live, startedAt, now }: { live: boolean; startedAt: number | null; now: number }) {
  skew = now - Date.now();
  if (!meta) return;
  const last = meta.lessons[meta.lessons.length - 1];
  if (live && startedAt !== null && (!last || last.end !== null)) meta.lessons.push({ start: startedAt, end: null });
  else if (live && startedAt !== null && last && last.end === null) last.start = Math.min(last.start, startedAt);
  if (!live && last && last.end === null) last.end = now;
  set({ lessonLive: live });
  saveMetaSoon();
}

const onConnect = () => socket.emit('rec:on'); // a new connection: the server needs to be asked again

// ---------- start, stop ----------

export async function startRecording({ title, code, clockSkew, withScreen }: { title: string; code: string; clockSkew: number; withScreen: boolean }) {
  if (state.recording) return;
  skew = clockSkew;
  const id = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  meta = {
    id, title, code, createdAt: Date.now(), clockSkew, recordStart: serverNow(), recordEnd: null,
    video: null, lessons: [], segments: [], names: { ...names }, pictures: {}, eventsMime: 'application/x-ndjson', finished: false,
  };
  segmentCount = 0;
  pictureWriters = [];
  keepPictures();
  // the screen is asked for first, while the click still counts as the teacher's (Safari is strict)
  const video = withScreen && await startScreen() ? 'on' : 'off';
  navigator.storage?.persist?.().catch(() => {});
  eventsWriter = new ChunkWriter(id, 'events');
  eventsTimer = setInterval(flushEvents, 2000);
  socket.on('rec:events', onEvents);
  socket.on('rec:status', onStatus);
  socket.on('rec:rooms', syncRooms);
  socket.on('connect', onConnect);
  socket.emit('rec:on');
  set({ recording: true, startedAt: Date.now(), video, lessonLive: false, error: '', justFinished: null });
  await putMeta(meta);
}

/** Stops everything and waits until the last pieces are stored. Gives the recording's id */
export async function stopRecording(): Promise<string | null> {
  if (!state.recording || !meta) return null;
  const m = meta;
  socket.emit('rec:off');
  socket.off('rec:events', onEvents);
  socket.off('rec:status', onStatus);
  socket.off('rec:rooms', syncRooms);
  socket.off('connect', onConnect);
  if (eventsTimer) clearInterval(eventsTimer);
  eventsTimer = null;
  await Promise.all([stopScreen(), ...[...rooms.keys()].map(unlisten)]);
  flushEvents();
  await Promise.all([videoWriter?.flushed(), eventsWriter?.flushed(), ...pictureWriters.map(w => w.flushed())]);
  pictureWriters = [];
  const last = m.lessons[m.lessons.length - 1];
  if (last && last.end === null) last.end = serverNow();
  m.recordEnd = serverNow();
  m.finished = true;
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  await putMeta(m);
  meta = null;
  videoWriter = eventsWriter = null;
  set({ recording: false, video: 'off', lessonLive: false, justFinished: m.id });
  return m.id;
}

export function clearJustFinished() {
  set({ justFinished: null });
}

// A closed tab can't finish anything, but what's stored stays: the next visit offers to save it
window.addEventListener('pagehide', () => { if (meta) { flushEvents(); putMeta(meta).catch(() => {}); } });

// Where a lesson recording lives while it's being made: IndexedDB in this browser, piece by piece
// as the recorders hand them over. Pieces are on disk, not in memory, so an hour of video is fine and
// a closed or crashed tab loses nothing already written. Saving turns them into two downloads:
// the screen video, and one .zip with the sound tracks, the students' actions and a description.

export interface AudioSegment {
  file: string;   // path in the archive
  who: string;    // LiveKit identity: the student's nick, or 'Teacher'
  room: string;   // LiveKit room without the lesson code: main-room, pair-g0-r1, fours-2…
  start: number;  // server time, ms
  end: number | null;
  mime: string;
}

export interface RecordingMeta {
  id: string;
  title: string;          // «5А» or the lesson's title — goes into file names
  code: string;           // the lesson code
  createdAt: number;      // this computer's time
  clockSkew: number;      // server time − this computer's, when recording began
  recordStart: number;    // server time, as all below
  recordEnd: number | null;
  video: { start: number; mime: string } | null;
  lessons: { start: number; end: number | null }[]; // «Начать урок» … end; the archive's part
  segments: AudioSegment[];
  names: Record<string, string>; // nick → the name the teacher knows them by
  eventsMime: string;
  finished: boolean;
}

const DB_NAME = 'co-learn-recordings';
let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('recordings', { keyPath: 'id' });
      d.createObjectStore('chunks', { keyPath: ['rec', 'file', 'seq'] });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(req.error); };
  });
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putMeta(meta: RecordingMeta): Promise<void> {
  const tx = (await db()).transaction('recordings', 'readwrite');
  tx.objectStore('recordings').put(meta);
  await done(tx);
}

export async function listRecordings(): Promise<RecordingMeta[]> {
  const tx = (await db()).transaction('recordings');
  const all = await request(tx.objectStore('recordings').getAll() as IDBRequest<RecordingMeta[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteRecording(id: string): Promise<void> {
  const tx = (await db()).transaction(['recordings', 'chunks'], 'readwrite');
  tx.objectStore('recordings').delete(id);
  tx.objectStore('chunks').delete(IDBKeyRange.bound([id, '', 0], [id, '￿', Infinity]));
  await done(tx);
}

/** Appends to a file, in order: each file has its own queue */
export class ChunkWriter {
  private seq = 0;
  private queue: Promise<void> = Promise.resolve();
  private rec: string;
  private file: string;
  bytes = 0;
  constructor(rec: string, file: string) {
    this.rec = rec;
    this.file = file;
  }

  add(blob: Blob) {
    if (!blob.size) return;
    const seq = this.seq++;
    this.bytes += blob.size;
    this.queue = this.queue.then(async () => {
      const tx = (await db()).transaction('chunks', 'readwrite');
      tx.objectStore('chunks').put({ rec: this.rec, file: this.file, seq, blob });
      await done(tx);
    }).catch(e => console.warn('recording: a piece was not stored', e));
  }

  flushed(): Promise<void> {
    return this.queue;
  }
}

async function fileChunks(rec: string, file: string): Promise<Blob[]> {
  const tx = (await db()).transaction('chunks');
  const rows = await request(tx.objectStore('chunks').getAll(IDBKeyRange.bound([rec, file, 0], [rec, file, Infinity])) as IDBRequest<{ blob: Blob }[]>);
  return rows.map(r => r.blob);
}

async function fileNames(rec: string): Promise<string[]> {
  const tx = (await db()).transaction('chunks');
  const keys = await request(tx.objectStore('chunks').getAllKeys(IDBKeyRange.bound([rec, '', 0], [rec, '￿', Infinity])));
  return [...new Set(keys.map(k => (k as [string, string, number])[1]))];
}

// ---------- zip (stored, not compressed: sound is compressed already) ----------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

async function crc32(blobs: Blob[]): Promise<number> {
  let c = 0xffffffff;
  for (const b of blobs) {
    const bytes = new Uint8Array(await b.arrayBuffer());
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

interface ZipEntry { name: string; parts: Blob[] }

async function buildZip(entries: ZipEntry[], when: Date): Promise<Blob> {
  const enc = new TextEncoder();
  const { time, date } = dosTime(when);
  const out: BlobPart[] = [];
  const central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = new Uint8Array(enc.encode(e.name));
    const size = e.parts.reduce((n, b) => n + b.size, 0);
    if (size >= 0xffffffff || offset >= 0xffffffff) throw new Error('archive over 4 GB');
    const crc = await crc32(e.parts);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // names in UTF-8
    local.setUint16(8, 0, true);      // stored
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    out.push(local.buffer, name, ...e.parts);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true);
    cd.setUint16(4, 20, true);
    cd.setUint16(6, 20, true);
    cd.setUint16(8, 0x0800, true);
    cd.setUint16(10, 0, true);
    cd.setUint16(12, time, true);
    cd.setUint16(14, date, true);
    cd.setUint32(16, crc, true);
    cd.setUint32(20, size, true);
    cd.setUint32(24, size, true);
    cd.setUint16(28, name.length, true);
    cd.setUint32(42, offset, true);
    const rec = new Uint8Array(46 + name.length);
    rec.set(new Uint8Array(cd.buffer), 0);
    rec.set(name, 46);
    central.push(rec);
    offset += 30 + name.length + size;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...out, ...central, end.buffer], { type: 'application/zip' });
}

// ---------- what gets saved ----------

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 3600)}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};
const localTime = (meta: RecordingMeta, serverMs: number) => new Date(serverMs - meta.clockSkew).toLocaleString('ru-RU');
export const extOf = (mime: string) => (mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm');

export function baseName(meta: RecordingMeta): string {
  const d = new Date(meta.createdAt);
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
  const title = meta.title.replace(/[\\/:*?"<>|]+/g, ' ').trim();
  return `урок${title ? `-${title}` : ''}-${stamp}`;
}

function readme(meta: RecordingMeta, videoName: string | null): string {
  const lines = [
    `Запись урока${meta.title ? ` «${meta.title}»` : ''}, код ${meta.code}`,
    `Запись: ${localTime(meta, meta.recordStart)} — ${meta.recordEnd ? localTime(meta, meta.recordEnd) : 'оборвалась'}`,
    '',
  ];
  if (meta.video && videoName) {
    lines.push(`Видео экрана — отдельный файл: ${videoName}`);
    for (const [i, l] of meta.lessons.entries()) {
      const n = meta.lessons.length > 1 ? ` ${i + 1}` : '';
      lines.push(`Урок${n} начался на ${clock(l.start - meta.video.start)} видео${l.end ? `, закончился на ${clock(l.end - meta.video.start)}` : ''}.`);
    }
  } else {
    lines.push('Видео экрана не записывалось.');
  }
  lines.push(
    '',
    'Звук и действия записаны только во время урока (от «Начать урок» до его завершения).',
    'звук/ — каждый участник отдельно, в каждой комнате своим файлом.',
    'действия.jsonl — по строке на событие: что сервер отправил ученикам (to) и что они прислали (from).',
    'урок.json — всё это с точным временем: время в миллисекундах по часам сервера.',
  );
  return lines.join('\n') + '\n';
}

export interface SavedFiles { archive: { name: string; blob: Blob }; video: { name: string; blob: Blob } | null }

/** Names from the teacher's journal are in the recording: nick → a different name */
export const hasJournalNames = (meta: RecordingMeta) => Object.entries(meta.names).some(([nick, name]) => name && name !== nick);

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_');

/** withoutJournal: only the students' nicks stay (in names and the sound files' names) — an archive to give to others */
export async function buildDownloads(meta: RecordingMeta, { withoutJournal = false } = {}): Promise<SavedFiles> {
  const base = baseName(meta);
  const files = await fileNames(meta.id);
  let video: SavedFiles['video'] = null;
  if (meta.video && files.includes('video')) {
    const parts = await fileChunks(meta.id, 'video');
    video = { name: `${base}-экран.${extOf(meta.video.mime)}`, blob: new Blob(parts, { type: meta.video.mime }) };
  }
  const entries: ZipEntry[] = [];
  const enc = new TextEncoder();
  const stored = meta.segments.filter(s => files.includes(s.file));
  // a sound file's name is звук/NNN-<name (nick)>-<room>.ext; without the journal — звук/NNN-<nick>-<room>.ext
  const segments = withoutJournal
    ? stored.map(s => ({ ...s, file: `звук/${s.file.slice('звук/'.length).split('-')[0]}-${safeName(s.who)}-${safeName(s.room)}.${s.file.split('.').pop()}` }))
    : stored;
  const names = withoutJournal ? Object.fromEntries(Object.keys(meta.names).map(n => [n, n])) : meta.names;
  const manifest = {
    format: 'co-learn-recording/1',
    title: meta.title,
    code: meta.code,
    clock: 'server ms',
    recordStart: meta.recordStart,
    recordEnd: meta.recordEnd,
    video: meta.video && video ? { file: video.name, start: meta.video.start, mime: meta.video.mime } : null,
    lessons: meta.lessons,
    names,
    audio: segments,
    events: files.includes('events') ? 'действия.jsonl' : null,
  };
  entries.push({ name: 'ПРОЧТИ.txt', parts: [new Blob([enc.encode(readme(meta, video?.name ?? null))])] });
  entries.push({ name: 'урок.json', parts: [new Blob([enc.encode(JSON.stringify(manifest, null, 2))])] });
  if (files.includes('events')) entries.push({ name: 'действия.jsonl', parts: await fileChunks(meta.id, 'events') });
  for (const [i, s] of segments.entries()) entries.push({ name: s.file, parts: await fileChunks(meta.id, stored[i].file) });
  return { archive: { name: `${base}.zip`, blob: await buildZip(entries, new Date(meta.createdAt)) }, video };
}

export function download(name: string, blob: Blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

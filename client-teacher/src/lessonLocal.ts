// The lesson file (.colesson from the editor) lives here, in the teacher's browser — it is not
// uploaded anywhere. The server only gets its structure (slides JSON + a catalog of media hashes)
// and relays media files to students piece by piece when they need them.
// The file is also kept in IndexedDB per lesson code, so a page reload doesn't lose it.
import { unzip, strFromU8, type Unzipped } from 'fflate';
import { bakeLayers, sceneMediaNames, type Scene } from './slides/model';

export interface MediaInfo { hash: string; size: number; type: string }

export interface LocalBlock {
  id: string; type: string; title: string; slides: Scene[];
  /** The teacher's own: never leave this browser */
  teacherNote: string;
  task: string;
  sheetReadOnly: boolean;
  duration: number | null;
}

export interface LocalLesson {
  /** SHA-256 of lesson.json — tells "the same file" apart from another one */
  id: string;
  title: string;
  blocks: LocalBlock[];
  /** media name → content info (sent to the server) */
  catalog: Record<string, MediaInfo>;
  /** media name → object URL, for the teacher's own player */
  urls: Map<string, string>;
  /** hash → file, for sending to students */
  byHash: Map<string, Blob>;
}

export class NotALessonError extends Error {}

const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
};

async function sha256(data: BufferSource): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function readLesson(file: Blob): Promise<LocalLesson> {
  const zip = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Unzipped>((resolve, reject) =>
    unzip(zip, (err, data) => (err ? reject(new NotALessonError('not a zip')) : resolve(data))));
  // .colesson starts with a 'mimetype' entry (see client-editor/src/lessonFile.ts)
  const mimetype = entries['mimetype'];
  if (!mimetype || strFromU8(mimetype) !== 'application/vnd.colearn.lesson+zip') throw new NotALessonError('no lesson mimetype');
  const json = entries['lesson.json'];
  if (!json) throw new NotALessonError('no lesson.json');
  let raw: { version?: number; meta?: { title?: string }; blocks?: (Record<string, unknown> & { scene?: Scene; slides?: Scene[] })[] };
  try { raw = JSON.parse(strFromU8(json)); } catch { throw new NotALessonError('bad lesson.json'); }
  if (raw.version !== 1 || !Array.isArray(raw.blocks)) throw new NotALessonError('unsupported version');

  // Same normalization as the editor: old single 'scene' → slides[]
  const blocks: LocalBlock[] = raw.blocks.map(b => ({
    id: String(b.id), type: String(b.type ?? ''), title: String(b.title ?? ''),
    teacherNote: typeof b.teacherNote === 'string' ? b.teacherNote : '',
    task: typeof b.task === 'string' ? b.task : '',
    sheetReadOnly: b.sheetReadOnly === true,
    duration: typeof b.duration === 'number' ? b.duration : null,
    // layer flags baked into objects: the presenter and the server work per object
    slides: [...(b.slides ?? []), ...(b.scene ? [b.scene] : [])].filter(s => s && Array.isArray(s.objects)).map(bakeLayers),
  }));

  const names = new Set<string>();
  for (const b of blocks) for (const s of b.slides) for (const n of sceneMediaNames(s.objects)) names.add(n);

  const catalog: Record<string, MediaInfo> = {};
  const urls = new Map<string, string>();
  const byHash = new Map<string, Blob>();
  for (const name of names) {
    const data = entries[`media/${name}`];
    if (!data) continue;
    const type = MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
    const blob = new Blob([data as Uint8Array<ArrayBuffer>], { type });
    const hash = await sha256(data as Uint8Array<ArrayBuffer>);
    catalog[name] = { hash, size: blob.size, type };
    urls.set(name, URL.createObjectURL(blob));
    byHash.set(hash, blob);
  }
  return { id: await sha256(json as Uint8Array<ArrayBuffer>), title: raw.meta?.title || 'Без названия', blocks, catalog, urls, byHash };
}

export function releaseLesson(l: LocalLesson | null) {
  for (const u of l?.urls.values() ?? []) URL.revokeObjectURL(u);
}

/** What the server gets: structure and catalog, no media */
export function lessonForServer(l: LocalLesson) {
  const blocks = l.blocks.map(({ id, type, title, task, sheetReadOnly, slides }) => ({
    id, type, title, task, sheetReadOnly,
    slides: slides.map(({ note: _note, ...scene }) => scene), // notes are the teacher's own
  }));
  return { id: l.id, title: l.title, blocks, media: l.catalog };
}

// ---------- kept across page reloads ----------

const DB = 'co-learn-teacher';
const STORE = 'lessonFiles';

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  try {
    return await new Promise<T>((resolve, reject) => {
      const r = fn(d.transaction(STORE, mode).objectStore(STORE));
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  } finally { d.close(); }
}

export const storedLessonFile = (code: string) => tx<Blob | undefined>('readonly', s => s.get(code)).catch(() => undefined);
export const storeLessonFile = (code: string, file: Blob) => tx('readwrite', s => s.put(file, code)).catch(() => {});
export const forgetLessonFile = (code: string) => tx('readwrite', s => s.delete(code)).catch(() => {});

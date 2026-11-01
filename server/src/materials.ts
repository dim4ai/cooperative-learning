// Lesson materials (the teacher's .lesson.zip) on disk, only for the duration of a lesson.
//
//   <MATERIALS_DIR>/<lessonCode>/lesson.json   — full lesson (teacher view)
//   <MATERIALS_DIR>/<lessonCode>/media/<hash>  — media files, named by hash of their lesson name
//
// Deleted when the teacher ends the lesson, or by sweep() after MATERIALS_TTL_HOURS without activity.
import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { unzip, strFromU8, type Unzipped } from 'fflate';

export const MATERIALS_DIR = path.resolve(process.env.MATERIALS_DIR || 'materials');
const TTL_MS = (Number(process.env.MATERIALS_TTL_HOURS) || 12) * 60 * 60 * 1000;
export const MAX_UPLOAD_BYTES = 150 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 400 * 1024 * 1024;

export interface SceneObject {
  type: string;
  uid?: string;
  mediaName?: string;
  studentHidden?: boolean;
  studentDraggable?: boolean;
  left?: number;
  top?: number;
  [key: string]: unknown;
}

export interface Scene {
  id: string;
  background?: string;
  objects: SceneObject[];
  [key: string]: unknown;
}

export interface Block {
  id: string;
  type: string;
  title: string;
  slides?: Scene[];
  [key: string]: unknown;
}

export interface Material {
  title: string;
  blocks: Block[];
  /** media name → file on disk */
  media: Map<string, { file: string; type: string }>;
}

const cache = new Map<string, Material>();
const lastTouch = new Map<string, number>();

class MaterialError extends Error {}
export { MaterialError };

function dirOf(code: string): string {
  if (!/^[a-z0-9]{4,32}$/.test(code)) throw new MaterialError('bad lesson code');
  return path.join(MATERIALS_DIR, code);
}

function mediaFileName(name: string): string {
  return crypto.createHash('sha256').update(name).digest('hex').slice(0, 40);
}

function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', pdf: 'application/pdf',
  } as Record<string, string>)[ext] ?? 'application/octet-stream';
}

/** Same normalization as the editor: old single-slide 'scene' → slides[] */
function normalize(blocks: Block[]) {
  for (const b of blocks as (Block & { scene?: Scene })[]) {
    if (b.scene) { b.slides = [...(b.slides ?? []), b.scene]; delete b.scene; }
    b.slides = (b.slides ?? []).filter(s => s && Array.isArray(s.objects));
    for (const s of b.slides) s.id ??= crypto.randomBytes(6).toString('hex');
  }
}

function usedMediaNames(blocks: Block[]): Set<string> {
  const names = new Set<string>();
  for (const b of blocks) {
    for (const a of (b.attachments as { name?: string }[] | undefined) ?? []) if (a?.name) names.add(a.name);
    for (const s of b.slides ?? []) for (const o of s.objects) if (typeof o.mediaName === 'string') names.add(o.mediaName);
  }
  return names;
}

/** Unpack and store an uploaded lesson, replacing any previous one for this lesson */
export async function saveMaterial(code: string, zip: Uint8Array): Promise<Material> {
  const dir = dirOf(code);
  const entries = await new Promise<Unzipped>((resolve, reject) =>
    unzip(zip, (err, data) => (err ? reject(new MaterialError('not a zip archive')) : resolve(data))),
  );
  const total = Object.values(entries).reduce((n, e) => n + e.length, 0);
  if (total > MAX_UNPACKED_BYTES) throw new MaterialError('archive too large');

  const json = entries['lesson.json'];
  if (!json) throw new MaterialError('no lesson.json in archive');
  let lesson: { version?: number; meta?: { title?: string }; blocks?: Block[] };
  try { lesson = JSON.parse(strFromU8(json)); } catch { throw new MaterialError('lesson.json is not valid JSON'); }
  if (lesson.version !== 1 || !Array.isArray(lesson.blocks)) throw new MaterialError('unsupported lesson format');
  normalize(lesson.blocks);

  // Write into a temp dir, then swap — readers never see a half-written lesson
  await fs.mkdir(MATERIALS_DIR, { recursive: true });
  const tmp = `${dir}.tmp-${crypto.randomBytes(4).toString('hex')}`;
  await fs.mkdir(path.join(tmp, 'media'), { recursive: true });
  try {
    for (const name of usedMediaNames(lesson.blocks)) {
      const data = entries[`media/${name}`];
      if (data) await fs.writeFile(path.join(tmp, 'media', mediaFileName(name)), data);
    }
    await fs.writeFile(path.join(tmp, 'lesson.json'), JSON.stringify(lesson));
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rename(tmp, dir);
  } catch (e) {
    await fs.rm(tmp, { recursive: true, force: true });
    throw e;
  }
  cache.delete(code);
  lastTouch.set(code, Date.now());
  return (await getMaterial(code))!;
}

export async function getMaterial(code: string): Promise<Material | null> {
  const hit = cache.get(code);
  if (hit) return hit;
  const dir = dirOf(code);
  let raw: string;
  try { raw = await fs.readFile(path.join(dir, 'lesson.json'), 'utf-8'); } catch { return null; }
  const lesson = JSON.parse(raw) as { meta?: { title?: string }; blocks: Block[] };
  const present = new Set(await fs.readdir(path.join(dir, 'media')).catch(() => [] as string[]));
  const media = new Map<string, { file: string; type: string }>();
  for (const name of usedMediaNames(lesson.blocks)) {
    const file = mediaFileName(name);
    if (present.has(file)) media.set(name, { file: path.join(dir, 'media', file), type: mimeFromName(name) });
  }
  const material: Material = { title: lesson.meta?.title || 'Без названия', blocks: lesson.blocks, media };
  cache.set(code, material);
  return material;
}

export async function deleteMaterial(code: string): Promise<boolean> {
  const dir = dirOf(code);
  cache.delete(code);
  lastTouch.delete(code);
  const existed = await fs.stat(dir).then(() => true, () => false);
  await fs.rm(dir, { recursive: true, force: true });
  return existed;
}

/** Mark lesson materials as in use (keeps sweep() away); cheap, writes to disk at most once a minute */
export function touchMaterial(code: string) {
  const now = Date.now();
  if (now - (lastTouch.get(code) ?? 0) < 60_000) return;
  lastTouch.set(code, now);
  const d = new Date(now);
  fs.utimes(dirOf(code), d, d).catch(() => { /* no material — nothing to keep */ });
}

/** Delete materials idle for longer than the TTL. Returns codes removed. */
export async function sweepMaterials(inUse: (code: string) => boolean): Promise<string[]> {
  const removed: string[] = [];
  const names = await fs.readdir(MATERIALS_DIR).catch(() => [] as string[]);
  for (const name of names) {
    const full = path.join(MATERIALS_DIR, name);
    if (name.includes('.tmp-')) { // leftovers of a crashed upload
      const st = await fs.stat(full).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 60 * 60 * 1000) await fs.rm(full, { recursive: true, force: true });
      continue;
    }
    if (inUse(name)) { touchMaterial(name); continue; }
    const st = await fs.stat(full).catch(() => null);
    if (!st) continue;
    const idle = Date.now() - Math.max(st.mtimeMs, lastTouch.get(name) ?? 0);
    if (idle > TTL_MS) {
      await deleteMaterial(name).catch(() => {});
      removed.push(name);
    }
  }
  return removed;
}

// ---------- what each role may see ----------

export interface SlidesState {
  active: boolean;
  blockId: string | null;
  index: number;
  revealed: Map<string, Set<string>>;                                   // scene id → revealed uids
  positions: Map<string, Record<string, { left: number; top: number }>>; // scene id → moved objects
}

export function emptySlidesState(): SlidesState {
  return { active: false, blockId: null, index: 0, revealed: new Map(), positions: new Map() };
}

export function blockSlides(material: Material | null, blockId: string | null): Scene[] {
  return material?.blocks.find(b => b.id === blockId)?.slides ?? [];
}

export function currentScene(material: Material | null, st: SlidesState): Scene | null {
  return blockSlides(material, st.blockId)[st.index] ?? null;
}

/** A scene as a student may receive it: hidden objects removed unless revealed, positions applied */
export function studentScene(scene: Scene, st: SlidesState): Scene {
  const revealed = st.revealed.get(scene.id) ?? new Set<string>();
  const moved = st.positions.get(scene.id) ?? {};
  return {
    ...scene,
    objects: scene.objects
      .filter(o => !o.studentHidden || (o.uid && revealed.has(o.uid)))
      .map(o => {
        const { studentHidden: _h, ...rest } = o; // students don't learn what was hidden
        const pos = o.uid ? moved[o.uid] : undefined;
        return pos ? { ...rest, left: pos.left, top: pos.top } : rest;
      }),
  };
}

/** Media a student may load right now: what is visible on the current slide and the next one */
export function studentMediaAllowed(material: Material | null, st: SlidesState, name: string): boolean {
  if (!st.active || !material) return false;
  const slides = blockSlides(material, st.blockId);
  for (const scene of [slides[st.index], slides[st.index + 1]]) {
    if (!scene) continue;
    if (studentScene(scene, st).objects.some(o => o.mediaName === name)) return true;
  }
  return false;
}

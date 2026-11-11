// Lesson material for the slides. The lesson file itself stays in the teacher's browser.
// The server keeps, in memory and only while the lesson lives:
//   - the lesson structure (slides as JSON; media referenced by name), sent by the teacher;
//   - the media catalog: name → content hash, size, type (the files themselves are relayed
//     teacher → students by mediaRelay.ts and never stored here);
//   - the slide state: which slide is shown, what was revealed, where ✋ objects were moved.
import crypto from 'crypto';

export const MAX_MATERIAL_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_MEDIA_FILE_BYTES = 1024 * 1024 * 1024;

export interface SceneObject {
  type: string;
  uid?: string;
  mediaName?: string;
  studentHidden?: boolean;
  studentDraggable?: boolean;
  layer?: string;
  left?: number;
  top?: number;
  [key: string]: unknown;
}

export interface SlideLayer { id: string; name: string; studentHidden?: boolean; studentDraggable?: boolean; [key: string]: unknown }

export interface Scene {
  id: string;
  background?: string;
  layers?: SlideLayer[];
  objects: SceneObject[];
  [key: string]: unknown;
}

export interface Block {
  id: string;
  type: string;
  title: string;
  /** what students read above the board (work blocks) */
  task: string;
  /** the sheet is only to look at: students can't write on it */
  sheetReadOnly: boolean;
  /** earlier work blocks whose boards students may look at here (each sees their own room's) */
  boardsFrom: string[];
  /** minutes planned for it: the teacher sees the time run, everyone hears 15 s before the end and at the end */
  duration: number | null;
  slides: Scene[];
}

export interface MediaInfo { hash: string; size: number; type: string }

export interface Material {
  /** Fingerprint of the lesson file (hash of its lesson.json), set by the teacher's client */
  id: string;
  title: string;
  blocks: Block[];
  /** media name → content */
  media: Map<string, MediaInfo>;
  /** rough memory footprint, for the server-wide cap */
  bytes: number;
  teacherId: number | null;
}

export class MaterialError extends Error {}

/**
 * Layer flags (🙈 hidden from students, ✋ draggable) copied onto the layer's objects,
 * so everything below works per object. Same rule as bakeLayers in the shared slide model.
 */
function bakeLayers(scene: Scene): Scene {
  const layers = (Array.isArray(scene.layers) ? scene.layers : []).filter(l => l && typeof l === 'object' && typeof l.id === 'string');
  const byId = new Map(layers.map(l => [l.id, l]));
  return {
    ...scene,
    layers,
    objects: scene.objects.map(o => {
      const l = typeof o?.layer === 'string' ? byId.get(o.layer) : undefined;
      if (!l || (l.studentHidden !== true && l.studentDraggable !== true)) return o;
      return { ...o, studentHidden: o.studentHidden || l.studentHidden === true || undefined, studentDraggable: o.studentDraggable || l.studentDraggable === true || undefined };
    }),
  };
}

/** Every object of a scene, including those inside groups */
function* allObjects(objects: SceneObject[]): Generator<SceneObject> {
  for (const o of objects) {
    if (!o || typeof o !== 'object') continue;
    yield o;
    if (Array.isArray(o.objects)) yield* allObjects(o.objects as SceneObject[]);
  }
}

const HASH_RE = /^[0-9a-f]{64}$/;
const TYPE_RE = /^(image|video|audio)\/[a-z0-9.+-]{1,60}$/;

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Validate what the teacher's client sent; keeps only what the slides need */
export function parseMaterial(body: unknown, teacherId: number | null): Material {
  const b = body as { id?: unknown; title?: unknown; blocks?: unknown; media?: unknown } | null;
  if (!b || typeof b !== 'object') throw new MaterialError('bad material');
  if (typeof b.id !== 'string' || !HASH_RE.test(b.id)) throw new MaterialError('bad material id');
  if (!Array.isArray(b.blocks)) throw new MaterialError('bad blocks');

  const blocks: Block[] = [];
  for (const raw of b.blocks as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') continue;
    const slides = (Array.isArray(raw.slides) ? raw.slides : [])
      .filter((s): s is Scene => !!s && typeof s === 'object' && Array.isArray((s as Scene).objects))
      // `note` is the teacher's own: students get scenes as they are here, so it must not stay
      .map(({ note: _note, ...s }: Scene & { note?: unknown }) => bakeLayers({ ...s, id: typeof s.id === 'string' && s.id ? s.id.slice(0, 64) : crypto.randomBytes(6).toString('hex') }));
    blocks.push({ id: raw.id.slice(0, 64), type: str(raw.type, 32), title: str(raw.title, 200), task: str(raw.task, 4000), sheetReadOnly: raw.sheetReadOnly === true,
      boardsFrom: Array.isArray(raw.boardsFrom) ? raw.boardsFrom.filter((id): id is string => typeof id === 'string').slice(0, 50) : [],
      duration: typeof raw.duration === 'number' && raw.duration > 0 && raw.duration <= 240 ? raw.duration : null, slides });
  }
  // only work blocks that come before: those are the ones that have been written on by then
  const WORK = ['individual', 'pairs', 'fours'];
  blocks.forEach((bl, i) => {
    const before = new Set(blocks.slice(0, i).filter(b => WORK.includes(b.type)).map(b => b.id));
    bl.boardsFrom = WORK.includes(bl.type) ? [...new Set(bl.boardsFrom)].filter(id => before.has(id)) : [];
  });

  const used = new Set<string>();
  for (const bl of blocks) for (const s of bl.slides) for (const o of allObjects(s.objects)) if (typeof o.mediaName === 'string') used.add(o.mediaName);

  const media = new Map<string, MediaInfo>();
  const rawMedia = (b.media && typeof b.media === 'object' ? b.media : {}) as Record<string, { hash?: unknown; size?: unknown; type?: unknown }>;
  for (const name of used) {
    const m = rawMedia[name];
    if (!m || typeof m.hash !== 'string' || !HASH_RE.test(m.hash)) continue;
    const size = Number(m.size);
    if (!Number.isInteger(size) || size <= 0 || size > MAX_MEDIA_FILE_BYTES) continue;
    const type = typeof m.type === 'string' && TYPE_RE.test(m.type) ? m.type : 'application/octet-stream';
    media.set(name, { hash: m.hash, size, type });
  }

  const bytes = JSON.stringify(blocks).length;
  if (bytes > MAX_MATERIAL_JSON_BYTES) throw new MaterialError('material too large');
  return { id: b.id, title: str(b.title, 200) || 'Без названия', blocks, media, bytes, teacherId };
}

/** Hash → size/type of every media file of the lesson */
export function mediaCatalog(material: Material | null): Map<string, { size: number; type: string }> {
  const cat = new Map<string, { size: number; type: string }>();
  for (const m of material?.media.values() ?? []) cat.set(m.hash, { size: m.size, type: m.type });
  return cat;
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
  const { layers: _layers, ...rest } = scene; // layer names/flags are the teacher's business
  return {
    ...rest,
    objects: visibleObjects(scene.objects, revealed).map(o => {
      const pos = o.uid ? moved[o.uid] : undefined;
      return pos ? { ...o, left: pos.left, top: pos.top } : o;
    }),
  };
}

/** Hidden objects removed (also inside groups) unless revealed; students don't learn what was hidden */
function visibleObjects(objects: SceneObject[], revealed: Set<string>): SceneObject[] {
  return objects
    .filter(o => !o.studentHidden || (o.uid && revealed.has(o.uid)))
    .map(o => {
      const { studentHidden: _h, ...rest } = o;
      return Array.isArray(o.objects) ? { ...rest, objects: visibleObjects(o.objects as SceneObject[], revealed) } : rest;
    });
}

/** The scenes students get right now: the current slide and the next one (for preloading) */
export function studentScenes(material: Material | null, st: SlidesState): { scene: Scene; next: Scene | null } | null {
  if (!st.active || !material) return null;
  const slides = blockSlides(material, st.blockId);
  const cur = slides[st.index];
  if (!cur) return null;
  const next = slides[st.index + 1];
  return { scene: studentScene(cur, st), next: next ? studentScene(next, st) : null };
}

/** Media of the given (student) scenes, by name — what students may receive right now */
export function scenesMedia(material: Material, scenes: Scene[]): Record<string, MediaInfo> {
  const out: Record<string, MediaInfo> = {};
  for (const s of scenes) for (const o of allObjects(s.objects)) {
    const info = typeof o.mediaName === 'string' ? material.media.get(o.mediaName) : undefined;
    if (info) out[o.mediaName as string] = info;
  }
  return out;
}

/** Hashes students may receive, most urgent first (current slide, then next) */
export function allowedHashes(material: Material | null, st: SlidesState): string[] {
  const s = studentScenes(material, st);
  if (!s || !material) return [];
  const order = [...Object.values(scenesMedia(material, [s.scene])), ...Object.values(scenesMedia(material, s.next ? [s.next] : []))];
  return [...new Set(order.map(m => m.hash))];
}

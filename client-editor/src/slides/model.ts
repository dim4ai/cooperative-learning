// Slide data model — shared verbatim by client-editor, client-teacher and client-student.
// Canonical copy lives in client-editor/src/slides; run scripts/sync-slides.sh after changing it.

/**
 * Slide of a block: a scene of layered objects (Fabric.js object model).
 * Array order = z-order (later = on top). Images reference media by name
 * (`mediaName`, file in media/), never inline data.
 */
export interface Scene {
  id: string
  engine: 'fabric'
  width: number
  height: number
  background: string
  /** Ruling drawn over the background color: 'grid-m', 'lines-s', 'propis'… (see paper.ts) */
  paper?: string
  /** Color of the ruling lines */
  paperColor?: string
  /** Layers bottom → top. Objects are kept sorted by layer (array order = drawing order) */
  layers?: SlideLayer[]
  objects: SceneObject[]
}

/**
 * A layer is a named part of a slide: background, cards, covers… Objects in it stay
 * independent (unlike a group); the layer sets what is above what and carries flags
 * that apply to all its objects.
 */
export interface SlideLayer {
  id: string
  name: string
  locked?: boolean           // objects can't be selected/moved in the editor (background)
  editorHidden?: boolean     // not shown in the editor only (to work on what is below)
  studentHidden?: boolean    // all objects hidden from students until revealed
  studentDraggable?: boolean // students can move all objects of the layer
}

/** Fabric object JSON plus our own fields */
export interface SceneObject {
  type: string
  uid: string
  /** Editor-only recipe of a drawn mark (line kinds, word-analysis marks, axes) — lets it be rebuilt on resize */
  mark?: { kind: string; w: number; h: number }
  layer?: string            // id of the SlideLayer it belongs to
  name?: string             // layer name shown in the editor's layers panel
  mediaName?: string
  pinned?: boolean           // locked in place (background), not selectable in editor
  studentHidden?: boolean    // hidden from students until revealed
  studentDraggable?: boolean // student can move it during the lesson
  [key: string]: unknown
}

export const SLIDE_WIDTH = 1600
export const SLIDE_HEIGHT = 900

/** Every object of a scene, including those inside groups (depth-first) */
export function* allObjects(objects: SceneObject[]): Generator<SceneObject> {
  for (const o of objects) {
    yield o
    if (Array.isArray(o.objects)) yield* allObjects(o.objects as SceneObject[])
  }
}

/** Same tree with each object (at any depth) passed through fn */
export function mapObjects(objects: SceneObject[], fn: (o: SceneObject) => SceneObject): SceneObject[] {
  return objects.map(o => {
    const m = fn(o)
    return Array.isArray(m.objects) ? { ...m, objects: mapObjects(m.objects as SceneObject[], fn) } : m
  })
}

/** Media names a scene's objects use, groups included */
export function sceneMediaNames(objects: SceneObject[]): string[] {
  const out = new Set<string>()
  for (const o of allObjects(objects)) if (o.mediaName) out.add(o.mediaName)
  return [...out]
}

const layerId = () => 'L' + Math.random().toString(36).slice(2, 10)

/** Layers of a new slide */
export function defaultLayers(): SlideLayer[] {
  return [{ id: layerId(), name: 'Подложка', locked: true }, { id: layerId(), name: 'Слой 1' }]
}

/**
 * Every object in an existing layer, objects sorted by layer (stable).
 * A slide from before layers: pinned objects at the bottom become a locked 'Подложка', the rest 'Слой 1'.
 */
export function normalizeLayers(scene: Scene): Scene {
  let layers = Array.isArray(scene.layers) ? scene.layers.filter(l => l && typeof l.id === 'string') : []
  let objects = scene.objects
  if (!layers.length) {
    let base = 0
    while (base < objects.length && objects[base].pinned) base++
    const bg: SlideLayer = { id: layerId(), name: 'Подложка', locked: true }
    const main: SlideLayer = { id: layerId(), name: 'Слой 1' }
    layers = base ? [bg, main] : [main]
    objects = objects.map((o, i) => ({ ...o, layer: i < base ? bg.id : main.id }))
  }
  const index = new Map(layers.map((l, i) => [l.id, i]))
  const top = layers[layers.length - 1].id
  objects = objects
    .map(o => (o.layer && index.has(o.layer) ? o : { ...o, layer: top }))
    .map((o, i) => ({ o, i }))
    .sort((a, b) => index.get(a.o.layer!)! - index.get(b.o.layer!)! || a.i - b.i)
    .map(x => x.o)
  return { ...scene, layers, objects }
}

/** Layer flags copied onto the objects (for the lesson: player, server) */
export function bakeLayers(scene: Scene): Scene {
  if (!scene.layers?.length) return scene
  const byId = new Map(scene.layers.map(l => [l.id, l]))
  return {
    ...scene,
    objects: scene.objects.map(o => {
      const l = o.layer ? byId.get(o.layer) : undefined
      if (!l || (!l.studentHidden && !l.studentDraggable)) return o
      return { ...o, studentHidden: o.studentHidden || l.studentHidden || undefined, studentDraggable: o.studentDraggable || l.studentDraggable || undefined }
    }),
  }
}

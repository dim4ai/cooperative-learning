// GENERATED COPY of client-editor/src/slides/model.ts — do not edit here, edit the original and run scripts/sync-slides.sh
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
  objects: SceneObject[]
}

/** Fabric object JSON plus our own fields */
export interface SceneObject {
  type: string
  uid: string
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

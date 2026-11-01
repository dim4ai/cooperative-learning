// Scene <-> Fabric glue shared by the editor, thumbnails and the player.
// Kept free of editor-only concerns so the player can later move to the
// teacher/student clients as is.
import { FabricObject, StaticCanvas, util } from 'fabric'
import type { Scene, SceneObject } from '../types'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../types'
import type { Media } from '../lessonFile'
import { nanoid } from '../nanoid'

// Our fields travel with Fabric's own JSON
FabricObject.customProperties = ['uid', 'mediaName', 'pinned', 'studentHidden', 'studentDraggable']

export type Obj = FabricObject &
  Partial<Pick<SceneObject, 'uid' | 'mediaName' | 'pinned' | 'studentHidden' | 'studentDraggable'>>

export function emptyScene(): Scene {
  return { id: nanoid(), engine: 'fabric', width: SLIDE_WIDTH, height: SLIDE_HEIGHT, background: '#ffffff', objects: [] }
}

// One object URL per Blob for the whole session (blobs are immutable)
const blobUrls = new WeakMap<Blob, string>()
export function blobUrl(blob: Blob): string {
  let url = blobUrls.get(blob)
  if (!url) {
    url = URL.createObjectURL(blob)
    blobUrls.set(blob, url)
  }
  return url
}

// 1×1 grey pixel — stands in for an image missing from the archive
export const MISSING_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mO8Ww8AAj8BXkQ+xPEAAAAASUVORK5CYII='

/** Scene JSON → JSON Fabric can load: images get a src from media */
export function hydrate(objects: SceneObject[], media: Media): Record<string, unknown>[] {
  return objects.map(o => (o.mediaName ? { ...o, src: media[o.mediaName] ? blobUrl(media[o.mediaName]) : MISSING_IMAGE } : o))
}

export function toSceneObject(o: FabricObject): SceneObject {
  const json = o.toObject() as SceneObject
  if (json.mediaName) delete json.src // bytes live in media/, not in JSON
  return json
}

export function serialize(fc: StaticCanvas, id: string): Scene {
  return {
    ...emptyScene(),
    id,
    background: typeof fc.backgroundColor === 'string' && fc.backgroundColor ? fc.backgroundColor : '#ffffff',
    objects: fc.getObjects().map(toSceneObject),
  }
}

export async function loadInto(fc: StaticCanvas, scene: Scene, media: Media, signal?: AbortSignal): Promise<Obj[]> {
  await fc.loadFromJSON({ objects: hydrate(scene.objects, media), background: scene.background }, undefined, { signal })
  return fc.getObjects() as Obj[]
}

export async function enliven(objects: SceneObject[], media: Media): Promise<Obj[]> {
  return (await util.enlivenObjects(hydrate(objects, media))) as Obj[]
}

export async function imageSize(blob: Blob): Promise<{ width: number; height: number }> {
  const img = new Image()
  img.src = blobUrl(blob)
  await img.decode()
  return { width: img.naturalWidth, height: img.naturalHeight }
}

/**
 * Image object JSON, centered on the slide. `fill`: whole slide (background,
 * pinned) or 60% (an element on top of something).
 */
export function imageObject(mediaName: string, size: { width: number; height: number }, fill: boolean): SceneObject {
  const share = fill ? 1 : 0.6
  const k = Math.min((SLIDE_WIDTH * share) / size.width, (SLIDE_HEIGHT * share) / size.height)
  return {
    type: 'Image', uid: nanoid(), mediaName, pinned: fill || undefined,
    originX: 'center', originY: 'center', left: SLIDE_WIDTH / 2, top: SLIDE_HEIGHT / 2,
    width: size.width, height: size.height, scaleX: k, scaleY: k,
  }
}

/** Fit a Fabric canvas to its host width, keeping logical 1600×900 coordinates */
export function fitToWidth(fc: StaticCanvas, width: number) {
  fc.setDimensions({ width, height: (width * SLIDE_HEIGHT) / SLIDE_WIDTH })
  fc.setZoom(width / SLIDE_WIDTH)
}

// ---------- thumbnails ----------

const THUMB_W = 192
const thumbCache = new WeakMap<Scene, Promise<string>>()

/** PNG data URL of a scene; cached per scene object (scenes are replaced, never mutated) */
export function thumbnail(scene: Scene, media: Media): Promise<string> {
  let p = thumbCache.get(scene)
  if (!p) {
    p = (async () => {
      const fc = new StaticCanvas(undefined, { renderOnAddRemove: false, enableRetinaScaling: false })
      try {
        fitToWidth(fc, THUMB_W)
        await loadInto(fc, scene, media)
        fc.renderAll()
        return fc.toDataURL({ multiplier: 1, format: 'png' })
      } finally {
        fc.dispose()
      }
    })()
    thumbCache.set(scene, p)
  }
  return p
}

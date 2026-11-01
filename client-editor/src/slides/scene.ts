// Editor-side scene helpers (blobs, serialization, thumbnails). Rendering itself
// lives in render.ts, which is shared with the lesson clients.
import { StaticCanvas, util, type FabricObject } from 'fabric'
import type { Scene, SceneObject } from './model'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from './model'
import type { Media } from '../lessonFile'
import { nanoid } from '../nanoid'
import { fitToWidth, hydrate, loadInto, type MediaResolver, type Obj } from './render'

export type { Obj } from './render'
export { fitToWidth } from './render'

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

export function mediaResolver(media: Media): MediaResolver {
  return name => (media[name] ? blobUrl(media[name]) : undefined)
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

export async function enliven(objects: SceneObject[], media: Media): Promise<Obj[]> {
  return (await util.enlivenObjects(hydrate(objects, mediaResolver(media)))) as Obj[]
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
        await loadInto(fc, scene, mediaResolver(media))
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

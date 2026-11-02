// GENERATED COPY of client-editor/src/slides/render.ts — do not edit here, edit the original and run scripts/sync-slides.sh
// Scene → Fabric rendering, shared verbatim by client-editor, client-teacher and client-student.
// Canonical copy lives in client-editor/src/slides; run scripts/sync-slides.sh after changing it.
import { FabricObject, type StaticCanvas } from 'fabric'
import type { Scene, SceneObject } from './model'
import { SLIDE_HEIGHT, SLIDE_WIDTH, mapObjects } from './model'

// Our fields travel with Fabric's own JSON
FabricObject.customProperties = ['uid', 'layer', 'name', 'mediaName', 'pinned', 'studentHidden', 'studentDraggable']

export type Obj = FabricObject &
  Partial<Pick<SceneObject, 'uid' | 'layer' | 'name' | 'mediaName' | 'pinned' | 'studentHidden' | 'studentDraggable'>>

/** media name → URL to load it from (blob: in the editor, server URL in a lesson); undefined if absent */
export type MediaResolver = (name: string) => string | undefined

// 1×1 grey pixel — stands in for an image that is missing
export const MISSING_IMAGE =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mO8Ww8AAj8BXkQ+xPEAAAAASUVORK5CYII='

/** Scene JSON → JSON Fabric can load: images (also inside groups) get a src */
export function hydrate(objects: SceneObject[], resolve: MediaResolver): Record<string, unknown>[] {
  return mapObjects(objects, o => {
    if (!o.mediaName) return o
    const src = resolve(o.mediaName) ?? MISSING_IMAGE
    // Server images are cross-origin: load with CORS so the canvas stays readable
    return /^https?:/.test(src) ? { ...o, src, crossOrigin: 'anonymous' } : { ...o, src }
  })
}

export async function loadInto(fc: StaticCanvas, scene: Scene, resolve: MediaResolver, signal?: AbortSignal): Promise<Obj[]> {
  await fc.loadFromJSON({ objects: hydrate(scene.objects, resolve), background: scene.background }, undefined, { signal })
  return fc.getObjects() as Obj[]
}

/** Fit a Fabric canvas to a width, keeping logical 1600×900 coordinates */
export function fitToWidth(fc: StaticCanvas, width: number) {
  fc.setDimensions({ width, height: (width * SLIDE_HEIGHT) / SLIDE_WIDTH })
  fc.setZoom(width / SLIDE_WIDTH)
}

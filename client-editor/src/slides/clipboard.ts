// In-app clipboard for slide objects: works across slides, blocks and even
// lessons (carries the media blobs along). The system clipboard only gets a
// marker so that a later paste knows the last copy was ours, not an old image.
import type { SceneObject } from '../types'
import type { Media } from '../lessonFile'

export const CLIP_MIME = 'application/x-cooperative-slide'

interface Clip {
  id: string
  objects: SceneObject[]
  media: Media
}

let clip: Clip | null = null

export function setClip(objects: SceneObject[], media: Media): string {
  const used: Media = {}
  for (const o of objects) if (o.mediaName && media[o.mediaName]) used[o.mediaName] = media[o.mediaName]
  clip = { id: Math.random().toString(36).slice(2), objects, media: used }
  return clip.id
}

export function getClip(id?: string): Clip | null {
  if (!clip || (id !== undefined && id !== clip.id)) return null
  return clip
}

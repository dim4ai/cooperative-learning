// Opening our lesson file (*.colesson, LESSON_FORMAT.md): a zip with `mimetype`, lesson.json and media/.
// For a lesson for two, the slides of every stage, in order, become the board's pages: one slide at
// the top of each page, as wide as the page, with room below to write. Slide layers become board
// layers (merged by name), pinned objects are locked, objects hidden from the student go to a layer
// hidden from the student.
import { strFromU8, unzipSync } from 'fflate'
import { picture, placeJson, shrinkImage, type Pic } from './pictures'
import type { Layer } from './board'

const LESSON_MIME = 'application/vnd.colearn.lesson+zip'
const SLIDE_W = 1600
const SLIDE_H = 900

export function isLesson(bytes: Uint8Array): boolean {
  // zip, and its first entry is the uncompressed "mimetype" (name from byte 30, then the value)
  return bytes[0] === 0x50 && bytes[1] === 0x4b && strFromU8(bytes.subarray(30, 38)) === 'mimetype'
}

type Json = Record<string, unknown>
type SlideLayer = { id: string; name?: string; locked?: boolean; studentHidden?: boolean }

const rid = () => 'L' + Math.random().toString(36).slice(2, 10)

/**
 * Reads a lesson into board objects (board coordinates) and the layers they need.
 * `page` — the board page size; pages go down from (0, 0).
 */
export async function readLesson(file: Blob, page: { w: number; h: number }): Promise<{ objects: Json[]; layers: Layer[]; slides: number; title: string }> {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  if (strFromU8(entries['mimetype'] ?? new Uint8Array()) !== LESSON_MIME) throw new Error('not a lesson')
  const lesson = JSON.parse(strFromU8(entries['lesson.json']))
  if (lesson?.version !== 1 || !Array.isArray(lesson.blocks)) throw new Error('unknown version')

  const pics = new Map<string, Promise<Pic | null>>()
  const pic = (name: string) => {
    if (!pics.has(name)) {
      const data = entries[`media/${name}`]
      pics.set(name, data ? picture(data).catch(() => null) : Promise.resolve(null))
    }
    return pics.get(name)!
  }

  const layers: Layer[] = []
  const byName = new Map<string, Layer>()
  /** bottom to top: the lowest place a layer had on any slide */
  const rank = new Map<string, number>()
  const layerFor = (l: { name: string; locked?: boolean; studentHidden?: boolean }, at: number) => {
    const key = `${l.name}|${!!l.locked}|${!!l.studentHidden}`
    let L = byName.get(key)
    if (!L) {
      L = { id: rid(), name: l.name.slice(0, 40), ...(l.locked ? { locked: true } : {}), ...(l.studentHidden ? { studentHidden: true } : {}) }
      byName.set(key, L)
      layers.push(L)
    }
    rank.set(L.id, Math.min(rank.get(L.id) ?? Infinity, at))
    return L.id
  }

  const clean = async (objs: Json[]): Promise<Json[]> => {
    const out: Json[] = []
    for (const src of objs) {
      const o: Json = {}
      for (const [k, v] of Object.entries(src)) if (!['uid', 'mark', 'mediaName', 'pinned', 'studentHidden', 'studentDraggable', 'layer', 'id'].includes(k)) o[k] = v
      if (String(o.type).toLowerCase() === 'image') {
        const p = typeof src.mediaName === 'string' ? await pic(src.mediaName) : null
        if (!p) continue // its picture isn't in the file
        shrinkImage(o, p)
      }
      if (Array.isArray(o.objects)) o.objects = await clean(o.objects as Json[])
      out.push(o)
    }
    return out
  }

  const objects: Json[] = []
  const k = page.w / SLIDE_W
  let row = 0
  for (const block of lesson.blocks) {
    const slides: Json[] = Array.isArray(block?.slides) ? block.slides : block?.scene ? [block.scene] : []
    for (const slide of slides) {
      const srcObjs = (Array.isArray(slide.objects) ? slide.objects : []) as Json[]
      const order = (Array.isArray(slide.layers) ? slide.layers : []) as SlideLayer[]
      const slideLayers = new Map<string, SlideLayer>(order.map((l) => [l.id, l]))
      const placed: Json[] = []
      const bg = typeof slide.background === 'string' && /^#[0-9a-f]{6}$/i.test(slide.background) ? slide.background.toLowerCase() : '#ffffff'
      if (bg !== '#ffffff')
        placed.push({ type: 'Rect', left: 0, top: 0, originX: 'left', originY: 'top', width: SLIDE_W, height: SLIDE_H, fill: bg, strokeWidth: 0, locked: true, layer: layerFor({ name: 'Фон слайдов', locked: true }, -2) })
      const cleaned = await clean(srcObjs)
      let ci = 0
      for (const src of srcObjs) {
        if (String(src.type).toLowerCase() === 'image' && !(typeof src.mediaName === 'string' && (await pic(src.mediaName)))) continue
        const o = cleaned[ci++]
        const L = slideLayers.get(src.layer as string)
        const hidden = !!src.studentHidden || !!L?.studentHidden
        const fixed = !!src.pinned || !!L?.locked
        if (fixed) o.locked = true
        // its place among the slide's layers; without layers: backdrop, then the rest, then the hidden
        const at = L ? order.indexOf(L) + (hidden && !L.studentHidden ? 0.5 : 0) : hidden ? 2 : fixed ? -1 : 1
        o.layer = layerFor(
          hidden
            ? { name: L?.studentHidden ? L.name || 'Скрыто от ученика' : L?.name ? `${L.name}: скрытое` : 'Скрыто от ученика', studentHidden: true }
            : L?.name
              ? { name: L.name }
              : { name: fixed ? 'Подложка' : 'Слой урока' },
          at,
        )
        placed.push(o)
      }
      placeJson(placed, k, 0, row * page.h)
      objects.push(...placed)
      row++
    }
  }
  layers.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!) // stable: ties keep the order met
  return { objects, layers, slides: row, title: String(lesson.meta?.title ?? '') }
}

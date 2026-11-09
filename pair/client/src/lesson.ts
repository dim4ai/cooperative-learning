// Opening our lesson file (*.colesson, LESSON_FORMAT.md): a zip with `mimetype`, lesson.json and media/.
// For a lesson for two, the slides of every stage, in order, become the board's pages: one slide at
// the top of each page, as wide as the page, with room below to write. Slide layers become board
// layers (merged by name), pinned objects are locked, objects hidden from the student go to a layer
// hidden from the student.
//
// Saving the board (writeLesson): every board page with something on it becomes a slide of that page's
// shape (1600 wide), which remembers its place (`page: [column, row]`); the sheet and bookmarks go to
// `pair`. Opened again here, the board comes back as it was; the lesson editor shows the slides.
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate'
import { picture, placeJson, shrinkImage, type Pic } from './pictures'
import type { Bookmark, Layer } from './board'
import type { Sheet } from './paper'

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
export type SavedBoard = { sheet?: Partial<Sheet>; bookmarks?: Bookmark[] }

/** The board saved by us, if the file is one: its sheet and bookmarks (open it before reading the objects) */
export async function lessonBoard(file: Blob): Promise<SavedBoard | null> {
  const lesson = await parse(file)
  const pair = lesson.json.pair
  return pair && typeof pair === 'object' ? pair : null
}

async function parse(file: Blob) {
  const entries = unzipSync(new Uint8Array(await file.arrayBuffer()))
  if (strFromU8(entries['mimetype'] ?? new Uint8Array()) !== LESSON_MIME) throw new Error('not a lesson')
  const json = JSON.parse(strFromU8(entries['lesson.json']))
  if (json?.version !== 1 || !Array.isArray(json.blocks)) throw new Error('unknown version')
  return { entries, json }
}

export async function readLesson(file: Blob, page: { w: number; h: number }): Promise<{ objects: Json[]; layers: Layer[]; slides: number; title: string }> {
  const { entries, json: lesson } = await parse(file)
  /** saved from our board: layers are the board's own (by id), flags stay on layers */
  const ours = !!lesson.pair

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
  const layerFor = (l: { id?: string; name: string; locked?: boolean; studentHidden?: boolean }, at: number) => {
    const key = ours && l.id ? l.id : `${l.name}|${!!l.locked}|${!!l.studentHidden}`
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
      for (const [k, v] of Object.entries(src)) if (!['uid', 'mark', 'mediaName', 'pinned', 'studentHidden', 'studentDraggable', 'layer', 'id', 'z'].includes(k)) o[k] = v
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
  const zOf = new Map<Json, number>()
  const k = page.w / SLIDE_W
  let row = 0
  for (const block of lesson.blocks) {
    const slides: Json[] = Array.isArray(block?.slides) ? block.slides : block?.scene ? [block.scene] : []
    for (const slide of slides) {
      const srcObjs = (Array.isArray(slide.objects) ? slide.objects : []) as Json[]
      const order = (Array.isArray(slide.layers) ? slide.layers : []) as SlideLayer[]
      const slideLayers = new Map<string, SlideLayer>(order.map((l) => [l.id, l]))
      const placed: Json[] = []
      if (ours) order.forEach((L, i) => layerFor({ id: L.id, name: L.name || 'Слой', locked: L.locked, studentHidden: L.studentHidden }, i)) // empty ones too
      const bg = typeof slide.background === 'string' && /^#[0-9a-f]{6}$/i.test(slide.background) ? slide.background.toLowerCase() : '#ffffff'
      if (bg !== '#ffffff')
        placed.push({ type: 'Rect', left: 0, top: 0, originX: 'left', originY: 'top', width: SLIDE_W, height: SLIDE_H, fill: bg, strokeWidth: 0, locked: true, layer: layerFor({ name: 'Фон слайдов', locked: true }, -2) })
      const cleaned = await clean(srcObjs)
      let ci = 0
      for (const src of srcObjs) {
        if (String(src.type).toLowerCase() === 'image' && !(typeof src.mediaName === 'string' && (await pic(src.mediaName)))) continue
        const o = cleaned[ci++]
      if (ours && typeof src.z === 'number') zOf.set(o, src.z)
        const L = slideLayers.get(src.layer as string)
        const hidden = !!src.studentHidden || !!L?.studentHidden
        const fixed = !!src.pinned || !!L?.locked
        if (ours ? src.pinned : fixed) o.locked = true
        // its place among the slide's layers; without layers: backdrop, then the rest, then the hidden
        const at = L ? order.indexOf(L) + (hidden && !L.studentHidden ? 0.5 : 0) : hidden ? 2 : fixed ? -1 : 1
        o.layer = layerFor(
          ours && L
            ? { id: L.id, name: L.name || 'Слой', locked: L.locked, studentHidden: L.studentHidden }
            : hidden
            ? { name: L?.studentHidden ? L.name || 'Скрыто от ученика' : L?.name ? `${L.name}: скрытое` : 'Скрыто от ученика', studentHidden: true }
            : L?.name
              ? { name: L.name }
              : { name: fixed ? 'Подложка' : 'Слой урока' },
          at,
        )
        placed.push(o)
      }
      const spot = Array.isArray(slide.page) && slide.page.length === 2 && slide.page.every(Number.isInteger) ? (slide.page as number[]) : null
      const w = Number(slide.width) > 0 ? Number(slide.width) : SLIDE_W
      if (spot) placeJson(placed, page.w / w, spot[0] * page.w, spot[1] * page.h)
      else placeJson(placed, k, 0, row * page.h)
      objects.push(...placed)
      row++
    }
  }
  layers.sort((a, b) => rank.get(a.id)! - rank.get(b.id)!) // stable: ties keep the order met
  if (zOf.size) objects.sort((a, b) => (zOf.get(a) ?? 0) - (zOf.get(b) ?? 0))
  return { objects, layers, slides: row, title: String(lesson.meta?.title ?? '') }
}

// ---------- saving ----------

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg' }

/** A picture's src (data URL, or a link) → its bytes and file extension */
async function bytesOf(src: string): Promise<{ data: Uint8Array; ext: string } | null> {
  try {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src)
    if (m) {
      const data = m[2] ? Uint8Array.from(atob(m[3]), (c) => c.charCodeAt(0)) : strToU8(decodeURIComponent(m[3]))
      return { data, ext: EXT[m[1]] ?? 'png' }
    }
    const r = await fetch(src)
    if (!r.ok) return null
    return { data: new Uint8Array(await r.arrayBuffer()), ext: EXT[r.headers.get('content-type') ?? ''] ?? 'png' }
  } catch {
    return null
  }
}

/**
 * The board → a lesson file. `items`: each object (Fabric JSON, board coordinates) with the page
 * its middle is on; `page`: the page size on the board.
 */
export async function writeLesson(a: {
  title: string
  items: { obj: Json; page: [number, number] }[]
  layers: Layer[]
  sheet: Sheet
  bookmarks: Bookmark[]
  page: { w: number; h: number }
}): Promise<Blob> {
  const media: Record<string, Uint8Array> = {}
  const names = new Map<string, string | null>()
  const nameOf = async (src: string) => {
    if (!names.has(src)) {
      const got = await bytesOf(src)
      let name: string | null = null
      if (got) {
        name = `picture-${names.size + 1}.${got.ext}`
        media[name] = got.data
      }
      names.set(src, name)
    }
    return names.get(src)!
  }
  // our fields → the format's: id → uid, locked → pinned, src → mediaName
  const out = async (o: Json, top: boolean): Promise<Json | null> => {
    const r: Json = {}
    for (const [k, v] of Object.entries(o)) if (!['id', 'locked', 'layer', 'src'].includes(k)) r[k] = v
    if (top && o.id) r.uid = o.id
    if (top && o.locked) r.pinned = true
    if (top) r.layer = a.layers.some((l) => l.id === o.layer) ? o.layer : a.layers[0]?.id
    if (String(o.type).toLowerCase() === 'image') {
      const name = typeof o.src === 'string' ? await nameOf(o.src) : null
      if (!name) return null
      r.mediaName = name
    }
    if (Array.isArray(o.objects)) r.objects = (await Promise.all((o.objects as Json[]).map((c) => out(c, false)))).filter(Boolean)
    return r
  }

  const W = SLIDE_W
  const s = W / a.page.w
  const H = Math.round(a.page.h * s)
  const byPage = new Map<string, { page: [number, number]; objs: Json[] }>()
  for (const [z, it] of a.items.entries()) {
    const key = it.page.join(',')
    if (!byPage.has(key)) byPage.set(key, { page: it.page, objs: [] })
    const o = await out(it.obj, true)
    if (!o) continue
    o.z = z // what is above what across pages too
    byPage.get(key)!.objs.push(o)
  }
  const layers = a.layers.map((l) => ({ id: l.id, name: l.name, ...(l.locked ? { locked: true } : {}), ...(l.studentHidden ? { studentHidden: true } : {}) }))
  const slides = [...byPage.values()]
    .sort((p, q) => p.page[1] - q.page[1] || p.page[0] - q.page[0])
    .map(({ page: [i, j], objs }) => {
      placeJson(objs, s, -i * W, -j * a.page.h * s)
      return { id: rid(), engine: 'fabric', width: W, height: H, background: '#ffffff', page: [i, j], layers, objects: objs }
    })
  const lesson = {
    version: 1,
    meta: { title: a.title, createdAt: new Date().toISOString().slice(0, 10) },
    blocks: [{ id: rid(), type: 'pairs', title: a.title || 'Доска', duration: 45, teacherNote: '', attachments: [], slides }],
    pair: { sheet: a.sheet, bookmarks: a.bookmarks },
  }
  const files: Zippable = { mimetype: [strToU8(LESSON_MIME), { level: 0 }], 'lesson.json': strToU8(JSON.stringify(lesson)) }
  for (const [name, data] of Object.entries(media)) files[`media/${name}`] = [data, { level: 0 }]
  return new Blob([zipSync(files) as BlobPart], { type: LESSON_MIME })
}

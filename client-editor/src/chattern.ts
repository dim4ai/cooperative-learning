// Import of Chattern boards (*.chtrn) — so a teacher can bring their own boards over.
// File: "chattern" + 10 ASCII digits (length N) + gzip(JSON) of N bytes + PNG blobs back to back.
// JSON: { type: 'board', version, blobs: [{sha, size}], fc: <Fabric.js 5.3 canvas JSON> } with Chattern's
// own fields: chrnBlobSha256 (image bytes by hash), chrnPinned (background), chrnUuid, chrnBg (ruling).
//
// Imported into a block (like a multi-page PDF): the board's slides go after the current one.
// A board is one long page (A4 width, any height); our slides are 16:9. The board is cut into frames
// as wide as the page, at empty gaps between objects, one frame → one slide. Groups taller than a
// frame (Chattern pins whole-board layouts as one group) are taken apart first.
import { gunzipSync, strFromU8 } from 'fflate'
import { Group, Line, Point, util, type FabricObject } from 'fabric'
import type { Scene, SceneObject } from './types'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from './types'
import { emptyScene, blobUrl, toSceneObject } from './slides/scene'
import type { Media } from './lessonFile'
import { nanoid } from './nanoid'
import './slides/render' // registers our custom properties (mediaName, layer…) with Fabric

export function isChattern(bytes: Uint8Array): boolean {
  return strFromU8(bytes.subarray(0, 8)) === 'chattern'
}

interface Board {
  blobs?: { sha: string; size: number }[]
  fc: { objects?: Record<string, unknown>[]; background?: unknown; chrnBg?: string | Record<string, unknown>; chrnPage64pxMm?: number; chrnPageSize?: string }
}

function parse(bytes: Uint8Array): { board: Board; media: Map<string, Blob> } {
  if (!isChattern(bytes)) throw new Error('Это не доска Chattern')
  const n = parseInt(strFromU8(bytes.subarray(8, 18)), 10)
  if (!(n > 0) || 18 + n > bytes.length) throw new Error('Доска Chattern повреждена')
  let board: Board
  try {
    board = JSON.parse(strFromU8(gunzipSync(bytes.subarray(18, 18 + n))))
  } catch {
    throw new Error('Доска Chattern повреждена')
  }
  if (!board?.fc || !Array.isArray(board.fc.objects)) throw new Error('Доска Chattern повреждена')
  const media = new Map<string, Blob>()
  let off = 18 + n
  for (const b of board.blobs ?? []) {
    const data = bytes.slice(off, off + b.size)
    off += b.size
    media.set(b.sha, new Blob([data], { type: sniffImage(data) }))
  }
  return { board, media }
}

function sniffImage(d: Uint8Array): string {
  if (d[0] === 0x89 && d[1] === 0x50) return 'image/png'
  if (d[0] === 0xff && d[1] === 0xd8) return 'image/jpeg'
  if (d[0] === 0x47 && d[1] === 0x49) return 'image/gif'
  if (strFromU8(d.subarray(8, 12)) === 'WEBP') return 'image/webp'
  return 'image/png'
}

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }

/** Fabric 5 JSON → JSON Fabric 7 loads; images point at their blobs, Chattern fields → ours */
function prepare(objs: Record<string, unknown>[], blobs: Map<string, Blob>, names: Map<string, string>, pinned = false): Record<string, unknown>[] {
  return objs.map(src => {
    const o: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(src)) if (!k.startsWith('chrn') && k !== 'erasable') o[k] = v
    const pin = pinned || src.chrnPinned === true
    if (pin) o.pinned = true
    if (o.visible === false) { o.visible = true; o.studentHidden = true } // hidden on the board → hidden from students
    const sha = src.chrnBlobSha256 as string | undefined
    if (sha && blobs.has(sha)) {
      const blob = blobs.get(sha)!
      if (!names.has(sha)) names.set(sha, `chattern-${sha.slice(0, 12)}.${EXT[blob.type] ?? 'png'}`)
      o.mediaName = names.get(sha)
      o.src = blobUrl(blob)
    }
    if (Array.isArray(o.objects)) o.objects = prepare(o.objects as Record<string, unknown>[], blobs, names, pin)
    return o
  })
}

/** Board-space bounds of an object; z — its place in the drawing order */
type Box = { o: FabricObject; z: number; top: number; bottom: number; left: number; right: number }
const box = (o: FabricObject, z = 0): Box => {
  o.setCoords()
  const r = o.getBoundingRect()
  return { o, z, top: r.top, bottom: r.top + r.height, left: r.left, right: r.left + r.width }
}

/**
 * Tall backdrops (a column's panel, a divider line through the whole board) are cut into
 * a piece per slide instead of shrinking a slide to fit them: upright rectangles and vertical lines.
 */
function splittable(b: Box, frameH: number): boolean {
  const o = b.o
  if (b.bottom - b.top <= frameH * 0.9 || o.angle % 360 !== 0 || o.skewX || o.skewY) return false
  const t = o.type.toLowerCase()
  return t === 'rect' || (t === 'line' && b.right - b.left <= (o.strokeWidth || 1) * Math.abs(o.scaleX) + 2)
}

/** The part of a splittable object between y0 and y1 (board space) */
async function piece(b: Box, y0: number, y1: number): Promise<FabricObject> {
  const o = b.o
  const top = Math.max(b.top, y0), bottom = Math.min(b.bottom, y1)
  if (o.type.toLowerCase() === 'line') {
    const x = (b.left + b.right) / 2
    const sw = (o.strokeWidth || 1) * Math.abs(o.scaleX)
    const { stroke, strokeDashArray, strokeLineCap, opacity } = o
    const p = new Line([x, top + sw / 2, x, bottom - sw / 2], { stroke, strokeWidth: sw, strokeDashArray, strokeLineCap, opacity })
    copyOurs(o, p)
    return p
  }
  const p = await o.clone()
  copyOurs(o, p)
  const sw = o.stroke ? o.strokeWidth || 0 : 0
  const h = bottom - top
  p.set({ height: Math.max(1, o.strokeUniform ? (h - sw) / o.scaleY : h / o.scaleY - sw) })
  p.setPositionByOrigin(new Point((b.left + b.right) / 2, (top + bottom) / 2), 'center', 'center')
  return p
}

type Ours = FabricObject & { pinned?: boolean; studentHidden?: boolean; mediaName?: string }
function copyOurs(from: FabricObject, to: FabricObject) {
  const f = from as Ours, t = to as Ours
  if (f.pinned) t.pinned = true
  if (f.studentHidden) t.studentHidden = true
}

/** Groups taller than a frame → their children, in board coordinates (recursively) */
function explode(objs: FabricObject[], frameH: number): FabricObject[] {
  const out: FabricObject[] = []
  for (const o of objs) {
    if (o instanceof Group && box(o).bottom - box(o).top > frameH) {
      const pinned = (o as FabricObject & { pinned?: boolean }).pinned
      const kids = o.removeAll() // Fabric puts the group's transform onto each child
      for (const k of kids) if (pinned) (k as FabricObject & { pinned?: boolean }).pinned = true
      out.push(...explode(kids, frameH))
    } else out.push(o)
  }
  return out
}

/** Board background → slide background color and ruling */
function page(fc: Board['fc'], k: number): Pick<Scene, 'background' | 'paper' | 'paperColor'> {
  let bg: { colorCode?: string; colorValue?: string; markupCode?: string; markupColorCode?: string; step?: number } = {}
  try { if (fc.chrnBg) bg = typeof fc.chrnBg === 'string' ? JSON.parse(fc.chrnBg) : fc.chrnBg } catch { /* no ruling */ }
  let background = '#ffffff'
  if (typeof fc.background === 'string' && /^#[0-9a-f]{3,8}$/i.test(fc.background)) background = fc.background
  if (bg.colorValue) background = bg.colorValue
  else if (bg.colorCode === 'paper') background = '#fdf6e3'
  // Ruling: chrnBg, or an old-style pattern picture (…/images/lgray_cell_32px.png, black_callig_1.png)
  const pattern = typeof fc.background === 'object' && fc.background ? String((fc.background as { source?: unknown }).source ?? '') : ''
  let paper: string | undefined
  if (bg.markupCode === 'cell' || /_cell_/.test(pattern)) {
    const step = (bg.step || Number(pattern.match(/_(\d+)px/)?.[1]) || 32) * k
    paper = step < 30 ? 'grid-s' : step < 60 ? 'grid-m' : 'grid-l'
  } else if (/callig/.test(pattern)) paper = 'calligraphy'
  const paperColor = paper && (bg.markupColorCode === 'gray' || /lgray/.test(pattern)) ? '#cbd5e1' : undefined
  return { background, ...(paper ? { paper, ...(paperColor ? { paperColor } : {}) } : {}) }
}

/** A .chtrn file → slides (the board cut into frames) and the pictures they use */
export async function chatternSlides(file: Blob): Promise<{ slides: Scene[]; media: Media }> {
  const { board, media: blobs } = parse(new Uint8Array(await file.arrayBuffer()))
  const names = new Map<string, string>() // sha → media name
  const json = prepare(board.fc.objects!, blobs, names)
  let objs = (await util.enlivenObjects(json)) as FabricObject[]
  // Group frames were measured with Chattern's fonts (Roboto, Pacifico…); with ours text may come out
  // wider and get clipped by the group — fit every group to what it holds now (innermost first)
  const refit = (o: FabricObject) => { if (o instanceof Group) { o.getObjects().forEach(refit); o.triggerLayout() } }
  objs.forEach(refit)

  // Frame: as wide as the page (A4 at the board's scale) or the content, whichever is wider
  const pxPerMm = 64 / (board.fc.chrnPage64pxMm || 10)
  const pageW = (board.fc.chrnPageSize?.endsWith('L') ? 297 : 210) * pxPerMm
  let boxes = objs.map(box)
  const x0 = Math.min(0, ...boxes.map(b => b.left))
  const width = Math.max(pageW, Math.max(...boxes.map(b => b.right), 0) - x0)
  const frameH = (width * SLIDE_HEIGHT) / SLIDE_WIDTH
  objs = explode(objs, frameH)
  boxes = objs.map((o, z) => box(o, z))
  const spans = boxes.filter(b => splittable(b, frameH))
  if (spans.length < boxes.length) boxes = boxes.filter(b => !spans.includes(b)) // else: nothing but backdrops
  boxes.sort((a, b) => a.top - b.top)

  const slides: Scene[] = []
  let rest = boxes
  while (rest.length) {
    const y0 = rest[0].top
    const limit = y0 + frameH
    // Cut at the lowest point ≤ limit that no object crosses (not too high: at least 40% of a frame)
    const crosses = (y: number) => rest.some(b => b.top < y - 0.5 && b.bottom > y + 0.5)
    const candidates = [limit, ...rest.filter(b => b.top > y0 && b.top <= limit).map(b => b.top),
      ...rest.filter(b => b.bottom > y0 && b.bottom <= limit).map(b => b.bottom)]
      .filter(y => y >= y0 + frameH * 0.4)
      .sort((a, b) => b - a)
    const cut = candidates.find(y => !crosses(y)) ?? limit
    const inBand = rest.filter(b => b.top < cut)
    rest = rest.filter(b => b.top >= cut)
    const bandEnd = rest.length ? cut : Math.max(cut, ...inBand.map(b => b.bottom))
    if (spans.length < boxes.length)
      for (const s of spans) if (s.top < bandEnd && s.bottom > y0) inBand.push(box(await piece(s, y0, bandEnd), s.z))
    inBand.sort((a, b) => a.z - b.z) // drawing order as on the board
    // An object taller than the band (a big picture) shrinks the whole slide to fit
    const bottom = Math.max(cut, ...inBand.map(b => b.bottom))
    const k = Math.min(SLIDE_WIDTH / width, SLIDE_HEIGHT / (bottom - y0))
    const dx = (SLIDE_WIDTH - width * k) / 2
    slides.push(makeSlide(inBand.map(b => b.o), o => {
      o.set({ left: dx + (o.left - x0) * k, top: (o.top - y0) * k, scaleX: o.scaleX * k, scaleY: o.scaleY * k })
    }, page(board.fc, k)))
  }

  const media: Media = {}
  for (const [sha, name] of names) media[name] = blobs.get(sha)!
  return { slides, media }
}

function makeSlide(objs: FabricObject[], place: (o: FabricObject) => void, look: Pick<Scene, 'background' | 'paper' | 'paperColor'>): Scene {
  const s = emptyScene()
  const [bg, main] = s.layers!
  const objects: SceneObject[] = []
  for (const o of objs) {
    place(o)
    const j = toSceneObject(o)
    j.uid = nanoid()
    j.layer = j.pinned ? bg.id : main.id
    delete j.pinned // the layer is locked instead
    objects.push(j)
  }
  objects.sort((a, b) => (a.layer === bg.id ? 0 : 1) - (b.layer === bg.id ? 0 : 1)) // stable: background first
  return { ...s, ...look, objects }
}

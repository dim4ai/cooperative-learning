// Opening a Chattern board (*.chtrn) that a teacher brings: we only read it, never write one
// (their boards have no layers, ours do). The same reader as in the lesson editor:
// "chattern" + 10 ASCII digits (length N) + gzip(JSON) of N bytes + the pictures back to back.
// JSON: { blobs: [{sha, size}], fc: <Fabric.js 5 canvas JSON> } plus Chattern's own fields:
// chrnBlobSha256 (a picture's bytes by hash), chrnPinned (fixed in place), chrnPage64pxMm (scale).
import { gunzipSync, strFromU8 } from 'fflate'

export function isChattern(bytes: Uint8Array): boolean {
  return bytes.length > 18 && strFromU8(bytes.subarray(0, 8)) === 'chattern'
}

export interface ChatternBoard {
  /** Fabric JSON ready to load: pictures as data URLs, pinned objects locked, Chattern fields dropped */
  objects: Record<string, unknown>[]
  /** how many of our board pixels one Chattern pixel is (from its page scale) */
  scale: number
  landscape: boolean
}

const PX_PER_MM = 96 / 25.4 // ours, as in paper.ts
const MAX_SIDE = 1800 // like PDF pages: enough for a page, light enough to send to the student

/** A picture's bytes → a data URL no larger than MAX_SIDE, and how much it was shrunk */
async function picture(data: Uint8Array): Promise<{ url: string; f: number }> {
  const bmp = await createImageBitmap(new Blob([data as BlobPart]))
  const f = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(bmp.width * f))
  cv.height = Math.max(1, Math.round(bmp.height * f))
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height)
  bmp.close()
  const png = data[0] === 0x89 && data[1] === 0x50
  let url = cv.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85)
  if (url.length > 1_500_000) url = cv.toDataURL('image/jpeg', 0.8) // big screenshots: png is wasteful
  return { url, f: cv.width / bmp.width }
}

export async function readChattern(file: Blob): Promise<ChatternBoard> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!isChattern(bytes)) throw new Error('not chattern')
  const n = parseInt(strFromU8(bytes.subarray(8, 18)), 10)
  if (!(n > 0) || 18 + n > bytes.length) throw new Error('broken')
  const board = JSON.parse(strFromU8(gunzipSync(bytes.subarray(18, 18 + n))))
  const fc = board?.fc
  if (!fc || !Array.isArray(fc.objects)) throw new Error('broken')

  const raw = new Map<string, Uint8Array>()
  let off = 18 + n
  for (const b of Array.isArray(board.blobs) ? board.blobs : []) {
    raw.set(b.sha, bytes.subarray(off, off + b.size))
    off += b.size
  }
  const pics = new Map<string, Promise<{ url: string; f: number } | null>>()
  const pic = (sha: string) => {
    if (!pics.has(sha)) pics.set(sha, raw.has(sha) ? picture(raw.get(sha)!).catch(() => null) : Promise.resolve(null))
    return pics.get(sha)!
  }

  const prepare = async (objs: Record<string, unknown>[], inGroup: boolean): Promise<Record<string, unknown>[]> => {
    const out: Record<string, unknown>[] = []
    for (const src of objs) {
      const o: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(src)) if (!k.startsWith('chrn') && k !== 'erasable') o[k] = v
      // a fixed backdrop (a worksheet, a layout) stays put for both sides
      if (!inGroup && src.chrnPinned === true) o.locked = true
      if (o.visible === false) o.visible = true
      const sha = src.chrnBlobSha256
      if (String(o.type).toLowerCase() === 'image') {
        const p = typeof sha === 'string' ? await pic(sha) : null
        if (!p) continue // a picture whose bytes are missing: leave it out rather than break the board
        o.src = p.url
        if (p.f < 1) {
          // the same picture on the board, from fewer pixels
          for (const k of ['width', 'height', 'cropX', 'cropY'] as const) if (typeof o[k] === 'number') o[k] = (o[k] as number) * p.f
          o.scaleX = ((o.scaleX as number) ?? 1) / p.f
          o.scaleY = ((o.scaleY as number) ?? 1) / p.f
        }
      }
      if (Array.isArray(o.objects)) o.objects = await prepare(o.objects as Record<string, unknown>[], true)
      out.push(o)
    }
    return out
  }

  const objects = await prepare(fc.objects, false)
  const pxPerMm = 64 / (Number(fc.chrnPage64pxMm) || 10)
  return { objects, scale: PX_PER_MM / pxPerMm, landscape: String(fc.chrnPageSize ?? '').endsWith('L') }
}

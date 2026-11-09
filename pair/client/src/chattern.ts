// Opening a Chattern board (*.chtrn) that a teacher brings: we only read it, never write one
// (their boards have no layers, ours do). The same reader as in the lesson editor:
// "chattern" + 10 ASCII digits (length N) + gzip(JSON) of N bytes + the pictures back to back.
// JSON: { blobs: [{sha, size}], fc: <Fabric.js 5 canvas JSON> } plus Chattern's own fields:
// chrnBlobSha256 (a picture's bytes by hash), chrnPinned (fixed in place), chrnPage64pxMm (scale).
import { gunzipSync, strFromU8 } from 'fflate'
import { picture, shrinkImage } from './pictures'

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
        shrinkImage(o, p)
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

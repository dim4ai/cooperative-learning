// Reading a zip straight from the file on disk: the central directory is parsed, entries are
// handed out as slices of the File — a recording's sound can be hundreds of megabytes, none of it
// is read into memory until it plays. The teacher's browser writes the archive stored (not
// compressed, client-teacher/src/recStore.ts); a compressed entry (someone re-zipped it) is inflated.
import { inflateSync, strFromU8 } from 'fflate'

export interface ZipEntry {
  name: string
  /** the entry's bytes; mime is set by the caller */
  blob(type?: string): Promise<Blob>
}

const EOCD = 0x06054b50
const CEN = 0x02014b50
const LOC = 0x04034b50

async function bytes(file: Blob, from: number, to: number): Promise<DataView> {
  return new DataView(await file.slice(from, to).arrayBuffer())
}

export async function readZip(file: Blob): Promise<Map<string, ZipEntry>> {
  // End of central directory: the last 22 bytes, or earlier if there's a comment (up to 64 KB)
  const tailFrom = Math.max(0, file.size - 22 - 0xffff)
  const tail = await bytes(file, tailFrom, file.size)
  let eocd = -1
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === EOCD) { eocd = i; break }
  if (eocd < 0) throw new Error('not a zip')
  const count = tail.getUint16(eocd + 10, true)
  const cdSize = tail.getUint32(eocd + 12, true)
  const cdOffset = tail.getUint32(eocd + 16, true)
  const cd = await bytes(file, cdOffset, cdOffset + cdSize)

  const out = new Map<string, ZipEntry>()
  let p = 0
  for (let n = 0; n < count; n++) {
    if (cd.getUint32(p, true) !== CEN) throw new Error('broken zip')
    const flags = cd.getUint16(p + 8, true)
    const method = cd.getUint16(p + 10, true)
    const compSize = cd.getUint32(p + 20, true)
    const nameLen = cd.getUint16(p + 28, true)
    const extraLen = cd.getUint16(p + 30, true)
    const commentLen = cd.getUint16(p + 32, true)
    const local = cd.getUint32(p + 42, true)
    const raw = new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen)
    // 0x0800: UTF-8 names; others (old Windows zips) are most likely cp866 — rare, read as UTF-8 too
    const name = flags & 0x0800 ? strFromU8(raw) : new TextDecoder().decode(raw)
    p += 46 + nameLen + extraLen + commentLen
    if (name.endsWith('/')) continue

    out.set(name, {
      name,
      async blob(type = '') {
        const lh = await bytes(file, local, local + 30)
        if (lh.getUint32(0, true) !== LOC) throw new Error('broken zip')
        const start = local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true)
        const data = file.slice(start, start + compSize, type)
        if (method === 0) return data
        if (method === 8) return new Blob([inflateSync(new Uint8Array(await data.arrayBuffer())) as Uint8Array<ArrayBuffer>], { type })
        throw new Error(`unsupported zip method ${method}`)
      },
    })
  }
  return out
}

export async function entryText(e: ZipEntry): Promise<string> {
  return (await e.blob()).text()
}

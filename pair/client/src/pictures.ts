// Pictures from opened files: bytes → a data URL small enough to send to the student.

const MAX_SIDE = 1800 // like PDF pages: enough for a page, light enough to send

export type Pic = { url: string; f: number }

/** A picture's bytes → a data URL no larger than MAX_SIDE, and how much it was shrunk */
export async function picture(data: Uint8Array): Promise<Pic> {
  const bmp = await createImageBitmap(new Blob([data as BlobPart]))
  const f = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height))
  const cv = document.createElement('canvas')
  cv.width = Math.max(1, Math.round(bmp.width * f))
  cv.height = Math.max(1, Math.round(bmp.height * f))
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height)
  const real = cv.width / bmp.width
  bmp.close()
  const png = data[0] === 0x89 && data[1] === 0x50
  let url = cv.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85)
  if (url.length > 1_500_000) url = cv.toDataURL('image/jpeg', 0.8) // big screenshots: png is wasteful
  return { url, f: real }
}

/** Points an image object (Fabric JSON) at the picture; the same size on the board, from fewer pixels */
export function shrinkImage(o: Record<string, unknown>, p: Pic) {
  o.src = p.url
  if (p.f >= 1) return
  for (const k of ['width', 'height', 'cropX', 'cropY'] as const) if (typeof o[k] === 'number') o[k] = (o[k] as number) * p.f
  o.scaleX = ((o.scaleX as number) ?? 1) / p.f
  o.scaleY = ((o.scaleY as number) ?? 1) / p.f
}

/** Moves and scales Fabric JSON objects about (0, 0): p → p·s + (dx, dy). Any origin works. */
export function placeJson(objs: Record<string, unknown>[], s: number, dx: number, dy: number) {
  for (const o of objs) {
    o.left = ((o.left as number) ?? 0) * s + dx
    o.top = ((o.top as number) ?? 0) * s + dy
    o.scaleX = ((o.scaleX as number) ?? 1) * s
    o.scaleY = ((o.scaleY as number) ?? 1) * s
  }
}

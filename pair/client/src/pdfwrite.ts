// A minimal PDF writer: one JPEG picture per page, filling the page. Enough to save
// the board as a multi-page PDF without a library.

export interface PdfPage {
  jpeg: Uint8Array
  /** pixel size of the JPEG */
  width: number
  height: number
  /** page size in millimetres */
  mmW: number
  mmH: number
}

const PT_PER_MM = 72 / 25.4

export function makePdf(pages: PdfPage[]): Blob {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const offsets: number[] = []
  let size = 0
  const put = (p: string | Uint8Array) => {
    const b = typeof p === 'string' ? enc.encode(p) : p
    parts.push(b)
    size += b.length
  }
  const obj = (n: number, body: () => void) => {
    offsets[n] = size
    put(`${n} 0 obj\n`)
    body()
    put('\nendobj\n')
  }

  // objects: 1 catalog, 2 page tree, then per page: page, content, image
  const pageObj = (i: number) => 3 + i * 3
  put('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  obj(1, () => put('<< /Type /Catalog /Pages 2 0 R >>'))
  obj(2, () => put(`<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`))
  pages.forEach((p, i) => {
    const n = pageObj(i)
    const w = (p.mmW * PT_PER_MM).toFixed(2)
    const h = (p.mmH * PT_PER_MM).toFixed(2)
    obj(n, () =>
      put(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`),
    )
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`
    obj(n + 1, () => put(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`))
    obj(n + 2, () => {
      put(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`)
      put(p.jpeg)
      put('\nendstream')
    })
  })
  const xref = size
  const count = 3 + pages.length * 3
  put(`xref\n0 ${count}\n0000000000 65535 f \n`)
  for (let n = 1; n < count; n++) put(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`)
  put(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`)
  return new Blob(parts as BlobPart[], { type: 'application/pdf' })
}

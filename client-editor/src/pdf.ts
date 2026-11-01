// PDF page → raster image, so a PDF page becomes an ordinary image layer on the slide.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

const TARGET_WIDTH = 2400 // px; slide is 1600 wide — headroom for zoom/projectors

export async function pdfPageCount(file: Blob): Promise<number> {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  try {
    return (await task.promise).numPages
  } finally {
    await task.destroy()
  }
}

/** Renders the given pages (1-based) to PNG, opening the document once */
export async function renderPdfPages(
  file: Blob, pages: number[], onProgress?: (done: number) => void,
): Promise<Blob[]> {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  try {
    const doc = await task.promise
    const out: Blob[] = []
    for (const pageNo of pages) {
      onProgress?.(out.length + 1)
      const page = await doc.getPage(pageNo)
      const base = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: TARGET_WIDTH / base.width })
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvas, canvasContext: ctx, viewport }).promise
      page.cleanup()
      out.push(await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(b => (b ? resolve(b) : reject(new Error(`Не удалось отрисовать страницу ${pageNo}`))), 'image/png'),
      ))
      canvas.width = canvas.height = 0 // free the bitmap early on long PDFs
    }
    return out
  } finally {
    await task.destroy()
  }
}

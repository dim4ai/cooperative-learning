// Importing a PDF: a dialog with page thumbnails to pick pages (or type a range),
// a large view of a page to frame the part to keep (the same frame cuts every chosen
// page), then the pages are rendered to pictures. Loaded only when a PDF is opened.
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

type Crop = { l: number; t: number; r: number; b: number } // fractions of the page

const TARGET = 1800 // px across the kept part of a page

/** "1-3, 5" → [1, 2, 3, 5] within 1..n */
export function parseRange(text: string, n: number): number[] {
  const out = new Set<number>()
  for (const part of text.split(/[,;\s]+/)) {
    const m = part.match(/^(\d+)(?:\s*[-–—]\s*(\d+))?$/)
    if (!m) continue
    let a = +m[1]
    let b = m[2] ? +m[2] : a
    if (a > b) [a, b] = [b, a]
    for (let i = Math.max(1, a); i <= Math.min(n, b); i++) out.add(i)
  }
  return [...out].sort((x, y) => x - y)
}

/** [1, 2, 3, 5] → "1-3, 5" */
export function formatRange(pages: number[]): string {
  const parts: string[] = []
  for (let i = 0; i < pages.length; i++) {
    let j = i
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++
    parts.push(j > i ? `${pages[i]}-${pages[j]}` : String(pages[i]))
    i = j
  }
  return parts.join(', ')
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = '') {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (text) e.textContent = text
  return e
}

async function renderPage(doc: PDFDocumentProxy, n: number, width: number) {
  const page = await doc.getPage(n)
  const base = page.getViewport({ scale: 1 })
  const viewport = page.getViewport({ scale: width / base.width })
  const cv = document.createElement('canvas')
  cv.width = Math.ceil(viewport.width)
  cv.height = Math.ceil(viewport.height)
  const ctx = cv.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, cv.width, cv.height)
  await page.render({ canvas: cv, canvasContext: ctx, viewport }).promise
  page.cleanup()
  return cv
}

/** First step without a file: say what this is, take a dropped file or open the file picker on request. */
function chooseFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Вставка PDF' })
    const card = h('div', { class: 'modal-card pdf-pick' })
    const head = h('div', { class: 'modal-head' })
    head.append(h('b', {}, 'Вставка PDF'))
    const zone = h('div', { class: 'pdf-drop' })
    zone.append(
      h('p', { class: 'pdf-drop-title' }, 'Перетащите PDF-файл сюда'),
      h('p', { class: 'muted' }, 'Потом можно будет выбрать страницы и обрезать поля. Страницы лягут по листам доски, как обычные картинки.'),
    )
    const input = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: '' }) as HTMLInputElement
    const pick = h('button', { class: 'primary-sm' }, 'Выбрать файл…')
    zone.append(pick, input)
    const foot = h('div', { class: 'modal-foot' })
    const cancel = h('button', { class: 'secondary' }, 'Отмена')
    foot.append(h('div', { class: 'grow' }), cancel)
    card.append(head, zone, foot)
    overlay.append(card)
    document.body.append(overlay)
    const close = (f: File | null) => {
      document.removeEventListener('keydown', onKey, true)
      overlay.remove()
      resolve(f)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close(null)
      }
    }
    document.addEventListener('keydown', onKey, true)
    const isPdf = (f: File) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
    pick.addEventListener('click', () => input.click())
    input.addEventListener('change', () => input.files?.[0] && close(input.files[0]))
    cancel.addEventListener('click', () => close(null))
    overlay.addEventListener('pointerdown', (e) => e.target === overlay && close(null))
    zone.addEventListener('dragover', (e) => {
      e.preventDefault()
      zone.classList.add('over')
    })
    zone.addEventListener('dragleave', () => zone.classList.remove('over'))
    zone.addEventListener('drop', (e) => {
      e.preventDefault()
      e.stopPropagation()
      zone.classList.remove('over')
      const f = [...(e.dataTransfer?.files ?? [])].find(isPdf)
      if (f) close(f)
      else zone.querySelector('.muted')!.textContent = 'Это не PDF. Нужен файл с расширением .pdf'
    })
  })
}

/** Opens the dialog (asking for the file first if none given); resolves with the chosen pages as pictures, or null if cancelled. */
export async function pdfDialog(given?: File): Promise<Blob[] | null> {
  const file = given ?? (await chooseFile())
  if (!file) return null
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const doc = await task.promise
  const n = doc.numPages
  // a short file is usually wanted whole; from a long one (a textbook) the teacher picks pages
  const chosen = new Set<number>(n <= 10 ? Array.from({ length: n }, (_, i) => i + 1) : [])
  let current = 1
  let crop: Crop = { l: 0, t: 0, r: 1, b: 1 }

  const overlay = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Вставка PDF' })
  const card = h('div', { class: 'modal-card pdf-card' })
  overlay.append(card)

  const header = h('div', { class: 'modal-head' })
  const title = h('b', {}, file.name)
  const count = h('span', { class: 'muted' }, ` · ${n} стр.`)
  header.append(title, count)

  const thumbs = h('div', { class: 'pdf-thumbs' })
  const side = h('div', { class: 'pdf-side' })
  const viewWrap = h('div', { class: 'pdf-view' })
  const frame = h('div', { class: 'pdf-crop' })
  viewWrap.append(frame)
  const viewHint = h('p', { class: 'muted' }, 'Обведите рамкой нужную часть страницы (рамку можно двигать). Обрезка применяется ко всем выбранным страницам.')
  const resetCrop = h('button', { class: 'link-btn' }, 'Без обрезки')
  side.append(viewWrap, viewHint, resetCrop)

  const body = h('div', { class: 'pdf-body' })
  body.append(thumbs, side)

  const footer = h('div', { class: 'modal-foot' })
  const rangeLabel = h('label', { class: 'pdf-range' }, 'Страницы: ')
  const range = h('input', { placeholder: 'например, 1-3, 5', spellcheck: 'false' }) as HTMLInputElement
  rangeLabel.append(range)
  const all = h('button', { class: 'link-btn' }, 'все')
  const none = h('button', { class: 'link-btn' }, 'ни одной')
  const grow = h('div', { class: 'grow' })
  const cancel = h('button', { class: 'secondary' }, 'Отмена')
  const insert = h('button', { class: 'primary-sm' }, 'Вставить')
  footer.append(rangeLabel, all, none, grow, cancel, insert)
  card.append(header, body, footer)
  document.body.append(overlay)

  // ---- thumbnails, rendered as they scroll into view, one at a time ----
  const cells: HTMLElement[] = []
  let queue = Promise.resolve()
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue
        const cell = e.target as HTMLElement
        io.unobserve(cell)
        const k = +cell.dataset.page!
        queue = queue.then(async () => {
          const cv = await renderPage(doc, k, 220)
          cell.querySelector('.pdf-ph')!.replaceWith(cv)
        }).catch(() => {})
      }
    },
    { root: thumbs, rootMargin: '200px' },
  )
  for (let k = 1; k <= n; k++) {
    const cell = h('button', { class: 'pdf-thumb', 'data-page': String(k), title: `Страница ${k}: щелчок — выбрать или убрать` })
    cell.append(h('div', { class: 'pdf-ph' }), h('span', { class: 'pdf-num' }, String(k)))
    cell.addEventListener('click', () => {
      if (chosen.has(k) && current !== k) {
        // first click on a chosen page only shows it large; a second one unselects
        current = k
      } else {
        if (chosen.has(k)) chosen.delete(k)
        else chosen.add(k)
        current = k
      }
      sync()
    })
    thumbs.append(cell)
    cells.push(cell)
    io.observe(cell)
  }

  // ---- the large page with the crop frame ----
  let viewCanvas: HTMLCanvasElement | null = null
  let shown = 0
  async function showCurrent() {
    if (shown === current) return
    shown = current
    const k = current
    const cv = await renderPage(doc, k, 900)
    if (shown !== k) return
    viewCanvas?.remove()
    viewCanvas = cv
    viewWrap.prepend(cv)
    placeFrame()
  }
  function placeFrame() {
    frame.style.left = `${crop.l * 100}%`
    frame.style.top = `${crop.t * 100}%`
    frame.style.width = `${(crop.r - crop.l) * 100}%`
    frame.style.height = `${(crop.b - crop.t) * 100}%`
    frame.classList.toggle('whole', crop.l === 0 && crop.t === 0 && crop.r === 1 && crop.b === 1)
  }
  let drag: { mode: 'new' | 'move'; x: number; y: number; start: Crop } | null = null
  const frac = (e: PointerEvent) => {
    const r = viewWrap.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  viewWrap.addEventListener('pointerdown', (e) => {
    const p = frac(e)
    const inside = !frame.classList.contains('whole') && p.x > crop.l && p.x < crop.r && p.y > crop.t && p.y < crop.b
    drag = { mode: inside ? 'move' : 'new', x: p.x, y: p.y, start: { ...crop } }
    viewWrap.setPointerCapture(e.pointerId)
  })
  viewWrap.addEventListener('pointermove', (e) => {
    if (!drag) return
    const p = frac(e)
    if (drag.mode === 'new') {
      crop = { l: Math.min(drag.x, p.x), t: Math.min(drag.y, p.y), r: Math.max(drag.x, p.x), b: Math.max(drag.y, p.y) }
    } else {
      const s = drag.start
      const dx = Math.min(1 - s.r, Math.max(-s.l, p.x - drag.x))
      const dy = Math.min(1 - s.b, Math.max(-s.t, p.y - drag.y))
      crop = { l: s.l + dx, t: s.t + dy, r: s.r + dx, b: s.b + dy }
    }
    placeFrame()
  })
  const endDrag = () => {
    if (drag && (crop.r - crop.l < 0.03 || crop.b - crop.t < 0.03)) crop = { l: 0, t: 0, r: 1, b: 1 } // a click, not a frame
    drag = null
    placeFrame()
  }
  viewWrap.addEventListener('pointerup', endDrag)
  viewWrap.addEventListener('pointercancel', endDrag)
  resetCrop.addEventListener('click', () => {
    crop = { l: 0, t: 0, r: 1, b: 1 }
    placeFrame()
  })

  // ---- selection ----
  function sync(fromInput = false) {
    const list = [...chosen].sort((a, b) => a - b)
    if (!fromInput) range.value = formatRange(list)
    cells.forEach((c, i) => {
      c.classList.toggle('on', chosen.has(i + 1))
      c.classList.toggle('current', current === i + 1)
    })
    insert.textContent = list.length ? `Вставить ${list.length} стр.` : 'Вставить'
    ;(insert as HTMLButtonElement).disabled = !list.length
    showCurrent()
  }
  range.addEventListener('input', () => {
    chosen.clear()
    for (const k of parseRange(range.value, n)) chosen.add(k)
    if (chosen.size && !chosen.has(current)) current = Math.min(...chosen)
    sync(true)
  })
  all.addEventListener('click', () => {
    for (let k = 1; k <= n; k++) chosen.add(k)
    sync()
  })
  none.addEventListener('click', () => {
    chosen.clear()
    sync()
  })
  sync()

  // ---- finish ----
  const result = await new Promise<Blob[] | null>((resolve) => {
    const close = (v: Blob[] | null) => {
      io.disconnect()
      overlay.remove()
      document.removeEventListener('keydown', onKey, true)
      resolve(v)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close(null)
      }
    }
    document.addEventListener('keydown', onKey, true)
    cancel.addEventListener('click', () => close(null))
    overlay.addEventListener('pointerdown', (e) => e.target === overlay && close(null))
    insert.addEventListener('click', async () => {
      const list = [...chosen].sort((a, b) => a - b)
      if (!list.length) return
      ;(insert as HTMLButtonElement).disabled = true
      const out: Blob[] = []
      try {
        for (const k of list) {
          insert.textContent = `Готовим ${out.length + 1} из ${list.length}…`
          await queue
          const page = await doc.getPage(k)
          const base = page.getViewport({ scale: 1 })
          page.cleanup()
          const keepW = crop.r - crop.l
          const keepH = crop.b - crop.t
          const width = Math.min(base.width * 4, TARGET / keepW) // whole-page width that gives TARGET px across the kept part
          const cv = await renderPage(doc, k, width)
          const sx = Math.round(crop.l * cv.width)
          const sy = Math.round(crop.t * cv.height)
          const sw = Math.max(1, Math.round(keepW * cv.width))
          const sh = Math.max(1, Math.round(keepH * cv.height))
          const piece = document.createElement('canvas')
          piece.width = sw
          piece.height = sh
          piece.getContext('2d')!.drawImage(cv, sx, sy, sw, sh, 0, 0, sw, sh)
          cv.width = cv.height = 0
          const blob = await new Promise<Blob | null>((r) => piece.toBlob(r, 'image/jpeg', 0.88))
          if (blob) out.push(blob)
        }
        close(out)
      } catch (err) {
        console.warn(err)
        close(out.length ? out : null)
      }
    })
  })
  await task.destroy()
  return result
}

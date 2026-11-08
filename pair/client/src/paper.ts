// The sheet: ruling (grid, lined, propis, calligraphy, dots) with its line colour and
// weight, and pages — the endless board is cut into pages of a paper size, row by row
// from the top-left corner; page borders can be shown, PDF export saves them.
// Drawn on a separate canvas under the board, over its visible part, so the eraser
// (which cuts holes in the board canvas) never erases it.
// Rulings adapted from client-editor/src/slides/paper.ts.

export type Paper = 'none' | 'grid-s' | 'grid-m' | 'grid-l' | 'lines-s' | 'lines-m' | 'lines-l' | 'propis' | 'calligraphy' | 'dots'
export type PageSize = 'A5' | 'A4' | 'A3'

export interface Sheet {
  paper: Paper
  color: string
  weight: number // line width in screen pixels
  page: PageSize
  landscape: boolean
  borders: boolean
  borderColor: string
}

export const DEFAULT_SHEET: Sheet = { paper: 'grid-m', color: '#aebfd2', weight: 1, page: 'A4', landscape: false, borders: false, borderColor: '#dc2626' }

export const PAPERS: { value: Paper; label: string }[] = [
  { value: 'grid-m', label: 'Клетка' },
  { value: 'grid-s', label: 'Мелкая клетка' },
  { value: 'grid-l', label: 'Крупная клетка' },
  { value: 'lines-m', label: 'Линейка' },
  { value: 'lines-s', label: 'Узкая линейка' },
  { value: 'lines-l', label: 'Широкая линейка' },
  { value: 'propis', label: 'Пропись (косая линейка)' },
  { value: 'calligraphy', label: 'Каллиграфия' },
  { value: 'dots', label: 'Точки' },
  { value: 'none', label: 'Чистый лист' },
]

export const LINE_COLORS = [
  { value: '#aebfd2', label: 'Серо-голубой' },
  { value: '#93c5fd', label: 'Голубой' },
  { value: '#86efac', label: 'Зелёный' },
  { value: '#fca5a5', label: 'Красный' },
  { value: '#9ca3af', label: 'Серый' },
]

export const BORDER_COLORS = [
  { value: '#dc2626', label: 'Красный' },
  { value: '#ea580c', label: 'Оранжевый' },
  { value: '#111827', label: 'Чёрный' },
  { value: '#92400e', label: 'Коричневый' },
]

export const LINE_WEIGHTS = [
  { value: 1, label: 'Тонкие' },
  { value: 1.5, label: 'Средние' },
  { value: 2.5, label: 'Толстые' },
]

export const PAGE_SIZES: { value: PageSize; label: string; mm: [number, number] }[] = [
  { value: 'A5', label: 'A5', mm: [148, 210] },
  { value: 'A4', label: 'A4', mm: [210, 297] },
  { value: 'A3', label: 'A3', mm: [297, 420] },
]

/** Board units per millimetre: the board is drawn at 96 dpi at 100% */
export const PX_PER_MM = 96 / 25.4

/** Page size in board units and in millimetres */
export function pageBox(s: Sheet) {
  let [w, h] = PAGE_SIZES.find((p) => p.value === s.page)!.mm
  if (s.landscape) [w, h] = [h, w]
  return { w: w * PX_PER_MM, h: h * PX_PER_MM, mmW: w, mmH: h }
}

export function validSheet(s: Partial<Sheet> | undefined): Sheet {
  const d = DEFAULT_SHEET
  if (!s || typeof s !== 'object') return { ...d }
  return {
    paper: PAPERS.some((p) => p.value === s.paper) ? s.paper! : d.paper,
    color: typeof s.color === 'string' && /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : d.color,
    weight: typeof s.weight === 'number' && s.weight >= 0.5 && s.weight <= 4 ? s.weight : d.weight,
    page: PAGE_SIZES.some((p) => p.value === s.page) ? s.page! : d.page,
    landscape: !!s.landscape,
    borders: !!s.borders,
    borderColor: BORDER_COLORS.some((c) => c.value === s.borderColor) ? s.borderColor! : d.borderColor,
  }
}

interface Ruling {
  grid?: number
  major?: number // every n-th grid line darker
  dots?: number
  period?: number
  rows?: [number, number][] // [y offset in a period, opacity]
  slant?: { angle: number; step: number; alpha: number }
}

const RULINGS: Record<Exclude<Paper, 'none'>, Ruling> = {
  'grid-s': { grid: 16, major: 5 },
  'grid-m': { grid: 24, major: 5 },
  'grid-l': { grid: 48 },
  'lines-s': { period: 30, rows: [[0, 1]] },
  'lines-m': { period: 44, rows: [[0, 1]] },
  'lines-l': { period: 64, rows: [[0, 1]] },
  propis: { period: 60, rows: [[0, 1], [20, 0.5], [40, 1]], slant: { angle: 65, step: 28, alpha: 0.85 } },
  calligraphy: { period: 80, rows: [[0, 0.6], [20, 1], [50, 1], [70, 0.6]], slant: { angle: 55, step: 56, alpha: 0.75 } },
  dots: { dots: 24 },
}

/** Draws the sheet for viewport transform v onto a canvas element the size of the board. */
export function drawPaper(cv: HTMLCanvasElement, sheet: Sheet, v: number[]) {
  const dpr = window.devicePixelRatio || 1
  const W = cv.clientWidth
  const H = cv.clientHeight
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
    cv.width = Math.round(W * dpr)
    cv.height = Math.round(H * dpr)
  }
  const ctx = cv.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cv.width, cv.height)
  ctx.scale(dpr, dpr)
  renderPaper(ctx, W, H, sheet, v)
  if (sheet.borders) renderBorders(ctx, W, H, sheet, v)
}

type Box = { x0: number; y0: number; x1: number; y1: number }

/**
 * Draws the ruling into a W×H (CSS pixels) area of ctx for viewport transform v.
 * Aligned: each page holds a whole number of cells or rows, centred, the leftover strip
 * stays blank at the edges as a margin (like a notebook); otherwise the ruling is endless.
 */
export function renderPaper(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  sheet: Sheet,
  v: number[],
  lineScale = 1,
  aligned = sheet.borders,
) {
  if (sheet.paper === 'none') return
  const r = RULINGS[sheet.paper]
  const z = v[0]
  const view: Box = { x0: -v[4] / z, y0: -v[5] / z, x1: -v[4] / z + W / z, y1: -v[5] / z + H / z }
  const lw = sheet.weight * lineScale
  if (!aligned) {
    drawRuling(ctx, r, sheet, z, view, view, lw, { x: 0, y: 0 })
    ctx.globalAlpha = 1
    return
  }
  const { w, h } = pageBox(sheet)
  const a = innerArea(r, w, h)
  for (let i = Math.floor(view.x0 / w); i * w <= view.x1; i++) {
    for (let j = Math.floor(view.y0 / h); j * h <= view.y1; j++) {
      const area: Box = { x0: i * w + a.ox, y0: j * h + a.oy, x1: i * w + a.ox + a.cw, y1: j * h + a.oy + a.ch }
      const vis: Box = { x0: Math.max(view.x0, area.x0), y0: Math.max(view.y0, area.y0), x1: Math.min(view.x1, area.x1), y1: Math.min(view.y1, area.y1) }
      if (vis.x0 > vis.x1 + 1 || vis.y0 > vis.y1 + 1) continue
      ctx.save()
      ctx.beginPath()
      ctx.rect((area.x0 - view.x0) * z - lw, (area.y0 - view.y0) * z - lw, (area.x1 - area.x0) * z + 2 * lw, (area.y1 - area.y0) * z + 2 * lw)
      ctx.clip()
      drawRuling(ctx, r, sheet, z, view, vis, lw, { x: area.x0, y: area.y0 })
      ctx.restore()
    }
  }
  ctx.globalAlpha = 1
}

/** The part of a w×h page the ruling fills: whole cells, or whole rows, centred */
function innerArea(r: Ruling, w: number, h: number) {
  const g = r.grid ?? r.dots
  if (g) {
    const cw = Math.floor(w / g) * g
    const ch = Math.floor(h / g) * g
    return { ox: (w - cw) / 2, oy: (h - ch) / 2, cw, ch }
  }
  const p = r.period!
  const last = Math.max(...r.rows!.map(([dy]) => dy))
  const n = Math.max(1, Math.floor((h - last - p * 0.5) / p) + 1) // keep half a row of margin at least
  const span = (n - 1) * p + last
  return { ox: 0, oy: (h - span) / 2, cw: w, ch: span }
}

/**
 * The ruling's lines anchored at `origin`, drawn over `vis` (board coordinates);
 * `view` maps the board to the screen.
 */
function drawRuling(ctx: CanvasRenderingContext2D, r: Ruling, sheet: Sheet, z: number, view: Box, vis: Box, lw: number, origin: { x: number; y: number }) {
  const odd = Math.round(lw) % 2 === 1 ? 0.5 : 0 // odd widths sit on pixel centres
  const sx = (x: number) => Math.round((x - view.x0) * z) + odd // board → screen, pixel-aligned
  const sy = (y: number) => Math.round((y - view.y0) * z) + odd
  const top = (vis.y0 - view.y0) * z - lw
  const bottom = (vis.y1 - view.y0) * z + lw
  const left = (vis.x0 - view.x0) * z - lw
  const right = (vis.x1 - view.x0) * z + lw
  ctx.lineWidth = lw
  const stroke = (alpha: number, draw: () => void) => {
    ctx.globalAlpha = alpha
    ctx.strokeStyle = sheet.color
    ctx.beginPath()
    draw()
    ctx.stroke()
  }
  // first multiple of step from the origin at or before `start`
  const from = (start: number, o: number, step: number) => o + Math.floor((start - o) / step) * step
  const nth = (val: number, o: number, step: number, m: number) => ((Math.round((val - o) / step) % m) + m) % m === 0

  if (r.grid) {
    const g = r.grid
    const fine = g * z >= 6 // too dense when zoomed out: keep only major lines
    const each = (major: boolean) => {
      for (let x = from(vis.x0, origin.x, g); x <= vis.x1 + 0.01; x += g) {
        if ((!!r.major && nth(x, origin.x, g, r.major)) === major) { ctx.moveTo(sx(x), top); ctx.lineTo(sx(x), bottom) }
      }
      for (let y = from(vis.y0, origin.y, g); y <= vis.y1 + 0.01; y += g) {
        if ((!!r.major && nth(y, origin.y, g, r.major)) === major) { ctx.moveTo(left, sy(y)); ctx.lineTo(right, sy(y)) }
      }
    }
    if (fine) stroke(r.major ? 0.6 : 1, () => each(false))
    if (r.major) stroke(1, () => each(true))
  }
  if (r.dots) {
    const g = r.dots
    if (g * z >= 6) {
      ctx.globalAlpha = 1
      ctx.fillStyle = sheet.color
      const s = Math.max(1.5, 2 * Math.min(z, 1.5)) * Math.max(1, lw)
      for (let x = from(vis.x0, origin.x, g); x <= vis.x1 + 0.01; x += g)
        for (let y = from(vis.y0, origin.y, g); y <= vis.y1 + 0.01; y += g) ctx.fillRect(sx(x) - s / 2, sy(y) - s / 2, s, s)
    }
  }
  if (r.period && r.rows) {
    const p = r.period
    for (const [dy, alpha] of r.rows) {
      stroke(alpha, () => {
        for (let y = from(vis.y0, origin.y + dy, p); y <= vis.y1 + 0.01; y += p) { ctx.moveTo(left, sy(y)); ctx.lineTo(right, sy(y)) }
      })
    }
  }
  if (r.slant) {
    const { angle, step, alpha } = r.slant
    const k = 1 / Math.tan((angle * Math.PI) / 180) // x shift per unit of height
    // a slanted line through (x, origin.y) runs to x - k*(y - origin.y); it crosses vis for x in [x0 + k*(y0-oy), x1 + k*(y1-oy)]
    stroke(alpha, () => {
      for (let x = from(vis.x0 + k * (vis.y0 - origin.y), origin.x, step); x <= vis.x1 + k * (vis.y1 - origin.y); x += step) {
        ctx.moveTo((x - k * (vis.y0 - origin.y) - view.x0) * z, (vis.y0 - view.y0) * z)
        ctx.lineTo((x - k * (vis.y1 - origin.y) - view.x0) * z, (vis.y1 - view.y0) * z)
      }
    })
  }
}

/** Solid page borders in their own colour */
function renderBorders(ctx: CanvasRenderingContext2D, W: number, H: number, sheet: Sheet, v: number[]) {
  const { w, h } = pageBox(sheet)
  const z = v[0]
  const x0 = -v[4] / z
  const y0 = -v[5] / z
  const x1 = x0 + W / z
  const y1 = y0 + H / z
  ctx.save()
  ctx.strokeStyle = sheet.borderColor
  ctx.lineWidth = 1.5
  ctx.beginPath()
  for (let x = Math.floor(x0 / w) * w; x <= x1; x += w) {
    const X = Math.round((x - x0) * z)
    ctx.moveTo(X, 0)
    ctx.lineTo(X, H)
  }
  for (let y = Math.floor(y0 / h) * h; y <= y1; y += h) {
    const Y = Math.round((y - y0) * z)
    ctx.moveTo(0, Y)
    ctx.lineTo(W, Y)
  }
  ctx.stroke()
  ctx.restore()
}

/** Which pages (column, row) a scene rectangle touches */
export function pagesOf(sheet: Sheet, r: { left: number; top: number; width: number; height: number }) {
  const { w, h } = pageBox(sheet)
  const out: [number, number][] = []
  const eps = 0.5 // a stroke ending exactly on a border doesn't spill onto the next page
  for (let i = Math.floor((r.left + eps) / w); i <= Math.floor((r.left + r.width - eps) / w); i++)
    for (let j = Math.floor((r.top + eps) / h); j <= Math.floor((r.top + r.height - eps) / h); j++) out.push([i, j])
  return out
}

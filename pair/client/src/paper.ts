// Sheet rulings: grid, lined, handwriting (propis) and calligraphy. Drawn on a
// separate canvas under the board, over the visible part of the endless sheet, so
// the eraser (which cuts holes in the board canvas) never erases the ruling.
// Rulings adapted from client-editor/src/slides/paper.ts.

export type Paper = 'none' | 'grid-s' | 'grid-m' | 'grid-l' | 'lines-s' | 'lines-m' | 'lines-l' | 'propis' | 'calligraphy' | 'dots'

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

const LINE = '#cbd8e6'
const LINE_MAJOR = '#aebfd2'

/** Draws the ruling for viewport transform v onto a canvas element the size of the board. */
export function drawPaper(cv: HTMLCanvasElement, paper: Paper, v: number[]) {
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
  renderPaper(ctx, W, H, paper, v)
}

/** Draws the ruling into a W×H (CSS pixels) area of ctx for viewport transform v. */
export function renderPaper(ctx: CanvasRenderingContext2D, W: number, H: number, paper: Paper, v: number[]) {
  if (paper === 'none') return
  const r = RULINGS[paper]
  const z = v[0]
  // visible scene rectangle
  const x0 = -v[4] / z
  const y0 = -v[5] / z
  const x1 = x0 + W / z
  const y1 = y0 + H / z
  const sx = (x: number) => Math.round((x - x0) * z) + 0.5 // scene → screen, pixel-aligned
  const sy = (y: number) => Math.round((y - y0) * z) + 0.5
  ctx.lineWidth = 1
  const stroke = (color: string, alpha: number, draw: () => void) => {
    ctx.globalAlpha = alpha
    ctx.strokeStyle = color
    ctx.beginPath()
    draw()
    ctx.stroke()
  }
  const from = (start: number, step: number) => Math.floor(start / step) * step

  if (r.grid) {
    const g = r.grid
    const fine = g * z >= 6 // too dense when zoomed out: keep only major lines
    const each = (major: boolean) => {
      for (let x = from(x0, g); x <= x1; x += g) {
        const isMajor = !!r.major && Math.round(x / g) % r.major === 0
        if (isMajor === major) { ctx.moveTo(sx(x), 0); ctx.lineTo(sx(x), H) }
      }
      for (let y = from(y0, g); y <= y1; y += g) {
        const isMajor = !!r.major && Math.round(y / g) % r.major === 0
        if (isMajor === major) { ctx.moveTo(0, sy(y)); ctx.lineTo(W, sy(y)) }
      }
    }
    if (fine) stroke(LINE, 1, () => each(false))
    if (r.major) stroke(LINE_MAJOR, 1, () => each(true))
  }
  if (r.dots) {
    const g = r.dots
    if (g * z >= 6) {
      ctx.fillStyle = LINE_MAJOR
      const s = Math.max(1.5, 2 * Math.min(z, 1.5))
      for (let x = from(x0, g); x <= x1; x += g) for (let y = from(y0, g); y <= y1; y += g) ctx.fillRect(sx(x) - s / 2, sy(y) - s / 2, s, s)
    }
  }
  if (r.period && r.rows) {
    const p = r.period
    for (const [dy, alpha] of r.rows) {
      stroke(LINE_MAJOR, alpha, () => {
        for (let y = from(y0 - dy, p) + dy; y <= y1; y += p) { ctx.moveTo(0, sy(y)); ctx.lineTo(W, sy(y)) }
      })
    }
  }
  if (r.slant) {
    const { angle, step, alpha } = r.slant
    const k = 1 / Math.tan((angle * Math.PI) / 180) // x shift per unit of height
    // a slanted line through (x, 0) of the scene crosses the visible rect for x in [x0 - k*y1, x1 - k*y0]
    stroke(LINE_MAJOR, alpha, () => {
      for (let x = from(x0 + k * y0 - k * (y1 - y0) * 2, step); x <= x1 + k * y1; x += step) {
        ctx.moveTo((x - k * y0 - x0) * z, 0)
        ctx.lineTo((x - k * y1 - x0) * z, H)
      }
    })
  }
  ctx.globalAlpha = 1
}

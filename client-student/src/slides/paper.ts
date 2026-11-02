// GENERATED COPY of client-editor/src/slides/paper.ts — do not edit here, edit the original and run scripts/sync-slides.sh
// Ruled slide backgrounds (grid, lines, handwriting rulings). Drawn as vector lines
// right after the background color, at the canvas' current zoom — crisp at any size
// (a repeating bitmap pattern gave moiré when the slide is shown scaled down).
// Shared verbatim by client-editor, client-teacher and client-student.
// Canonical copy: client-editor/src/slides; run scripts/sync-slides.sh after changing it.
import type { StaticCanvas } from 'fabric'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from './model'

export type Paper =
  | 'none' | 'grid-s' | 'grid-m' | 'grid-l' | 'lines-s' | 'lines-m' | 'lines-l' | 'propis' | 'calligraphy'

export const PAPERS: { value: Paper; label: string }[] = [
  { value: 'none', label: 'Без разметки' },
  { value: 'grid-s', label: 'Мелкая клетка' },
  { value: 'grid-m', label: 'Средняя клетка' },
  { value: 'grid-l', label: 'Крупная клетка' },
  { value: 'lines-s', label: 'Мелкая линейка' },
  { value: 'lines-m', label: 'Средняя линейка' },
  { value: 'lines-l', label: 'Крупная линейка' },
  { value: 'propis', label: 'Пропись (косая линейка)' },
  { value: 'calligraphy', label: 'Каллиграфия' },
]

export const DEFAULT_PAPER_COLOR = '#93c5fd'

/** Horizontal lines of one period: [y offset, opacity] */
interface Ruling { grid?: number; period?: number; rows?: [number, number][]; slant?: { angle: number; step: number; alpha: number } }

const RULINGS: Record<Exclude<Paper, 'none'>, Ruling> = {
  'grid-s': { grid: 20 },
  'grid-m': { grid: 40 },
  'grid-l': { grid: 80 },
  'lines-s': { period: 30, rows: [[0, 1]] },
  'lines-m': { period: 50, rows: [[0, 1]] },
  'lines-l': { period: 80, rows: [[0, 1]] },
  // row: top, helper middle and base line, then a gap; slants ~65°
  propis: { period: 60, rows: [[0, 1], [20, 0.5], [40, 1]], slant: { angle: 65, step: 28, alpha: 0.45 } },
  // ascender, x-height, base and descender lines; slants ~55°
  calligraphy: { period: 80, rows: [[0, 0.6], [20, 1], [50, 1], [70, 0.6]], slant: { angle: 55, step: 56, alpha: 0.35 } },
}

/** Draw the ruling in slide coordinates; lines are 1 screen pixel wide and pixel-aligned */
function drawRuling(ctx: CanvasRenderingContext2D, r: Ruling, color: string, zoom: number) {
  const px = 1 / zoom
  const snap = (v: number) => (Math.round(v * zoom) + 0.5) / zoom // middle of a screen pixel
  ctx.lineWidth = px
  ctx.strokeStyle = color
  const lines = (alpha: number, draw: () => void) => {
    ctx.globalAlpha = alpha
    ctx.beginPath()
    draw()
    ctx.stroke()
  }
  if (r.grid) {
    lines(1, () => {
      for (let x = 0; x <= SLIDE_WIDTH; x += r.grid!) { ctx.moveTo(snap(x), 0); ctx.lineTo(snap(x), SLIDE_HEIGHT) }
      for (let y = 0; y <= SLIDE_HEIGHT; y += r.grid!) { ctx.moveTo(0, snap(y)); ctx.lineTo(SLIDE_WIDTH, snap(y)) }
    })
  }
  if (r.period && r.rows) {
    const top = r.period / 2 // first row a bit below the edge
    for (const [dy, alpha] of r.rows) {
      lines(alpha, () => {
        for (let y = top + dy; y <= SLIDE_HEIGHT; y += r.period!) { ctx.moveTo(0, snap(y)); ctx.lineTo(SLIDE_WIDTH, snap(y)) }
      })
    }
  }
  if (r.slant) {
    const dx = SLIDE_HEIGHT / Math.tan((r.slant.angle * Math.PI) / 180)
    lines(r.slant.alpha, () => {
      for (let x = -dx; x <= SLIDE_WIDTH; x += r.slant!.step) { ctx.moveTo(x, SLIDE_HEIGHT); ctx.lineTo(x + dx, 0) }
    })
  }
}

interface PaperState { paper?: string; color?: string }
type Patched = StaticCanvas & { __paper?: PaperState; _renderBackground: (ctx: CanvasRenderingContext2D) => void }

/** Background color + ruling of a canvas (the ruling is drawn on every render, under all objects) */
export function applyPaper(fc: StaticCanvas, background: string, paper?: string, color?: string) {
  const c = fc as Patched
  fc.backgroundColor = background || '#ffffff'
  if (!c.__paper) {
    const orig = c._renderBackground.bind(c)
    c._renderBackground = (ctx: CanvasRenderingContext2D) => {
      orig(ctx)
      const st = c.__paper
      const r = st?.paper ? RULINGS[st.paper as Exclude<Paper, 'none'>] : undefined
      if (!r) return
      const v = c.viewportTransform
      ctx.save()
      ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5])
      ctx.beginPath()
      ctx.rect(0, 0, SLIDE_WIDTH, SLIDE_HEIGHT)
      ctx.clip()
      drawRuling(ctx, r, st!.color || DEFAULT_PAPER_COLOR, c.getZoom())
      ctx.restore()
    }
  }
  c.__paper = { paper, color }
}

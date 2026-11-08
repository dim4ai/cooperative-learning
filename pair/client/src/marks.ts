// Lines and marks drawn by dragging: straight/dashed/double/wavy lines, vector,
// segment, bracket, coordinate axes and word-analysis marks (prefix, root, suffix,
// ending, stem). Adapted from client-editor/src/slides/marks.ts.
// On the board a mark is a plain Path/Group, so the other side needs nothing special.
import { FabricText, Group, Path, type FabricObject } from 'fabric'

export type MarkKind =
  | 'line' | 'arrow' | 'segment' | 'dashed' | 'double' | 'wavy' | 'dashdot' | 'bracket' | 'axes'
  | 'prefix' | 'root' | 'suffix' | 'ending' | 'stem'

/**
 * How a mark follows the mouse:
 *  line — from press to release, any angle (Shift: steps of 15°)
 *  span — horizontal, over the dragged width (marks above/under a word)
 *  box  — the dragged rectangle
 */
export type DragKind = 'line' | 'span' | 'box'

export const MARKS: Record<MarkKind, { title: string; drag: DragKind; place?: 'above' | 'below' }> = {
  line: { title: 'Прямая линия (Shift — шаг 15°)', drag: 'line' },
  arrow: { title: 'Вектор (Shift — шаг 15°)', drag: 'line' },
  segment: { title: 'Отрезок с точками на концах', drag: 'line' },
  dashed: { title: 'Пунктир', drag: 'line' },
  double: { title: 'Двойная линия (сказуемое)', drag: 'line' },
  wavy: { title: 'Волнистая линия (определение)', drag: 'line' },
  dashdot: { title: 'Точка-тире (обстоятельство)', drag: 'line' },
  bracket: { title: 'Квадратная скобка — растяните по высоте', drag: 'box' },
  axes: { title: 'Оси координат — растяните рамку', drag: 'box' },
  prefix: { title: 'Приставка — проведите над приставкой', drag: 'span', place: 'above' },
  root: { title: 'Корень — проведите над корнем', drag: 'span', place: 'above' },
  suffix: { title: 'Суффикс — проведите над суффиксом', drag: 'span', place: 'above' },
  ending: { title: 'Окончание — обведите рамкой', drag: 'box' },
  stem: { title: 'Основа — проведите под основой', drag: 'span', place: 'below' },
}

export const LINE_MARKS: MarkKind[] = ['line', 'arrow', 'segment', 'dashed', 'double', 'wavy', 'dashdot', 'bracket', 'axes']
export const WORD_MARKS: MarkKind[] = ['prefix', 'root', 'suffix', 'ending', 'stem']

export interface MarkStyle { stroke: string; strokeWidth: number }

/** Height of an above/below mark for a given width */
export function markHeight(kind: MarkKind, w: number): number {
  if (kind === 'stem') return Math.max(10, Math.min(18, w * 0.15))
  if (kind === 'prefix') return Math.max(10, Math.min(22, w * 0.2))
  return Math.max(12, Math.min(34, w * 0.3)) // root, suffix
}

function pathData(kind: MarkKind, w: number, h: number, sw: number): string {
  switch (kind) {
    case 'double': {
      const g = Math.max(5, sw * 2)
      return `M 0 0 L ${w} 0 M 0 ${g} L ${w} ${g}`
    }
    case 'wavy': {
      const p = Math.max(8, sw * 3) // half-period
      const a = Math.max(4, sw * 1.4)
      const n = Math.max(2, Math.round(w / p))
      const step = w / n
      let d = 'M 0 0'
      for (let i = 0; i < n; i++) d += ` Q ${(i + 0.5) * step} ${i % 2 ? a * 2 : -a * 2} ${(i + 1) * step} 0`
      return d
    }
    case 'arrow': {
      const ah = Math.max(14, sw * 4)
      return `M 0 0 L ${w} 0 M ${w - ah} ${-ah * 0.55} L ${w} 0 L ${w - ah} ${ah * 0.55}`
    }
    case 'segment': {
      const r = Math.max(5, sw * 1.5)
      const dot = (x: number) => `M ${x - r} 0 a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`
      return `M 0 0 L ${w} 0 ${dot(0)} ${dot(w)}`
    }
    case 'bracket': {
      const t = Math.min(w, Math.max(8, h * 0.18))
      return `M ${t} 0 L 0 0 L 0 ${h} L ${t} ${h}`
    }
    case 'prefix': return `M 0 0 L ${w} 0 L ${w} ${h}`
    case 'root': return `M 0 ${h} C ${w * 0.04} ${-h * 0.32} ${w * 0.96} ${-h * 0.32} ${w} ${h}`
    case 'suffix': return `M 0 ${h} L ${w / 2} 0 L ${w} ${h}`
    case 'ending': return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`
    case 'stem': return `M 0 0 L 0 ${h} L ${w} ${h} L ${w} 0`
    default: return `M 0 0 L ${w} 0` // line, dashed, dashdot
  }
}

function dashes(kind: MarkKind, sw: number): number[] | null {
  if (kind === 'dashed') return [sw * 3, sw * 2]
  if (kind === 'dashdot') return [sw * 4, sw * 2, 0.01, sw * 2] // dot = round cap of a ~0 dash
  return null
}

/** A mark of width/length w (and height h for box/above/below marks), centered at (0,0) */
export function buildMark(kind: MarkKind, w: number, h: number, style: MarkStyle): FabricObject {
  w = Math.max(8, w)
  if (kind === 'axes') return buildAxes(w, Math.max(40, h), style)
  const sw = style.strokeWidth
  return new Path(pathData(kind, w, h, sw), {
    stroke: style.stroke,
    strokeWidth: sw,
    fill: kind === 'segment' ? style.stroke : '',
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
    strokeUniform: true,
    strokeDashArray: dashes(kind, sw),
    originX: 'center',
    originY: 'center',
    left: 0,
    top: 0,
  })
}

const AXIS_STEP = 40

function buildAxes(w: number, h: number, style: MarkStyle): FabricObject {
  const sw = Math.max(1, Math.min(style.strokeWidth, 3))
  const ah = 12
  const cx = w / 2
  const cy = h / 2
  let d = `M 0 ${cy} L ${w} ${cy} M ${w - ah} ${cy - ah * 0.5} L ${w} ${cy} L ${w - ah} ${cy + ah * 0.5}`
  d += ` M ${cx} ${h} L ${cx} 0 M ${cx - ah * 0.5} ${ah} L ${cx} 0 L ${cx + ah * 0.5} ${ah}`
  const labels: FabricObject[] = []
  const text = (t: string, x: number, y: number, ox: 'left' | 'center' | 'right' = 'center') =>
    labels.push(new FabricText(t, { left: x, top: y, originX: ox, originY: 'center', fontSize: 15, fontFamily: 'sans-serif', fill: style.stroke }))
  for (let i = 1; cx + i * AXIS_STEP < w - ah * 1.5; i++) {
    for (const s of [1, -1]) {
      const x = cx + s * i * AXIS_STEP
      d += ` M ${x} ${cy - 5} L ${x} ${cy + 5}`
      text(String(s * i), x, cy + 16)
    }
  }
  for (let i = 1; cy + i * AXIS_STEP < h - ah * 0.5 && cy - i * AXIS_STEP > ah * 1.5; i++) {
    for (const s of [1, -1]) {
      const y = cy - s * i * AXIS_STEP
      d += ` M ${cx - 5} ${y} L ${cx + 5} ${y}`
      text(String(s * i), cx - 9, y, 'right')
    }
  }
  text('0', cx - 9, cy + 14, 'right')
  text('x', w - 4, cy - 16, 'right')
  text('y', cx + 12, 8, 'left')
  const axes = new Path(d, { stroke: style.stroke, strokeWidth: sw, fill: '', strokeLineCap: 'round', strokeUniform: true })
  return new Group([axes, ...labels], { originX: 'center', originY: 'center', left: 0, top: 0 })
}

/** Places a mark for a drag from a to b (scene coordinates). */
export function markFromDrag(kind: MarkKind, a: { x: number; y: number }, b: { x: number; y: number }, style: MarkStyle) {
  const { drag, place } = MARKS[kind]
  if (drag === 'line') {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    const o = buildMark(kind, len, 0, style)
    o.set({ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI })
    return o
  }
  if (drag === 'span') {
    const w = Math.abs(b.x - a.x)
    const h = markHeight(kind, w)
    const o = buildMark(kind, w, h, style)
    // above-marks stand on the drag line, below-marks hang from it
    o.set({ left: (a.x + b.x) / 2, top: place === 'below' ? a.y + h / 2 : a.y - h / 2 })
    return o
  }
  const w = Math.abs(b.x - a.x)
  const h = Math.abs(b.y - a.y)
  const o = buildMark(kind, w, h, style)
  o.set({ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 })
  return o
}

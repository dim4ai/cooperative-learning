// Drawn marks: line kinds, sentence-member underlines, word-analysis (morpheme) marks,
// coordinate axes — and the extra shapes. Editor-only: in the slide JSON a mark is a
// plain Fabric Path/Group (players need nothing special); `mark` keeps the recipe so the
// editor can rebuild it when it is resized (a wavy line stays wavy, not stretched).
import { FabricText, Group, Path, Polygon, Triangle, Ellipse, type FabricObject } from 'fabric'

export type MarkKind =
  | 'line' | 'arrow' | 'segment' | 'dashed' | 'axes'
  | 'subject' | 'predicate' | 'object' | 'attribute' | 'adverbial'
  | 'prefix' | 'root' | 'suffix' | 'ending' | 'stem'

/**
 * How a mark is drawn with the mouse:
 *  line — from the press to the release point, any angle (Shift: steps of 15°)
 *  span — horizontal, over the dragged width (marks above/under a word)
 *  box  — the dragged rectangle
 */
export type DragKind = 'line' | 'span' | 'box'

export interface MarkInfo { label: string; icon: string; title: string; drag: DragKind; place?: 'above' | 'below' }

export const MARKS: Record<MarkKind, MarkInfo> = {
  line: { label: 'Линия', icon: '╱', title: 'Прямая линия (Shift — шаг 15°)', drag: 'line' },
  arrow: { label: 'Вектор', icon: '↗', title: 'Линия со стрелкой (Shift — шаг 15°)', drag: 'line' },
  segment: { label: 'Отрезок', icon: '•–•', title: 'Отрезок с точками на концах', drag: 'line' },
  dashed: { label: 'Пунктир', icon: '┄', title: 'Пунктирная линия', drag: 'line' },
  axes: { label: 'Оси координат', icon: '┼', title: 'Оси координат с делениями — растяните рамку', drag: 'box' },

  subject: { label: 'Подлежащее', icon: '—', title: 'Подлежащее: одна черта', drag: 'span' },
  predicate: { label: 'Сказуемое', icon: '═', title: 'Сказуемое: две черты', drag: 'span' },
  object: { label: 'Дополнение', icon: '┄', title: 'Дополнение: пунктир', drag: 'span' },
  attribute: { label: 'Определение', icon: '〰', title: 'Определение: волнистая линия', drag: 'span' },
  adverbial: { label: 'Обстоятельство', icon: '–·–', title: 'Обстоятельство: точка-тире', drag: 'span' },

  prefix: { label: 'Приставка', icon: '¬', title: 'Приставка — проведите над приставкой', drag: 'span', place: 'above' },
  root: { label: 'Корень', icon: '⌒', title: 'Корень — проведите над корнем', drag: 'span', place: 'above' },
  suffix: { label: 'Суффикс', icon: '^', title: 'Суффикс — проведите над суффиксом', drag: 'span', place: 'above' },
  ending: { label: 'Окончание', icon: '▭', title: 'Окончание — обведите рамкой', drag: 'box' },
  stem: { label: 'Основа', icon: '⌴', title: 'Основа — проведите под основой', drag: 'span', place: 'below' },
}

export const LINE_MARKS: MarkKind[] = ['line', 'arrow', 'segment', 'dashed', 'axes']
export const SENTENCE_MARKS: MarkKind[] = ['subject', 'predicate', 'object', 'attribute', 'adverbial']
export const MORPHEME_MARKS: MarkKind[] = ['prefix', 'root', 'suffix', 'ending', 'stem']

export interface MarkStyle { stroke: string; strokeWidth: number }
export const DEFAULT_MARK_STYLE: MarkStyle = { stroke: '#1d4ed8', strokeWidth: 4 }

/** Height of an above/below mark for a given width */
export function markHeight(kind: MarkKind, w: number): number {
  if (kind === 'stem') return Math.max(10, Math.min(18, w * 0.15))
  if (kind === 'prefix') return Math.max(10, Math.min(22, w * 0.2))
  return Math.max(12, Math.min(34, w * 0.3)) // root, suffix
}

function pathData(kind: MarkKind, w: number, h: number, sw: number): string {
  switch (kind) {
    case 'predicate': {
      const g = Math.max(5, sw * 2)
      return `M 0 0 L ${w} 0 M 0 ${g} L ${w} ${g}`
    }
    case 'attribute': {
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
    case 'prefix': return `M 0 0 L ${w} 0 L ${w} ${h}`
    case 'root': return `M 0 ${h} C ${w * 0.04} ${-h * 0.32} ${w * 0.96} ${-h * 0.32} ${w} ${h}`
    case 'suffix': return `M 0 ${h} L ${w / 2} 0 L ${w} ${h}`
    case 'ending': return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`
    case 'stem': return `M 0 0 L 0 ${h} L ${w} ${h} L ${w} 0`
    default: return `M 0 0 L ${w} 0` // line, dashed, subject, object, adverbial
  }
}

function dashes(kind: MarkKind, sw: number): number[] | null {
  if (kind === 'dashed' || kind === 'object') return [sw * 3, sw * 2]
  if (kind === 'adverbial') return [sw * 4, sw * 2, 0.01, sw * 2] // dot = round cap of a ~0 dash
  return null
}

/** A mark of width/length w (and height h for box/above/below marks), centered at (0,0) */
export function buildMark(kind: MarkKind, w: number, h: number, style: MarkStyle): FabricObject {
  w = Math.max(8, w)
  if (kind === 'axes') return buildAxes(w, Math.max(40, h), style)
  const sw = style.strokeWidth
  const o = new Path(pathData(kind, w, h, sw), {
    stroke: style.stroke, strokeWidth: sw,
    fill: kind === 'segment' ? style.stroke : '',
    strokeLineCap: 'round', strokeLineJoin: 'round', strokeUniform: true,
    strokeDashArray: dashes(kind, sw),
    originX: 'center', originY: 'center', left: 0, top: 0,
  })
  ;(o as FabricObject & { mark?: unknown }).mark = { kind, w, h }
  return o
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
  const g = new Group([axes, ...labels], { originX: 'center', originY: 'center', left: 0, top: 0 })
  ;(g as FabricObject & { mark?: unknown }).mark = { kind: 'axes', w, h }
  return g
}

// ---------- extra shapes (inserted at the slide center, like rectangle/circle) ----------

export type ShapeKind = 'triangle' | 'rightTriangle' | 'rhombus' | 'trapezoid' | 'circleOutline'

export const SHAPES: Record<ShapeKind, { label: string; icon: string }> = {
  triangle: { label: 'Треугольник', icon: '△' },
  rightTriangle: { label: 'Прямоугольный треугольник', icon: '◺' },
  rhombus: { label: 'Ромб', icon: '◇' },
  trapezoid: { label: 'Трапеция', icon: '⏢' },
  circleOutline: { label: 'Окружность', icon: '○' },
}

export function buildShape(kind: ShapeKind, style: Record<string, unknown>): FabricObject {
  switch (kind) {
    case 'triangle': return new Triangle({ ...style, width: 280, height: 240 })
    case 'rightTriangle': return new Polygon([{ x: 0, y: 0 }, { x: 0, y: 240 }, { x: 300, y: 240 }], style)
    case 'rhombus': return new Polygon([{ x: 140, y: 0 }, { x: 280, y: 170 }, { x: 140, y: 340 }, { x: 0, y: 170 }], style)
    case 'trapezoid': return new Polygon([{ x: 80, y: 0 }, { x: 260, y: 0 }, { x: 340, y: 190 }, { x: 0, y: 190 }], style)
    case 'circleOutline': return new Ellipse({ ...style, rx: 140, ry: 140, fill: 'transparent' })
  }
}

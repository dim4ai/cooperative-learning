// Shapes drawn by dragging a box: rectangle, square, rhombus, ellipse, circle,
// triangles, trapezoid, regular hexagon. Polygons are plain Fabric Polygons.
import { Ellipse, Polygon, Rect, type FabricObject } from 'fabric'

export type ShapeKind = 'rect' | 'square' | 'rhombus' | 'ellipse' | 'circle' | 'triangle' | 'rightTriangle' | 'trapezoid' | 'hexagon'

export const SHAPES: Record<ShapeKind, string> = {
  rect: 'Прямоугольник (Shift — квадрат)',
  square: 'Квадрат',
  rhombus: 'Ромб',
  ellipse: 'Эллипс (Shift — круг)',
  circle: 'Круг',
  triangle: 'Равнобедренный треугольник',
  rightTriangle: 'Прямоугольный треугольник',
  trapezoid: 'Трапеция',
  hexagon: 'Правильный шестиугольник',
}

export const SHAPE_KINDS = Object.keys(SHAPES) as ShapeKind[]

/** Shapes that keep their proportions while dragging */
const EQUAL: ShapeKind[] = ['square', 'circle', 'hexagon']

/** Unit outlines, in a 1×1 box */
const OUTLINES: Partial<Record<ShapeKind, [number, number][]>> = {
  rhombus: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]],
  triangle: [[0.5, 0], [1, 1], [0, 1]],
  rightTriangle: [[0, 0], [1, 1], [0, 1]],
  trapezoid: [[0.25, 0], [0.75, 0], [1, 1], [0, 1]],
  hexagon: Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i
    return [0.5 + 0.5 * Math.cos(a), 0.5 + (0.5 * Math.sin(a)) / (Math.sqrt(3) / 2)] as [number, number]
  }),
}

/** Box from the press point to the pointer; Shift (or a "regular" shape) keeps it equal-sided */
export function dragBox(kind: ShapeKind, o: { x: number; y: number }, p: { x: number; y: number }, shift: boolean) {
  let w = p.x - o.x
  let h = p.y - o.y
  if (shift || EQUAL.includes(kind)) {
    const s = Math.max(Math.abs(w), Math.abs(h))
    w = Math.sign(w || 1) * s
    h = Math.sign(h || 1) * (kind === 'hexagon' ? (s * Math.sqrt(3)) / 2 : s)
  }
  return { left: Math.min(o.x, o.x + w), top: Math.min(o.y, o.y + h), width: Math.abs(w), height: Math.abs(h) }
}

export function buildShape(kind: ShapeKind, box: { left: number; top: number; width: number; height: number }, style: Record<string, unknown>): FabricObject {
  const { left, top, width, height } = box
  const at = { originX: 'left' as const, originY: 'top' as const, left, top }
  if (kind === 'rect' || kind === 'square') return new Rect({ ...style, ...at, width, height })
  if (kind === 'ellipse' || kind === 'circle') return new Ellipse({ ...style, ...at, rx: width / 2, ry: height / 2 })
  const pts = OUTLINES[kind]!.map(([x, y]) => ({ x: left + x * width, y: top + y * height }))
  return new Polygon(pts, { ...style, ...at })
}

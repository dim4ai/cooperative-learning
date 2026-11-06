// GENERATED COPY of client-editor/src/slides/Board.tsx — do not edit here, edit the original and run scripts/sync-slides.sh
// Live drawing board (Fabric.js): the shared board of a lesson and the student's warm-up board.
// Shared verbatim by client-editor, client-teacher and client-student. Canonical copy:
// client-editor/src/slides; run scripts/sync-slides.sh after changing it.
//
// A fixed 1600×900 page fitted into the available space, so everyone sees the same picture
// whatever their screen. The toolbar sits above the page, never over it. Changes travel as
// per-object operations (add / mod / del / clear) through a `link`; without one the board is local.
// With an `underlay` (a slide) the page is transparent and the drawing lies on top of it.
import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import {
  ActiveSelection, Canvas, Ellipse, IText, Line, Path, PencilBrush, Rect, Triangle, util,
  type FabricObject, type TPointerEventInfo,
} from 'fabric'
import { SLIDE_HEIGHT as H, SLIDE_WIDTH as W } from './model'
import type { Obj } from './render'
import './render' // registers our custom properties (uid, author…) for toObject()

export type BoardObject = Record<string, unknown> & { uid: string; type: string }
export type BoardOp =
  | { t: 'add'; obj: BoardObject }
  | { t: 'mod'; obj: BoardObject }
  | { t: 'del'; uid: string }
  | { t: 'clear' }

/** Transport of a shared board: sends local operations, delivers remote ones and full states */
export interface BoardLink {
  send(op: BoardOp): void
  /** Subscribe and request the current state; returns unsubscribe */
  subscribe(onOp: (op: BoardOp) => void, onState: (objects: BoardObject[]) => void): () => void
}

/** student — basic tools; teacher — also marker, arrow and clearing the whole board */
export type BoardRole = 'student' | 'teacher'

type Tool = 'slide' | 'select' | 'pen' | 'marker' | 'eraser' | 'line' | 'arrow' | 'rect' | 'triangle' | 'ellipse' | 'text'
type ShapeTool = 'line' | 'arrow' | 'rect' | 'triangle' | 'ellipse'
const SHAPES: readonly Tool[] = ['line', 'arrow', 'rect', 'triangle', 'ellipse']
// The eraser paints the page's own colour: it takes part of a stroke, and undo and sync work as for any stroke
const ERASER_COLOR = '#ffffff'
const ERASER_SCALE = 5

const lineIcon = (children: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ display: 'block', margin: 'auto' }}>{children}</svg>
)
const PencilIcon = lineIcon(<>
  <path d="M4 20l1-4.5L16.5 4a2.1 2.1 0 0 1 3 0l.5.5a2.1 2.1 0 0 1 0 3L8.5 19 4 20z" />
  <path d="M14.5 6l3.5 3.5" />
</>)
const EraserIcon = lineIcon(<>
  <path d="M8 20l-4.3-4.3a1.8 1.8 0 0 1 0-2.5L13.2 3.7a1.8 1.8 0 0 1 2.5 0l4.6 4.6a1.8 1.8 0 0 1 0 2.5L11 20H8z" />
  <path d="M8.5 8.5l7 7" />
  <path d="M8 20h12" />
</>)

const TriangleIcon = lineIcon(<path d="M12 4.5L21 19.5H3z" />)
const EllipseIcon = lineIcon(<circle cx="12" cy="12" r="8" />)
const TextIcon = lineIcon(<path d="M5 6.5V5h14v1.5M12 5v14M9 19h6" />)
const LineIcon = lineIcon(<path d="M5 19L19 5" />)
const RectIcon = lineIcon(<rect x="4.5" y="5.5" width="15" height="13" rx="0.5" />)
const SelectIcon = lineIcon(<path d="M20.5 20.5L3.5 3.5M3.5 13V3.5H13" />)
const ArrowIcon = lineIcon(<path d="M2.5 12h19M15 5.5l6.5 6.5-6.5 6.5" />)

const TOOLS: { key: Tool; icon: ReactNode; title: string; teacherOnly?: boolean; onSlide?: boolean }[] = [
  { key: 'slide', icon: '☝', title: 'Работа со слайдом: открыть скрытое, подвинуть объект', teacherOnly: true, onSlide: true },
  { key: 'select', icon: SelectIcon, title: 'Выбрать и двигать (Delete — удалить)' },
  { key: 'pen', icon: PencilIcon, title: 'Карандаш' },
  { key: 'marker', icon: '🖍', title: 'Маркер: полупрозрачный, для выделения', teacherOnly: true },
  { key: 'eraser', icon: EraserIcon, title: 'Ластик: проведите там, где нужно стереть. Толщину можно выбрать' },
  { key: 'line', icon: LineIcon, title: 'Линия' },
  { key: 'arrow', icon: ArrowIcon, title: 'Стрелка', teacherOnly: true },
  { key: 'rect', icon: RectIcon, title: 'Прямоугольник' },
  { key: 'triangle', icon: TriangleIcon, title: 'Треугольник' },
  { key: 'ellipse', icon: EllipseIcon, title: 'Овал' },
  { key: 'text', icon: TextIcon, title: 'Текст: кликните, где писать' },
]
const COLORS = ['#1e1e1e', '#e03131', '#1971c2', '#2f9e44', '#f08c00', '#fcc419', '#8b5a2b', '#9c36b5']
const WIDTHS = [3, 6, 12]

let uidCounter = 0
const newUid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}${(uidCounter++).toString(36)}`

function withAlpha(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

function makeShape(tool: ShapeTool, a: { x: number; y: number }, b: { x: number; y: number }, color: string, width: number): FabricObject {
  const stroke = { stroke: color, strokeWidth: width, fill: 'transparent', strokeUniform: true }
  if (tool === 'line') return new Line([a.x, a.y, b.x, b.y], { ...stroke, strokeLineCap: 'round' })
  if (tool === 'arrow') {
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    const head = Math.max(14, width * 4)
    const p = (da: number) => `${b.x - head * Math.cos(ang + da)} ${b.y - head * Math.sin(ang + da)}`
    return new Path(`M ${a.x} ${a.y} L ${b.x} ${b.y} M ${p(0.45)} L ${b.x} ${b.y} L ${p(-0.45)}`,
      { ...stroke, strokeLineCap: 'round', strokeLineJoin: 'round' })
  }
  // Fabric 7 places objects by their center by default — these are given by the corner
  const box = { left: Math.min(a.x, b.x), top: Math.min(a.y, b.y), originX: 'left' as const, originY: 'top' as const }
  const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y)
  if (tool === 'rect') return new Rect({ ...box, width: w, height: h, ...stroke })
  if (tool === 'triangle') return new Triangle({ ...box, width: w, height: h, ...stroke })
  return new Ellipse({ ...box, rx: w / 2, ry: h / 2, ...stroke })
}

interface Props {
  role?: BoardRole
  readOnly?: boolean
  /** Shared board transport; omitted — a local board nobody else sees */
  link?: BoardLink
  /** What lies under the drawing, at the page's width in pixels */
  underlay?: (width: number) => ReactNode
}

export function Board({ role = 'student', readOnly = false, link, underlay }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const fcRef = useRef<Canvas | null>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [color, setColor] = useState(COLORS[0])
  const [width, setWidth] = useState(WIDTHS[0])
  const [hist, setHist] = useState({ undo: 0, redo: 0 })
  const [pageWidth, setPageWidth] = useState(0)
  const hasUnderlay = !!underlay
  const live = useRef({ tool, color, width, readOnly, link, hasUnderlay })
  live.current = { tool, color, width, readOnly, link, hasUnderlay }

  // The last synced JSON of every object (for undo of moves/deletes) and local undo/redo stacks
  const known = useRef(new Map<string, BoardObject>())
  type Entry = { undo: BoardOp[]; redo: BoardOp[] }
  const undoStack = useRef<Entry[]>([])
  const redoStack = useRef<Entry[]>([])
  const syncHist = () => setHist({ undo: undoStack.current.length, redo: redoStack.current.length })

  const api = useRef({ undo() {}, redo() {}, clear() {}, deleteSelection() {}, restyle() {} })

  // Set up the canvas once
  useEffect(() => {
    const el = document.createElement('canvas')
    hostRef.current!.appendChild(el)
    const fc = new Canvas(el, { backgroundColor: '#ffffff', preserveObjectStacking: true, selection: false })
    fcRef.current = fc
    if (import.meta.env.DEV) (window as unknown as { __board: Canvas }).__board = fc // for e2e tests

    const byUid = (uid: string) => fc.getObjects().find(o => (o as Obj).uid === uid) as Obj | undefined
    const toJson = (o: FabricObject) => o.toObject() as BoardObject
    const sendOp = (op: BoardOp) => live.current.link?.send(op)

    const style = (o: FabricObject) => {
      const { tool, readOnly } = live.current
      const sel = tool === 'select' && !readOnly && o.stroke !== ERASER_COLOR // a rub-out isn't something to pick up
      o.set({ selectable: sel, evented: sel, hoverCursor: 'move' })
    }

    // ---- applying operations to the canvas (remote ones and undo/redo) ----
    let queue: Promise<void> = Promise.resolve()
    const enqueue = (f: () => Promise<void> | void) => { queue = queue.then(f).catch(() => {}) }

    async function applyNow(op: BoardOp) {
      if (op.t === 'clear') {
        fc.discardActiveObject()
        fc.remove(...fc.getObjects().filter(o => !o.excludeFromExport))
        known.current.clear()
      } else if (op.t === 'del') {
        const o = byUid(op.uid)
        if (o) { if (fc.getActiveObjects().includes(o)) fc.discardActiveObject(); fc.remove(o) }
        known.current.delete(op.uid)
      } else {
        const [o] = (await util.enlivenObjects([op.obj])) as FabricObject[]
        style(o)
        const old = byUid(op.obj.uid)
        if (old) {
          if ((old as IText).isEditing) return // someone else's edit loses to the one being typed here
          const i = fc.getObjects().indexOf(old)
          if (fc.getActiveObjects().includes(old)) fc.discardActiveObject()
          fc.remove(old)
          fc.insertAt(i, o)
        } else fc.add(o)
        known.current.set(op.obj.uid, op.obj)
      }
      fc.requestRenderAll()
    }

    function loadState(objects: BoardObject[]) {
      enqueue(async () => {
        const objs = (await util.enlivenObjects(objects)) as FabricObject[]
        fc.discardActiveObject()
        fc.remove(...fc.getObjects())
        objs.forEach(style)
        if (objs.length) fc.add(...objs)
        known.current = new Map(objects.map(o => [o.uid, o]))
        undoStack.current = []; redoStack.current = []; syncHist()
        fc.requestRenderAll()
      })
    }

    // A local change already on the canvas: remember, send, make undoable
    function commit(redo: BoardOp[], undo: BoardOp[]) {
      for (const op of redo) {
        if (op.t === 'add' || op.t === 'mod') known.current.set(op.obj.uid, op.obj)
        else if (op.t === 'del') known.current.delete(op.uid)
        else known.current.clear()
        sendOp(op)
      }
      undoStack.current.push({ undo, redo })
      if (undoStack.current.length > 100) undoStack.current.shift()
      redoStack.current = []
      syncHist()
    }

    function added(o: FabricObject) {
      const obj = o as Obj
      obj.uid = newUid()
      style(o)
      const json = toJson(o)
      commit([{ t: 'add', obj: json }], [{ t: 'del', uid: json.uid }])
    }

    function erase(objs: FabricObject[]) {
      const ops = objs.map(o => (o as Obj).uid).filter((u): u is string => !!u && known.current.has(u))
      if (!ops.length) return
      const prev = ops.map(u => known.current.get(u)!)
      fc.discardActiveObject()
      fc.remove(...objs)
      fc.requestRenderAll()
      commit(ops.map(uid => ({ t: 'del', uid })), prev.map(obj => ({ t: 'add', obj })))
    }

    function step(from: React.MutableRefObject<Entry[]>, to: React.MutableRefObject<Entry[]>, dir: 'undo' | 'redo') {
      const e = from.current.pop()
      if (!e) return
      to.current.push(e)
      syncHist()
      for (const op of e[dir]) { enqueue(() => applyNow(op)); sendOp(op) }
    }
    api.current = {
      undo: () => step(undoStack, redoStack, 'undo'),
      redo: () => step(redoStack, undoStack, 'redo'),
      clear: () => {
        const all = fc.getObjects().filter(o => !o.excludeFromExport && (o as Obj).uid)
        if (!all.length) return
        const prev = all.map(o => known.current.get((o as Obj).uid!) ?? toJson(o))
        fc.discardActiveObject()
        fc.remove(...all)
        fc.requestRenderAll()
        commit([{ t: 'clear' }], prev.map(obj => ({ t: 'add', obj })))
      },
      deleteSelection: () => {
        const sel = fc.getActiveObjects()
        if (sel.length && !(sel[0] as IText).isEditing) erase(sel)
      },
      restyle: () => {
        fc.getObjects().forEach(style)
        const { tool, readOnly } = live.current
        const editing = fc.getActiveObject() as IText | undefined
        if (editing?.isEditing) editing.exitEditing() // typed text is sent on exit
        if (tool !== 'select') fc.discardActiveObject()
        fc.isDrawingMode = !readOnly && (tool === 'pen' || tool === 'marker' || tool === 'eraser')
        fc.selection = !readOnly && tool === 'select'
        fc.backgroundColor = live.current.hasUnderlay ? '' : '#ffffff'
        // ☝ and viewers: the pointer goes through to the slide underneath
        const through = live.current.hasUnderlay && (readOnly || tool === 'slide')
        if (fc.elements?.container) fc.elements.container.style.pointerEvents = through ? 'none' : 'auto' // the host never takes them
        fc.skipTargetFind = readOnly || tool !== 'select'
        fc.defaultCursor = readOnly ? 'default' : tool === 'text' ? 'text' : tool === 'select' ? 'default' : 'crosshair'
        if (fc.isDrawingMode) {
          const b = new PencilBrush(fc)
          const { color, width } = live.current
          b.color = tool === 'eraser' ? ERASER_COLOR : tool === 'marker' ? withAlpha(color, 0.35) : color
          b.width = tool === 'eraser' ? width * ERASER_SCALE : tool === 'marker' ? width * 4 : width
          fc.freeDrawingBrush = b
        }
        fc.requestRenderAll()
      },
    }

    // ---- local input ----
    fc.on('path:created', e => {
      const path = (e as unknown as { path: FabricObject }).path
      // On a slide white paint would cover the slide: there the eraser removes the ink itself
      if (live.current.hasUnderlay && path.stroke === ERASER_COLOR) path.set({ globalCompositeOperation: 'destination-out' })
      added(path)
    })

    let start: { x: number; y: number } | null = null
    let preview: FabricObject | null = null

    fc.on('mouse:down', (e: TPointerEventInfo) => {
      const { tool, readOnly, color } = live.current
      if (readOnly) return
      if (tool === 'text') {
        const editing = fc.getActiveObject() as IText | undefined
        if (editing?.isEditing) { editing.exitEditing(); fc.discardActiveObject(); fc.requestRenderAll(); return }
        const t = new IText('', { left: e.scenePoint.x, top: e.scenePoint.y - 24, originX: 'left', originY: 'top', fontSize: 40, fill: color, fontFamily: 'sans-serif' })
        ;(t as Obj).uid = newUid()
        fc.add(t)
        fc.setActiveObject(t)
        t.enterEditing()
        return
      }
      if (SHAPES.includes(tool)) start = { x: e.scenePoint.x, y: e.scenePoint.y }
    })
    fc.on('mouse:move', (e: TPointerEventInfo) => {
      const { tool, color, width } = live.current
      if (!start) return
      if (preview) fc.remove(preview)
      preview = makeShape(tool as ShapeTool, start, e.scenePoint, color, width)
      preview.set({ excludeFromExport: true, selectable: false, evented: false })
      fc.add(preview)
      fc.requestRenderAll()
    })
    fc.on('mouse:up', (e: TPointerEventInfo) => {
      if (!start) return
      const { tool, color, width } = live.current
      if (preview) { fc.remove(preview); preview = null }
      const s = start
      start = null
      if (Math.hypot(e.scenePoint.x - s.x, e.scenePoint.y - s.y) < 4) { fc.requestRenderAll(); return }
      const o = makeShape(tool as ShapeTool, s, e.scenePoint, color, width)
      fc.add(o)
      added(o)
      fc.requestRenderAll()
    })

    // Text: sent when typing is finished; an emptied text disappears
    fc.on('text:editing:exited', e => {
      const t = e.target as IText & Obj
      const uid = t.uid!
      const prev = known.current.get(uid)
      if (!t.text.trim()) {
        fc.remove(t)
        fc.requestRenderAll()
        if (prev) commit([{ t: 'del', uid }], [{ t: 'add', obj: prev }])
        return
      }
      style(t)
      const json = toJson(t)
      if (!prev) commit([{ t: 'add', obj: json }], [{ t: 'del', uid }])
      else commit([{ t: 'mod', obj: json }], [{ t: 'mod', obj: prev }])
    })

    // Moved / resized / rotated with the select tool
    fc.on('object:modified', e => {
      const target = e.target
      let objs: FabricObject[] = [target]
      if (target instanceof ActiveSelection) {
        objs = target.getObjects()
        fc.discardActiveObject() // children get their absolute positions back
      }
      const redo: BoardOp[] = [], undo: BoardOp[] = []
      for (const o of objs) {
        const uid = (o as Obj).uid
        const prev = uid ? known.current.get(uid) : undefined
        if (!uid || !prev) continue
        redo.push({ t: 'mod', obj: toJson(o) })
        undo.push({ t: 'mod', obj: prev })
      }
      if (objs.length > 1) {
        fc.setActiveObject(new ActiveSelection(objs, { canvas: fc }))
        fc.requestRenderAll()
      }
      if (redo.length) commit(redo, undo)
    })

    const unsubscribe = live.current.link?.subscribe(op => enqueue(() => applyNow(op)), loadState)
    api.current.restyle()

    // Fit the page into the stage
    const stage = stageRef.current!
    const fit = () => {
      const k = Math.max(0.05, Math.min(stage.clientWidth / W, stage.clientHeight / H))
      fc.setDimensions({ width: Math.floor(W * k), height: Math.floor(H * k) })
      fc.setZoom(k)
      setPageWidth(Math.floor(W * k))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(stage)

    return () => {
      ro.disconnect()
      unsubscribe?.()
      fcRef.current = null
      fc.dispose().finally(() => { fc.elements?.container?.remove(); el.remove() })
    }
  }, [])

  useEffect(() => {
    if (!hasUnderlay && tool === 'slide') setTool('pen')
    api.current.restyle()
  }, [tool, color, width, readOnly, hasUnderlay])

  function onKeyDown(e: React.KeyboardEvent) {
    if (readOnly || (e.target as HTMLElement).tagName === 'TEXTAREA') return
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? api.current.redo() : api.current.undo(); return }
    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); api.current.deleteSelection() }
  }

  return (
    <div className="live-board" tabIndex={-1} onKeyDown={onKeyDown}
      onPointerDown={e => { if ((e.target as HTMLElement).tagName !== 'TEXTAREA') e.currentTarget.focus({ preventScroll: true }) }}
      style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--board-margin, #e9ecef)', outline: 'none', boxSizing: 'border-box' }}>
      {!readOnly && (
        <div data-testid="board-toolbar" style={bar}>
          {TOOLS.filter(t => (role === 'teacher' || !t.teacherOnly) && (hasUnderlay || !t.onSlide)).map(t => (
            <Btn key={t.key} on={tool === t.key} title={t.title} onClick={() => setTool(t.key)} testId={`tool-${t.key}`}>{t.icon}</Btn>
          ))}
          <Sep />
          {COLORS.map(c => (
            <button key={c} title="Цвет" onClick={() => setColor(c)} style={{
              width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
              border: color === c ? '3px solid #fff' : '2px solid transparent',
              boxShadow: color === c ? `0 0 0 2px ${c}` : 'none',
            }} />
          ))}
          <Sep />
          {WIDTHS.map(w => (
            <Btn key={w} on={width === w} title="Толщина" onClick={() => setWidth(w)}>
              <span style={{ display: 'inline-block', width: 16, height: Math.max(2, w / 2), background: '#333', borderRadius: 2, verticalAlign: 'middle' }} />
            </Btn>
          ))}
          <Sep />
          <Btn title="Отменить (Ctrl+Z)" disabled={!hist.undo} onClick={() => api.current.undo()}>↶</Btn>
          <Btn title="Повторить (Ctrl+Shift+Z)" disabled={!hist.redo} onClick={() => api.current.redo()}>↷</Btn>
          {role === 'teacher' && <Btn title="Очистить доску (можно отменить)" onClick={() => api.current.clear()} testId="board-clear">🗑</Btn>}
        </div>
      )}
      <div ref={stageRef} style={{ flex: 1, minHeight: 0, minWidth: 0, position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ position: 'relative', lineHeight: 0, boxShadow: '0 1px 4px rgba(0,0,0,0.15)' }}>
            {underlay && pageWidth > 0 && <div style={{ position: 'absolute', left: 0, top: 0 }}>{underlay(pageWidth)}</div>}
            <div ref={hostRef} data-testid="board" style={{ position: 'relative', lineHeight: 0, pointerEvents: 'none' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Btn({ on, title, disabled, onClick, testId, children }: {
  on?: boolean; title: string; disabled?: boolean; onClick: () => void; testId?: string; children: ReactNode
}) {
  return (
    <button title={title} disabled={disabled} onClick={onClick} data-testid={testId} style={{
      minWidth: 32, height: 32, padding: '0 6px', borderRadius: 6, fontSize: 16, lineHeight: 1,
      border: on ? '1px solid #4a90e2' : '1px solid transparent',
      background: on ? '#e7f1fc' : 'transparent', color: '#222',
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.35 : 1,
    }}>{children}</button>
  )
}

const Sep = () => <span style={{ width: 1, height: 22, background: '#ddd', margin: '0 4px' }} />

const bar: CSSProperties = {
  flex: 'none', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2,
  padding: '4px 6px', background: '#fff', borderBottom: '1px solid #ddd',
}

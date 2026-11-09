// The shared board. Every object carries an `id`; local changes go out as small
// ops (add / mod / del / order), remote ops are applied without echoing back.
// Undo/redo works on my own changes: each step remembers the state before and after.

import {
  ActiveSelection,
  Canvas,
  Ellipse,
  FabricImage,
  FabricObject,
  Group,
  IText,
  Point,
  Polygon,
  Polyline,
  PencilBrush,
  Rect,
  util,
  type TPointerEventInfo,
} from 'fabric'
import { MARKS, markFromDrag, type MarkKind } from './marks'
import { SHAPES, buildShape, dragBox, type ShapeKind } from './shapes'
import { DEFAULT_SHEET, drawPaper, pageBox, pagesOf, renderPaper, validSheet, type Sheet } from './paper'
import { makePdf, type PdfPage } from './pdfwrite'
import { applyCrop, cropFrame, isCropped, uncrop } from './crop'

FabricObject.customProperties = ['id', 'locked', 'layer']

export type Tool =
  | 'select'
  | 'lock'
  | 'hand'
  | 'pointer'
  | 'pen'
  | 'marker'
  | 'eraser'
  | 'broom'
  | 'text'
  | 'polygon'
  | 'pipette'
  | MarkKind
  | ShapeKind

export type Op =
  | { op: 'add'; obj: any }
  | { op: 'mod'; obj: any }
  | { op: 'del'; id: string }
  | { op: 'order'; ids: string[] }
  | { op: 'sheet'; sheet: Sheet }
  | { op: 'bookmarks'; list: Bookmark[] }
  | { op: 'layers'; list: Layer[] }
  | { op: 'sync'; objs: any[]; sheet?: Sheet; bookmarks?: Bookmark[]; layers?: Layer[] }

/**
 * A layer: a named part of the board that sets what is above what (as in the lesson editor).
 * The eraser cuts only inside its own layer. Shared: name, order, locked, hidden from the student.
 */
export interface Layer {
  id: string
  name: string
  locked?: boolean
  studentHidden?: boolean
}

export const BASE_LAYER = 'L1'


/** A remembered place on the board: what was in the middle of the screen, and the zoom */
export type Bookmark = { id: string; name: string; x: number; y: number; z: number }

export interface TextStyle {
  fontSize: number
  fontWeight: 'normal' | 'bold'
  fontStyle: 'normal' | 'italic'
  underline: boolean
  fontFamily: string
}

type Obj = FabricObject & { id?: string; locked?: boolean; layer?: string; _pending?: boolean }
type State = Record<string, any>
type Change = { id: string; before: State | null; after: State | null }

const NOT_SYNCED_ON_MOD = ['type', 'version', 'src', 'path', 'objects', 'filters', 'crossOrigin', 'points']
const DRAWING = new Set<Tool>(['pen', 'marker', 'eraser'])
export const isMark = (t: string): t is MarkKind => t in MARKS
export const isShape = (t: string): t is ShapeKind => t in SHAPES

export function newId() {
  const a = crypto.getRandomValues(new Uint8Array(9))
  return Array.from(a, (b) => (b % 36).toString(36)).join('')
}

export function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
  let last = 0
  let timer = 0
  let lastArgs: A
  return (...a: A) => {
    lastArgs = a
    const wait = last + ms - Date.now()
    if (wait <= 0) {
      last = Date.now()
      fn(...a)
    } else if (!timer) {
      timer = window.setTimeout(() => {
        timer = 0
        last = Date.now()
        fn(...lastArgs)
      }, wait)
    }
  }
}

export class Board {
  readonly canvas: Canvas
  tool: Tool = 'pen'
  color = '#1f2937'
  width = 3
  fill = '' // '' = no fill
  sheet: Sheet = { ...DEFAULT_SHEET }
  text: TextStyle = { fontSize: 28, fontWeight: 'normal', fontStyle: 'normal', underline: false, fontFamily: 'Inter, system-ui, sans-serif' }
  /** the teacher has locked the board: only looking around and pointing */
  readOnly = false

  /** called for every local change that the other side must see */
  onOp: (op: Op) => void = () => {}
  onViewport: () => void = () => {}
  onCursor: (x: number, y: number) => void = () => {}
  onLaser: (x: number, y: number, start: boolean) => void = () => {}
  onToolChange: (t: Tool) => void = () => {}
  onSelection: () => void = () => {}
  onHistory: () => void = () => {}
  onPipette: (color: string) => void = () => {}
  /** a text uses a font that may not be loaded yet */
  onFont: (t: IText) => void = () => {}
  onBookmarks: () => void = () => {}
  onCrop: () => void = () => {}

  bookmarks: Bookmark[] = []
  layers: Layer[] = [{ id: BASE_LAYER, name: 'Слой 1' }]
  activeLayer = BASE_LAYER
  /** layers I hid on my screen only */
  hiddenForMe = new Set<string>()
  /** set by the page: the teacher sees layers hidden from the student (dimmed) */
  isTeacher = false
  onLayers: () => void = () => {}
  /** a short message for the person at this screen, without stopping them */
  onNotice: (text: string) => void = () => {}
  onSheet: () => void = () => {}
  cropping: { img: FabricImage; frame: Obj } | null = null

  private applying = false
  private draft: Obj | null = null
  private origin: Point | null = null
  private panning: { x: number; y: number } | null = null
  private erasing = false
  private lasering = false
  private spaceHand = false
  private poly: { x: number; y: number }[] = []
  private beforePipette: Tool = 'pen'
  private known = new Map<string, State>() // last settled state of each object, for undo
  private undoStack: Change[][] = []
  private redoStack: Change[][] = []
  private batch: Change[] | null = null
  private clip: State[] = []

  constructor(
    el: HTMLCanvasElement,
    private wrap: HTMLElement,
    private paperEl: HTMLCanvasElement,
  ) {
    const canvas = new Canvas(el, {
      preserveObjectStacking: true,
      selectionColor: 'rgba(37, 99, 235, 0.08)',
      selectionBorderColor: '#2563eb',
      fireRightClick: false,
    })
    this.canvas = canvas
    const plain = canvas._renderObjects.bind(canvas)
    canvas._renderObjects = (ctx: CanvasRenderingContext2D, objects: FabricObject[]) => this.renderLayers(ctx, objects, plain)
    this.resize()
    window.addEventListener('resize', () => this.resize())

    canvas.on('object:added', ({ target }) => {
      const o = target as Obj
      o.id ??= newId()
      if (!this.applying && !o._pending) {
        o.layer ??= this.targetLayer()
        canvas.moveObjectTo(o, this.layerTopIndex(o.layer, o))
      }
      this.interactivity(o)
      if (this.applying || o._pending) return
      const state = this.serialize(o)
      this.known.set(o.id, state)
      this.record({ id: o.id, before: null, after: state })
      this.onOp({ op: 'add', obj: state })
    })
    // the eraser draws a stroke that cuts through everything under it: the ruling (a separate canvas) shows through
    canvas.on('before:path:created', ({ path }) => {
      if (this.tool === 'eraser') path.set({ stroke: '#000', globalCompositeOperation: 'destination-out' })
      ;(path as Obj).layer = this.targetLayer()
    })
    canvas.on('object:removed', ({ target }) => {
      const o = target as Obj
      if (this.applying || o._pending || !o.id) return
      this.record({ id: o.id, before: this.known.get(o.id) ?? this.serialize(o), after: null })
      this.known.delete(o.id)
      this.onOp({ op: 'del', id: o.id })
    })
    canvas.on('object:modified', ({ target }) => this.commit(target))
    const live = throttle((t: FabricObject) => this.sendLive(t), 80)
    canvas.on('object:moving', ({ target }) => live(target))
    canvas.on('object:scaling', ({ target }) => live(target))
    canvas.on('object:rotating', ({ target }) => live(target))
    canvas.on('text:changed', ({ target }) => live(target))
    canvas.on('text:editing:exited', ({ target }) => {
      const t = target as IText & Obj
      if (!t.text.trim()) return void canvas.remove(t)
      // a text typed right after it was placed is one step: "add" with the final text
      const last = this.undoStack.at(-1)
      if (last?.length === 1 && last[0].id === t.id && last[0].before === null) {
        const state = this.serialize(t)
        last[0].after = state
        this.known.set(t.id!, state)
        this.onOp({ op: 'mod', obj: state })
      } else this.commit(t)
    })
    canvas.on('selection:created', () => this.onSelection())
    canvas.on('selection:updated', () => this.onSelection())
    canvas.on('selection:cleared', () => this.onSelection())

    canvas.on('mouse:down', (e) => this.down(e))
    canvas.on('mouse:move', (e) => this.move(e))
    canvas.on('mouse:up', () => this.up())
    canvas.on('mouse:dblclick', () => this.tool === 'polygon' && this.finishPolygon())
    canvas.on('mouse:wheel', (e) => this.wheel(e))
    canvas.on('after:render', ({ ctx }) => this.drawLockMarks(ctx))

    const cursor = throttle((x: number, y: number) => this.onCursor(x, y), 50)
    canvas.on('mouse:move', (e) => {
      const p = canvas.getScenePoint(e.e)
      cursor(p.x, p.y)
    })

    window.addEventListener('keydown', (e) => this.key(e, true))
    window.addEventListener('keyup', (e) => this.key(e, false))
    this.setTool('pen')
    this.updateView()
  }

  // ---------- tools ----------

  setTool(t: Tool) {
    if (this.readOnly && t !== 'hand' && t !== 'pointer') t = 'hand'
    if (t === 'pipette' && this.tool !== 'pipette') this.beforePipette = this.tool
    if (t !== 'polygon') this.cancelPolygon()
    if (this.cropping) this.finishCrop(false)
    this.tool = t
    const c = this.canvas
    if (t !== 'select') c.discardActiveObject()
    c.isDrawingMode = DRAWING.has(t)
    if (c.isDrawingMode) {
      const brush = new PencilBrush(c)
      if (t === 'eraser') {
        brush.color = 'rgba(148, 163, 184, 0.55)' // preview only; the finished stroke cuts (see before:path:created)
        brush.width = Math.max(16, this.width * 5)
      } else {
        brush.color = t === 'marker' ? this.markerColor() : this.color
        brush.width = t === 'marker' ? this.width * 5 : this.width
      }
      c.freeDrawingBrush = brush
    }
    c.selection = t === 'select'
    c.defaultCursor =
      t === 'hand' ? 'grab' : t === 'select' ? 'default' : t === 'text' ? 'text' : t === 'pointer' ? POINTER_CURSOR : 'crosshair'
    c.hoverCursor = t === 'select' ? 'move' : t === 'broom' || t === 'lock' ? 'pointer' : c.defaultCursor
    c.forEachObject((o) => this.interactivity(o))
    c.requestRenderAll()
    this.onToolChange(t)
  }

  setReadOnly(on: boolean) {
    this.readOnly = on
    if (on) {
      this.canvas.discardActiveObject()
      if (this.tool !== 'pointer') this.setTool('hand')
    }
  }

  setColor(color: string) {
    this.color = color
    this.restyle((o) => {
      if (o instanceof IText) o.set({ fill: color })
      else if (o instanceof FabricImage || o instanceof Group) return false
      else {
        if (o.fill && o.fill === o.stroke) o.set({ fill: color }) // filled dots of a segment follow the line
        o.set({ stroke: color })
      }
    })
    if (this.tool !== 'pipette') this.setTool(this.tool)
  }

  setWidth(w: number) {
    this.width = w
    this.restyle((o) => {
      if (o instanceof IText || o instanceof FabricImage || o instanceof Group) return false
      o.set({ strokeWidth: w })
    })
    this.setTool(this.tool)
  }

  setFill(fill: string) {
    this.fill = fill
    this.restyle((o) => {
      if (!(o instanceof Rect || o instanceof Ellipse || o instanceof Polygon)) return false
      o.set({ fill: fill || 'transparent' })
    })
  }

  setTextStyle(s: Partial<TextStyle>) {
    Object.assign(this.text, s)
    this.restyle((o) => {
      if (!(o instanceof IText)) return false
      o.set(s)
      o.initDimensions()
      o.setCoords()
      this.onFont(o)
    })
  }

  /** Applies a change to the selected objects; the callback returns false to skip one. */
  private restyle(fn: (o: FabricObject) => void | false) {
    const sel = this.canvas.getActiveObjects()
    if (!sel.length) return
    const changed = sel.filter((o) => fn(o) !== false)
    if (!changed.length) return
    this.canvas.requestRenderAll()
    this.commit(...changed)
  }

  private markerColor() {
    const n = parseInt(this.color.slice(1), 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.35)`
  }

  private interactivity(o: FabricObject) {
    const L = this.layerOf(o as Obj)
    const hidden = !!L && (this.hiddenForMe.has(L.id) || (!this.isTeacher && !!L.studentHidden))
    o.visible = !hidden
    // eraser strokes are holes, not things: they can't be picked, moved or swept away
    if (isCut(o)) {
      o.selectable = false
      o.evented = false
      return
    }
    const layerLocked = hidden || !!L?.locked
    if (this.tool === 'lock') {
      o.selectable = false
      o.evented = !layerLocked
      return
    }
    const free = !(o as Obj).locked && !layerLocked
    o.selectable = free && this.tool === 'select'
    o.evented = free && (this.tool === 'select' || this.tool === 'broom')
  }

  // ---------- layers ----------

  private layerOf(o: Obj) {
    return this.layers.find((l) => l.id === (o.layer ?? BASE_LAYER))
  }

  private layerOrder() {
    return new Map(this.layers.map((l, i) => [l.id, i]))
  }

  /** z-index of an object's layer; objects of a layer not known yet go on top */
  private rank(order: Map<string, number>, o: Obj) {
    return order.get(o.layer ?? BASE_LAYER) ?? this.layers.length
  }

  /** Canvas index right above the last object of the layer (`except`: the object being placed) */
  private layerTopIndex(layer: string, except?: FabricObject) {
    const order = this.layerOrder()
    const k = order.get(layer) ?? this.layers.length
    let at = 0
    this.canvas
      .getObjects()
      .filter((o) => o !== except)
      .forEach((o, i) => {
        if (this.rank(order, o as Obj) <= k) at = i + 1
      })
    return at
  }

  /** Objects sorted by layer again (stable inside a layer) */
  private resort() {
    const c = this.canvas
    const order = this.layerOrder()
    const sorted = c
      .getObjects()
      .map((o, i) => ({ o, i }))
      .sort((a, b) => this.rank(order, a.o as Obj) - this.rank(order, b.o as Obj) || a.i - b.i)
    sorted.forEach(({ o }, i) => c.moveObjectTo(o, i))
  }

  private editable(l: Layer) {
    return !l.locked && !this.hiddenForMe.has(l.id) && (this.isTeacher || !l.studentHidden)
  }

  /** The layer new objects go to: the active one if it can be drawn on, otherwise the top one that can */
  private targetLayer() {
    const act = this.layers.find((l) => l.id === this.activeLayer)
    if (act && this.editable(act)) return act.id
    let t = [...this.layers].reverse().find((l) => this.editable(l))
    if (!t) {
      t = { id: 'L' + newId(), name: `Слой ${this.layers.length + 1}` }
      this.layers.push(t)
      this.layersChanged()
    }
    if (act) {
      const why = act.locked ? 'заблокирован' : this.hiddenForMe.has(act.id) ? 'скрыт у вас' : 'скрыт от ученика'
      this.onNotice(`Слой «${act.name}» ${why}, рисую в «${t.name}»`)
    }
    this.activeLayer = t.id
    this.onLayers()
    return t.id
  }

  private layersChanged(send = true) {
    this.resort()
    this.canvas.forEachObject((o) => this.interactivity(o))
    const sel = this.canvas.getActiveObjects()
    if (sel.some((o) => !o.selectable || !o.visible)) this.canvas.discardActiveObject()
    this.canvas.requestRenderAll()
    this.onLayers()
    if (send) this.onOp({ op: 'layers', list: this.layers })
  }

  setActiveLayer(id: string) {
    this.activeLayer = id
    this.onLayers()
  }

  addLayer() {
    const at = Math.max(0, this.layers.findIndex((l) => l.id === this.activeLayer)) + 1
    const fresh: Layer = { id: 'L' + newId(), name: `Слой ${this.layers.length + 1}` }
    this.layers.splice(at, 0, fresh)
    this.activeLayer = fresh.id
    this.layersChanged()
    return fresh
  }

  patchLayer(id: string, patch: Partial<Layer>) {
    this.layers = this.layers.map((l) => (l.id === id ? { ...l, ...patch } : l))
    this.layersChanged()
  }

  /** dir +1: up (drawn above), -1: down */
  moveLayer(id: string, dir: 1 | -1) {
    const i = this.layers.findIndex((l) => l.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= this.layers.length) return
    ;[this.layers[i], this.layers[j]] = [this.layers[j], this.layers[i]]
    this.layersChanged()
  }

  /** Deletes a layer with its objects (the objects come back with Ctrl+Z, into the top layer) */
  deleteLayer(id: string) {
    if (this.layers.length < 2) return
    const inside = this.canvas.getObjects().filter((o) => (o as Obj).layer === id || (!(o as Obj).layer && id === BASE_LAYER))
    this.canvas.discardActiveObject()
    this.tx(() => inside.length && this.canvas.remove(...inside))
    this.layers = this.layers.filter((l) => l.id !== id)
    if (this.activeLayer === id) this.activeLayer = this.layers.at(-1)!.id
    this.layersChanged()
  }

  countInLayer(id: string) {
    return this.canvas.getObjects().filter((o) => ((o as Obj).layer ?? BASE_LAYER) === id && !isCut(o)).length
  }

  /** Shows or hides a layer on my screen only */
  toggleHidden(id: string) {
    if (this.hiddenForMe.has(id)) this.hiddenForMe.delete(id)
    else this.hiddenForMe.add(id)
    this.layersChanged(false)
  }

  /** Moves the selected objects to the top of a layer */
  moveSelectionToLayer(id: string) {
    const objs = this.canvas.getActiveObjects() as Obj[]
    if (!objs.length) return
    this.canvas.discardActiveObject()
    for (const o of objs) o.layer = id
    this.resort()
    this.commit(...objs)
    this.onOp({ op: 'order', ids: this.ids() })
    this.activeLayer = id
    this.canvas.forEachObject((o) => this.interactivity(o))
    if (objs.every((o) => o.selectable)) this.reselect(objs)
    this.canvas.requestRenderAll()
    this.onLayers()
  }

  /**
   * Draws the objects layer by layer. A layer with eraser strokes is drawn on its own
   * canvas first, so the strokes cut through that layer only and not the layers below.
   * The teacher sees layers hidden from the student dimmed.
   */
  private renderLayers(ctx: CanvasRenderingContext2D, objects: FabricObject[], plain: (ctx: CanvasRenderingContext2D, o: FabricObject[]) => void) {
    const runs: { layer: string; objs: FabricObject[] }[] = []
    for (const o of objects) {
      const l = (o as Obj).layer ?? BASE_LAYER
      const last = runs.at(-1)
      if (last && last.layer === l) last.objs.push(o)
      else runs.push({ layer: l, objs: [o] })
    }
    runs.forEach((run, i) => {
      const dim = this.isTeacher && !!this.layers.find((l) => l.id === run.layer)?.studentHidden
      const cuts = i > 0 && run.objs.some((o) => isCut(o) && o.visible)
      if (!dim && !cuts) return plain(ctx, run.objs)
      const off = (this.offscreen ??= document.createElement('canvas'))
      if (off.width !== ctx.canvas.width || off.height !== ctx.canvas.height) {
        off.width = ctx.canvas.width
        off.height = ctx.canvas.height
      }
      const o2 = off.getContext('2d')!
      o2.setTransform(1, 0, 0, 1, 0, 0)
      o2.clearRect(0, 0, off.width, off.height)
      o2.setTransform(ctx.getTransform())
      plain(o2, run.objs)
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.globalAlpha = dim ? 0.45 : 1
      ctx.drawImage(off, 0, 0)
      ctx.restore()
    })
  }
  private offscreen: HTMLCanvasElement | undefined

  /** In the pin tool, outline every object: red — pinned, blue — free. */
  private drawLockMarks(ctx: CanvasRenderingContext2D) {
    if (this.tool !== 'lock') return
    const v = this.canvas.viewportTransform
    ctx.save()
    ctx.transform(v[0], v[1], v[2], v[3], v[4], v[5])
    ctx.setLineDash([6 / v[0], 4 / v[0]])
    ctx.lineWidth = 1.5 / v[0]
    for (const o of this.canvas.getObjects() as Obj[]) {
      if (isCut(o)) continue
      ctx.strokeStyle = o.locked ? '#dc2626' : 'rgba(37, 99, 235, 0.35)'
      const pts = o.getCoords()
      ctx.beginPath()
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
      ctx.closePath()
      ctx.stroke()
    }
    ctx.restore()
  }

  // ---------- pointer ----------

  private shapeStyle() {
    return {
      stroke: this.color,
      strokeWidth: this.width,
      fill: this.fill || 'transparent',
      strokeUniform: true,
      strokeLineCap: 'round' as const,
      strokeLineJoin: 'round' as const,
    }
  }

  private down(e: TPointerEventInfo) {
    const c = this.canvas
    const ev = e.e as MouseEvent
    if (this.tool === 'hand' || this.spaceHand || ev.button === 1) {
      this.panning = { x: ev.clientX, y: ev.clientY }
      c.setCursor('grabbing')
      return
    }
    const p = c.getScenePoint(ev)
    switch (this.tool) {
      case 'pointer':
        this.lasering = true
        this.onLaser(p.x, p.y, true)
        return
      case 'broom':
        this.erasing = true
        if (e.target) c.remove(e.target)
        return
      case 'lock':
        if (e.target) this.toggleLock(e.target as Obj)
        return
      case 'pipette':
        this.onPipette(this.colorAt(e.viewportPoint.x, e.viewportPoint.y))
        this.setTool(this.beforePipette)
        return
      case 'polygon':
        return this.polygonClick(p)
      case 'text': {
        if (e.target instanceof IText) return
        const t = new IText('', {
          left: p.x,
          top: p.y - this.text.fontSize / 2,
          originX: 'left',
          originY: 'top',
          fill: this.color,
          ...this.text,
        })
        c.add(t)
        this.setTool('select')
        c.setActiveObject(t)
        t.enterEditing()
        return
      }
    }
    if (isMark(this.tool) || isShape(this.tool)) {
      this.origin = p
      this.redraft(p, ev.shiftKey)
    }
  }

  /** Rebuilds the shape/mark being dragged, from the press point to p. */
  private redraft(p: Point, shift: boolean) {
    const c = this.canvas
    const o = this.origin!
    this.applying = true
    if (this.draft) c.remove(this.draft)
    let d: Obj
    if (isMark(this.tool)) {
      if (MARKS[this.tool].drag === 'line' && shift) p = snap15(o, p)
      d = markFromDrag(this.tool, o, p, { stroke: this.color, strokeWidth: this.width })
    } else d = buildShape(this.tool as ShapeKind, dragBox(this.tool as ShapeKind, o, p, shift), this.shapeStyle())
    d._pending = true
    this.draft = d
    c.add(d)
    d.selectable = d.evented = false
    this.applying = false
  }

  private move(e: TPointerEventInfo) {
    const c = this.canvas
    const ev = e.e as MouseEvent
    if (this.panning) {
      c.relativePan(new Point(ev.clientX - this.panning.x, ev.clientY - this.panning.y))
      this.panning = { x: ev.clientX, y: ev.clientY }
      this.updateView()
      return
    }
    if (this.lasering) {
      const p = c.getScenePoint(ev)
      this.onLaser(p.x, p.y, false)
      return
    }
    if (this.erasing && e.target) {
      c.remove(e.target)
      return
    }
    if (this.tool === 'polygon' && this.poly.length) return this.polygonPreview(c.getScenePoint(ev))
    if (!this.draft || !this.origin) return
    this.redraft(c.getScenePoint(ev), ev.shiftKey)
    c.requestRenderAll()
  }

  private up() {
    const c = this.canvas
    if (this.panning) {
      this.panning = null
      c.setCursor(this.tool === 'hand' || this.spaceHand ? 'grab' : c.defaultCursor)
      return
    }
    this.erasing = false
    this.lasering = false
    if (!this.origin) return
    const d = this.draft
    this.draft = null
    this.origin = null
    if (!d) return
    this.applying = true
    c.remove(d)
    this.applying = false
    const r = d.getBoundingRect()
    if (r.width < 4 && r.height < 4) return // a click, not a drag
    d._pending = false
    c.add(d)
  }

  // polygon by points: click — next corner; click on the first corner, double click or Enter — done; Esc — cancel
  private polygonClick(p: Point) {
    const first = this.poly[0]
    const near = first && Math.hypot(p.x - first.x, p.y - first.y) * this.canvas.getZoom() < 10
    if (near && this.poly.length >= 3) return this.finishPolygon()
    this.poly.push({ x: p.x, y: p.y })
    this.polygonPreview(p)
  }

  private polygonPreview(p: Point) {
    const c = this.canvas
    this.applying = true
    if (this.draft) c.remove(this.draft)
    const d = new Polyline([...this.poly, { x: p.x, y: p.y }], { ...this.shapeStyle(), fill: '' }) as Obj
    d._pending = true
    this.draft = d
    c.add(d)
    d.selectable = d.evented = false
    this.applying = false
    c.requestRenderAll()
  }

  private finishPolygon() {
    // a double click also lands two clicks on the same spot
    const pts = this.poly.filter((q, i, a) => !i || Math.hypot(q.x - a[i - 1].x, q.y - a[i - 1].y) > 2)
    this.cancelPolygon()
    if (pts.length >= 3) this.canvas.add(new Polygon(pts, this.shapeStyle()))
  }

  private cancelPolygon() {
    if (!this.poly.length) return
    this.poly = []
    if (this.draft) {
      this.applying = true
      this.canvas.remove(this.draft)
      this.applying = false
      this.draft = null
      this.canvas.requestRenderAll()
    }
  }

  private wheel(e: TPointerEventInfo<WheelEvent>) {
    const ev = e.e
    ev.preventDefault()
    const c = this.canvas
    if (ev.ctrlKey || ev.metaKey) {
      const zoom = Math.min(5, Math.max(0.2, c.getZoom() * 0.999 ** ev.deltaY))
      c.zoomToPoint(new Point(ev.offsetX, ev.offsetY), zoom)
    } else c.relativePan(new Point(-ev.deltaX, -ev.deltaY))
    this.updateView()
  }

  private key(e: KeyboardEvent, down: boolean) {
    const active = this.canvas.getActiveObject()
    const typing = (active instanceof IText && active.isEditing) || (e.target as HTMLElement).closest?.('input, textarea, select')
    if (typing) return
    if (e.code === 'Space') {
      e.preventDefault()
      if (this.spaceHand !== down) {
        this.spaceHand = down
        this.canvas.setCursor(down ? 'grab' : this.canvas.defaultCursor)
      }
      return
    }
    if (!down || this.readOnly) return
    const mod = e.ctrlKey || e.metaKey
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.canvas.getActiveObjects().length) {
      e.preventDefault()
      this.deleteSelection()
    } else if (mod && e.code === 'KeyZ') {
      e.preventDefault()
      e.shiftKey ? this.redo() : this.undo()
    } else if (mod && e.code === 'KeyY') {
      e.preventDefault()
      this.redo()
    } else if (mod && e.code === 'KeyC' && this.canvas.getActiveObjects().length) {
      this.copy()
    } else if (mod && e.code === 'KeyD') {
      e.preventDefault()
      this.duplicate()
    } else if (mod && e.code === 'KeyA' && this.tool === 'select') {
      e.preventDefault()
      this.selectAll()
    } else if (e.key === 'Enter' && this.cropping) {
      this.finishCrop(true)
    } else if (e.key === 'Escape' && this.cropping) {
      this.finishCrop(false)
    } else if (e.key === 'Enter' && this.tool === 'polygon') {
      this.finishPolygon()
    } else if (e.key === 'Escape') {
      this.cancelPolygon()
      this.canvas.discardActiveObject()
      this.canvas.requestRenderAll()
    }
  }

  private colorAt(x: number, y: number) {
    const el = this.canvas.lowerCanvasEl
    const k = el.width / el.clientWidth
    const [r, g, b, a] = el.getContext('2d')!.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data
    if (a < 10) return '#ffffff'
    return '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')
  }

  // ---------- history ----------

  private record(c: Change) {
    if (this.batch) return void this.batch.push(c)
    this.undoStack.push([c])
    if (this.undoStack.length > 200) this.undoStack.shift()
    this.redoStack = []
    this.onHistory()
  }

  /** Several changes that undo as one step */
  private tx(fn: () => void) {
    const outer = !this.batch
    if (outer) this.batch = []
    try {
      fn()
    } finally {
      if (outer) {
        const b = this.batch!
        this.batch = null
        if (b.length) {
          this.undoStack.push(b)
          this.redoStack = []
          this.onHistory()
        }
      }
    }
  }

  get canUndo() {
    return this.undoStack.length > 0
  }
  get canRedo() {
    return this.redoStack.length > 0
  }

  async undo() {
    const step = this.undoStack.pop()
    if (!step) return
    this.canvas.discardActiveObject()
    for (const ch of [...step].reverse()) await this.put(ch.id, ch.before)
    this.redoStack.push(step)
    this.onHistory()
  }

  async redo() {
    const step = this.redoStack.pop()
    if (!step) return
    this.canvas.discardActiveObject()
    for (const ch of step) await this.put(ch.id, ch.after)
    this.undoStack.push(step)
    this.onHistory()
  }

  /** Brings an object to a state (null = gone) here and for everyone, without recording it. */
  private async put(id: string, state: State | null) {
    if (state === null) {
      if (!this.find(id)) return
      await this.apply({ op: 'del', id })
      this.onOp({ op: 'del', id })
    } else {
      await this.apply({ op: 'mod', obj: state }) // adds it back if it's gone
      this.onOp({ op: 'mod', obj: state })
    }
  }

  /** Records and sends the final state of objects after a local change. */
  private commit(...targets: FabricObject[]) {
    if (this.applying) return
    const objs = targets.flatMap((t) => (t instanceof ActiveSelection ? t.getObjects() : [t])) as Obj[]
    this.tx(() => {
      for (const o of objs) {
        if (o._pending || !o.id || isCut(o)) continue
        const after = this.serialize(o)
        this.record({ id: o.id, before: this.known.get(o.id) ?? null, after })
        this.known.set(o.id, after)
        this.onOp({ op: 'mod', obj: after })
      }
    })
  }

  /** Sends an in-between state while dragging; not recorded */
  private sendLive(target: FabricObject) {
    if (this.applying || !target) return
    const objs = (target instanceof ActiveSelection ? target.getObjects() : [target]) as Obj[]
    for (const o of objs) if (!o._pending && o.id) this.onOp({ op: 'mod', obj: this.serialize(o) })
  }

  // ---------- selection actions ----------

  private reselect(objs: FabricObject[]) {
    const c = this.canvas
    if (objs.length) c.setActiveObject(objs.length === 1 ? objs[0] : new ActiveSelection(objs, { canvas: c }))
    c.requestRenderAll()
  }

  deleteSelection() {
    const objs = this.canvas.getActiveObjects()
    if (!objs.length) return
    this.canvas.discardActiveObject()
    this.tx(() => this.canvas.remove(...objs))
  }

  selectAll() {
    this.canvas.discardActiveObject()
    this.reselect(this.canvas.getObjects().filter((o) => o.selectable))
  }

  copy() {
    this.clip = this.canvas.getActiveObjects().map((o) => this.serialize(o))
  }

  get hasClip() {
    return this.clip.length > 0
  }

  async paste(states = this.clip) {
    if (!states.length) return
    const target = this.targetLayer()
    const fresh = states.map((s) => {
      const l = this.layers.find((x) => x.id === s.layer)
      return { ...s, id: newId(), locked: false, layer: l && this.editable(l) ? l.id : target, left: s.left + 24, top: s.top + 24 }
    })
    this.clip = fresh // pasting again steps further
    const objs = await util.enlivenObjects<FabricObject>(fresh)
    const c = this.canvas
    this.setTool('select')
    this.tx(() => c.add(...objs))
    this.reselect(objs)
  }

  duplicate() {
    return this.paste(this.canvas.getActiveObjects().map((o) => this.serialize(o)))
  }

  bringToFront() {
    this.reorder(true)
  }

  sendToBack() {
    this.reorder(false)
  }

  private reorder(front: boolean) {
    const c = this.canvas
    const objs = c.getActiveObjects()
    if (!objs.length) return
    c.discardActiveObject()
    const ordered = c.getObjects().filter((o) => objs.includes(o))
    // keep their mutual order: to the front one by one from the bottom, to the back from the top
    if (front) ordered.forEach((o) => c.bringObjectToFront(o))
    else ordered.reverse().forEach((o) => c.sendObjectToBack(o))
    this.resort() // front and back within its own layer
    this.reselect(objs)
    this.onOp({ op: 'order', ids: this.ids() })
  }

  /** Mirrors the selection left-to-right */
  flip() {
    const c = this.canvas
    const objs = c.getActiveObjects()
    if (!objs.length) return
    const cx = c.getActiveObject()!.getCenterPoint().x
    c.discardActiveObject() // back to board coordinates
    for (const o of objs) {
      const p = o.getCenterPoint()
      o.set({ flipX: !o.flipX, angle: -o.angle })
      o.setPositionByOrigin(new Point(2 * cx - p.x, p.y), 'center', 'center')
      o.setCoords()
    }
    this.commit(...objs)
    this.reselect(objs)
  }

  get canGroup() {
    return this.canvas.getActiveObjects().length > 1
  }
  get canUngroup() {
    const a = this.canvas.getActiveObject()
    return a instanceof Group && !(a instanceof ActiveSelection)
  }

  group() {
    const c = this.canvas
    const objs = c.getActiveObjects()
    if (objs.length < 2) return
    c.discardActiveObject()
    const ordered = c.getObjects().filter((o) => objs.includes(o))
    let g!: Group
    this.tx(() => {
      c.remove(...ordered)
      g = new Group(ordered)
      ;(g as Obj).layer = (ordered.at(-1) as Obj).layer
      c.add(g)
    })
    this.reselect([g])
  }

  ungroup() {
    const c = this.canvas
    const g = c.getActiveObject()
    if (!(g instanceof Group) || g instanceof ActiveSelection) return
    c.discardActiveObject()
    let objs: FabricObject[] = []
    this.tx(() => {
      c.remove(g)
      objs = g.removeAll()
      c.add(...objs)
    })
    this.reselect(objs)
  }

  /** Pins the selection: pinned objects can't be picked, moved or swept until unpinned with the pin tool. */
  lockSelection() {
    const objs = this.canvas.getActiveObjects() as Obj[]
    if (!objs.length) return
    this.canvas.discardActiveObject()
    for (const o of objs) {
      o.locked = true
      this.interactivity(o)
    }
    this.commit(...objs)
    this.canvas.requestRenderAll()
  }

  private toggleLock(o: Obj) {
    o.locked = !o.locked
    this.commit(o)
    this.canvas.requestRenderAll()
  }

  clear() {
    const objs = this.canvas.getObjects()
    if (!objs.length) return
    this.canvas.discardActiveObject()
    this.tx(() => this.canvas.remove(...objs))
  }

  /** PNG of everything on the board, on the current ruling */
  async exportPng(): Promise<Blob | null> {
    const c = this.canvas
    const objs = c.getObjects()
    if (!objs.length) return null
    const pad = 40
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const o of objs) {
      const r = o.getBoundingRect() // board coordinates
      x0 = Math.min(x0, r.left)
      y0 = Math.min(y0, r.top)
      x1 = Math.max(x1, r.left + r.width)
      y1 = Math.max(y1, r.top + r.height)
    }
    x0 -= pad
    y0 -= pad
    const w = x1 - x0 + pad
    const h = y1 - y0 + pad
    const scale = Math.min(2, 4000 / Math.max(w, h))
    const out = document.createElement('canvas')
    out.width = Math.round(w * scale)
    out.height = Math.round(h * scale)
    const ctx = out.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, out.width, out.height)
    renderPaper(ctx, out.width, out.height, this.sheet, [scale, 0, 0, scale, -x0 * scale, -y0 * scale], scale)
    // the board on its own canvas, so the eraser's holes stay transparent
    const v = c.viewportTransform
    const z = v[0]
    const shot = c.toCanvasElement(scale / z, { left: x0 * z + v[4], top: y0 * z + v[5], width: w * z, height: h * z })
    ctx.drawImage(shot, 0, 0, out.width, out.height)
    return new Promise((r) => out.toBlob(r, 'image/png'))
  }

  /** Board pages (column, row) that have something on them, top to bottom, left to right */
  pagesWithContent() {
    const seen = new Map<string, [number, number]>()
    for (const o of this.canvas.getObjects() as Obj[]) {
      if (o._pending || isCut(o) || !o.visible) continue
      for (const p of pagesOf(this.sheet, o.getBoundingRect())) seen.set(p.join(','), p)
    }
    return [...seen.values()].sort((a, b) => a[1] - b[1] || a[0] - b[0])
  }

  /** PDF of every page with something on it, each on its own sheet of the chosen size */
  async exportPdf(onProgress?: (done: number, total: number) => void): Promise<Blob | null> {
    const pages = this.pagesWithContent()
    if (!pages.length) return null
    const c = this.canvas
    const { w, h, mmW, mmH } = pageBox(this.sheet)
    const scale = Math.min(2, 2400 / Math.max(w, h)) // ~190 dpi on A4
    const out: PdfPage[] = []
    const v = c.viewportTransform
    const z = v[0]
    for (const [i, j] of pages) {
      onProgress?.(out.length + 1, pages.length)
      const x0 = i * w
      const y0 = j * h
      const cv = document.createElement('canvas')
      cv.width = Math.round(w * scale)
      cv.height = Math.round(h * scale)
      const ctx = cv.getContext('2d')!
      ctx.fillStyle = '#fff'
      ctx.fillRect(0, 0, cv.width, cv.height)
      renderPaper(ctx, cv.width, cv.height, this.sheet, [scale, 0, 0, scale, -x0 * scale, -y0 * scale], scale, true) // whole cells on every page
      const shot = c.toCanvasElement(scale / z, {
        left: x0 * z + v[4],
        top: y0 * z + v[5],
        width: w * z,
        height: h * z,
        filter: (o) => !(o as Obj)._pending,
      })
      ctx.drawImage(shot, 0, 0, cv.width, cv.height)
      const blob = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/jpeg', 0.9))
      if (!blob) continue
      out.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), width: cv.width, height: cv.height, mmW, mmH })
      await new Promise((r) => setTimeout(r)) // let the page breathe on long boards
    }
    return makePdf(out)
  }

  /**
   * Puts pictures (imported PDF pages) one per board page, down from the first empty
   * page in the column on screen, into the current layer like any picture, and selects
   * them so they can be moved or cropped right away. One undo step removes them all.
   */
  async placePages(files: Blob[]) {
    const c = this.canvas
    const { w, h } = pageBox(this.sheet)
    const center = this.viewCenter()
    const col = Math.floor(center.x / w)
    const used = new Set(this.pagesWithContent().map((p) => p.join(',')))
    let row = Math.floor(center.y / h)
    while (used.has(`${col},${row}`)) row++
    const imgs: FabricImage[] = []
    for (const f of files) {
      const img = await FabricImage.fromURL(await downscale(f, 1800, 'image/jpeg'))
      imgs.push(img)
    }
    this.tx(() => {
      imgs.forEach((img, k) => {
        const s = Math.min(w / img.width, h / img.height)
        const cx = col * w + w / 2
        const cy = (row + k) * h + h / 2
        img.set({ left: cx, top: cy, originX: 'center', originY: 'center', scaleX: s, scaleY: s })
        c.add(img)
      })
    })
    this.setTool('select')
    this.reselect(imgs)
    // show the first imported page whole
    const zoom = Math.min(c.width / w, c.height / h) * 0.95
    this.lookAt(col * w + w / 2, row * h + h / 2, Math.min(5, Math.max(0.2, zoom)))
  }

  /**
   * Puts a whole board brought from elsewhere (Fabric JSON, its own pixels × `scale` = ours) into a free
   * column of pages to the right of everything, from the top, into the current layer. Sizes stay
   * true to the paper. One undo step removes it all. Returns how many objects came in.
   */
  async placeBoard(json: Record<string, unknown>[], scale: number): Promise<number> {
    const c = this.canvas
    const objs = (await util.enlivenObjects<FabricObject>(json)) as Obj[]
    if (!objs.length) return 0
    // group frames were measured with the other app's fonts: fit each group to what it holds now
    const refit = (o: FabricObject) => {
      if (o instanceof Group) {
        o.getObjects().forEach(refit)
        o.triggerLayout()
      }
    }
    objs.forEach(refit)
    const { w, h } = pageBox(this.sheet)
    const used = this.pagesWithContent()
    const col = used.length ? Math.max(...used.map((p) => p[0])) + 1 : 0
    let minX = 0
    let minY = 0
    for (const o of objs) {
      o.setCoords()
      const r = o.getBoundingRect()
      minX = Math.min(minX, r.left)
      minY = Math.min(minY, r.top)
    }
    this.canvas.discardActiveObject()
    this.tx(() => {
      for (const o of objs) {
        delete o.id // ours, fresh: the same board may be opened twice
        o.set({
          left: col * w + (o.left - minX) * scale,
          top: (o.top - minY) * scale,
          scaleX: o.scaleX * scale,
          scaleY: o.scaleY * scale,
        })
        o.setCoords()
        c.add(o)
      }
    })
    this.setTool('select')
    const zoom = Math.min(c.width / w, c.height / h) * 0.95
    this.lookAt(col * w + w / 2, h / 2, Math.min(5, Math.max(0.2, zoom)))
    return objs.length
  }

  // ---------- pictures ----------

  async addImage(file: Blob) {
    const url = await downscale(file, 1600)
    const img = await FabricImage.fromURL(url)
    const c = this.canvas
    const center = this.viewCenter()
    const vw = c.width / c.getZoom()
    const scale = Math.min(1, (vw * 0.6) / img.width)
    img.set({ left: center.x, top: center.y, originX: 'center', originY: 'center', scaleX: scale, scaleY: scale })
    c.add(img)
    this.setTool('select')
    c.setActiveObject(img)
  }

  get canCrop() {
    return !this.cropping && this.canvas.getActiveObject() instanceof FabricImage
  }

  get canUncrop() {
    const a = this.canvas.getActiveObject()
    return !this.cropping && a instanceof FabricImage && isCropped(a)
  }

  /** A frame over the selected picture; move and resize it, then finishCrop(true) */
  startCrop() {
    const c = this.canvas
    const img = c.getActiveObject()
    if (!(img instanceof FabricImage) || this.cropping) return
    c.discardActiveObject()
    const frame = cropFrame(img) as Obj
    frame._pending = true
    this.applying = true
    c.add(frame)
    this.applying = false
    c.forEachObject((o) => (o.evented = o === frame))
    frame.selectable = true
    this.cropping = { img, frame }
    c.setActiveObject(frame)
    c.requestRenderAll()
    this.onCrop()
  }

  finishCrop(apply: boolean) {
    const cr = this.cropping
    if (!cr) return
    const c = this.canvas
    this.cropping = null
    this.applying = true
    c.discardActiveObject()
    c.remove(cr.frame)
    this.applying = false
    if (apply) applyCrop(cr.img, cr.frame as unknown as Rect)
    c.forEachObject((o) => this.interactivity(o))
    if (this.tool === 'select') c.setActiveObject(cr.img)
    c.requestRenderAll()
    if (apply) this.commit(cr.img)
    this.onCrop()
  }

  uncropSelection() {
    const img = this.canvas.getActiveObject()
    if (!(img instanceof FabricImage)) return
    uncrop(img)
    this.canvas.requestRenderAll()
    this.commit(img)
  }

  // ---------- bookmarks ----------

  addBookmark(name: string) {
    const c = this.viewCenter()
    this.bookmarks.push({ id: newId(), name, x: c.x, y: c.y, z: this.canvas.getZoom() })
    this.bookmarksChanged()
  }

  removeBookmark(id: string) {
    this.bookmarks = this.bookmarks.filter((b) => b.id !== id)
    this.bookmarksChanged()
  }

  goTo(b: Bookmark) {
    this.lookAt(b.x, b.y, Math.min(5, Math.max(0.2, b.z)))
  }

  private bookmarksChanged() {
    this.onBookmarks()
    this.onOp({ op: 'bookmarks', list: this.bookmarks })
  }

  // ---------- sync ----------

  /** Full state of an object, in board coordinates even when it sits in a selection */
  private serialize(o: FabricObject): State {
    const plain = o.toObject(['id', 'locked'])
    if (o.group instanceof ActiveSelection) {
      const d = util.qrDecompose(o.calcTransformMatrix())
      const origin = o.translateToOriginPoint(new Point(d.translateX, d.translateY), o.originX, o.originY)
      Object.assign(plain, {
        left: origin.x,
        top: origin.y,
        angle: d.angle,
        scaleX: d.scaleX,
        scaleY: d.scaleY,
        skewX: d.skewX,
        skewY: 0,
        flipX: false,
        flipY: false,
      })
    }
    return plain
  }

  private find(id: string) {
    return this.canvas.getObjects().find((o) => (o as Obj).id === id) as Obj | undefined
  }

  private ids() {
    return (this.canvas.getObjects() as Obj[]).filter((o) => !o._pending && o.id).map((o) => o.id!)
  }

  snapshot(): Op {
    return {
      op: 'sync',
      objs: this.canvas.getObjects().filter((o) => !(o as Obj)._pending).map((o) => this.serialize(o)),
      sheet: this.sheet,
      bookmarks: this.bookmarks,
      layers: this.layers,
    }
  }

  setSheet(patch: Partial<Sheet>, send = true) {
    this.sheet = validSheet({ ...this.sheet, ...patch })
    this.updateView()
    this.onSheet()
    if (send) this.onOp({ op: 'sheet', sheet: this.sheet })
  }

  async apply(op: Op): Promise<void> {
    const c = this.canvas
    if (op.op === 'sheet') return this.setSheet(op.sheet, false)
    if (op.op === 'layers') {
      const list = validLayers(op.list)
      if (!list.length) return
      this.layers = list
      if (!list.some((l) => l.id === this.activeLayer)) this.activeLayer = list.at(-1)!.id
      return this.layersChanged(false)
    }
    if (op.op === 'bookmarks') {
      this.bookmarks = op.list.filter(validBookmark)
      return this.onBookmarks()
    }
    if (op.op === 'order') {
      const pos = new Map(op.ids.map((id, i) => [id, i]))
      const sorted = [...(c.getObjects() as Obj[])].sort((a, b) => (pos.get(a.id!) ?? 1e9) - (pos.get(b.id!) ?? 1e9))
      sorted.forEach((o, i) => c.moveObjectTo(o, i))
      this.resort()
    } else if (op.op === 'del') {
      const o = this.find(op.id)
      this.known.delete(op.id)
      if (!o) return
      if (c.getActiveObjects().includes(o)) c.discardActiveObject()
      this.applying = true
      c.remove(o)
      this.applying = false
    } else if (op.op === 'mod') {
      const o = this.find(op.obj.id)
      if (!o) return this.apply({ op: 'add', obj: op.obj })
      if (o instanceof IText && o.isEditing) return
      if (c.getActiveObjects().includes(o)) c.discardActiveObject()
      const props = { ...op.obj }
      for (const k of NOT_SYNCED_ON_MOD) delete props[k]
      const prevLayer = (o as Obj).layer
      o.set(props)
      if (o instanceof IText) {
        o.initDimensions()
        this.onFont(o)
      }
      o.setCoords()
      const layer = (o as Obj).layer
      if (layer !== prevLayer) c.moveObjectTo(o, this.layerTopIndex(layer ?? BASE_LAYER, o)) // moved to another layer
      this.interactivity(o)
      this.known.set(op.obj.id, { ...(this.known.get(op.obj.id) ?? {}), ...op.obj })
    } else {
      if (op.op === 'sync' && op.sheet) this.setSheet(op.sheet, false)
      if (op.op === 'sync' && op.layers) {
        // both sides may have made layers before meeting: keep mine, add theirs on top
        const have = new Set(this.layers.map((l) => l.id))
        const add = validLayers(op.layers).filter((l) => !have.has(l.id))
        this.layers.push(...add)
        if (add.length) this.layersChanged(false)
      }
      if (op.op === 'sync' && op.bookmarks?.length) {
        const have = new Set(this.bookmarks.map((b) => b.id))
        const add = op.bookmarks.filter((b) => validBookmark(b) && !have.has(b.id))
        if (add.length) {
          this.bookmarks.push(...add)
          this.onBookmarks()
        }
      }
      const list = op.op === 'add' ? [op.obj] : op.objs
      const fresh = list.filter((x) => x?.id && !this.find(x.id))
      if (!fresh.length) return
      const objs = await util.enlivenObjects<FabricObject>(fresh)
      this.applying = true
      for (const o of objs as Obj[]) {
        if (this.find(o.id!)) continue
        c.add(o)
        c.moveObjectTo(o, this.layerTopIndex(o.layer ?? BASE_LAYER, o))
        this.known.set(o.id!, this.serialize(o))
      }
      this.applying = false
    }
    c.requestRenderAll()
  }

  // ---------- view ----------

  sceneToScreen(x: number, y: number) {
    const v = this.canvas.viewportTransform
    return { x: v[0] * x + v[4], y: v[3] * y + v[5] }
  }

  viewCenter() {
    const c = this.canvas
    const v = c.viewportTransform
    return new Point((c.width / 2 - v[4]) / v[0], (c.height / 2 - v[5]) / v[3])
  }

  /** Shows board point (x, y) in the middle of the screen at the given zoom */
  lookAt(x: number, y: number, zoom: number) {
    const c = this.canvas
    c.setViewportTransform([zoom, 0, 0, zoom, c.width / 2 - x * zoom, c.height / 2 - y * zoom])
    this.updateView()
  }

  zoomBy(f: number) {
    const c = this.canvas
    const zoom = Math.min(5, Math.max(0.2, c.getZoom() * f))
    c.zoomToPoint(new Point(c.width / 2, c.height / 2), zoom)
    this.updateView()
  }

  resetZoom() {
    const c = this.canvas
    c.zoomToPoint(new Point(c.width / 2, c.height / 2), 1)
    this.updateView()
  }

  /** Shows a whole page (column, row) */
  goToPage(i: number, j: number) {
    const c = this.canvas
    const { w, h } = pageBox(this.sheet)
    const zoom = Math.min(5, Math.max(0.2, Math.min(c.width / w, c.height / h) * 0.95))
    this.lookAt(i * w + w / 2, j * h + h / 2, zoom)
  }

  /** Back to the start of the board: its top-left corner at 100% */
  home() {
    this.canvas.setViewportTransform([1, 0, 0, 1, 0, 0])
    this.updateView()
  }

  private resize() {
    this.canvas.setDimensions({ width: this.wrap.clientWidth, height: this.wrap.clientHeight })
    this.updateView()
  }

  private updateView() {
    drawPaper(this.paperEl, this.sheet, this.canvas.viewportTransform)
    this.onViewport()
  }
}

const POINTER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><circle cx="10" cy="10" r="6" fill="#ef4444" fill-opacity=".85" stroke="#fff" stroke-width="2"/></svg>',
)}") 10 10, crosshair`

function validLayers(list: unknown): Layer[] {
  if (!Array.isArray(list)) return []
  return list
    .filter((l) => l && typeof l.id === 'string' && typeof l.name === 'string')
    .map((l) => ({ id: l.id, name: String(l.name).slice(0, 40), locked: !!l.locked, studentHidden: !!l.studentHidden }))
}

function validBookmark(b: Bookmark) {
  return b && typeof b.id === 'string' && typeof b.name === 'string' && [b.x, b.y, b.z].every(Number.isFinite) && b.z > 0
}

function isCut(o: FabricObject) {
  return o.globalCompositeOperation === 'destination-out'
}

function snap15(o: { x: number; y: number }, p: Point) {
  const dx = p.x - o.x
  const dy = p.y - o.y
  const len = Math.hypot(dx, dy)
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12)
  return new Point(o.x + len * Math.cos(a), o.y + len * Math.sin(a))
}

async function downscale(file: Blob, max: number, as?: 'image/jpeg'): Promise<string> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const cv = document.createElement('canvas')
  cv.width = Math.round(bmp.width * k)
  cv.height = Math.round(bmp.height * k)
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height)
  const type = as ?? (file.type === 'image/png' ? 'image/png' : 'image/jpeg')
  let url = cv.toDataURL(type, 0.85)
  if (url.length > 1_500_000) url = cv.toDataURL('image/jpeg', 0.8) // big screenshots: png is wasteful
  return url
}

// The shared board. Every object carries an `id`; local changes go out as small
// ops (add / mod / del), remote ops are applied without echoing back.

import {
  ActiveSelection,
  Canvas,
  Ellipse,
  FabricImage,
  FabricObject,
  IText,
  Line,
  Path,
  PencilBrush,
  Point,
  Rect,
  Triangle,
  util,
  type TPointerEventInfo,
} from 'fabric'

FabricObject.customProperties = ['id']

export type Tool =
  | 'select'
  | 'hand'
  | 'pen'
  | 'marker'
  | 'eraser'
  | 'broom'
  | 'line'
  | 'arrow'
  | 'rect'
  | 'ellipse'
  | 'triangle'
  | 'text'

export type Op =
  | { op: 'add'; obj: any }
  | { op: 'mod'; obj: any }
  | { op: 'del'; id: string }
  | { op: 'sync'; objs: any[] }

type Obj = FabricObject & { id?: string; _pending?: boolean }

const GRID = 24
const SHAPE_TOOLS = new Set<Tool>(['line', 'arrow', 'rect', 'ellipse', 'triangle'])
const NOT_SYNCED_ON_MOD = ['type', 'version', 'src', 'path', 'objects', 'filters', 'crossOrigin']

export function newId() {
  const a = crypto.getRandomValues(new Uint8Array(9))
  return Array.from(a, (b) => (b % 36).toString(36)).join('')
}

function throttle<A extends unknown[]>(fn: (...a: A) => void, ms: number) {
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
  /** called for every local change that the other side must see */
  onOp: (op: Op) => void = () => {}
  onViewport: () => void = () => {}
  onCursor: (x: number, y: number) => void = () => {}
  onToolChange: (t: Tool) => void = () => {}

  private applying = false
  private draft: Obj | null = null
  private origin: Point | null = null
  private panning: { x: number; y: number } | null = null
  private erasing = false
  private spaceHand = false
  private myAdds: string[] = []

  constructor(
    el: HTMLCanvasElement,
    private wrap: HTMLElement,
  ) {
    const canvas = new Canvas(el, {
      preserveObjectStacking: true,
      selectionColor: 'rgba(37, 99, 235, 0.08)',
      selectionBorderColor: '#2563eb',
      fireRightClick: false,
    })
    this.canvas = canvas
    this.resize()
    window.addEventListener('resize', () => this.resize())

    canvas.on('object:added', ({ target }) => {
      const o = target as Obj
      o.id ??= newId()
      this.interactivity(o)
      if (this.applying || o._pending) return
      this.myAdds.push(o.id)
      this.onOp({ op: 'add', obj: this.serialize(o) })
    })
    // the eraser draws a stroke that cuts through everything under it: the grid (page background) shows through
    canvas.on('before:path:created', ({ path }) => {
      if (this.tool === 'eraser') path.set({ stroke: '#000', globalCompositeOperation: 'destination-out' })
    })
    canvas.on('object:removed', ({ target }) => {
      const o = target as Obj
      if (this.applying || o._pending || !o.id) return
      this.onOp({ op: 'del', id: o.id })
    })
    canvas.on('object:modified', ({ target }) => this.sendModified(target))
    const live = throttle((t: FabricObject) => this.sendModified(t), 80)
    canvas.on('object:moving', ({ target }) => live(target))
    canvas.on('object:scaling', ({ target }) => live(target))
    canvas.on('object:rotating', ({ target }) => live(target))
    canvas.on('text:changed', ({ target }) => live(target))
    canvas.on('text:editing:exited', ({ target }) => {
      if (!(target as IText).text.trim()) canvas.remove(target)
      else this.sendModified(target)
    })

    canvas.on('mouse:down', (e) => this.down(e))
    canvas.on('mouse:move', (e) => this.move(e))
    canvas.on('mouse:up', () => this.up())
    canvas.on('mouse:wheel', (e) => this.wheel(e))

    const cursor = throttle((x: number, y: number) => this.onCursor(x, y), 50)
    canvas.on('mouse:move', (e) => {
      const p = canvas.getScenePoint(e.e)
      cursor(p.x, p.y)
    })

    window.addEventListener('keydown', (e) => this.key(e, true))
    window.addEventListener('keyup', (e) => this.key(e, false))
    this.setTool('pen')
    this.updateGrid()
  }

  // ---------- tools ----------

  setTool(t: Tool) {
    this.tool = t
    const c = this.canvas
    if (t !== 'select') c.discardActiveObject()
    c.isDrawingMode = t === 'pen' || t === 'marker' || t === 'eraser'
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
    c.defaultCursor = t === 'hand' ? 'grab' : t === 'select' ? 'default' : t === 'text' ? 'text' : 'crosshair'
    c.hoverCursor = t === 'select' ? 'move' : t === 'broom' ? 'pointer' : c.defaultCursor
    c.forEachObject((o) => this.interactivity(o))
    c.requestRenderAll()
    this.onToolChange(t)
  }

  setColor(color: string) {
    this.color = color
    this.restyleSelection({ stroke: color }, { fill: color })
    this.setTool(this.tool)
  }

  setWidth(w: number) {
    this.width = w
    this.restyleSelection({ strokeWidth: w }, {})
    this.setTool(this.tool)
  }

  private restyleSelection(shape: Record<string, unknown>, text: Record<string, unknown>) {
    const sel = this.canvas.getActiveObjects()
    if (!sel.length) return
    for (const o of sel) {
      if (o instanceof IText) o.set(text)
      else if (o instanceof FabricImage) continue
      else o.set(shape)
    }
    this.canvas.requestRenderAll()
    this.sendModified(this.canvas.getActiveObject()!)
  }

  private markerColor() {
    const n = parseInt(this.color.slice(1), 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.35)`
  }

  private interactivity(o: FabricObject) {
    // eraser strokes are holes, not things: they can't be picked, moved or swept away
    if (isCut(o)) {
      o.selectable = false
      o.evented = false
      return
    }
    const select = this.tool === 'select'
    o.selectable = select
    o.evented = select || this.tool === 'broom'
  }

  // ---------- pointer ----------

  private down(e: TPointerEventInfo) {
    const c = this.canvas
    const ev = e.e as MouseEvent
    if (this.tool === 'hand' || this.spaceHand || ev.button === 1) {
      this.panning = { x: ev.clientX, y: ev.clientY }
      c.setCursor('grabbing')
      return
    }
    const p = c.getScenePoint(ev)
    if (this.tool === 'broom') {
      this.erasing = true
      if (e.target) c.remove(e.target)
      return
    }
    if (this.tool === 'text') {
      if (e.target instanceof IText) return
      const t = new IText('', {
        left: p.x,
        top: p.y - 14,
        originX: 'left',
        originY: 'top',
        fontSize: 28,
        fontFamily: 'Inter, system-ui, sans-serif',
        fill: this.color,
      })
      c.add(t)
      this.setTool('select')
      c.setActiveObject(t)
      t.enterEditing()
      return
    }
    if (!SHAPE_TOOLS.has(this.tool)) return
    this.origin = p
    const style = {
      stroke: this.color,
      strokeWidth: this.width,
      fill: 'transparent',
      strokeUniform: true,
      strokeLineCap: 'round' as const,
      originX: 'left' as const,
      originY: 'top' as const,
    }
    let d: Obj
    if (this.tool === 'line' || this.tool === 'arrow') d = new Line([p.x, p.y, p.x, p.y], style)
    else if (this.tool === 'rect') d = new Rect({ ...style, left: p.x, top: p.y, width: 0, height: 0 })
    else if (this.tool === 'ellipse') d = new Ellipse({ ...style, left: p.x, top: p.y, rx: 0, ry: 0 })
    else d = new Triangle({ ...style, left: p.x, top: p.y, width: 0, height: 0 })
    d._pending = true
    this.draft = d
    c.add(d)
  }

  private move(e: TPointerEventInfo) {
    const c = this.canvas
    const ev = e.e as MouseEvent
    if (this.panning) {
      c.relativePan(new Point(ev.clientX - this.panning.x, ev.clientY - this.panning.y))
      this.panning = { x: ev.clientX, y: ev.clientY }
      this.updateGrid()
      return
    }
    if (this.erasing && e.target) {
      c.remove(e.target)
      return
    }
    const d = this.draft
    const o = this.origin
    if (!d || !o) return
    let p = c.getScenePoint(ev)
    if (d instanceof Line) {
      if (ev.shiftKey) p = snap45(o, p)
      d.set({ x2: p.x, y2: p.y })
    } else {
      let w = p.x - o.x
      let h = p.y - o.y
      if (ev.shiftKey) {
        const s = Math.max(Math.abs(w), Math.abs(h))
        w = Math.sign(w || 1) * s
        h = Math.sign(h || 1) * s
      }
      const left = Math.min(o.x, o.x + w)
      const top = Math.min(o.y, o.y + h)
      if (d instanceof Ellipse) d.set({ left, top, rx: Math.abs(w) / 2, ry: Math.abs(h) / 2 })
      else d.set({ left, top, width: Math.abs(w), height: Math.abs(h) })
    }
    d.setCoords()
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
    const d = this.draft
    this.draft = null
    this.origin = null
    if (!d) return
    const tiny = d instanceof Line ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) < 3 : d.width * d.scaleX < 3 && d.height * d.scaleY < 3
    this.applying = true
    c.remove(d)
    this.applying = false
    if (tiny) return
    if (this.tool === 'arrow' && d instanceof Line) {
      const { x1, y1, x2, y2 } = d
      const a = Math.atan2(y2 - y1, x2 - x1)
      const head = 10 + this.width * 2.5
      const h1 = { x: x2 - head * Math.cos(a - 0.45), y: y2 - head * Math.sin(a - 0.45) }
      const h2 = { x: x2 - head * Math.cos(a + 0.45), y: y2 - head * Math.sin(a + 0.45) }
      c.add(
        new Path(`M ${x1} ${y1} L ${x2} ${y2} M ${h1.x} ${h1.y} L ${x2} ${y2} L ${h2.x} ${h2.y}`, {
          stroke: this.color,
          strokeWidth: this.width,
          fill: '',
          strokeLineCap: 'round',
          strokeLineJoin: 'round',
          strokeUniform: true,
        }),
      )
      return
    }
    d._pending = false
    c.add(d)
  }

  private wheel(e: TPointerEventInfo<WheelEvent>) {
    const ev = e.e
    ev.preventDefault()
    const c = this.canvas
    if (ev.ctrlKey || ev.metaKey) {
      const zoom = Math.min(5, Math.max(0.2, c.getZoom() * 0.999 ** ev.deltaY))
      c.zoomToPoint(new Point(ev.offsetX, ev.offsetY), zoom)
    } else c.relativePan(new Point(-ev.deltaX, -ev.deltaY))
    this.updateGrid()
  }

  zoomBy(f: number) {
    const c = this.canvas
    const zoom = Math.min(5, Math.max(0.2, c.getZoom() * f))
    c.zoomToPoint(new Point(c.width / 2, c.height / 2), zoom)
    this.updateGrid()
  }

  resetZoom() {
    const c = this.canvas
    c.zoomToPoint(new Point(c.width / 2, c.height / 2), 1)
    this.updateGrid()
  }

  private key(e: KeyboardEvent, down: boolean) {
    const active = this.canvas.getActiveObject()
    const typing = (active instanceof IText && active.isEditing) || (e.target as HTMLElement).closest?.('input, textarea')
    if (typing) return
    if (e.code === 'Space') {
      e.preventDefault()
      if (this.spaceHand !== down) {
        this.spaceHand = down
        this.canvas.setCursor(down ? 'grab' : this.canvas.defaultCursor)
      }
      return
    }
    if (!down) return
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.canvas.getActiveObjects().length) {
      e.preventDefault()
      const objs = this.canvas.getActiveObjects()
      this.canvas.discardActiveObject()
      this.canvas.remove(...objs)
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault()
      this.undo()
    } else if (e.key === 'Escape') {
      this.canvas.discardActiveObject()
      this.canvas.requestRenderAll()
    }
  }

  /** Undo removes my own most recent object that still exists. */
  undo() {
    while (this.myAdds.length) {
      const id = this.myAdds.pop()!
      const o = this.find(id)
      if (o) {
        this.canvas.remove(o)
        this.canvas.requestRenderAll()
        return
      }
    }
  }

  // ---------- pictures ----------

  async addImage(file: Blob) {
    const url = await downscale(file, 1600)
    const img = await FabricImage.fromURL(url)
    const c = this.canvas
    const center = c.getScenePoint({ clientX: c.width / 2, clientY: c.height / 2 } as MouseEvent)
    const vw = c.width / c.getZoom()
    const scale = Math.min(1, (vw * 0.6) / img.width)
    img.set({ left: center.x, top: center.y, originX: 'center', originY: 'center', scaleX: scale, scaleY: scale })
    c.add(img)
    this.setTool('select')
    c.setActiveObject(img)
  }

  // ---------- sync ----------

  private serialize(o: FabricObject) {
    return o.toObject(['id'])
  }

  private find(id: string) {
    return this.canvas.getObjects().find((o) => (o as Obj).id === id) as Obj | undefined
  }

  private sendModified(target: FabricObject) {
    if (this.applying || !target) return
    if (target instanceof ActiveSelection) {
      // objects inside a selection have coordinates relative to it; send absolute ones
      for (const o of target.getObjects()) {
        const m = o.calcTransformMatrix()
        const d = util.qrDecompose(m)
        const plain = this.serialize(o)
        const origin = o.translateToOriginPoint(new Point(d.translateX, d.translateY), o.originX, o.originY)
        Object.assign(plain, { left: origin.x, top: origin.y, angle: d.angle, scaleX: d.scaleX, scaleY: d.scaleY, skewX: d.skewX, skewY: 0, flipX: false, flipY: false })
        this.onOp({ op: 'mod', obj: plain })
      }
      return
    }
    if ((target as Obj)._pending || !(target as Obj).id) return
    this.onOp({ op: 'mod', obj: this.serialize(target) })
  }

  snapshot(): Op {
    return { op: 'sync', objs: this.canvas.getObjects().filter((o) => !(o as Obj)._pending).map((o) => this.serialize(o)) }
  }

  async apply(op: Op): Promise<void> {
    const c = this.canvas
    if (op.op === 'del') {
      const o = this.find(op.id)
      if (!o) return
      if (c.getActiveObjects().includes(o)) c.discardActiveObject()
      this.applying = true
      c.remove(o)
      this.applying = false
    } else if (op.op === 'mod') {
      const o = this.find(op.obj.id)
      if (!o) return this.apply({ op: 'add', obj: op.obj })
      if (o instanceof IText && o.isEditing) return
      if (c.getActiveObject() instanceof ActiveSelection && c.getActiveObjects().includes(o)) c.discardActiveObject()
      const props = { ...op.obj }
      for (const k of NOT_SYNCED_ON_MOD) delete props[k]
      o.set(props)
      o.setCoords()
    } else {
      const list = op.op === 'add' ? [op.obj] : op.objs
      const fresh = list.filter((x) => x?.id && !this.find(x.id))
      if (!fresh.length) return
      const objs = await util.enlivenObjects<FabricObject>(fresh)
      this.applying = true
      for (const o of objs) if (!this.find((o as Obj).id!)) c.add(o)
      this.applying = false
    }
    c.requestRenderAll()
  }

  // ---------- view ----------

  sceneToScreen(x: number, y: number) {
    const v = this.canvas.viewportTransform
    return { x: v[0] * x + v[4], y: v[3] * y + v[5] }
  }

  private resize() {
    this.canvas.setDimensions({ width: this.wrap.clientWidth, height: this.wrap.clientHeight })
    this.updateGrid()
  }

  private updateGrid() {
    const v = this.canvas.viewportTransform
    const size = GRID * v[0]
    this.wrap.style.backgroundSize = `${size}px ${size}px, ${size}px ${size}px, ${size * 5}px ${size * 5}px, ${size * 5}px ${size * 5}px`
    this.wrap.style.backgroundPosition = `${v[4]}px ${v[5]}px`
    this.onViewport()
  }
}

function isCut(o: FabricObject) {
  return o.globalCompositeOperation === 'destination-out'
}

function snap45(o: Point, p: Point) {
  const dx = p.x - o.x
  const dy = p.y - o.y
  const len = Math.hypot(dx, dy)
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12) // 15° steps
  return new Point(o.x + len * Math.cos(a), o.y + len * Math.sin(a))
}

async function downscale(file: Blob, max: number): Promise<string> {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const cv = document.createElement('canvas')
  cv.width = Math.round(bmp.width * k)
  cv.height = Math.round(bmp.height * k)
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height)
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg'
  let url = cv.toDataURL(type, 0.85)
  if (url.length > 1_500_000) url = cv.toDataURL('image/jpeg', 0.8) // big screenshots: png is wasteful
  return url
}

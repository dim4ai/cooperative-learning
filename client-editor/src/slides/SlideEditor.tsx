// Editor of one slide: Fabric canvas + toolbar + properties + layers panel.
// The scene is loaded once on mount (keyed by slide id) and emitted upward on
// every change; Fabric owns the live state in between.
import { useEffect, useRef, useState } from 'react'
import { ActiveSelection, Canvas, Ellipse, FabricImage, Group, PencilBrush, Point, Polygon, Polyline, Rect, Textbox, type FabricObject, type TPointerEventInfo } from 'fabric'
import type { Scene, SceneObject } from '../types'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../types'
import { uniqueName, type Media } from '../lessonFile'
import { pickMediaFiles } from '../fileAccess'
import { nanoid } from '../nanoid'
import {
  backgroundSlide, enliven, fitToWidth, imageObject, imageSize, mediaResolver, pageOf, serialize, toSceneObject, type Obj, type Page,
} from './scene'
import { DEFAULT_PAPER_COLOR, PAPERS, applyPaper } from './paper'
import {
  DEFAULT_MARK_STYLE, LINE_MARKS, MARKS, MORPHEME_MARKS, SENTENCE_MARKS, SHAPES, buildMark, buildShape, markHeight,
  type MarkKind, type MarkStyle, type ShapeKind,
} from './marks'
import { ColorField, ToolMenu, screenPipette, type PickColor } from './controls'
import { applyCrop, cropFrame, isCropped, uncrop } from './crop'
import { loadInto } from './render'
import { mapObjects, normalizeLayers, type SlideLayer } from './model'
import { CLIP_MIME, getClip, setClip } from './clipboard'

interface Props {
  scene: Scene
  media: Media
  onAddMedia: (name: string, blob: Blob) => void
  onChange: (scene: Scene) => void
  onError: (text: string) => void
  /** New slides to insert right after this one (multi-page PDF) */
  onInsertSlides: (scenes: Scene[]) => void
}

const HISTORY_LIMIT = 100
const PASTE_OFFSET = 24

export function SlideEditor(props: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fcRef = useRef<Canvas | null>(null)
  const [objects, setObjects] = useState<Obj[]>([])
  // Layers of the slide (bottom → top); part of the scene, so changes go through undo too
  const layersRef = useRef<SlideLayer[]>(normalizeLayers(props.scene).layers!)
  const [activeLayer, setActiveLayer] = useState<string>(() => topEditable(layersRef.current)?.id ?? layersRef.current[0].id)
  const activeLayerRef = useRef(activeLayer)
  activeLayerRef.current = activeLayer
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [active, setActive] = useState<Obj[]>([])
  const [, force] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  // Freehand drawing: pencil or translucent marker (Shift — straight line)
  const [drawing, setDrawing] = useState<null | 'pencil' | 'marker'>(null)
  const [brushes, setBrushes] = useState({ pencil: { color: '#1d4ed8', width: 6 }, marker: { color: '#facc15', width: 24 } })
  // Drawn-by-drag tool (lines, marks, axes), polygon by points, or the slide pipette
  const [tool, setTool] = useState<null | MarkKind | 'polygon' | 'pipette'>(null)
  const [markStyle, setMarkStyle] = useState<MarkStyle>(DEFAULT_MARK_STYLE)
  const pipetteDone = useRef<((c: string | null) => void) | null>(null)
  const [cropping, setCropping] = useState<{ img: FabricImage; frame: Rect } | null>(null)
  const pageRef = useRef<Page>(pageOf(props.scene))
  const [dropping, setDropping] = useState(false)

  // Latest props for Fabric/window handlers
  const live = useRef(props)
  live.current = props
  const media = useRef<Media>(props.media) // also updated synchronously when we add media
  media.current = { ...media.current, ...props.media }

  // Mutation bookkeeping
  const muted = useRef(1) // >0: Fabric events are ours (load/undo/batch), don't record; starts muted until loaded
  const history = useRef<{ past: string[]; now: string; future: string[] }>({ past: [], now: '', future: [] })
  const emitTimer = useRef<number | undefined>(undefined)
  const pendingEmit = useRef(false)

  const sceneId = props.scene.id

  function refresh() {
    const fc = fcRef.current
    if (!fc) return
    setObjects(fc.getObjects().filter(o => !o.excludeFromExport) as Obj[])
    const sel = fc.getActiveObjects() as Obj[]
    setActive(sel)
    if (sel[0]?.layer && sel[0].layer !== activeLayerRef.current) setActiveLayer(sel[0].layer)
    force(n => n + 1)
  }

  function emitNow() {
    clearTimeout(emitTimer.current)
    if (!pendingEmit.current || !fcRef.current) return
    pendingEmit.current = false
    live.current.onChange(serialize(fcRef.current, sceneId, layersRef.current, pageRef.current))
  }

  function scheduleEmit() {
    pendingEmit.current = true
    clearTimeout(emitTimer.current)
    emitTimer.current = window.setTimeout(emitNow, 300)
  }

  /** Snapshot for undo, if the scene actually changed */
  function record() {
    const fc = fcRef.current
    if (!fc) return
    const snap = JSON.stringify(serialize(fc, sceneId, layersRef.current, pageRef.current))
    const h = history.current
    if (snap === h.now) return
    h.past.push(h.now)
    if (h.past.length > HISTORY_LIMIT) h.past.shift()
    h.now = snap
    h.future = []
  }

  /** Something changed on the canvas (user action) */
  function changed(opts: { record?: boolean } = {}) {
    refresh()
    if (opts.record !== false) record()
    scheduleEmit()
  }

  /** Run several canvas mutations as one undo step */
  async function batch(fn: () => void | Promise<void>) {
    muted.current++
    try {
      await fn()
    } finally {
      muted.current--
    }
    fcRef.current?.requestRenderAll()
    changed()
  }

  // Restores run strictly one after another: loadFromJSON is async and two
  // overlapping loads (fast Ctrl+Z Ctrl+Z) would interleave objects
  const restoreChain = useRef(Promise.resolve())
  function restore(snap: string) {
    restoreChain.current = restoreChain.current.then(() => doRestore(snap)).catch(e => {
      live.current.onError(`Не удалось отменить: ${(e as Error).message}`)
    })
  }

  async function doRestore(snap: string) {
    const fc = fcRef.current
    if (!fc) return
    muted.current++
    try {
      fc.discardActiveObject()
      const scene = JSON.parse(snap) as Scene
      layersRef.current = scene.layers!
      pageRef.current = pageOf(scene)
      if (!scene.layers!.some(l => l.id === activeLayerRef.current)) setActiveLayer(topEditable(scene.layers!)?.id ?? scene.layers![0].id)
      const objs = await loadInto(fc, scene, mediaResolver(media.current))
      objs.forEach(applyEditorFlags)
      fc.requestRenderAll()
    } finally {
      muted.current--
    }
    refresh()
    scheduleEmit()
  }

  function undo() {
    const h = history.current
    const prev = h.past.pop()
    if (prev === undefined) return
    h.future.push(h.now)
    h.now = prev
    restore(prev)
  }

  function redo() {
    const h = history.current
    const next = h.future.pop()
    if (next === undefined) return
    h.past.push(h.now)
    h.now = next
    restore(next)
  }

  // ---------- mount ----------
  useEffect(() => {
    // Element created here, not in JSX: Fabric wraps it in its own DOM, which
    // must not be shared between StrictMode's double mount.
    const el = document.createElement('canvas')
    hostRef.current!.appendChild(el)
    const fc = new Canvas(el, {
      width: SLIDE_WIDTH, height: SLIDE_HEIGHT, preserveObjectStacking: true, backgroundColor: props.scene.background,
    })
    fcRef.current = fc
    if (import.meta.env.DEV) (window as unknown as { __fc: Canvas }).__fc = fc // for e2e tests
    const abort = new AbortController()

    loadInto(fc, normalizeLayers(props.scene), mediaResolver(media.current), abort.signal).then(objs => {
      if (abort.signal.aborted) return
      objs.forEach(applyEditorFlags)
      fc.requestRenderAll()
      history.current = { past: [], now: JSON.stringify(serialize(fc, sceneId, layersRef.current, pageRef.current)), future: [] }
      muted.current = 0
      refresh()
    }).catch(e => {
      if (abort.signal.aborted) return // unmounted while loading (StrictMode double mount, fast switch)
      muted.current = 0
      live.current.onError(`Слайд не загрузился: ${(e as Error).message}`)
    })

    const onMutate = () => { if (!muted.current) changed() }
    fc.on('object:added', onMutate)
    fc.on('object:removed', onMutate)
    fc.on('object:modified', e => {
      if (muted.current) return
      const o = e.target as Obj
      if (o?.mark && (Math.abs(o.scaleX) !== 1 || Math.abs(o.scaleY) !== 1)) rebuildMark(o)
      else changed()
    })
    fc.on('text:changed', () => { if (!muted.current) changed({ record: false }) }) // one undo step per edit session…
    fc.on('text:editing:exited', () => { if (!muted.current) changed() })           // …recorded when editing ends
    fc.on('before:path:created', e => { const p = e.path as Obj; p.uid = nanoid(); p.layer = targetLayer() })
    fc.on('path:created', e => {
      // Fabric added the drawing on top of everything; put it on top of its layer instead
      const p = e.path as Obj
      muted.current++
      try { fc.moveObjectTo(p, layerTopIndex(p.layer!, p)) } finally { muted.current-- }
      const h = history.current
      h.now = JSON.stringify(serialize(fc, sceneId, layersRef.current, pageRef.current)) // same undo step as the drawing
      refresh()
      scheduleEmit()
    })
    fc.on('selection:created', refresh)
    fc.on('selection:updated', refresh)
    fc.on('selection:cleared', refresh)

    // As wide as the column, but no taller than the window: the slide with its toolbars fits the screen
    const host = hostRef.current!
    const column = host.parentElement!
    const fit = () => {
      const above = host.offsetTop - column.offsetTop // toolbars over the slide
      const maxH = Math.max(320, window.innerHeight - above - 24)
      const w = Math.floor(Math.min(column.clientWidth, (maxH * SLIDE_WIDTH) / SLIDE_HEIGHT))
      host.style.width = w + 'px'
      fitToWidth(fc, w - 2) // minus the host's border
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(column)
    window.addEventListener('resize', fit)

    return () => {
      abort.abort()
      ro.disconnect()
      window.removeEventListener('resize', fit)
      emitNow()
      fcRef.current = null
      fc.dispose().finally(() => { fc.elements?.container?.remove(); el.remove() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- keyboard & clipboard ----------
  useEffect(() => {
    const isFormTarget = (t: EventTarget | null) =>
      t instanceof HTMLElement && !!t.closest('input, textarea, select, [contenteditable=true]')

    const onKey = (e: KeyboardEvent) => {
      const fc = fcRef.current
      if (!fc || isFormTarget(e.target)) return // includes Fabric's hidden textarea while editing text
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      const sel = fc.getActiveObjects() as Obj[]

      if (mod && key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) { e.preventDefault(); redo() }
      else if (mod && key === 'd' && sel.length) { e.preventDefault(); duplicate() }
      else if (mod && key === 'a') { e.preventDefault(); selectAll() }
      else if (mod && key === 'g' && e.shiftKey) { e.preventDefault(); ungroupSelection() }
      else if (mod && key === 'g') { e.preventDefault(); groupSelection() }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) { e.preventDefault(); removeObjects(sel) }
      else if (e.key === 'Escape') {
        setDrawingMode(null); setTool(null); cancelCrop()
        fc.discardActiveObject(); fc.requestRenderAll(); refresh()
      }
      else if (e.key.startsWith('Arrow') && sel.length) {
        e.preventDefault()
        const step = e.shiftKey ? 10 : 1
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
        const target = fc.getActiveObject()!
        target.set({ left: target.left + dx, top: target.top + dy })
        target.setCoords()
        fc.requestRenderAll()
        changed()
      }
    }

    const onCopy = (e: ClipboardEvent, cut: boolean) => {
      const fc = fcRef.current
      if (!fc || isFormTarget(e.target)) return
      const sel = fc.getActiveObjects() as Obj[]
      if (!sel.length) return
      e.preventDefault()
      const id = setClip(serializeSelection(fc), media.current)
      e.clipboardData?.setData(CLIP_MIME, id)
      e.clipboardData?.setData('text/plain', sel.filter(o => o instanceof Textbox).map(o => (o as Textbox).text).join('\n'))
      if (cut) removeObjects(sel)
    }
    const copy = (e: ClipboardEvent) => onCopy(e, false)
    const cut = (e: ClipboardEvent) => onCopy(e, true)

    const onPaste = (e: ClipboardEvent) => {
      if (!fcRef.current || isFormTarget(e.target) || !e.clipboardData) return
      const ours = e.clipboardData.getData(CLIP_MIME)
      const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'))
      const text = e.clipboardData.getData('text/plain')
      if (ours && getClip(ours)) { e.preventDefault(); pasteClip(ours) }
      else if (files.length) { e.preventDefault(); addFiles(files) }
      else if (text.trim()) { e.preventDefault(); addText(text.trim()) }
    }

    window.addEventListener('keydown', onKey)
    document.addEventListener('copy', copy)
    document.addEventListener('cut', cut)
    document.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKey)
      document.removeEventListener('copy', copy)
      document.removeEventListener('cut', cut)
      document.removeEventListener('paste', onPaste)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------- operations ----------

  /** Selected objects as scene JSON with absolute coordinates (ActiveSelection makes them group-relative) */
  function serializeSelection(fc: Canvas): SceneObject[] {
    const sel = fc.getActiveObject()
    if (sel instanceof ActiveSelection) {
      fc.discardActiveObject() // returns children to canvas coordinates
      const out = (sel.getObjects() as Obj[]).map(toSceneObject)
      fc.setActiveObject(new ActiveSelection(sel.getObjects(), { canvas: fc }))
      fc.requestRenderAll()
      return out
    }
    return sel ? [toSceneObject(sel)] : []
  }

  async function insertObjects(objects: SceneObject[], offset: number) {
    const fc = fcRef.current!
    const fresh = objects.map(o => ({
      ...o, uid: nanoid(), pinned: undefined,
      left: (o.left as number) + offset, top: (o.top as number) + offset,
    }))
    const objs = await enliven(fresh, media.current)
    const fallback = targetLayer()
    await batch(() => {
      fc.discardActiveObject()
      for (const o of objs) {
        // same layer when duplicating within the slide, otherwise the current one
        if (!o.layer || !layerOf(o) || layerOf(o)!.locked) o.layer = fallback
        applyEditorFlags(o)
        fc.insertAt(layerTopIndex(o.layer!), o)
      }
      selectObjects(objs)
    })
  }

  function duplicate() {
    const fc = fcRef.current!
    insertObjects(serializeSelection(fc), PASTE_OFFSET)
  }

  function pasteClip(id: string) {
    const clip = getClip(id)
    if (!clip) return
    // Bring media along (another lesson, or since-deleted object); rename on clash
    const rename: Record<string, string> = {}
    for (const [name, blob] of Object.entries(clip.media)) {
      if (media.current[name] === blob) continue
      const fresh = uniqueName(name, media.current)
      rename[name] = fresh
      addMedia(fresh, blob)
    }
    const objects = mapObjects(clip.objects, o => (o.mediaName && rename[o.mediaName] ? { ...o, mediaName: rename[o.mediaName] } : o))
    insertObjects(objects, PASTE_OFFSET)
  }

  function addMedia(name: string, blob: Blob) {
    media.current = { ...media.current, [name]: blob } // visible before the parent rerenders
    live.current.onAddMedia(name, blob)
  }

  function selectObjects(objs: FabricObject[]) {
    const fc = fcRef.current!
    const selectable = objs.filter(o => o.selectable)
    if (selectable.length === 1) fc.setActiveObject(selectable[0])
    else if (selectable.length > 1) fc.setActiveObject(new ActiveSelection(selectable, { canvas: fc }))
  }

  function selectAll() {
    const fc = fcRef.current!
    fc.discardActiveObject()
    selectObjects(fc.getObjects())
    fc.requestRenderAll()
    refresh()
  }

  function add(obj: Obj, name?: string) {
    const fc = fcRef.current!
    setDrawingMode(null)
    obj.uid = nanoid()
    obj.layer = targetLayer()
    if (name) obj.name = name
    fc.insertAt(layerTopIndex(obj.layer), obj) // → object:added → recorded
    fc.setActiveObject(obj)
    fc.requestRenderAll()
    refresh()
  }

  /** A ready object (drawn mark, polygon) into the target layer; select it unless a tool stays active */
  function addShapeObject(obj: Obj, name?: string, select = true) {
    const fc = fcRef.current!
    obj.uid = nanoid()
    obj.layer = targetLayer()
    if (name) obj.name = name
    applyEditorFlags(obj)
    fc.insertAt(layerTopIndex(obj.layer), obj) // → object:added → recorded
    if (select) fc.setActiveObject(obj)
    fc.requestRenderAll()
    refresh()
  }

  function addText(text = 'Текст') {
    add(new Textbox(text, {
      left: SLIDE_WIDTH / 2, top: SLIDE_HEIGHT / 2, width: Math.min(1200, Math.max(300, text.length * 28)),
      fontSize: 56, fontFamily: 'sans-serif', fill: '#1a1a1a', textAlign: 'center',
    }) as Obj)
  }

  const shapeStyle = { ...SHAPE_PAINT, left: SLIDE_WIDTH / 2, top: SLIDE_HEIGHT / 2 }
  const addShape = (k: ShapeKind) => add(buildShape(k, shapeStyle) as Obj, SHAPES[k].label)
  const addRect = () => add(new Rect({ ...shapeStyle, width: 320, height: 200, rx: 12, ry: 12 }) as Obj)
  const addEllipse = () => add(new Ellipse({ ...shapeStyle, rx: 140, ry: 140 }) as Obj)
  const addArrow = () => add(new Polygon(
    [{ x: 0, y: 30 }, { x: 220, y: 30 }, { x: 220, y: 0 }, { x: 300, y: 60 }, { x: 220, y: 120 }, { x: 220, y: 90 }, { x: 0, y: 90 }],
    { ...shapeStyle, fill: '#fde68a', stroke: '#b45309' },
  ) as Obj, 'Стрелка')

  async function addFiles(files: File[]) {
    const fc = fcRef.current!
    const newSlides: Scene[] = []
    try {
      for (const f of files) {
        if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
          setBusy('Читаю PDF…')
          const { pdfPageCount, renderPdfPages } = await import('../pdf') // ~1 MB, load on demand
          const n = await pdfPageCount(f)
          let pages = [1]
          if (n > 1) {
            const answer = prompt(
              `В «${f.name}» ${n} стр.\n\n• номер страницы — вставить её на этот слайд\n• «все» — каждая страница станет отдельным слайдом`,
              'все',
            )
            if (answer === null) continue
            pages = /^\s*в/i.test(answer)
              ? Array.from({ length: n }, (_, i) => i + 1)
              : [Math.min(n, Math.max(1, parseInt(answer, 10) || 1))]
          }
          const stem = f.name.replace(/\.pdf$/i, '')
          const rendered = await renderPdfPages(f, pages, (done) => setBusy(`Страница ${done} из ${pages.length}…`))
          for (let i = 0; i < rendered.length; i++) {
            const png = rendered[i]
            const name = uniqueName(n > 1 ? `${stem} — стр. ${pages[i]}.png` : `${stem}.png`, media.current)
            addMedia(name, png)
            const size = await imageSize(png)
            // First page goes onto this slide if it is empty (or a single page was asked for)
            if (i === 0 && (pages.length === 1 || fc.getObjects().length === 0)) {
              await addImageObject(imageObject(name, size, fc.getObjects().length === 0))
            } else {
              newSlides.push(backgroundSlide(imageObject(name, size, true)))
            }
          }
        } else if (f.type.startsWith('image/')) {
          setBusy('Добавляю…')
          const name = uniqueName(f.name || 'картинка.png', media.current)
          addMedia(name, f)
          await addImageObject(imageObject(name, await imageSize(f), fc.getObjects().length === 0))
        } else {
          live.current.onError(`«${f.name}»: на слайд можно добавить картинку или PDF`)
        }
      }
      if (newSlides.length) live.current.onInsertSlides(newSlides)
    } catch (e) {
      live.current.onError(`Не удалось добавить: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  async function addImageObject(json: SceneObject) {
    // A picture filling an empty slide is its background: the bottom layer
    const bottom = layersRef.current[0]
    const asBackground = !!json.pinned && layersRef.current.length > 1
    const layer = asBackground ? bottom.id : targetLayer()
    const [img] = await enliven([{ ...json, layer, pinned: asBackground && bottom.locked ? undefined : json.pinned }], media.current)
    applyEditorFlags(img)
    const fc = fcRef.current!
    setDrawingMode(null)
    fc.insertAt(layerTopIndex(layer), img)
    if (img.selectable) fc.setActiveObject(img)
    fc.requestRenderAll()
    refresh()
  }

  function removeObjects(objs: FabricObject[]) {
    const fc = fcRef.current!
    batch(() => {
      fc.discardActiveObject()
      fc.remove(...objs)
    })
  }

  /** Selected objects → one group, at the place (z-order) of the lowest of them */
  function groupSelection() {
    const fc = fcRef.current!
    const order = fc.getObjects()
    const sel = (fc.getActiveObjects() as Obj[]).slice().sort((a, b) => order.indexOf(a) - order.indexOf(b))
    if (sel.length < 2) return
    batch(() => {
      const index = order.indexOf(sel[0])
      fc.discardActiveObject() // children back to canvas coordinates
      fc.remove(...sel)
      const all = (f: 'studentHidden' | 'studentDraggable') => sel.every(o => o[f]) || undefined
      const flags = { studentHidden: all('studentHidden'), studentDraggable: all('studentDraggable') }
      for (const o of sel) { o.studentHidden = undefined; o.studentDraggable = undefined; o.pinned = undefined; applyEditorFlags(o) }
      const g = new Group(sel) as Obj
      Object.assign(g, { uid: nanoid(), layer: sel[0].layer }, flags)
      applyEditorFlags(g)
      fc.insertAt(index, g)
      fc.setActiveObject(g)
    })
  }

  /** Group → its objects, in place; they inherit the group's flags */
  function ungroupSelection() {
    const fc = fcRef.current!
    const g = fc.getActiveObject()
    if (!(g instanceof Group) || g instanceof ActiveSelection) return
    batch(() => {
      const index = fc.getObjects().indexOf(g)
      fc.discardActiveObject()
      const items = g.removeAll() as Obj[] // applies the group's transform: absolute coordinates
      fc.remove(g)
      for (const o of items) {
        o.layer = (g as Obj).layer
        if ((g as Obj).studentHidden) o.studentHidden = true
        if ((g as Obj).studentDraggable) o.studentDraggable = true
        applyEditorFlags(o)
      }
      fc.insertAt(index, ...items)
      selectObjects(items)
    })
  }

  function select(obj: Obj) {
    const fc = fcRef.current!
    if (!obj.selectable) return
    setDrawingMode(null)
    fc.setActiveObject(obj)
    fc.requestRenderAll()
    refresh()
  }

  /** Z-order: one step up/down, or to the very top/bottom */
  function move(obj: Obj, to: 'up' | 'down' | 'top' | 'bottom') {
    // Within the object's layer: layers decide what is above what
    const fc = fcRef.current!
    const all = fc.getObjects()
    const mates = all.filter(o => (o as Obj).layer === obj.layer)
    const i = mates.indexOf(obj)
    const j = to === 'up' ? i + 1 : to === 'down' ? i - 1 : to === 'top' ? mates.length - 1 : 0
    if (j < 0 || j >= mates.length || j === i) return
    fc.moveObjectTo(obj, all.indexOf(mates[j]))
    fc.requestRenderAll()
    changed()
  }

  // ---------- layers ----------

  function layerOf(o: Obj): SlideLayer | undefined {
    return layersRef.current.find(l => l.id === o.layer)
  }

  /** Canvas index right above the last object of the layer (`except` — an object being moved) */
  function layerTopIndex(layerId: string, except?: FabricObject): number {
    const order = new Map(layersRef.current.map((l, i) => [l.id, i]))
    const k = order.get(layerId) ?? Infinity
    const all = fcRef.current!.getObjects().filter(o => o !== except)
    let at = 0
    all.forEach((o, i) => { if ((order.get((o as Obj).layer ?? '') ?? Infinity) <= k) at = i + 1 })
    return at
  }

  /** Layer new objects go to: the active one if it can be edited, otherwise the top editable one (created if none) */
  function targetLayer(): string {
    const ls = layersRef.current
    const act = ls.find(l => l.id === activeLayerRef.current)
    if (act && !act.locked && !act.editorHidden) return act.id
    let t = topEditable(ls)
    if (!t) {
      t = { id: 'L' + nanoid(), name: nextLayerName(ls) }
      layersRef.current = [...ls, t]
    }
    activeLayerRef.current = t.id
    setActiveLayer(t.id)
    return t.id
  }

  /** Objects sorted by layer again (after layers were reordered) */
  function resort() {
    const fc = fcRef.current!
    const order = new Map(layersRef.current.map((l, i) => [l.id, i]))
    const sorted = fc.getObjects().map((o, i) => ({ o, i }))
      .sort((a, b) => (order.get((a.o as Obj).layer ?? '') ?? 0) - (order.get((b.o as Obj).layer ?? '') ?? 0) || a.i - b.i)
    sorted.forEach(({ o }, i) => fc.moveObjectTo(o, i))
  }

  function setLayers(next: SlideLayer[]) {
    layersRef.current = next
    const fc = fcRef.current!
    batch(() => {
      resort()
      for (const o of fc.getObjects() as Obj[]) applyEditorFlags(o)
      const sel = fc.getActiveObjects()
      if (sel.some(o => !o.selectable || !o.visible)) fc.discardActiveObject()
    })
  }

  function addLayer() {
    const ls = layersRef.current
    const fresh: SlideLayer = { id: 'L' + nanoid(), name: nextLayerName(ls) }
    const at = Math.max(0, ls.findIndex(l => l.id === activeLayer)) + 1
    setLayers([...ls.slice(0, at), fresh, ...ls.slice(at)])
    setActiveLayer(fresh.id)
    setRenaming(fresh.id)
  }

  function patchLayer(id: string, patch: Partial<SlideLayer>) {
    setLayers(layersRef.current.map(l => (l.id === id ? { ...l, ...patch } : l)))
  }

  /** dir +1 — up (drawn above), -1 — down */
  function moveLayer(id: string, dir: 1 | -1) {
    const ls = [...layersRef.current]
    const i = ls.findIndex(l => l.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ls.length) return
    ;[ls[i], ls[j]] = [ls[j], ls[i]]
    setLayers(ls)
  }

  function deleteLayer(id: string) {
    const ls = layersRef.current
    if (ls.length < 2) return
    const l = ls.find(x => x.id === id)!
    const fc = fcRef.current!
    const inside = fc.getObjects().filter(o => (o as Obj).layer === id)
    if (inside.length && !confirm(`Удалить слой «${l.name}» вместе с объектами (${inside.length})?`)) return
    layersRef.current = ls.filter(x => x.id !== id)
    if (activeLayer === id) setActiveLayer(topEditable(layersRef.current)?.id ?? layersRef.current[0].id)
    batch(() => { fc.discardActiveObject(); if (inside.length) fc.remove(...inside) })
  }

  /** Move objects to another layer (on top of it) */
  function toLayer(objs: Obj[], id: string) {
    const fc = fcRef.current!
    batch(() => {
      fc.discardActiveObject()
      for (const o of objs) {
        o.layer = id
        fc.moveObjectTo(o, layerTopIndex(id, o))
        applyEditorFlags(o)
      }
      selectObjects(objs)
    })
    setActiveLayer(id)
  }

  /** Editor-side interactivity derived from our flags and the object's layer */
  function applyEditorFlags(o: Obj) {
    const l = layerOf(o)
    const shown = !l?.editorHidden
    const locked = !!o.pinned || !!l?.locked || !shown
    o.set({ visible: shown, selectable: !locked, evented: !locked, hoverCursor: locked ? 'default' : 'move' })
  }

  /** Everything not selected becomes selected (and vice versa); pinned objects stay out */
  function invertSelection() {
    const fc = fcRef.current!
    const sel = new Set(fc.getActiveObjects())
    fc.discardActiveObject()
    selectObjects(fc.getObjects().filter(o => !sel.has(o)))
    fc.requestRenderAll()
    refresh()
  }

  function toggle(obj: Obj, key: 'pinned' | 'studentHidden' | 'studentDraggable') {
    const fc = fcRef.current!
    obj[key] = !obj[key]
    if (key === 'pinned' && obj.pinned) { obj.studentDraggable = false; fc.discardActiveObject() }
    if (key === 'studentDraggable' && obj.studentDraggable) obj.pinned = false
    applyEditorFlags(obj)
    fc.requestRenderAll()
    changed()
  }

  function setProp(obj: FabricObject, patch: Record<string, unknown>) {
    obj.set(patch)
    obj.setCoords()
    fcRef.current!.requestRenderAll()
    changed()
  }

  /** Background color and ruling of the slide */
  function setPage(patch: Partial<Page>) {
    const fc = fcRef.current!
    const p = { ...pageRef.current, ...patch }
    pageRef.current = p
    applyPaper(fc, p.background, p.paper, p.paperColor)
    fc.requestRenderAll()
    changed()
  }

  function setDrawingMode(kind: null | 'pencil' | 'marker') {
    const fc = fcRef.current
    if (!fc) return
    fc.isDrawingMode = !!kind
    if (kind) {
      setTool(null)
      fc.discardActiveObject()
      const b = new PencilBrush(fc)
      b.straightLineKey = 'shiftKey'
      fc.freeDrawingBrush = b
      applyBrush(kind, brushesRef.current[kind])
    }
    setDrawing(kind)
  }
  function applyBrush(kind: 'pencil' | 'marker', st: { color: string; width: number }) {
    const b = fcRef.current?.freeDrawingBrush
    if (!b) return
    b.color = kind === 'marker' ? withAlpha(st.color, 0.4) : st.color
    b.width = st.width
    ;(b as PencilBrush & { strokeLineCap: CanvasLineCap }).strokeLineCap = kind === 'marker' ? 'butt' : 'round'
  }
  const brushesRef = useRef(brushes)
  brushesRef.current = brushes
  useEffect(() => { if (drawing) applyBrush(drawing, brushes[drawing]) }, [brushes, drawing])

  // ---------- pipette ----------

  /** Screen pipette where the browser has one, otherwise a click on the slide */
  const pick: PickColor = async () => {
    const c = await screenPipette()
    if (c !== undefined) return c
    setDrawingMode(null)
    return new Promise(resolve => {
      pipetteDone.current?.(null)
      pipetteDone.current = resolve
      setTool('pipette')
    })
  }

  // ---------- drawn-by-drag tools ----------

  function startTool(t: MarkKind | 'polygon') {
    setDrawingMode(null)
    cancelCrop()
    fcRef.current?.discardActiveObject()
    setTool(cur => (cur === t ? null : t))
  }

  // Mouse handling while a tool is active: Fabric's own selection is off meanwhile
  useEffect(() => {
    const fc = fcRef.current
    if (!fc || !tool) return
    fc.selection = false
    fc.skipTargetFind = true
    fc.defaultCursor = 'crosshair'
    fc.discardActiveObject()
    fc.requestRenderAll()

    let start: Point | null = null
    let preview: FabricObject | null = null
    const points: Point[] = []

    const showPreview = (o: FabricObject | null) => {
      muted.current++
      try {
        if (preview) fc.remove(preview)
        preview = o
        if (o) { o.set({ excludeFromExport: true, evented: false, selectable: false, opacity: 0.6 }); fc.add(o) }
      } finally { muted.current-- }
      fc.requestRenderAll()
    }

    const pickPixel = (e: TPointerEventInfo) => {
      const r = fc.getRetinaScaling()
      const px = fc.getContext().getImageData(Math.round(e.viewportPoint.x * r), Math.round(e.viewportPoint.y * r), 1, 1).data
      const hex = '#' + [px[0], px[1], px[2]].map(n => n.toString(16).padStart(2, '0')).join('')
      pipetteDone.current?.(hex)
      pipetteDone.current = null
      setTool(null)
    }

    const finishPolygon = () => {
      showPreview(null)
      // a double click adds its point twice: drop vertices that repeat the previous one
      const vs = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 4)
      if (vs.length >= 3) addShapeObject(new Polygon(vs.map(p => ({ x: p.x, y: p.y })), SHAPE_PAINT) as Obj, 'Многоугольник')
      points.length = 0
      setTool(null)
    }

    const down = (e: TPointerEventInfo) => {
      if (tool === 'pipette') { pickPixel(e); return }
      const p = e.scenePoint
      if (tool === 'polygon') {
        if (points.length >= 3 && Math.hypot(p.x - points[0].x, p.y - points[0].y) < 14) { finishPolygon(); return }
        points.push(p)
        showPreview(new Polyline([...points, p].map(q => ({ x: q.x, y: q.y })), { ...SHAPE_PAINT, fill: 'transparent' }))
        return
      }
      start = p
    }
    const move = (e: TPointerEventInfo) => {
      if (tool === 'polygon' && points.length) {
        showPreview(new Polyline([...points, e.scenePoint].map(q => ({ x: q.x, y: q.y })), { ...SHAPE_PAINT, fill: 'transparent' }))
        return
      }
      if (!start || tool === 'pipette' || tool === 'polygon') return
      showPreview(dragMark(tool, start, e.scenePoint, (e.e as MouseEvent).shiftKey))
    }
    const up = (e: TPointerEventInfo) => {
      if (!start || tool === 'pipette' || tool === 'polygon') return
      const end = e.scenePoint
      const s0 = start
      start = null
      showPreview(null)
      if (Math.hypot(end.x - s0.x, end.y - s0.y) < 6) return // a click, not a drag
      const o = dragMark(tool, s0, end, (e.e as MouseEvent).shiftKey) as Obj
      addShapeObject(o, MARKS[tool].label, false)
    }
    const dbl = () => { if (tool === 'polygon') finishPolygon() }
    const key = (e: KeyboardEvent) => { if (tool === 'polygon' && e.key === 'Enter') finishPolygon() }

    fc.on('mouse:down', down)
    fc.on('mouse:move', move)
    fc.on('mouse:up', up)
    fc.on('mouse:dblclick', dbl)
    window.addEventListener('keydown', key)
    return () => {
      fc.off('mouse:down', down)
      fc.off('mouse:move', move)
      fc.off('mouse:up', up)
      fc.off('mouse:dblclick', dbl)
      window.removeEventListener('keydown', key)
      showPreview(null)
      fc.selection = true
      fc.skipTargetFind = false
      fc.defaultCursor = 'default'
      if (tool === 'pipette') { pipetteDone.current?.(null); pipetteDone.current = null }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tool])

  /** The mark for a drag from a to b */
  function dragMark(kind: MarkKind, a: Point, b: Point, shift: boolean): FabricObject {
    const info = MARKS[kind]
    const st = markStyleRef.current
    if (info.drag === 'line') {
      let ang = Math.atan2(b.y - a.y, b.x - a.x)
      if (shift) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12)
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      const o = buildMark(kind, len, 0, st)
      o.set({ left: a.x + Math.cos(ang) * len / 2, top: a.y + Math.sin(ang) * len / 2, angle: ang * 180 / Math.PI })
      return o
    }
    if (info.drag === 'box') {
      const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y)
      const o = buildMark(kind, w, h, st)
      o.set({ left: (a.x + b.x) / 2, top: (a.y + b.y) / 2 })
      return o
    }
    const w = Math.abs(b.x - a.x)
    const h = markHeight(kind, w)
    const o = buildMark(kind, w, h, st)
    const sw = st.strokeWidth
    const dy = info.place === 'above' ? -(h + sw) / 2 : info.place === 'below' ? (h + sw) / 2 : 0
    o.set({ left: (a.x + b.x) / 2, top: a.y + dy })
    return o
  }
  const markStyleRef = useRef(markStyle)
  markStyleRef.current = markStyle

  /** A resized mark is redrawn at its new size (a wavy line stays wavy instead of stretching) */
  function rebuildMark(o: Obj, style?: Partial<MarkStyle>) {
    const fc = fcRef.current!
    const m = o.mark!
    const kind = m.kind as MarkKind
    const w = m.w * Math.abs(o.scaleX)
    const h = m.h * Math.abs(o.scaleY)
    const st: MarkStyle = {
      stroke: typeof o.stroke === 'string' ? o.stroke : markStyleRef.current.stroke,
      strokeWidth: o instanceof Group ? markStyleRef.current.strokeWidth : o.strokeWidth,
      ...style,
    }
    if (o instanceof Group) {
      const axes = o.getObjects()[0]
      if (typeof axes?.stroke === 'string') st.stroke = style?.stroke ?? axes.stroke
    }
    const fresh = buildMark(kind, w, MARKS[kind].drag === 'line' ? m.h : h, st) as Obj
    const c = o.getCenterPoint()
    fresh.set({ left: c.x, top: c.y, angle: o.angle, opacity: o.opacity })
    Object.assign(fresh, { uid: o.uid, layer: o.layer, name: o.name, pinned: o.pinned, studentHidden: o.studentHidden, studentDraggable: o.studentDraggable })
    batch(() => {
      const i = fc.getObjects().indexOf(o)
      fc.discardActiveObject()
      fc.remove(o)
      applyEditorFlags(fresh)
      fc.insertAt(i, fresh)
      fc.setActiveObject(fresh)
    })
  }

  // ---------- crop ----------

  function startCrop(img: FabricImage) {
    const fc = fcRef.current!
    setTool(null)
    const frame = cropFrame(img)
    muted.current++
    try {
      for (const o of fc.getObjects()) o.set({ evented: false })
      fc.add(frame)
      fc.setActiveObject(frame)
    } finally { muted.current-- }
    fc.requestRenderAll()
    setCropping({ img, frame })
  }

  function finishCrop(apply: boolean) {
    const fc = fcRef.current!
    const c = croppingRef.current
    if (!c) return
    setCropping(null)
    muted.current++
    try {
      fc.discardActiveObject()
      fc.remove(c.frame)
      if (apply) applyCrop(c.img, c.frame)
      for (const o of fc.getObjects() as Obj[]) applyEditorFlags(o)
      fc.setActiveObject(c.img)
    } finally { muted.current-- }
    fc.requestRenderAll()
    if (apply) changed()
    else refresh()
  }
  const croppingRef = useRef(cropping)
  croppingRef.current = cropping
  function cancelCrop() { if (croppingRef.current) finishCrop(false) }

  function resetCrop(img: FabricImage) {
    uncrop(img)
    fcRef.current!.requestRenderAll()
    changed()
  }

  const markItem = (k: MarkKind) => ({ key: k, icon: MARKS[k].icon, label: MARKS[k].label, title: MARKS[k].title, on: tool === k, onClick: () => startTool(k) })

  // ---------- render ----------

  const layerList = [...layersRef.current].reverse() // panel lists the topmost layer first
  const one = active.length === 1 ? active[0] : null
  const h = history.current

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Tools */}
        <div style={toolbar}>
          <Tool onClick={() => addText()} title="Текст">T&nbsp;Текст</Tool>
          <Tool onClick={async () => addFiles(await pickMediaFiles('image/*,application/pdf'))} disabled={!!busy} title="Картинка или страницы PDF">
            🖼&nbsp;Картинка / PDF
          </Tool>
          <ToolMenu label="◇ Фигуры" title="Фигуры" testId="menu-shapes" on={tool === 'polygon'} sections={[{
            items: [
              { key: 'rect', icon: '▭', label: 'Прямоугольник', onClick: addRect },
              { key: 'ellipse', icon: '◯', label: 'Круг', onClick: addEllipse },
              ...(Object.keys(SHAPES) as ShapeKind[]).map(k => ({ key: k, icon: SHAPES[k].icon, label: SHAPES[k].label, onClick: () => addShape(k) })),
              { key: 'arrow', icon: '➜', label: 'Стрелка', onClick: addArrow },
              { key: 'polygon', icon: '⬠', label: 'Многоугольник по точкам', title: 'Кликайте вершины; закончить — двойной клик, Enter или клик в первую точку', on: tool === 'polygon', onClick: () => startTool('polygon') },
            ],
          }]} />
          <ToolMenu label="╱ Линии" title="Линии, вектор, оси координат" testId="menu-lines" on={!!tool && LINE_MARKS.includes(tool as MarkKind)}
            sections={[{ items: LINE_MARKS.map(k => markItem(k)) }]} />
          <ToolMenu label="⌒ Разбор" title="Разбор предложения и слова" testId="menu-analysis"
            on={!!tool && (SENTENCE_MARKS.includes(tool as MarkKind) || MORPHEME_MARKS.includes(tool as MarkKind))}
            sections={[
              { title: 'Члены предложения — проведите под словом', items: SENTENCE_MARKS.map(k => markItem(k)) },
              { title: 'Состав слова', items: MORPHEME_MARKS.map(k => markItem(k)) },
            ]} />
          <Tool on={drawing === 'pencil'} onClick={() => setDrawingMode(drawing === 'pencil' ? null : 'pencil')} title="Карандаш (Shift — прямая, Esc — выйти)">✏&nbsp;Карандаш</Tool>
          <Tool on={drawing === 'marker'} onClick={() => setDrawingMode(drawing === 'marker' ? null : 'marker')} title="Маркер: полупрозрачный, для выделения (Shift — прямая, Esc — выйти)">🖍&nbsp;Маркер</Tool>
          <span style={{ flex: 1 }} />
          <Tool onClick={undo} disabled={!h.past.length} title="Отменить (Ctrl+Z)">↶</Tool>
          <Tool onClick={redo} disabled={!h.future.length} title="Повторить (Ctrl+Shift+Z)">↷</Tool>
          <label style={propLabel} title="Фон слайда">
            Фон <ColorField value={toHex(pageRef.current.background, '#ffffff')} onChange={c => setPage({ background: c })} title="Цвет фона слайда" pick={pick} />
          </label>
          <select value={pageRef.current.paper ?? 'none'} onChange={e => setPage({ paper: e.target.value === 'none' ? undefined : e.target.value })}
            title="Разметка слайда: клетка, линейка, пропись" data-testid="paper" style={{ ...numInput, width: 'auto' }}>
            {PAPERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          {pageRef.current.paper && pageRef.current.paper !== 'none' && (
            <ColorField value={toHex(pageRef.current.paperColor, DEFAULT_PAPER_COLOR)} onChange={c => setPage({ paperColor: c })} title="Цвет линий разметки" pick={pick} />
          )}
        </div>

        {/* Properties of the selection */}
        <div style={{ ...toolbar, minHeight: 34, background: drawing || tool ? '#eff6ff' : '#fafafa' }} data-testid="props">
          {busy && <span style={{ fontSize: 12, color: '#6b7280' }}>{busy}</span>}
          {/* Settings of the active tool (in place of the selection's properties: the slide doesn't jump) */}
          {(drawing || (tool && tool !== 'pipette')) && (
            <span style={{ display: 'contents' }} data-testid="tool-settings">
            {drawing && (
              <>
                <span style={{ fontSize: 12, color: '#1e40af' }}>{drawing === 'pencil' ? 'Карандаш' : 'Маркер'} — рисуйте на слайде; Shift — прямая; Esc — выйти</span>
                <ColorField value={brushes[drawing].color} title="Цвет" pick={pick}
                  onChange={c => setBrushes(b => ({ ...b, [drawing]: { ...b[drawing], color: c } }))} />
                <input type="range" min={1} max={drawing === 'marker' ? 60 : 40} value={brushes[drawing].width} title="Толщина"
                  onChange={e => setBrushes(b => ({ ...b, [drawing]: { ...b[drawing], width: Number(e.target.value) } }))} />
              </>
            )}
            {tool && tool !== 'pipette' && tool !== 'polygon' && (
              <>
                <span style={{ fontSize: 12, color: '#1e40af' }}>{MARKS[tool].label}: {MARKS[tool].title.replace(/^[^—]*— ?/, '') || 'проведите мышкой'} · Esc — выйти</span>
                <ColorField value={markStyle.stroke} title="Цвет линии" pick={pick} onChange={c => setMarkStyle(m => ({ ...m, stroke: c }))} />
                <label style={propLabel}>Толщина
                  <input type="number" min={1} max={20} value={markStyle.strokeWidth} style={numInput}
                    onChange={e => setMarkStyle(m => ({ ...m, strokeWidth: Math.max(1, Math.min(20, Number(e.target.value) || 1)) }))} />
                </label>
              </>
            )}
            {tool === 'polygon' && <span style={{ fontSize: 12, color: '#1e40af' }}>Кликайте вершины; закончить — двойной клик, Enter или клик в первую точку; Esc — отмена</span>}
            </span>
          )}
          {tool === 'pipette' && <span style={{ fontSize: 12, color: '#92400e' }}>💧 Кликните на слайде, чтобы взять цвет (Esc — отмена)</span>}

          {!drawing && !tool && (<>
          {!busy && !active.length && (
            <span data-testid="shortcuts-hint" style={{ fontSize: 13, color: '#9ca3af', cursor: 'help' }}
              title={'Shift+клик — добавить к выделению\nCtrl+C/V — копировать/вставить, Ctrl+D — дублировать\nCtrl+G — сгруппировать, Delete — удалить, стрелки — сдвинуть\nКартинку можно вставить из буфера или перетащить файлы на слайд'}>
              ⌨
            </span>
          )}
          {!busy && active.length > 1 && (
            <>
              <span style={{ fontSize: 12, color: '#6b7280' }}>Выделено: {active.length}</span>
              <LayerSelect layers={layersRef.current} value={active[0].layer} onChange={id => toLayer(active, id)} />
              <Tool onClick={groupSelection} title="Сгруппировать: станут одним объектом (Ctrl+G)">▦ Сгруппировать</Tool>
              <Tool onClick={invertSelection} title="Инвертировать выбор: невыбранные станут выбранными">⇄</Tool>
              <Tool onClick={duplicate} title="Дублировать (Ctrl+D)">⧉ Дублировать</Tool>
              <Tool onClick={() => removeObjects(active)} title="Удалить (Delete)">✕ Удалить</Tool>
            </>
          )}
          {!busy && !cropping && one && (
            <input value={one.name ?? ''} placeholder="Название" title="Название объекта (видно в списке слоёв)"
              onChange={e => { one.name = e.target.value || undefined; changed({ record: false }) }}
              onBlur={() => changed()} style={{ ...numInput, width: 150 }} />
          )}
          {!busy && cropping && (
            <>
              <span style={{ fontSize: 12, color: '#92400e' }}>✂ Подвиньте и растяните рамку — останется то, что внутри</span>
              <Tool onClick={() => finishCrop(true)} title="Обрезать по рамке">✓ Обрезать</Tool>
              <Tool onClick={() => finishCrop(false)} title="Отмена (Esc)">✕ Отмена</Tool>
            </>
          )}
          {!busy && !cropping && one && <ObjectProps obj={one} pick={pick} set={patch => (one.mark && ('strokeWidth' in patch || 'stroke' in patch) ? rebuildMark(one, patch as Partial<MarkStyle>) : setProp(one, patch))} />}
          {!busy && !cropping && one instanceof FabricImage && (
            <>
              <Tool onClick={() => startCrop(one)} title="Обрезать картинку рамкой">✂ Обрезать</Tool>
              {isCropped(one) && <Tool onClick={() => resetCrop(one)} title="Вернуть картинку целиком">⤢ Целиком</Tool>}
            </>
          )}
          {!busy && one instanceof Group && (
            <Tool onClick={ungroupSelection} title="Разгруппировать (Ctrl+Shift+G)">⊞ Разгруппировать</Tool>
          )}
          {!busy && one && (
            <>
              <span style={{ flex: 1 }} />
              <LayerSelect layers={layersRef.current} value={one.layer} onChange={id => toLayer([one], id)} />
              <Tool onClick={() => move(one, 'top')} title="Поверх всех в своём слое">⤒</Tool>
              <Tool onClick={() => move(one, 'up')} title="Выше (в своём слое)">↑</Tool>
              <Tool onClick={() => move(one, 'down')} title="Ниже (в своём слое)">↓</Tool>
              <Tool onClick={() => move(one, 'bottom')} title="Под всеми в своём слое">⤓</Tool>
              <Tool onClick={invertSelection} title="Инвертировать выбор: невыбранные станут выбранными">⇄</Tool>
              <Tool onClick={duplicate} title="Дублировать (Ctrl+D)">⧉</Tool>
              <Tool onClick={() => removeObjects([one])} title="Удалить (Delete)">✕</Tool>
            </>
          )}
          </>)}
        </div>

        <div
          ref={hostRef}
          data-testid="slide"
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true) } }}
          onDragLeave={() => setDropping(false)}
          onDrop={e => { e.preventDefault(); setDropping(false); addFiles(Array.from(e.dataTransfer.files)) }}
          style={{
            maxWidth: '100%', borderRadius: 4, overflow: 'hidden', background: '#fff',
            border: `1px solid ${dropping ? '#4a90e2' : '#d1d5db'}`, boxShadow: dropping ? '0 0 0 3px #bfdbfe' : undefined,
          }}
        />
      </div>

      {/* Layers */}
      <div style={{ width: 250, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
          <div style={{ ...sectionTitle, marginBottom: 0, flex: 1 }}>Слои</div>
          <button onClick={addLayer} title="Новый слой над текущим" data-testid="add-layer" style={smallBtn}>+ Слой</button>
        </div>
        <div data-testid="layers" style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 560, overflowY: 'auto' }}>
          {layerList.map((l, li) => {
            const items = objects.filter(o => o.layer === l.id).reverse()
            const open = expanded.has(l.id)
            const isActive = l.id === activeLayer
            return (
              <div key={l.id} data-testid="layer" data-layer={l.name} style={{
                borderRadius: 4, background: '#fff', border: `1px solid ${isActive ? '#4a90e2' : '#e5e7eb'}`,
                boxShadow: isActive ? '0 0 0 1px #4a90e2' : undefined,
              }}>
                <div onClick={() => setActiveLayer(l.id)} style={{ padding: '5px 6px', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                    <button onClick={e => { e.stopPropagation(); setExpanded(x => { const n = new Set(x); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n }) }}
                      title={open ? 'Свернуть' : 'Показать объекты слоя'} style={{ ...smallBtn, border: 'none', padding: 0, width: 14 }}>{open ? '▾' : '▸'}</button>
                    {renaming === l.id ? (
                      <input autoFocus defaultValue={l.name} onClick={e => e.stopPropagation()}
                        onBlur={e => { const v = e.target.value.trim(); if (v && v !== l.name) patchLayer(l.id, { name: v }); setRenaming(null) }}
                        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(null) }}
                        style={{ ...numInput, flex: 1, width: 'auto', padding: '1px 4px', fontSize: 12 }} />
                    ) : (
                      <span onDoubleClick={e => { e.stopPropagation(); setRenaming(l.id) }} title="Двойной клик — переименовать"
                        style={{ flex: 1, fontSize: 13, fontWeight: isActive ? 600 : 400, color: l.editorHidden ? '#9ca3af' : '#111827',
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.name} <span style={{ color: '#9ca3af', fontWeight: 400 }}>({items.length})</span>
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 2 }}>
                    <Flag on={!l.editorHidden} title={l.editorHidden ? 'Слой спрятан в редакторе (ученики его видят)' : 'Спрятать в редакторе, чтобы поработать с тем, что под ним'}
                      onClick={() => patchLayer(l.id, { editorHidden: !l.editorHidden || undefined })}>👁</Flag>
                    <Flag on={!!l.locked} title="Закрепить слой: объекты не выделяются и не двигаются" onClick={() => patchLayer(l.id, { locked: !l.locked || undefined })}>🔒</Flag>
                    <Flag on={!!l.studentHidden} title="Скрыть весь слой от учеников, пока учитель не откроет" onClick={() => patchLayer(l.id, { studentHidden: !l.studentHidden || undefined })}>🙈</Flag>
                    <Flag on={!!l.studentDraggable} title="Ученики могут двигать объекты этого слоя" onClick={() => patchLayer(l.id, { studentDraggable: !l.studentDraggable || undefined })}>✋</Flag>
                    <span style={{ flex: 1 }} />
                    <Flag title="Слой выше" disabled={li === 0} onClick={() => moveLayer(l.id, 1)}>▲</Flag>
                    <Flag title="Слой ниже" disabled={li === layerList.length - 1} onClick={() => moveLayer(l.id, -1)}>▼</Flag>
                    <Flag title="Удалить слой" disabled={layerList.length < 2} onClick={() => deleteLayer(l.id)}>✕</Flag>
                  </div>
                </div>
                {open && (
                  <div style={{ borderTop: '1px solid #f3f4f6', padding: '4px 4px 4px 14px', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {items.length === 0 && <div style={{ fontSize: 11, color: '#9ca3af' }}>Пусто</div>}
                    {items.map((o, i) => (
                      <div key={o.uid ?? i} data-testid="layer-object" onClick={() => select(o)} style={{
                        padding: '3px 5px', borderRadius: 3, cursor: o.selectable ? 'pointer' : 'default',
                        border: `1px solid ${active.includes(o) ? '#4a90e2' : '#f3f4f6'}`, background: '#fafafa',
                      }}>
                        <div style={{ fontSize: 12, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 2 }}>
                          {layerLabel(o)}
                        </div>
                        <div style={{ display: 'flex', gap: 2 }}>
                          <Flag on={!!o.pinned} title="Закрепить объект (не двигается, не выделяется)" onClick={() => toggle(o, 'pinned')}>📌</Flag>
                          <Flag on={!!o.studentHidden} title="Скрыт от ученика, пока учитель не откроет" onClick={() => toggle(o, 'studentHidden')}>🙈</Flag>
                          <Flag on={!!o.studentDraggable} title="Ученик может перетаскивать" onClick={() => toggle(o, 'studentDraggable')}>✋</Flag>
                          <span style={{ flex: 1 }} />
                          <Flag title="Выше" disabled={i === 0} onClick={() => move(o, 'up')}>▲</Flag>
                          <Flag title="Ниже" disabled={i === items.length - 1} onClick={() => move(o, 'down')}>▼</Flag>
                          <Flag title="Удалить" onClick={() => removeObjects([o])}>✕</Flag>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const SHAPE_PAINT = { fill: '#bfdbfe', stroke: '#1d4ed8', strokeWidth: 4, strokeUniform: true }

/** #rrggbb → rgba() with the given opacity (marker) */
function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/** 'Слой N' with N one above the largest used */
function nextLayerName(layers: SlideLayer[]): string {
  const used = layers.map(l => /^Слой (\d+)$/.exec(l.name)?.[1]).filter(Boolean).map(Number)
  return `Слой ${Math.max(0, ...used) + 1}`
}

/** Topmost layer new objects can go to */
function topEditable(layers: SlideLayer[]): SlideLayer | undefined {
  return [...layers].reverse().find(l => !l.locked && !l.editorHidden)
}

function ObjectProps({ obj, set, pick }: { obj: Obj; set: (patch: Record<string, unknown>) => void; pick: PickColor }) {
  const isText = obj instanceof Textbox
  const isPath = obj.type === 'path'
  const isShape = !isText && !isPath && obj.type !== 'image' && !(obj instanceof Group)
  return (
    <>
      {isText && (
        <>
          <label style={propLabel}>Размер
            <input type="number" min={8} max={400} value={Math.round((obj as Textbox).fontSize)}
              onChange={e => set({ fontSize: Number(e.target.value) || 8 })} style={numInput} />
          </label>
          <label style={propLabel}>Цвет <ColorField value={toHex(obj.fill, '#000000')} onChange={c => set({ fill: c })} title="Цвет текста" pick={pick} /></label>
          <Tool on={(obj as Textbox).fontWeight === 'bold'} title="Жирный"
            onClick={() => set({ fontWeight: (obj as Textbox).fontWeight === 'bold' ? 'normal' : 'bold' })}><b>Ж</b></Tool>
          {(['left', 'center', 'right'] as const).map(a => (
            <Tool key={a} on={(obj as Textbox).textAlign === a} title={{ left: 'По левому краю', center: 'По центру', right: 'По правому краю' }[a]}
              onClick={() => set({ textAlign: a })}>{{ left: '⇤', center: '↔', right: '⇥' }[a]}</Tool>
          ))}
          <label style={propLabel}>Подложка
            <input type="checkbox" checked={!!(obj as Textbox).backgroundColor}
              onChange={e => set({ backgroundColor: e.target.checked ? '#fef9c3' : '' })} />
            {!!(obj as Textbox).backgroundColor && (
              <ColorField value={toHex((obj as Textbox).backgroundColor, '#fef9c3')} onChange={c => set({ backgroundColor: c })} title="Цвет подложки" pick={pick} />
            )}
          </label>
        </>
      )}
      {isShape && (
        <>
          <label style={propLabel}>Заливка
            <input type="checkbox" checked={!!obj.fill && obj.fill !== 'transparent'}
              onChange={e => set({ fill: e.target.checked ? '#bfdbfe' : 'transparent' })} />
            {!!obj.fill && obj.fill !== 'transparent' && (
              <ColorField value={toHex(obj.fill, '#bfdbfe')} onChange={c => set({ fill: c })} title="Цвет заливки" pick={pick} />
            )}
          </label>
        </>
      )}
      {(isShape || isPath) && (
        <>
          <label style={propLabel}>Линия <ColorField value={toHex(obj.stroke, '#000000')} onChange={c => set({ stroke: c })} title="Цвет линии" pick={pick} /></label>
          <label style={propLabel}>Толщина
            <input type="number" min={0} max={60} value={obj.strokeWidth} onChange={e => set({ strokeWidth: Math.max(0, Number(e.target.value) || 0) })} style={numInput} />
          </label>
        </>
      )}
      <label style={propLabel}>Прозрачность
        <input type="range" min={10} max={100} value={Math.round(obj.opacity * 100)} onChange={e => set({ opacity: Number(e.target.value) / 100 })} style={{ width: 80 }} />
      </label>
    </>
  )
}

function layerLabel(o: Obj): string {
  if (o.name) return `${o instanceof Group ? '▦' : '•'}  ${o.name}`
  if (o instanceof Group) return `▦  Группа (${o.size()})`
  if (o instanceof Textbox) return `T  ${o.text.replace(/\s+/g, ' ').slice(0, 40) || '(пусто)'}`
  if (o.mediaName) return `🖼  ${o.mediaName}`
  return ({ rect: '▭  Прямоугольник', ellipse: '◯  Круг', circle: '◯  Круг', line: '╱  Линия', polygon: '⬠  Многоугольник', path: '✏  Рисунок' } as Record<string, string>)[o.type] ?? o.type
}

/** CSS color (hex/rgb/named-ish) → #rrggbb for <input type=color> */
function toHex(c: unknown, fallback: string): string {
  if (typeof c !== 'string' || !c) return fallback
  if (/^#[0-9a-f]{6}$/i.test(c)) return c
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + [...c.slice(1)].map(x => x + x).join('')
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (m) return '#' + m.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('')
  const ctx = document.createElement('canvas').getContext('2d')!
  ctx.fillStyle = c
  return /^#[0-9a-f]{6}$/i.test(ctx.fillStyle) ? ctx.fillStyle : fallback
}

/** Which layer the selection is in; changing it moves the objects there */
function LayerSelect({ layers, value, onChange }: { layers: SlideLayer[]; value?: string; onChange: (id: string) => void }) {
  return (
    <label style={propLabel} title="Перенести в другой слой">Слой
      <select value={value ?? ''} onChange={e => onChange(e.target.value)} data-testid="object-layer"
        style={{ ...numInput, width: 'auto', maxWidth: 130 }}>
        {[...layers].reverse().map(l => <option key={l.id} value={l.id}>{l.name}{l.locked ? ' 🔒' : ''}</option>)}
      </select>
    </label>
  )
}

function Tool({ on, title, disabled, onClick, children }: {
  on?: boolean; title: string; disabled?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button title={title} aria-label={title} aria-pressed={on} disabled={disabled} onClick={onClick} style={{
      padding: '4px 10px', borderRadius: 4, fontSize: 13, color: '#374151', minWidth: 32,
      border: `1px solid ${on ? '#4a90e2' : '#d1d5db'}`, background: on ? '#dbeafe' : '#fff', opacity: disabled ? 0.4 : 1,
    }}>{children}</button>
  )
}

function Flag({ on, title, disabled, onClick, children }: {
  on?: boolean; title: string; disabled?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button title={title} aria-label={title} aria-pressed={on} disabled={disabled}
      onClick={e => { e.stopPropagation(); onClick() }} style={{
      width: 24, height: 22, padding: 0, borderRadius: 3, fontSize: 12, lineHeight: '20px',
      border: `1px solid ${on ? '#4a90e2' : '#e5e7eb'}`, background: on ? '#dbeafe' : '#f9fafb',
      opacity: disabled ? 0.35 : on === false ? 0.55 : 1,
    }}>{children}</button>
  )
}

const toolbar: React.CSSProperties = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 6, padding: 4, borderRadius: 4,
}
const propLabel: React.CSSProperties = { fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }
const numInput: React.CSSProperties = { width: 56, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4 }
const smallBtn: React.CSSProperties = {
  fontSize: 12, padding: '2px 8px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer',
}
const sectionTitle: React.CSSProperties = {
  fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6,
}

// Slide editor: a Fabric.js canvas of layered objects + a layers panel.
// The scene is loaded once on mount (component is keyed by block id) and
// emitted upward on every change; Fabric owns the live state in between.
import { useEffect, useRef, useState } from 'react'
import { Canvas, FabricImage, FabricObject, Textbox } from 'fabric'
import type { Scene, SceneObject } from './types'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from './types'
import { uniqueName, type Media } from './lessonFile'
import { pickMediaFiles } from './fileAccess'
import { nanoid } from './nanoid'

// Our fields travel with Fabric's own JSON
FabricObject.customProperties = ['uid', 'mediaName', 'pinned', 'studentHidden', 'studentDraggable']

type Obj = FabricObject & Partial<Pick<SceneObject, 'uid' | 'mediaName' | 'pinned' | 'studentHidden' | 'studentDraggable'>>

interface Props {
  scene: Scene | undefined
  media: Media
  onAddMedia: (name: string, blob: Blob) => void
  onChange: (scene: Scene) => void
  onError: (text: string) => void
}

export function emptyScene(): Scene {
  return { engine: 'fabric', width: SLIDE_WIDTH, height: SLIDE_HEIGHT, background: '#ffffff', objects: [] }
}

export function SceneEditor({ scene, media, onAddMedia, onChange, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fcRef = useRef<Canvas | null>(null)
  const [layers, setLayers] = useState<Obj[]>([])
  const [active, setActive] = useState<Obj | null>(null)
  const [, force] = useState(0)
  const [busy, setBusy] = useState(false)

  // Latest props for Fabric event handlers
  const live = useRef({ media, onChange, onAddMedia, onError })
  live.current = { media, onChange, onAddMedia, onError }
  const urls = useRef(new Map<string, string>())
  const emitTimer = useRef<number | undefined>(undefined)
  const pendingEmit = useRef(false)

  function urlFor(name: string): string | undefined {
    const blob = live.current.media[name]
    if (!blob) return undefined
    let url = urls.current.get(name)
    if (!url) {
      url = URL.createObjectURL(blob)
      urls.current.set(name, url)
    }
    return url
  }

  function serialize(fc: Canvas): Scene {
    const objects = fc.getObjects().map(o => {
      const json = o.toObject() as SceneObject
      if (json.mediaName) delete json.src // bytes live in media/, not in JSON
      return json
    })
    return { ...emptyScene(), background: String(fc.backgroundColor || '#ffffff'), objects }
  }

  function emitNow() {
    clearTimeout(emitTimer.current)
    if (!pendingEmit.current || !fcRef.current) return
    pendingEmit.current = false
    live.current.onChange(serialize(fcRef.current))
  }

  function refresh() {
    const fc = fcRef.current
    if (!fc) return
    setLayers([...fc.getObjects()] as Obj[])
    setActive((fc.getActiveObject() as Obj) ?? null)
    force(n => n + 1)
  }

  function changed() {
    refresh()
    pendingEmit.current = true
    clearTimeout(emitTimer.current)
    emitTimer.current = window.setTimeout(emitNow, 300)
  }

  // Mount: create canvas, load scene
  useEffect(() => {
    // Element created here, not in JSX: Fabric wraps it in its own DOM, which
    // must not be shared between StrictMode's double mount.
    const el = document.createElement('canvas')
    hostRef.current!.appendChild(el)
    const fc = new Canvas(el, {
      width: SLIDE_WIDTH, height: SLIDE_HEIGHT, backgroundColor: scene?.background ?? '#ffffff',
      preserveObjectStacking: true,
    })
    fcRef.current = fc
    if (import.meta.env.DEV) (window as unknown as { __fc: Canvas }).__fc = fc // for e2e tests
    let loading = true
    const abort = new AbortController()

    const objects = (scene?.objects ?? []).map(o => {
      if (!o.mediaName) return o
      return { ...o, src: urlFor(o.mediaName) ?? MISSING_IMAGE }
    })
    fc.loadFromJSON({ objects, background: scene?.background ?? '#ffffff' }, undefined, { signal: abort.signal }).then(() => {
      if (abort.signal.aborted) return
      for (const o of fc.getObjects() as Obj[]) applyFlags(o)
      fc.requestRenderAll()
      loading = false
      refresh()
    }).catch(e => {
      if (abort.signal.aborted) return // unmounted while loading (StrictMode double mount, fast block switch)
      loading = false
      live.current.onError(`Слайд не загрузился: ${(e as Error).message}`)
    })

    const onMutate = () => { if (!loading) changed() }
    fc.on('object:added', onMutate)
    fc.on('object:removed', onMutate)
    fc.on('object:modified', onMutate)
    fc.on('text:changed', onMutate)
    fc.on('selection:created', refresh)
    fc.on('selection:updated', refresh)
    fc.on('selection:cleared', refresh)

    // Fit to host width
    const ro = new ResizeObserver(() => {
      const w = hostRef.current?.clientWidth ?? SLIDE_WIDTH
      fc.setDimensions({ width: w, height: (w * SLIDE_HEIGHT) / SLIDE_WIDTH })
      fc.setZoom(w / SLIDE_WIDTH)
    })
    ro.observe(hostRef.current!)

    return () => {
      abort.abort()
      ro.disconnect()
      emitNow()
      fcRef.current = null
      fc.dispose().finally(() => { fc.elements?.container?.remove(); el.remove() })
      for (const u of urls.current.values()) URL.revokeObjectURL(u)
      urls.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Delete key removes the selected layer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]')) return
      const fc = fcRef.current
      const obj = fc?.getActiveObject() as Obj | undefined
      if (!fc || !obj || (obj instanceof Textbox && obj.isEditing)) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        removeLayer(obj)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function add(obj: Obj) {
    const fc = fcRef.current!
    obj.uid = nanoid()
    fc.add(obj)
    fc.setActiveObject(obj)
    fc.requestRenderAll()
  }

  function addText() {
    // Fabric 7: origin is the object's center by default
    add(new Textbox('Текст', {
      left: SLIDE_WIDTH / 2, top: SLIDE_HEIGHT / 2, width: 400,
      fontSize: 56, fontFamily: 'sans-serif', fill: '#1a1a1a', textAlign: 'center',
    }) as Obj)
  }

  async function addImageBlob(blob: Blob, fileName: string) {
    const name = uniqueName(fileName, live.current.media)
    live.current.media = { ...live.current.media, [name]: blob } // visible to urlFor before rerender
    live.current.onAddMedia(name, blob)
    const img = (await FabricImage.fromURL(urlFor(name)!)) as Obj
    img.mediaName = name
    // First layer fills the slide (typical: PDF page as background); later ones — 60%
    const isFirst = fcRef.current!.getObjects().length === 0
    const k = Math.min((SLIDE_WIDTH * (isFirst ? 1 : 0.6)) / img.width, (SLIDE_HEIGHT * (isFirst ? 1 : 0.6)) / img.height)
    img.set({ scaleX: k, scaleY: k, left: SLIDE_WIDTH / 2, top: SLIDE_HEIGHT / 2 })
    add(img)
  }

  async function addFiles() {
    const files = await pickMediaFiles('image/*,application/pdf')
    if (!files.length) return
    setBusy(true)
    try {
      for (const f of files) {
        if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
          const { pdfPageCount, renderPdfPage } = await import('./pdf') // ~1 MB, load on demand
          const n = await pdfPageCount(f)
          let pageNo = 1
          if (n > 1) {
            const answer = prompt(`В «${f.name}» ${n} стр. Какую страницу вставить? (1–${n})`, '1')
            if (answer === null) continue
            pageNo = Math.min(n, Math.max(1, parseInt(answer, 10) || 1))
          }
          const png = await renderPdfPage(f, pageNo)
          const stem = f.name.replace(/\.pdf$/i, '')
          await addImageBlob(png, n > 1 ? `${stem} — стр. ${pageNo}.png` : `${stem}.png`)
        } else if (f.type.startsWith('image/')) {
          await addImageBlob(f, f.name)
        } else {
          live.current.onError(`«${f.name}»: на слайд можно добавить картинку или PDF`)
        }
      }
    } catch (e) {
      live.current.onError(`Не удалось добавить: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  function select(obj: Obj) {
    const fc = fcRef.current!
    if (obj.pinned) return
    fc.setActiveObject(obj)
    fc.requestRenderAll()
    refresh()
  }

  function removeLayer(obj: Obj) {
    const fc = fcRef.current!
    fc.remove(obj)
    fc.discardActiveObject()
    fc.requestRenderAll()
  }

  /** dir: +1 — up (towards the top), -1 — down */
  function move(obj: Obj, dir: 1 | -1) {
    const fc = fcRef.current!
    if (dir > 0) fc.bringObjectForward(obj)
    else fc.sendObjectBackwards(obj)
    fc.requestRenderAll()
    changed()
  }

  function toggle(obj: Obj, key: 'pinned' | 'studentHidden' | 'studentDraggable') {
    obj[key] = !obj[key]
    if (key === 'pinned' && obj.pinned) fcRef.current!.discardActiveObject()
    if (key === 'pinned' && obj.pinned) obj.studentDraggable = false
    if (key === 'studentDraggable' && obj.studentDraggable) obj.pinned = false
    applyFlags(obj)
    fcRef.current!.requestRenderAll()
    changed()
  }

  const top = [...layers].reverse() // panel lists the topmost layer first

  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <button onClick={addText} style={toolBtn}>+ Текст</button>
          <button onClick={addFiles} disabled={busy} style={toolBtn}>{busy ? 'Добавляю…' : '+ Картинка / PDF'}</button>
          {active instanceof Textbox && (
            <label style={{ fontSize: 12, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
              Размер
              <input type="number" min={8} max={400} value={Math.round(active.fontSize)}
                onChange={e => { active.set('fontSize', Number(e.target.value) || 8); fcRef.current!.requestRenderAll(); changed() }}
                style={{ width: 60, padding: '3px 6px', border: '1px solid #d1d5db', borderRadius: 4 }} />
              <input type="color" value={String(active.fill)}
                onChange={e => { active.set('fill', e.target.value); fcRef.current!.requestRenderAll(); changed() }} />
            </label>
          )}
        </div>
        <div ref={hostRef} data-testid="slide" style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 4, overflow: 'hidden', background: '#fff' }}>
        </div>
      </div>

      <div style={{ width: 230, flexShrink: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
          Слои
        </div>
        {top.length === 0 && <div style={{ fontSize: 12, color: '#9ca3af' }}>Пусто — добавьте текст, картинку или PDF</div>}
        <div data-testid="layers" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {top.map((o, i) => (
            <div key={o.uid ?? i} onClick={() => select(o)} style={{
              padding: '5px 6px', borderRadius: 4, background: '#fff', cursor: o.pinned ? 'default' : 'pointer',
              border: `1px solid ${o === active ? '#4a90e2' : '#e5e7eb'}`,
            }}>
              <div style={{ fontSize: 12, color: '#374151', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>
                {layerLabel(o)}
              </div>
              <div style={{ display: 'flex', gap: 2 }} onClick={e => e.stopPropagation()}>
                <Flag on={!!o.pinned} title="Закрепить (фон: не двигается, не выделяется)" onClick={() => toggle(o, 'pinned')}>📌</Flag>
                <Flag on={!!o.studentHidden} title="Скрыт от ученика, пока учитель не откроет" onClick={() => toggle(o, 'studentHidden')}>🙈</Flag>
                <Flag on={!!o.studentDraggable} title="Ученик может перетаскивать" onClick={() => toggle(o, 'studentDraggable')}>✋</Flag>
                <span style={{ flex: 1 }} />
                <Flag title="Выше" disabled={i === 0} onClick={() => move(o, 1)}>▲</Flag>
                <Flag title="Ниже" disabled={i === top.length - 1} onClick={() => move(o, -1)}>▼</Flag>
                <Flag title="Удалить" onClick={() => removeLayer(o)}>✕</Flag>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function applyFlags(o: Obj) {
  const locked = !!o.pinned
  o.set({ selectable: !locked, evented: !locked, hoverCursor: locked ? 'default' : 'move' })
}

function layerLabel(o: Obj): string {
  if (o instanceof Textbox) return `T  ${o.text.replace(/\s+/g, ' ').slice(0, 40) || '(пусто)'}`
  if (o.mediaName) return `🖼  ${o.mediaName}`
  return o.type
}

function Flag({ on, title, disabled, onClick, children }: {
  on?: boolean; title: string; disabled?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button title={title} aria-label={title} aria-pressed={on} disabled={disabled} onClick={onClick} style={{
      width: 24, height: 22, padding: 0, borderRadius: 3, fontSize: 12, lineHeight: '20px',
      border: `1px solid ${on ? '#4a90e2' : '#e5e7eb'}`, background: on ? '#dbeafe' : '#f9fafb',
      opacity: disabled ? 0.35 : on === false ? 0.55 : 1,
    }}>{children}</button>
  )
}

const toolBtn: React.CSSProperties = {
  padding: '6px 12px', borderRadius: 4, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, color: '#374151',
}

// 1×1 grey pixel — stands in for an image missing from the archive
const MISSING_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mO8Ww8AAj8BXkQ+xPEAAAAASUVORK5CYII='

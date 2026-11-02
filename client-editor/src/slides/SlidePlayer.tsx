// Slide as seen during the lesson. Shared verbatim by client-editor (preview),
// client-teacher and client-student. Canonical copy: client-editor/src/slides;
// run scripts/sync-slides.sh after changing it.
//
// Same scene JSON as the editor, different rules:
//  student — hidden objects are absent until revealed; ✋ objects draggable if `canDrag`
//  teacher — hidden objects shown faded, a click reveals/hides them; ✋ objects draggable if `canDrag`
// State that is shared in a lesson (revealed, positions) is controlled from outside.
import { useEffect, useRef } from 'react'
import { Canvas } from 'fabric'
import { bakeLayers, type Scene } from './model'
import { fitToWidth, loadInto, type MediaResolver, type Obj } from './render'

export type PlayerRole = 'teacher' | 'student'
export type Positions = Readonly<Record<string, { left: number; top: number }>>

interface Props {
  scene: Scene
  resolveMedia: MediaResolver
  role: PlayerRole
  revealed: ReadonlySet<string>
  /** Overrides of object positions (uid → left/top) — where objects were dragged to */
  positions?: Positions
  /** ✋ objects can be dragged by this viewer */
  canDrag?: boolean
  onToggleReveal?: (uid: string) => void
  onMove?: (uid: string, left: number, top: number) => void
  width: number
}

const HIDDEN_PREVIEW_OPACITY = 0.3
const NO_POSITIONS: Positions = {}

export function SlidePlayer({
  scene, resolveMedia, role, revealed, positions = NO_POSITIONS, canDrag = role === 'student',
  onToggleReveal, onMove, width,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fcRef = useRef<Canvas | null>(null)
  const objsRef = useRef<Obj[]>([])
  const baseOpacity = useRef(new Map<Obj, number>())
  const dragging = useRef<Obj | null>(null)
  const live = useRef({ role, revealed, positions, canDrag, onToggleReveal, onMove })
  live.current = { role, revealed, positions, canDrag, onToggleReveal, onMove }

  function apply() {
    const fc = fcRef.current
    if (!fc) return
    const { role, revealed, positions, canDrag } = live.current
    for (const o of objsRef.current) {
      const hidden = !!o.studentHidden && !revealed.has(o.uid ?? '')
      const base = baseOpacity.current.get(o) ?? 1
      const drag = !!o.studentDraggable && canDrag
      const pos = o.uid ? positions[o.uid] : undefined
      if (pos && o !== dragging.current) o.set({ left: pos.left, top: pos.top })
      o.set({
        visible: !(hidden && role === 'student'),
        opacity: hidden && role === 'teacher' ? base * HIDDEN_PREVIEW_OPACITY : base,
        selectable: drag,
        evented: drag || (role === 'teacher' && !!o.studentHidden),
        hasControls: false,
        hasBorders: drag,
        lockRotation: true, lockScalingX: true, lockScalingY: true,
        lockMovementX: !drag, lockMovementY: !drag,
        hoverCursor: drag ? 'grab' : role === 'teacher' && o.studentHidden ? 'pointer' : 'default',
      })
      o.setCoords()
    }
    fc.requestRenderAll()
  }

  // (Re)load when the scene itself changes
  useEffect(() => {
    const el = document.createElement('canvas')
    hostRef.current!.appendChild(el)
    const fc = new Canvas(el, { selection: false, backgroundColor: scene.background })
    fcRef.current = fc
    if (import.meta.env.DEV) (window as unknown as { __player: Canvas }).__player = fc // for e2e tests
    fitToWidth(fc, width)
    const abort = new AbortController()
    loadInto(fc, bakeLayers(scene), resolveMedia, abort.signal).then(objs => {
      if (abort.signal.aborted) return
      objsRef.current = objs
      baseOpacity.current = new Map(objs.map(o => [o, o.opacity]))
      apply()
    }).catch(() => { /* aborted or broken scene — nothing to show */ })

    // Click vs drag: a press that ends within a few pixels of where it started is a click
    let press: { target: Obj | null; x: number; y: number } | null = null
    fc.on('mouse:down', e => {
      const target = (e.target as Obj | undefined) ?? null
      press = { target, x: e.viewportPoint.x, y: e.viewportPoint.y }
      if (target?.selectable) dragging.current = target
    })
    fc.on('mouse:up', e => {
      const o = e.target as Obj | undefined
      const { role, onToggleReveal } = live.current
      const still = press && Math.hypot(e.viewportPoint.x - press.x, e.viewportPoint.y - press.y) < 5
      if (role === 'teacher' && still && o && o === press?.target && o.studentHidden && o.uid) onToggleReveal?.(o.uid)
      dragging.current = null
      press = null
    })
    fc.on('object:moving', e => {
      const o = e.target as Obj
      if (o.uid) live.current.onMove?.(o.uid, o.left, o.top)
    })
    fc.on('object:modified', e => {
      const o = e.target as Obj
      if (o.uid) live.current.onMove?.(o.uid, o.left, o.top)
    })

    return () => {
      abort.abort()
      fcRef.current = null
      fc.dispose().finally(() => { fc.elements?.container?.remove(); el.remove() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene])

  useEffect(() => { if (fcRef.current) fitToWidth(fcRef.current, width) }, [width])
  useEffect(apply, [role, revealed, positions, canDrag])

  return <div ref={hostRef} data-testid="player" style={{ width, lineHeight: 0 }} />
}

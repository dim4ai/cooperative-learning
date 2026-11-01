// Slide as seen during the lesson. Same scene JSON as the editor, different rules:
//  student — hidden objects are absent until revealed; only ✋ objects can be dragged
//  teacher — hidden objects shown faded; a click on one reveals/hides it for the class
// Self-contained on purpose: meant to move into client-teacher / client-student later,
// where `revealed` and drag positions will come from the lesson server.
import { useEffect, useRef } from 'react'
import { Canvas } from 'fabric'
import type { Scene } from '../types'
import type { Media } from '../lessonFile'
import { fitToWidth, loadInto, type Obj } from './scene'

export type PlayerRole = 'teacher' | 'student'

interface Props {
  scene: Scene
  media: Media
  role: PlayerRole
  revealed: ReadonlySet<string>
  onToggleReveal?: (uid: string) => void
  width: number
}

const HIDDEN_PREVIEW_OPACITY = 0.3

export function SlidePlayer({ scene, media, role, revealed, onToggleReveal, width }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fcRef = useRef<Canvas | null>(null)
  const objsRef = useRef<Obj[]>([])
  const baseOpacity = useRef(new Map<Obj, number>())
  const live = useRef({ role, revealed, onToggleReveal })
  live.current = { role, revealed, onToggleReveal }

  function apply() {
    const fc = fcRef.current
    if (!fc) return
    const { role, revealed } = live.current
    for (const o of objsRef.current) {
      const hidden = !!o.studentHidden && !revealed.has(o.uid ?? '')
      const base = baseOpacity.current.get(o) ?? 1
      const drag = !!o.studentDraggable && role === 'student'
      o.set({
        visible: !(hidden && role === 'student'),
        opacity: hidden && role === 'teacher' ? base * HIDDEN_PREVIEW_OPACITY : base,
        // students drag ✋ objects; the teacher clicks hidden-capable ones
        selectable: drag,
        evented: drag || (role === 'teacher' && !!o.studentHidden),
        hasControls: false,
        hasBorders: drag,
        lockRotation: true, lockScalingX: true, lockScalingY: true,
        lockMovementX: !drag, lockMovementY: !drag,
        hoverCursor: drag ? 'grab' : role === 'teacher' && o.studentHidden ? 'pointer' : 'default',
      })
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
    loadInto(fc, scene, media, abort.signal).then(objs => {
      if (abort.signal.aborted) return
      objsRef.current = objs
      baseOpacity.current = new Map(objs.map(o => [o, o.opacity]))
      apply()
    }).catch(() => { /* aborted or broken scene — nothing to show */ })

    fc.on('mouse:down', e => {
      const o = e.target as Obj | undefined
      const { role, onToggleReveal } = live.current
      if (role === 'teacher' && o?.studentHidden && o.uid) onToggleReveal?.(o.uid)
    })

    return () => {
      abort.abort()
      fcRef.current = null
      fc.dispose().finally(() => { fc.elements?.container?.remove(); el.remove() })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, media])

  useEffect(() => { if (fcRef.current) fitToWidth(fcRef.current, width) }, [width])
  useEffect(apply, [role, revealed])

  return <div ref={hostRef} data-testid="player" style={{ width, lineHeight: 0 }} />
}

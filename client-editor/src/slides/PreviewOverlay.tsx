// Full-screen preview of a block's slides as the student / the teacher will see them.
import { useEffect, useMemo, useState } from 'react'
import type { Scene } from '../types'
import { SLIDE_HEIGHT, SLIDE_WIDTH } from '../types'
import type { Media } from '../lessonFile'
import { SlidePlayer, type PlayerRole, type Positions } from './SlidePlayer'
import { mediaResolver } from './scene'
import { bakeLayers } from './model'

interface Props {
  slides: Scene[]
  media: Media
  start: number
  onClose: () => void
}

export function PreviewOverlay({ slides, media, start, onClose }: Props) {
  const [index, setIndex] = useState(Math.min(start, slides.length - 1))
  const [role, setRole] = useState<PlayerRole>('student')
  // Revealed hidden objects, per slide; shared by both views like in a real lesson
  const [revealed, setRevealed] = useState<Record<string, Set<string>>>({})
  const [size, setSize] = useState(() => fit())
  // Where ✋ objects were dragged to, per slide — like the lesson server will keep it
  const [positions, setPositions] = useState<Record<string, Positions>>({})
  const resolve = useMemo(() => mediaResolver(media), [media])

  useEffect(() => {
    const onResize = () => setSize(fit())
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') setIndex(i => Math.min(slides.length - 1, i + 1))
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') setIndex(i => Math.max(0, i - 1))
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('resize', onResize)
    window.addEventListener('keydown', onKey, true) // capture: keep the editor underneath from reacting
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [onClose, slides.length])

  const scene = useMemo(() => bakeLayers(slides[index]), [slides, index]) // layer flags → objects
  const shown = revealed[scene.id] ?? EMPTY
  const hiddenCount = scene.objects.filter(o => o.studentHidden).length

  function toggleReveal(uid: string) {
    setRevealed(prev => {
      const next = new Set(prev[scene.id] ?? [])
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return { ...prev, [scene.id]: next }
    })
  }

  return (
    <div data-testid="preview" style={{
      position: 'fixed', inset: 0, zIndex: 100, background: '#111827', display: 'flex', flexDirection: 'column', alignItems: 'center',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 16px', width: '100%', color: '#e5e7eb', fontSize: 13 }}>
        <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid #374151' }}>
          {(['student', 'teacher'] as const).map(r => (
            <button key={r} onClick={() => setRole(r)} aria-pressed={role === r} style={{
              padding: '5px 12px', border: 'none', fontSize: 13,
              background: role === r ? '#4a90e2' : 'transparent', color: role === r ? '#fff' : '#9ca3af',
            }}>{r === 'student' ? 'Видит ученик' : 'Видит учитель'}</button>
          ))}
        </div>
        <span style={{ color: '#9ca3af' }}>
          {role === 'teacher' && hiddenCount > 0 && 'Бледные объекты скрыты от учеников — клик открывает/закрывает'}
          {role === 'student' && scene.objects.some(o => o.studentDraggable) && 'Объекты с ✋ можно перетаскивать'}
        </span>
        <span style={{ flex: 1 }} />
        <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0} style={navBtn}>←</button>
        <span>{index + 1} / {slides.length}</span>
        <button onClick={() => setIndex(i => Math.min(slides.length - 1, i + 1))} disabled={index === slides.length - 1} style={navBtn}>→</button>
        <button onClick={onClose} style={{ ...navBtn, marginLeft: 12 }} title="Закрыть (Esc)">✕</button>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
        <div style={{ boxShadow: '0 10px 40px rgba(0,0,0,.5)' }}>
          <SlidePlayer
            key={scene.id} scene={scene} resolveMedia={resolve} role={role} revealed={shown}
            positions={positions[scene.id]} canDrag onToggleReveal={toggleReveal} width={size}
            onMove={(uid, left, top) => setPositions(prev => ({ ...prev, [scene.id]: { ...prev[scene.id], [uid]: { left, top } } }))}
          />
        </div>
      </div>
    </div>
  )
}

const EMPTY: ReadonlySet<string> = new Set()

function fit(): number {
  return Math.floor(Math.min(window.innerWidth - 48, ((window.innerHeight - 90) * SLIDE_WIDTH) / SLIDE_HEIGHT))
}

const navBtn: React.CSSProperties = {
  padding: '4px 12px', borderRadius: 4, border: '1px solid #374151', background: 'transparent', color: '#e5e7eb', fontSize: 14,
}

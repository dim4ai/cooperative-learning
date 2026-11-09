// Slides of a block: thumbnail strip + editor of the current slide + preview.
import { useEffect, useState } from 'react'
import type { Scene } from '../types'
import type { Media } from '../lessonFile'
import { emptyScene, thumbnail } from './scene'
import { SlideEditor } from './SlideEditor'
import { PreviewOverlay } from './PreviewOverlay'
import { nanoid } from '../nanoid'

interface Props {
  slides: Scene[]
  media: Media
  onAddMedia: (name: string, blob: Blob) => void
  /** Receives an updater: slides are edited asynchronously, always apply to the latest list */
  onChange: (update: (slides: Scene[]) => Scene[]) => void
  onError: (text: string) => void
  /** A work block: these are sheets students write on, not slides to show */
  sheet?: boolean
}

export function SlidesSection({ slides, media, onAddMedia, onChange, onError, sheet }: Props) {
  const word = sheet ? 'лист' : 'слайд'
  const [currentId, setCurrentId] = useState<string | null>(slides[0]?.id ?? null)
  const [preview, setPreview] = useState(false)
  const index = Math.max(0, slides.findIndex(s => s.id === currentId))
  const current = slides[index] as Scene | undefined

  function insertAfter(afterId: string | null, fresh: Scene[], select = true) {
    onChange(list => {
      const i = afterId ? list.findIndex(s => s.id === afterId) : list.length - 1
      return [...list.slice(0, i + 1), ...fresh, ...list.slice(i + 1)]
    })
    if (select && fresh.length) setCurrentId(fresh[0].id)
  }

  function addSlide() {
    insertAfter(current?.id ?? null, [emptyScene()])
  }

  function duplicateSlide(s: Scene) {
    const copy: Scene = { ...structuredClone(s), id: nanoid(), objects: s.objects.map(o => ({ ...structuredClone(o), uid: nanoid() })) }
    insertAfter(s.id, [copy])
  }

  function removeSlide(s: Scene) {
    if (s.objects.length && !confirm(`Удалить ${word} вместе с содержимым?`)) return
    const i = slides.findIndex(x => x.id === s.id)
    const next = slides[i + 1] ?? slides[i - 1]
    onChange(list => list.filter(x => x.id !== s.id))
    setCurrentId(next?.id ?? null)
  }

  function moveSlide(s: Scene, dir: -1 | 1) {
    onChange(list => {
      const i = list.findIndex(x => x.id === s.id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= list.length) return list
      const copy = [...list]
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
      return copy
    })
  }

  if (!current) {
    return (
      <button onClick={addSlide} style={dashedBtn}>
        + Добавить {word} (текст, картинки, страницы PDF, фигуры — слоями)
      </button>
    )
  }

  return (
    <div>
      <div data-testid="slide-strip" style={{ display: 'flex', gap: 8, alignItems: 'stretch', overflowX: 'auto', paddingBottom: 6, marginBottom: 8 }}>
        {slides.map((s, i) => (
          <div key={s.id} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <button onClick={() => setCurrentId(s.id)} title={`${sheet ? 'Лист' : 'Слайд'} ${i + 1}`} aria-pressed={s.id === current.id} style={{
              padding: 0, borderRadius: 4, overflow: 'hidden', lineHeight: 0, background: '#fff',
              border: `2px solid ${s.id === current.id ? '#4a90e2' : '#e5e7eb'}`,
            }}>
              <Thumb scene={s} media={media} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 11, color: '#6b7280' }}>
              <span style={{ marginRight: 'auto' }}>{i + 1}{s.note ? <span title="Есть заметка" style={{ marginLeft: 4, color: '#b45309' }}>✎</span> : null}</span>
              {s.id === current.id && (
                <>
                  <Mini title="Левее" disabled={i === 0} onClick={() => moveSlide(s, -1)}>←</Mini>
                  <Mini title="Правее" disabled={i === slides.length - 1} onClick={() => moveSlide(s, 1)}>→</Mini>
                  <Mini title={`Дублировать ${word}`} onClick={() => duplicateSlide(s)}>⧉</Mini>
                  <Mini title={`Удалить ${word}`} onClick={() => removeSlide(s)}>✕</Mini>
                </>
              )}
            </div>
          </div>
        ))}
        <button onClick={addSlide} title={sheet ? 'Новый лист' : 'Новый слайд'} style={{ ...dashedBtn, width: 70, flexShrink: 0, fontSize: 20, textAlign: 'center' }}>+</button>
        <span style={{ flex: 1 }} />
        <button onClick={() => setPreview(true)} title="Как увидят ученик и учитель" style={{
          alignSelf: 'flex-start', flexShrink: 0, padding: '6px 12px', borderRadius: 4, border: 'none',
          background: '#1e1e2e', color: '#fff', fontSize: 13,
        }}>▶ Просмотр</button>
      </div>

      {sheet && (
        <div data-testid="sheet-hint" style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
          Фиолетовая рамка — лист ученика целиком, у всех он выглядит одинаково. Что вы положите, ученик не сможет стереть. Пустое место в рамке остаётся ему для записей.
        </div>
      )}
      <SlideEditor
        key={current.id}
        sheet={sheet}
        scene={current}
        media={media}
        onAddMedia={onAddMedia}
        // The editor rebuilds a scene from its canvas and knows nothing of the note
        onChange={scene => onChange(list => list.map(s => (s.id === scene.id ? { ...scene, note: s.note } : s)))}
        onError={onError}
        onInsertSlides={(fresh, replace) => {
          if (!replace) return insertAfter(current.id, fresh, false)
          onChange(list => list.flatMap(s => (s.id === current.id ? fresh : [s])))
          setCurrentId(fresh[0].id)
        }}
      />

      <label style={{ display: 'block', marginTop: 12, fontSize: 12, fontWeight: 600, color: '#6b7280' }}>
        Заметка к {sheet ? 'листу' : 'слайду'} {index + 1} (только вам)
        <textarea
          data-testid="slide-note"
          value={current.note ?? ''}
          onChange={e => {
            const note = e.target.value || undefined
            onChange(list => list.map(s => (s.id === current.id ? { ...s, note } : s)))
          }}
          rows={3}
          placeholder="Что сказать на этом шаге, на что обратить внимание..."
          style={{
            display: 'block', width: '100%', marginTop: 4, padding: '8px 10px', borderRadius: 5, outline: 'none', resize: 'vertical',
            fontSize: 14, fontWeight: 400, color: '#92400e', background: '#fffbeb', border: '1px solid #fcd34d',
          }}
        />
      </label>

      {preview && <PreviewOverlay slides={slides} media={media} start={index} onClose={() => setPreview(false)} />}
    </div>
  )
}

function Thumb({ scene, media }: { scene: Scene; media: Media }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    thumbnail(scene, media).then(url => { if (alive) setSrc(url) }).catch(() => {})
    return () => { alive = false }
  }, [scene, media])
  return src
    ? <img src={src} alt="" width={160} height={90} style={{ display: 'block', width: 160, height: 90 }} />
    : <div style={{ width: 160, height: 90, background: scene.background }} />
}

function Mini({ title, disabled, onClick, children }: { title: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button title={title} aria-label={title} disabled={disabled} onClick={onClick} style={{
      width: 22, height: 20, padding: 0, fontSize: 11, borderRadius: 3, border: '1px solid #e5e7eb',
      background: '#fff', color: '#374151', opacity: disabled ? 0.35 : 1,
    }}>{children}</button>
  )
}

const dashedBtn: React.CSSProperties = {
  padding: '7px 12px', borderRadius: 4, border: '1px dashed #d1d5db', background: 'transparent', color: '#6b7280', fontSize: 13,
}

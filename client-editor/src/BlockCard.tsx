import { useRef } from 'react'
import type { LessonBlock, Attachment } from './types'
import { BLOCK_LABELS, TECHNIQUES, kindFromName } from './types'
import { pickMediaFiles } from './fileAccess'
import { uniqueName, type Media } from './lessonFile'
import { SceneEditor, emptyScene } from './SceneEditor'

interface Props {
  block: LessonBlock
  media: Media
  onAddMedia: (name: string, blob: Blob) => void
  onChange: (block: LessonBlock) => void
  onDelete: () => void
  onError: (text: string) => void
}

export function BlockCard({ block, media, onAddMedia, onChange, onDelete, onError }: Props) {
  // SceneEditor emits asynchronously — merge into the latest block, not a stale one
  const latest = useRef(block)
  latest.current = block

  function attach(files: File[]) {
    if (!files.length) return
    const taken: Media = { ...media }
    const added: Attachment[] = []
    for (const f of files) {
      const name = uniqueName(f.name, taken)
      taken[name] = f
      onAddMedia(name, f)
      added.push({ name, kind: kindFromName(name) })
    }
    onChange({ ...block, attachments: [...block.attachments, ...added] })
  }

  async function addAttachment() {
    attach(await pickMediaFiles())
  }

  function openAttachment(name: string) {
    const blob = media[name]
    if (!blob) return
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  function removeAttachment(name: string) {
    onChange({ ...block, attachments: block.attachments.filter(a => a.name !== name) })
  }

  const hasTask = block.type === 'individual' || block.type === 'pairs' || block.type === 'fours'
  const hasTechnique = block.type === 'pairs' || block.type === 'fours'

  return (
    <div style={{ padding: 32, maxWidth: 1180 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <div style={{
          padding: '3px 10px', borderRadius: 4, fontSize: 11,
          background: typeColor(block.type), color: '#fff', fontWeight: 600, letterSpacing: 0.5,
        }}>
          {BLOCK_LABELS[block.type].toUpperCase()}
        </div>
        <button onClick={onDelete} style={{
          marginLeft: 'auto', padding: '4px 12px', borderRadius: 4, border: 'none',
          background: '#fee2e2', color: '#b91c1c', fontSize: 12,
        }}>
          Удалить
        </button>
      </div>

      <Field label="Слайд">
        {block.scene ? (
          <SceneEditor
            key={block.id}
            scene={block.scene}
            media={media}
            onAddMedia={onAddMedia}
            onChange={scene => onChange({ ...latest.current, scene })}
            onError={onError}
          />
        ) : (
          <button onClick={() => onChange({ ...block, scene: emptyScene() })} style={{
            padding: '7px 12px', borderRadius: 4, border: '1px dashed #d1d5db',
            background: 'transparent', color: '#6b7280', fontSize: 13,
          }}>
            + Добавить слайд (текст, картинки, страницы PDF слоями)
          </button>
        )}
      </Field>

      <div style={{ maxWidth: 680 }}>
      <Field label="Название этапа">
        <input
          value={block.title}
          onChange={e => onChange({ ...block, title: e.target.value })}
          style={inputStyle}
        />
      </Field>

      <Field label="Длительность (минут)">
        <input
          type="number" min={1}
          value={block.duration}
          onChange={e => onChange({ ...block, duration: Number(e.target.value) })}
          style={{ ...inputStyle, width: 80 }}
        />
      </Field>

      {hasTask && (
        <Field label="Задание (видят ученики)">
          <textarea
            value={(block as any).task}
            onChange={e => onChange({ ...block, task: e.target.value } as LessonBlock)}
            rows={5}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>
      )}

      {hasTechnique && (
        <Field label="Техника Кагана">
          <select
            value={(block as any).technique}
            onChange={e => onChange({ ...block, technique: e.target.value } as LessonBlock)}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            {TECHNIQUES.map(t => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </Field>
      )}

      <Field label="Заметка учителя (только вам)">
        <textarea
          value={block.teacherNote}
          onChange={e => onChange({ ...block, teacherNote: e.target.value })}
          rows={3}
          placeholder="Что сказать, на что обратить внимание..."
          style={{ ...inputStyle, resize: 'vertical', color: '#92400e', background: '#fffbeb', borderColor: '#fcd34d' }}
        />
      </Field>

      <Field label="Прикреплённые файлы">
        <div
          onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault() }}
          onDrop={e => { e.preventDefault(); attach(Array.from(e.dataTransfer.files)) }}
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          {block.attachments.map(a => (
            <div key={a.name} style={{
              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px',
              background: '#fff', borderRadius: 4, border: '1px solid #e5e7eb',
            }}>
              <span style={{ fontSize: 11, color: '#9ca3af', width: 36 }}>{kindIcon(a.kind)}</span>
              <span
                onClick={() => openAttachment(a.name)}
                title={media[a.name] ? 'Открыть' : 'Файл отсутствует'}
                style={{
                  flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                  color: media[a.name] ? '#374151' : '#b91c1c', cursor: media[a.name] ? 'pointer' : 'default',
                }}
              >
                {a.name}
              </span>
              <span style={{ fontSize: 11, color: '#9ca3af' }}>{media[a.name] ? formatSize(media[a.name].size) : 'нет файла'}</span>
              <button onClick={() => removeAttachment(a.name)} style={{
                padding: '2px 8px', borderRadius: 3, border: 'none',
                background: '#fee2e2', color: '#b91c1c', fontSize: 11,
              }}>
                ✕
              </button>
            </div>
          ))}
          <button onClick={addAttachment} style={{
            padding: '7px 12px', borderRadius: 4, border: '1px dashed #d1d5db',
            background: 'transparent', color: '#6b7280', fontSize: 13, textAlign: 'left',
          }}>
            + Добавить файл (или перетащите сюда)
          </button>
        </div>
      </Field>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#6b7280', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </label>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', borderRadius: 5,
  border: '1px solid #d1d5db', fontSize: 14, background: '#fff', outline: 'none',
}

function typeColor(type: LessonBlock['type']): string {
  return { group: '#4a90e2', individual: '#7c3aed', pairs: '#059669', fours: '#d97706' }[type]
}

function kindIcon(kind: Attachment['kind']): string {
  return { image: 'IMG', pdf: 'PDF', video: 'VID' }[kind]
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

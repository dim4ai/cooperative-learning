import type { LessonMeta } from './types'

interface Props {
  meta: LessonMeta
  onChange: (meta: LessonMeta) => void
}

export function MetaPanel({ meta, onChange }: Props) {
  function set(key: keyof LessonMeta, value: string) {
    onChange({ ...meta, [key]: value })
  }

  return (
    <div style={{ padding: 32, maxWidth: 680 }}>
      <div style={{ fontSize: 18, fontWeight: 600, color: '#1a1a1a', marginBottom: 24 }}>
        Свойства урока
      </div>

      <Field label="Название урока">
        <input
          value={meta.title}
          onChange={e => set('title', e.target.value)}
          placeholder="Например: Дроби. Сложение и вычитание"
          style={inputStyle}
        />
      </Field>

      <Field label="Предмет">
        <input
          value={meta.subject}
          onChange={e => set('subject', e.target.value)}
          placeholder="Математика"
          style={inputStyle}
        />
      </Field>

      <Field label="Класс">
        <input
          value={meta.grade}
          onChange={e => set('grade', e.target.value)}
          placeholder="6"
          style={{ ...inputStyle, width: 120 }}
        />
      </Field>

      <Field label="Автор">
        <input
          value={meta.author}
          onChange={e => set('author', e.target.value)}
          placeholder="Иванова А.В."
          style={inputStyle}
        />
      </Field>

      <Field label="Дата">
        <input
          type="date"
          value={meta.createdAt}
          onChange={e => set('createdAt', e.target.value)}
          style={{ ...inputStyle, width: 180 }}
        />
      </Field>
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

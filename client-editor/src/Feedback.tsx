// «Написать нам»: an error, an idea or a review. The editor has no server of its own: the letter
// goes to the main API (POST /feedback), which mails it to our box (the address is only in its .env).
// Same form as pair's (pair/client/src/feedback.ts).
import { useEffect, useRef, useState } from 'react'

const KINDS = [
  { id: 'bug', label: 'Ошибка', hint: 'Что делали, что ожидали, что вышло. Чем подробнее, тем быстрее найдём.' },
  { id: 'idea', label: 'Предложение', hint: 'Чего не хватает в редакторе, что сделать удобнее.' },
  { id: 'other', label: 'Отзыв', hint: 'Как вам редактор, что понравилось, что нет.' },
] as const

const ERRORS: Record<string, string> = {
  'too many': 'Слишком много писем подряд. Попробуйте через час.',
  'not configured': 'Отправка писем пока не настроена. Попробуйте позже.',
  empty: 'Напишите хотя бы пару слов.',
}

async function send(letter: { kind: string; text: string; contact: string; where: string }): Promise<string | null> {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/feedback`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ app: 'editor', ...letter }),
      signal: AbortSignal.timeout(40_000),
    })
    if (res.ok) return null
    const { error } = await res.json().catch(() => ({ error: '' }))
    return ERRORS[error] ?? 'Не получилось отправить. Попробуйте позже.'
  } catch {
    return 'Нет связи с сервером. Проверьте интернет.'
  }
}

/** `where` — which screen it came from; never the lesson itself */
export function FeedbackDialog({ where, onClose }: { where: string; onClose: () => void }) {
  const [kind, setKind] = useState<(typeof KINDS)[number]['id']>('bug')
  const [text, setText] = useState('')
  const [contact, setContact] = useState('')
  const [state, setState] = useState<{ text: string; error?: boolean } | null>(null)
  const [sending, setSending] = useState(false)
  const [done, setDone] = useState(false)
  const textRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setSending(true)
    setState({ text: 'Отправляем…' })
    const error = await send({ kind, text, contact, where: `${where}; окно ${innerWidth}×${innerHeight}` })
    setSending(false)
    if (error) setState({ text: error, error: true })
    else { setDone(true); setState(null) }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Написать нам" data-testid="feedback"
      // the slide below has its own shortcuts: typing here mustn't trigger them
      onKeyDown={e => e.stopPropagation()}
      onPointerDown={e => { if (e.target === e.currentTarget) onClose() }}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
      <form onSubmit={submit} style={{ background: '#fff', borderRadius: 8, width: 460, maxWidth: '100%', boxShadow: '0 8px 32px rgba(0,0,0,.3)', color: '#1f2937' }}>
        <div style={{ padding: '14px 18px', borderBottom: '1px solid #e5e7eb', fontWeight: 600 }}>Написать нам</div>
        <div style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {done ? (
            <p data-testid="feedback-done" style={{ margin: 0 }}>Спасибо! Письмо отправлено{contact.trim() ? ', ответим по указанному адресу' : ''}.</p>
          ) : <>
            <div role="radiogroup" aria-label="О чём письмо" style={{ display: 'flex', gap: 6 }}>
              {KINDS.map(k => (
                <label key={k.id} style={{
                  flex: 1, textAlign: 'center', padding: '6px 4px', borderRadius: 5, cursor: 'pointer', fontSize: 13,
                  border: `1px solid ${kind === k.id ? '#4a90e2' : '#d1d5db'}`, background: kind === k.id ? '#dbeafe' : '#fff',
                }}>
                  <input type="radio" name="kind" value={k.id} checked={kind === k.id} onChange={() => setKind(k.id)}
                    style={{ position: 'absolute', opacity: 0, pointerEvents: 'none' }} />
                  {k.label}
                </label>
              ))}
            </div>
            <textarea ref={textRef} rows={7} maxLength={4000} required aria-label="Текст письма" value={text}
              placeholder={KINDS.find(k => k.id === kind)!.hint} onChange={e => { setText(e.target.value); if (state?.error) setState(null) }}
              style={{ resize: 'vertical', padding: 8, borderRadius: 5, border: '1px solid #d1d5db', font: 'inherit', fontSize: 14 }} />
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
              <span>Как вам ответить <span style={{ color: '#9ca3af' }}>(необязательно)</span></span>
              <input maxLength={200} autoComplete="email" placeholder="почта, телефон или телеграм" value={contact}
                onChange={e => setContact(e.target.value)}
                style={{ padding: '6px 8px', borderRadius: 5, border: '1px solid #d1d5db', font: 'inherit', fontSize: 14 }} />
            </label>
            <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>
              К письму приложим только название экрана, браузер и размер окна. Сам урок не отправляем.
            </p>
            {state && <p role="status" data-testid="feedback-state" style={{ margin: 0, fontSize: 13, color: state.error ? '#b91c1c' : '#6b7280' }}>{state.text}</p>}
          </>}
        </div>
        <div style={{ padding: '12px 18px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" onClick={onClose} style={{ padding: '6px 14px', borderRadius: 5, border: '1px solid #d1d5db', background: '#fff' }}>Закрыть</button>
          {!done && <button type="submit" disabled={sending} style={{ padding: '6px 14px', borderRadius: 5, border: 'none', background: '#4a90e2', color: '#fff' }}>Отправить</button>}
        </div>
      </form>
    </div>
  )
}

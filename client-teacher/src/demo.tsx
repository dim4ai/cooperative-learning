import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

export interface DemoTimes { endsAt: number; noStudentsAt: number | null }
export interface DemoEnd { token: string; reason: string | null; retryAfterSeconds: number }

const WARN_LAST_MS = 5 * 60 * 1000;

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** What is left of the demo lesson, always in sight of the teacher */
export function DemoBanner({ times, clockSkew }: { times: DemoTimes; clockSkew: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const serverNow = now + clockSkew;
  const left = times.endsAt - serverNow;
  const ending = left <= WARN_LAST_MS;
  const urgent = ending || times.noStudentsAt !== null;
  return (
    <div data-testid="demo-banner" style={{
      padding: '6px 16px', fontSize: 13, display: 'flex', flexWrap: 'wrap', gap: '2px 16px',
      background: urgent ? '#fdf1d6' : '#eef3fa', color: urgent ? '#8a5a00' : '#46607f',
    }}>
      <span data-testid="demo-left">{ending ? `Демо-урок закончится через ${clock(left)}` : `Демо-урок: осталось ${clock(left)}`}</span>
      {times.noStudentsAt !== null && (
        <span data-testid="demo-no-students">Если никто не войдёт, занятие закроется через {clock(times.noStudentsAt - serverNow)}</span>
      )}
    </div>
  );
}

function endText({ reason, retryAfterSeconds }: DemoEnd): string {
  const headline = reason === 'time is up' ? 'Час закончился.'
    : reason === 'no students' ? 'За 10 минут никто не вошёл, поэтому занятие закрылось.'
    : 'Демо-урок завершён.';
  if (retryAfterSeconds <= 0) return headline;
  return `${headline} Новый урок с этого адреса можно начать через ${Math.ceil(retryAfterSeconds / 60)} мин.`;
}

// The point of the demo: what the teacher thought of it
export function DemoFinished({ end, onAgain }: { end: DemoEnd; onAgain: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function send() {
    setSending(true);
    setError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/demo/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${end.token}` },
        body: JSON.stringify({ rating, comment, email }),
      });
      if (res.ok) setSent(true);
      else setError('Не удалось отправить отзыв');
    } catch {
      setError('Нет связи с сервером');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={screen}>
      <div style={{ width: 400, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Спасибо, что попробовали</h2>
        <div data-testid="demo-end-text" style={{ color: '#666', fontSize: 14, lineHeight: 1.4 }}>{endText(end)}</div>
        {sent ? <div data-testid="demo-feedback-sent" style={{ color: '#27ae60' }}>Отзыв получен. Спасибо!</div> : <>
          <div style={{ fontSize: 14 }}>Как вам урок?</div>
          <div role="radiogroup" aria-label="Оценка" style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} role="radio" aria-checked={rating === n} onClick={() => setRating(n)} style={{
                flex: 1, padding: '8px 0', borderRadius: 6, cursor: 'pointer', fontSize: 15, color: '#222',
                border: rating === n ? '1px solid #4a90e2' : '1px solid #ccc', background: rating === n ? '#e7f1fc' : '#fff',
              }}>{n}</button>
            ))}
          </div>
          <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={4000} rows={4}
            placeholder="Что понравилось, чего не хватило, что мешало?" style={input} />
          <input value={email} onChange={e => setEmail(e.target.value)} maxLength={200} autoCapitalize="none"
            placeholder="Почта, если хотите получить ответ" style={input} />
          {error && <div style={{ color: '#e74c3c', fontSize: 13 }}>{error}</div>}
          <button data-testid="demo-feedback-send" onClick={send} disabled={!rating || sending} style={{
            padding: '10px 0', borderRadius: 6, border: 'none', background: '#4a90e2', color: '#fff', fontSize: 15,
            cursor: 'pointer', opacity: !rating || sending ? 0.5 : 1,
          }}>{sending ? 'Отправляем…' : 'Отправить отзыв'}</button>
        </>}
        <button onClick={onAgain} style={{ border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13 }}>
          К началу демо
        </button>
      </div>
    </div>
  );
}

const screen: CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'sans-serif', padding: 24, boxSizing: 'border-box',
};
const input: CSSProperties = {
  fontSize: 14, padding: 8, borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box', width: '100%', fontFamily: 'inherit',
};

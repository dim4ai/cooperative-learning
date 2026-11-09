import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

export interface DemoTimes { endsAt: number; noStudentsAt: number | null; solo?: boolean }
export interface DemoEnd { token: string; reason: string | null }

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

function endText({ reason }: DemoEnd): string {
  return reason === 'time is up' ? 'Час закончился.'
    : reason === 'no teacher' ? 'Вы вышли из урока, поэтому он завершился.'
    : reason === 'no students' ? 'За 15 минут после начала никто не вошёл, поэтому занятие закрылось.'
    : 'Демо-урок завершён.';
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

// ---------- how to try it: alone at once, or with a class on a booked time ----------

export function DemoChoice({ onSolo, onBook, onBack }: { onSolo: () => Promise<string | null>; onBook: () => void; onBack: () => void }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  async function solo() {
    setStarting(true);
    setError((await onSolo()) ?? '');
    setStarting(false);
  }
  return (
    <div style={screen}>
      <div style={{ width: 460, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0 }}>Попробовать Co-Learn</h2>
        <div style={card}>
          <b>Одному, прямо сейчас</b>
          <div style={cardText}>
            Проведите короткий урок с виртуальным классом: восемь учеников рассядутся как попало, вы соберёте их за парты, а они будут решать и звать вас на помощь.
            Камера и микрофон не нужны, займёт 10–15 минут.
          </div>
          <button data-testid="solo-start" onClick={solo} disabled={starting} style={{ ...primary, opacity: starting ? 0.5 : 1 }}>
            {starting ? 'Собираем класс…' : 'Начать урок с виртуальным классом'}
          </button>
          {error && <div data-testid="solo-error" style={{ color: '#e74c3c', fontSize: 13 }}>{error}</div>}
        </div>
        <div style={card}>
          <b>Со своим классом</b>
          <div style={cardText}>
            Забронируйте время: код для учеников будет сразу, а место останется за вами. До 32 учеников, урок идёт час.
          </div>
          <button data-testid="book-open" onClick={onBook} style={{ ...primary, background: 'transparent', color: '#4a90e2', border: '1px solid #4a90e2' }}>
            Забронировать занятие
          </button>
        </div>
        <button onClick={onBack} style={{ border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13 }}>Назад</button>
      </div>
    </div>
  );
}

export async function startSolo(): Promise<{ code: string; token: string } | { error: string }> {
  try {
    const res = await fetch(`${import.meta.env.VITE_API_URL}/demo/solo`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.token) return { code: body.code, token: body.token };
    if (body.error === 'slow down') return { error: 'Слишком много попыток, подождите немного' };
    if (body.error === 'barred') return { error: `С этого адреса был запуск без входа в урок. Попробуйте через ${Math.ceil((Number(body.retryAfterSeconds) || 60) / 60)} мин` };
    if (body.error === 'ip busy' || body.error === 'busy') return { error: 'Сейчас слишком много пробных уроков, попробуйте через минуту' };
    return { error: 'Не удалось начать, попробуйте ещё раз' };
  } catch {
    return { error: 'Нет связи с сервером' };
  }
}

const GUIDE: Record<string, { title: string; steps: string[] }> = {
  waiting: { title: 'Рассадка', steps: [
    'Ученики заходят и садятся как попало. Ряд за партой — это пара, вся парта — четвёрка.',
    'Соберите их за две парты: кликните по ученику, потом по свободному месту или по другому ученику, и они поменяются местами.',
    'Крестик поднимает ученика с места, и он сам садится на другое.',
    'Мест в классе можно поменять слева: от 8 до 32.',
    'Пока ученики рассаживаются, пролистайте урок во вкладке «Просмотр урока» наверху.',
    'Когда все будут на местах, нажмите слева «Начать урок».',
  ] },
  group: { title: 'Объяснение', steps: [
    'Слайд уже на доске, его видят все ученики. Рисуйте прямо поверх него и листайте стрелками.',
    'Скрытый ответ откройте инструментом ☝, когда ученики подумают.',
    'В конце нажмите «Всем понятно?». Красные рамки покажут, кто не понял, и останутся на карте.',
    'Затем выберите следующий блок в плане слева.',
  ] },
  individual: { title: 'Индивидуальная работа', steps: [
    'Каждый думает сам, у каждого своя доска. Вы не прерываете класс.',
    'Кто-то позовёт вас: на его месте появится 🔔. Нажмите на колокольчик, и вы окажетесь у доски ученика.',
    'Напишите подсказку и вернитесь кнопкой «← Назад». Затем слева выберите «Пары».',
  ] },
  pairs: { title: 'Пары', steps: [
    'Ученики сами разошлись по парам, у пары общая доска.',
    'В живом уроке здесь говорит весь класс сразу, но каждая пара слышит только себя.',
    'Одна пара ошибётся и позовёт вас. Нажмите 🔔, подскажите на доске и дождитесь исправления. Затем выберите «Четвёрки».',
  ] },
  fours: { title: 'Четвёрки', steps: [
    'Пары объединились: каждая сравнивает свой список с соседней.',
    'Нажмите 🔔 у группы, которая зовёт. Остальные продолжают работать.',
    'Это весь цикл урока. Нажмите слева «Завершить урок» и расскажите, что думаете.',
  ] },
};

/** The solo demo has nobody to explain it: this says what to do on each stage */
export function SoloGuide({ stage, calls }: { stage: string; calls: string[] }) {
  const part = GUIDE[stage] ?? GUIDE.waiting;
  return (
    <div data-testid="solo-guide" style={{ fontSize: 13, lineHeight: 1.45, color: '#333', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 11, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>Подсказка</div>
      <b style={{ fontSize: 15 }}>{part.title}</b>
      {part.steps.map(step => <div key={step}>{step}</div>)}
      {calls.map(note => (
        <div key={note} data-testid="solo-call" style={{ padding: 10, borderRadius: 8, background: '#fdf1d6', color: '#8a5a00' }}>
          <div style={{ fontSize: 11, marginBottom: 2 }}>Вас зовут</div>«{note}»
        </div>
      ))}
    </div>
  );
}

const card: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, padding: 16, borderRadius: 10, border: '1px solid #e2e2e2' };
const cardText: CSSProperties = { color: '#666', fontSize: 14, lineHeight: 1.4 };
const primary: CSSProperties = { padding: '10px 12px', borderRadius: 6, border: 'none', background: '#4a90e2', color: '#fff', fontSize: 15, cursor: 'pointer' };

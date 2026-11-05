import { useEffect, useMemo, useState } from 'react';
import { DEMO_MODES, ModeButton, columnStyle, mainButton, screenStyle, type DemoStart, type VideoMode } from './MediaSetup';
import { MediaCheck, saveMediaPrefs, type MediaPrefs } from './mediaCheck';

const API = import.meta.env.VITE_API_URL;
const TOKEN_KEY = 'demoBooking'; // a booking has no account: this token is the only way back to it
const FIRST_HOUR = 7;  // the day shown runs in the teacher's own time
const LAST_HOUR = 21;

interface Booking { code: string; videoMode: VideoMode; startsAt: number; opensAt: number; endsAt: number; status: string; now: number }
interface Slot { startsAt: number; teacher: boolean; none: boolean }

function tokenFromLink(): string | null {
  return new URLSearchParams(location.hash.slice(1)).get('booking');
}

export const hasBookingLink = () => !!tokenFromLink();

function loadToken(): string | null {
  const fromLink = tokenFromLink();
  if (fromLink) return fromLink;
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function saveToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* the link still works */ }
  if (!token && tokenFromLink()) history.replaceState(null, '', location.pathname + location.search);
}

const dayKey = (t: number) => new Date(t).toDateString();
const dayText = (t: number) => new Date(t).toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' });
const timeText = (t: number) => new Date(t).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const dateTimeText = (t: number) => `${new Date(t).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}, ${timeText(t)}`;

function refusalText(error: string, seconds: number): string {
  if (error === 'slow down') return `Слишком много попыток. Подождите ${Math.ceil(seconds / 60)} мин и не обновляйте страницу`;
  if (error === 'ip busy') return 'С вашего интернет-адреса уже есть бронь. В школе адрес обычно общий на всех';
  if (error === 'barred') return `Прошлая бронь с этого адреса осталась пустой. Новую можно сделать через ${Math.ceil(seconds / 3600)} ч`;
  if (error === 'no slots') return 'Это время только что заняли, выберите другое';
  return 'Не удалось забронировать, попробуйте ещё раз';
}

function Picker({ onBooked, onBack }: { onBooked: (token: string, b: Booking) => void; onBack: () => void }) {
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [videoMode, setVideoMode] = useState<VideoMode>('teacher');
  const [day, setDay] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    try {
      const res = await fetch(`${API}/demo/slots`);
      if (!res.ok) throw new Error();
      setSlots((await res.json()).slots);
    } catch {
      setError('Нет связи с сервером');
    }
  }
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => (slots ?? []).filter(s => {
    const hour = new Date(s.startsAt).getHours();
    return hour >= FIRST_HOUR && hour <= LAST_HOUR;
  }), [slots]);
  const days = useMemo(() => [...new Map(shown.map(s => [dayKey(s.startsAt), s.startsAt])).entries()], [shown]);
  const today = day && days.some(([k]) => k === day) ? day : days[0]?.[0];
  const isFree = (s: Slot) => videoMode === 'none' ? s.none : s.teacher;

  async function book() {
    setSending(true);
    setError('');
    try {
      const res = await fetch(`${API}/demo/bookings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ startsAt: chosen, videoMode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.token) {
        setError(refusalText(String(body.error), Number(body.retryAfterSeconds) || 0));
        setChosen(null);
        load();
        return;
      }
      onBooked(body.token, body.booking);
    } catch {
      setError('Нет связи с сервером');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={screenStyle}>
      <div style={{ ...columnStyle, width: 460 }}>
        <h3 style={{ margin: 0 }}>Забронировать демо-урок</h3>
        <div style={{ color: '#666', fontSize: 13, lineHeight: 1.4 }}>
          Выберите время заранее: код для учеников будет сразу, а место останется за вами. Без регистрации и журнала,
          до 32 учеников, урок идёт час, вход открывается за 15 минут. Время указано ваше.
        </div>
        <div role="radiogroup" aria-label="Видео на занятии" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {DEMO_MODES.map(m => <ModeButton key={m} mode={m} chosen={videoMode === m} onChoose={() => { setVideoMode(m); setChosen(null); }} />)}
        </div>
        {!slots && !error && <div style={{ color: '#888', fontSize: 13 }}>Загружаем расписание…</div>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {days.map(([k, t]) => <button key={k} data-testid="booking-day" onClick={() => { setDay(k); setChosen(null); }} style={chip(k === today, true)}>{dayText(t)}</button>)}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(66px, 1fr))', gap: 6 }}>
          {shown.filter(s => dayKey(s.startsAt) === today).map(s => (
            <button key={s.startsAt} data-testid="booking-time" disabled={!isFree(s)} onClick={() => setChosen(s.startsAt)}
              style={chip(chosen === s.startsAt, isFree(s))}>{timeText(s.startsAt)}</button>
          ))}
        </div>
        <button data-testid="booking-submit" onClick={book} disabled={chosen === null || sending} style={{ ...mainButton, opacity: chosen === null || sending ? 0.5 : 1 }}>
          {sending ? 'Бронируем…' : 'Забронировать'}
        </button>
        {error && <div data-testid="booking-error" style={{ color: '#e74c3c', fontSize: 13, textAlign: 'center' }}>{error}</div>}
        <button onClick={onBack} style={linkButton}>Назад</button>
      </div>
    </div>
  );
}

function Card({ token, booking, initial, onStart, onGone }: {
  token: string;
  booking: Booking;
  initial: MediaPrefs;
  onStart: (demo: DemoStart, p: MediaPrefs) => void;
  onGone: () => void;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [skew] = useState(() => booking.now - Date.now());
  const [now, setNow] = useState(Date.now);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const open = now + skew >= booking.opensAt;
  const link = `${location.origin}${location.pathname}#booking=${token}`;
  const headers = { Authorization: `Bearer ${token}` };

  async function enter() {
    setError('');
    try {
      const res = await fetch(`${API}/demo/bookings/mine/enter`, { method: 'POST', headers });
      const body = await res.json().catch(() => ({}));
      if (res.status === 410 || res.status === 404) { onGone(); return; }
      if (!res.ok || !body.token) { setError('Не удалось войти, попробуйте ещё раз'); return; }
      saveMediaPrefs(prefs);
      onStart({ code: body.code, token: body.token }, prefs);
    } catch {
      setError('Нет связи с сервером');
    }
  }

  async function cancel() {
    try {
      const res = await fetch(`${API}/demo/bookings/mine`, { method: 'DELETE', headers });
      if (res.ok || res.status === 410 || res.status === 404) onGone();
      else setError('Не удалось отменить, попробуйте ещё раз');
    } catch {
      setError('Нет связи с сервером');
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setError('Не удалось скопировать, выделите ссылку вручную');
    }
  }

  return (
    <div style={screenStyle}>
      {open && (
        <div style={columnStyle}>
          <h3 style={{ margin: 0 }}>Камера и микрофон</h3>
          <div style={{ color: '#888', fontSize: 13 }}>Проверьте себя перед занятием</div>
          <MediaCheck prefs={prefs} onChange={setPrefs} />
        </div>
      )}
      <div style={columnStyle}>
        <h3 style={{ margin: 0 }}>Ваш демо-урок</h3>
        <div data-testid="booking-when" style={{ fontSize: 15 }}>{dateTimeText(booking.startsAt)}</div>
        <div style={{ color: '#666', fontSize: 13 }}>
          {open ? 'Вход открыт' : `Вход откроется в ${timeText(booking.opensAt)}`}, урок закончится в {timeText(booking.endsAt)}
        </div>
        <div style={{ color: '#666', fontSize: 13, marginTop: 6 }}>Код для учеников</div>
        <div data-testid="booking-code" style={{ fontSize: 28, fontWeight: 600, letterSpacing: 2 }}>{booking.code}</div>
        <div style={{ color: '#666', fontSize: 13, lineHeight: 1.4, marginTop: 6 }}>
          <b>Сохраните ссылку на бронь.</b> Без неё с другого устройства в занятие не войти, а восстановить её нельзя.
        </div>
        <input data-testid="booking-link" readOnly value={link} onFocus={e => e.target.select()}
          style={{ fontSize: 12, padding: 8, borderRadius: 6, border: '1px solid #ccc', width: '100%', boxSizing: 'border-box' }} />
        <button onClick={copy} style={{ ...mainButton, background: 'transparent', color: '#4a90e2', border: '1px solid #4a90e2', fontSize: 14 }}>
          {copied ? 'Скопировано' : 'Скопировать ссылку'}
        </button>
        {open && <button data-testid="booking-enter" onClick={enter} style={mainButton}>Войти в занятие</button>}
        {error && <div data-testid="booking-error" style={{ color: '#e74c3c', fontSize: 13, textAlign: 'center' }}>{error}</div>}
        <div style={{ color: '#888', fontSize: 12, lineHeight: 1.4 }}>
          Если не войти в течение 15 минут после начала, бронь пропадёт и новую с этого адреса можно будет сделать через сутки.
          Отменить можно в любой момент, без последствий.
        </div>
        {confirming
          ? <button data-testid="booking-cancel-yes" onClick={cancel} style={{ ...linkButton, color: '#e74c3c' }}>Да, отменить бронь</button>
          : <button data-testid="booking-cancel" onClick={() => setConfirming(true)} style={linkButton}>Отменить бронь</button>}
      </div>
    </div>
  );
}

export function BookingScreen({ initial, onStart, onBack }: {
  initial: MediaPrefs;
  onStart: (demo: DemoStart, p: MediaPrefs) => void;
  onBack: () => void;
}) {
  const [token, setToken] = useState(loadToken);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token || booking) return;
    fetch(`${API}/demo/bookings/mine`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async res => {
        const body = await res.json().catch(() => ({}));
        if (res.ok && (body.booking?.status === 'booked' || body.booking?.status === 'open')) {
          saveToken(token);
          setBooking(body.booking);
        } else if (res.ok || res.status === 404) {
          saveToken(null);
          setToken(null);
        } else {
          setError('Не удалось загрузить бронь, обновите страницу');
        }
      })
      .catch(() => setError('Нет связи с сервером'));
  }, [token, booking]);

  if (error) return <div style={screenStyle}><div data-testid="booking-error" style={{ color: '#e74c3c' }}>{error}</div></div>;
  if (!token) {
    return <Picker onBack={onBack} onBooked={(t, b) => { saveToken(t); setToken(t); setBooking(b); }} />;
  }
  if (!booking) return <div style={screenStyle}><div style={{ color: '#888' }}>Загружаем бронь…</div></div>;
  return <Card token={token} booking={booking} initial={initial} onStart={onStart}
    onGone={() => { saveToken(null); setToken(null); setBooking(null); }} />;
}

const linkButton = { border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13 };

const chip = (on: boolean, enabled: boolean) => ({
  padding: '7px 8px', fontSize: 13, borderRadius: 6, cursor: enabled ? 'pointer' : 'default',
  border: on ? '1px solid #4a90e2' : '1px solid #ccc', background: on ? '#e7f1fc' : enabled ? '#fff' : '#f3f3f3',
  color: enabled ? '#222' : '#aaa', textDecoration: enabled ? 'none' : 'line-through',
});

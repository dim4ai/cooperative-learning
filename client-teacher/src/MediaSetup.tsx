import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { MediaCheck, saveMediaPrefs } from './mediaCheck';
import type { MediaPrefs } from './mediaCheck';

export type VideoMode = 'all' | 'teacherSees' | 'teacher' | 'none';
export const VIDEO_MODE_LABELS: Record<VideoMode, string> = {
  all: 'С видео',
  teacherSees: 'Учеников видит только учитель',
  teacher: 'Камера только у учителя',
  none: 'Без видео',
};
const DEMO_MODES: VideoMode[] = ['teacher', 'none'];
const VIDEO_MODE_KEY = 'videoMode';

const minutesText = (seconds: number) => `${Math.max(1, Math.ceil(seconds / 60))} мин`;

function demoRefusalText(error: string, seconds: number, videoMode: VideoMode): string {
  const wait = minutesText(seconds);
  if (error === 'slow down') return `Слишком много попыток. Подождите ${wait} и не обновляйте страницу: новые попытки продлевают паузу`;
  if (error === 'ip busy') return `С вашего интернет-адреса уже идёт демо-урок. Новый можно будет начать примерно через ${wait}`;
  if (error === 'cooldown') return `С вашего интернет-адреса недавно был демо-урок. Новый можно начать через ${wait}`;
  if (error === 'no slots') {
    return videoMode === 'teacher'
      ? `Места с камерой заняты, ближайшее освободится примерно через ${wait}. Можно попробовать «${VIDEO_MODE_LABELS.none}»`
      : `Все места заняты, ближайшее освободится примерно через ${wait}`;
  }
  return 'Демо-уроки сейчас недоступны, попробуйте позже';
}

function loadVideoMode(): VideoMode {
  try {
    const v = localStorage.getItem(VIDEO_MODE_KEY);
    return v && v in VIDEO_MODE_LABELS ? v as VideoMode : 'all';
  } catch {
    return 'all';
  }
}

const screenStyle: CSSProperties = {
  minHeight: '100vh', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', alignContent: 'center',
  justifyContent: 'center', gap: '24px 128px', fontFamily: 'sans-serif', padding: 24, boxSizing: 'border-box',
};
const columnStyle: CSSProperties = { width: 320, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 10 };

const mainButton: CSSProperties = {
  width: '100%', fontSize: 16, padding: '10px 0', borderRadius: 6, border: 'none',
  background: '#4a90e2', color: '#fff', cursor: 'pointer',
};

export interface DemoStart { code: string; token: string }

// Without an account: only the cheap video modes and nothing that needs a teacher's login.
export function DemoSetup({ initial, onStart, onBack }: {
  initial: MediaPrefs;
  onStart: (demo: DemoStart, p: MediaPrefs) => void;
  onBack: () => void;
}) {
  const [prefs, setPrefs] = useState<MediaPrefs>(initial);
  const [videoMode, setVideoMode] = useState<VideoMode>('teacher');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  // a refused page doesn't keep knocking: the button comes back when there's a point in trying
  const [blocked, setBlocked] = useState<{ until: number; mode: VideoMode | null } | null>(null);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!blocked) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [blocked]);
  const isBlocked = !!blocked && now < blocked.until && (blocked.mode === null || blocked.mode === videoMode);

  async function start() {
    setCreating(true);
    setError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/demo/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoMode }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.lesson) {
        const seconds = Number(body.retryAfterSeconds) || 0;
        setError(demoRefusalText(String(body.error), seconds, videoMode));
        if (seconds) {
          setNow(Date.now());
          setBlocked({ until: Date.now() + seconds * 1000, mode: body.error === 'no slots' ? videoMode : null });
        }
        return;
      }
      saveMediaPrefs(prefs);
      onStart({ code: body.lesson.code, token: body.token }, prefs);
    } catch {
      setError('Нет связи с сервером');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={screenStyle}>
      <div style={columnStyle}>
        <h3 style={{ margin: 0 }}>Камера и микрофон</h3>
        <div style={{ color: '#888', fontSize: 13 }}>Проверьте себя перед занятием</div>
        <MediaCheck prefs={prefs} onChange={setPrefs} />
      </div>

      <div style={columnStyle}>
        <h3 style={{ margin: 0 }}>Демо-урок</h3>
        <div style={{ color: '#666', fontSize: 13, lineHeight: 1.4 }}>
          Без регистрации и без журнала: рассадка живёт только на этом уроке. До 32 учеников, урок идёт час с момента
          нажатия кнопки. Если за 10 минут никто не войдёт, занятие закроется.
        </div>
        <div role="radiogroup" aria-label="Видео на занятии" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {DEMO_MODES.map(m => <ModeButton key={m} mode={m} chosen={videoMode === m} onChoose={() => { setVideoMode(m); setError(''); }} />)}
        </div>
        <button data-testid="demo-start" onClick={start} disabled={creating || isBlocked} style={{ ...mainButton, opacity: creating || isBlocked ? 0.5 : 1 }}>
          {creating ? 'Создаём…' : 'Новое занятие'}
        </button>
        {error && <div data-testid="demo-error" style={{ color: '#e74c3c', fontSize: 13, textAlign: 'center' }}>{error}</div>}
        <div style={{ color: '#888', fontSize: 12, lineHeight: 1.4 }}>
          С одного интернет-адреса идёт один урок, следующий можно начать через час после его окончания. В школе адрес
          обычно общий на всех.
        </div>
        <button onClick={onBack} style={{ border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13 }}>Назад</button>
      </div>
    </div>
  );
}

function ModeButton({ mode, chosen, onChoose }: { mode: VideoMode; chosen: boolean; onChoose: () => void }) {
  return (
    <button role="radio" aria-checked={chosen} onClick={onChoose} style={{
      padding: '8px 6px', fontSize: 13, borderRadius: 6, cursor: 'pointer', lineHeight: 1.2,
      border: chosen ? '1px solid #4a90e2' : '1px solid #ccc',
      background: chosen ? '#e7f1fc' : '#fff', color: '#222',
    }}>{VIDEO_MODE_LABELS[mode]}</button>
  );
}

// The teacher's start screen after login: check camera/mic, then start a new lesson or join one by code.
export function MediaSetup({ token, initial, error: lessonError, onJoin, onUnauthorized, journalLabel, onJournal, onLogout }: {
  journalLabel: string;
  onJournal: () => void;
  onLogout: () => void;
  token: string;
  initial: MediaPrefs;
  error: string;
  onJoin: (code: string, p: MediaPrefs) => void;
  onUnauthorized: () => void;
}) {
  const [prefs, setPrefs] = useState<MediaPrefs>(initial);
  const [codeInput, setCodeInput] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [videoMode, setVideoMode] = useState<VideoMode>(loadVideoMode);

  function join(code: string) {
    saveMediaPrefs(prefs);
    onJoin(code, prefs);
  }

  async function createNew() {
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ videoMode }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.lesson) {
        setCreateError(
          body.error === 'video full' ? 'Сейчас нет мест для занятий с камерой. Можно начать занятие «Без видео»'
          : body.error === 'server full' ? 'Сейчас все места для занятий заняты, попробуйте через несколько минут'
          : res.status === 429 ? 'Достигнут предел — 1000 занятий. Старые коды освобождаются через 30 дней без входа'
          : 'Не удалось создать занятие, попробуйте ещё раз');
        return;
      }
      try { localStorage.setItem(VIDEO_MODE_KEY, videoMode); } catch { /* private mode */ }
      join(body.lesson.code);
    } catch {
      setCreateError('Нет связи с сервером');
    } finally {
      setCreating(false);
    }
  }

  const code = codeInput.trim().toLowerCase();

  return (
    <div style={screenStyle}>
      <div style={columnStyle}>
        <h3 style={{ margin: 0 }}>Камера и микрофон</h3>
        <div style={{ color: '#888', fontSize: 13 }}>Проверьте себя перед занятием</div>
        <MediaCheck prefs={prefs} onChange={setPrefs} />
      </div>

      <div style={columnStyle}>
        <h3 style={{ margin: 0 }}>Занятие</h3>
        <div style={{ color: '#888', fontSize: 13 }}>Видео на занятии</div>
        <div role="radiogroup" aria-label="Видео на занятии" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {(Object.keys(VIDEO_MODE_LABELS) as VideoMode[]).map(m => (
            <ModeButton key={m} mode={m} chosen={videoMode === m} onChoose={() => setVideoMode(m)} />
          ))}
        </div>
        <button data-testid="journal-open" onClick={onJournal} style={{
          padding: '8px 10px', fontSize: 14, borderRadius: 6, border: '1px solid #ccc', background: '#fff', color: '#222', cursor: 'pointer',
        }}>{journalLabel}</button>
        <button onClick={createNew} disabled={creating} style={mainButton}>
          {creating ? 'Создаём…' : 'Новое занятие'}
        </button>
        <div style={{ color: '#888', fontSize: 13, textAlign: 'center' }}>или присоединиться к начатому</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={codeInput}
            onChange={e => setCodeInput(e.target.value)}
            placeholder="Код занятия"
            onKeyDown={e => { if (e.key === 'Enter' && code) join(code); }}
            style={{ flex: 1, minWidth: 0, fontSize: 15, padding: 8, borderRadius: 6, border: '1px solid #ccc', letterSpacing: 1 }}
          />
          <button onClick={() => code && join(code)} disabled={!code}
            style={{ ...mainButton, width: 'auto', padding: '8px 14px', fontSize: 14, opacity: code ? 1 : 0.5 }}>
            Войти
          </button>
        </div>
        {(createError || lessonError) && <div style={{ color: '#e74c3c', fontSize: 13, textAlign: 'center' }}>{createError || lessonError}</div>}
        <button onClick={onLogout} style={{ border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13 }}>Выйти</button>
      </div>
    </div>
  );
}

const sideToggle = (on: boolean): CSSProperties => ({
  flex: 1, padding: '6px 0', borderRadius: 6, border: 'none', cursor: 'pointer',
  fontSize: 15, color: '#fff', background: on ? '#27ae60' : '#e74c3c',
});

export function SidebarMediaToggles({ prefs, onChange, camAllowed = true }: { prefs: MediaPrefs; onChange: (p: MediaPrefs) => void; camAllowed?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      {camAllowed && <button title={prefs.camOn ? 'Выключить камеру' : 'Включить камеру'}
        onClick={() => onChange({ ...prefs, camOn: !prefs.camOn })} style={sideToggle(prefs.camOn)}>
        📷
      </button>}
      <button title={prefs.micOn ? 'Выключить микрофон' : 'Включить микрофон'}
        onClick={() => onChange({ ...prefs, micOn: !prefs.micOn })} style={sideToggle(prefs.micOn)}>
        {prefs.micOn ? '🎤' : '🔇'}
      </button>
    </div>
  );
}

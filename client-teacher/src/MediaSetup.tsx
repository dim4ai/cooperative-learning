import { useState } from 'react';
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
const VIDEO_MODE_KEY = 'videoMode';

function loadVideoMode(): VideoMode {
  try {
    const v = localStorage.getItem(VIDEO_MODE_KEY);
    return v && v in VIDEO_MODE_LABELS ? v as VideoMode : 'all';
  } catch {
    return 'all';
  }
}

const mainButton: CSSProperties = {
  width: '100%', fontSize: 16, padding: '10px 0', borderRadius: 6, border: 'none',
  background: '#4a90e2', color: '#fff', cursor: 'pointer',
};

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
        setCreateError(res.status === 429
          ? 'Достигнут предел — 1000 занятий. Старые коды освобождаются через 30 дней без входа'
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
    <div style={{
      minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 14, fontFamily: 'sans-serif', padding: 24, boxSizing: 'border-box',
    }}>
      <h2 style={{ margin: 0 }}>Настройка камеры и микрофона</h2>
      <div style={{ color: '#888', fontSize: 13 }}>Проверьте себя перед занятием</div>

      <MediaCheck prefs={prefs} onChange={setPrefs} />

      <div style={{ width: 320, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div role="radiogroup" aria-label="Видео на занятии" style={{ display: 'flex', gap: 4, marginTop: 8 }}>
          {(Object.keys(VIDEO_MODE_LABELS) as VideoMode[]).map(m => (
            <button key={m} role="radio" aria-checked={videoMode === m} onClick={() => setVideoMode(m)} style={{
              flex: 1, padding: '6px 4px', fontSize: 12, borderRadius: 6, cursor: 'pointer', lineHeight: 1.2,
              border: videoMode === m ? '1px solid #4a90e2' : '1px solid #ccc',
              background: videoMode === m ? '#e7f1fc' : '#fff', color: '#222',
            }}>{VIDEO_MODE_LABELS[m]}</button>
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

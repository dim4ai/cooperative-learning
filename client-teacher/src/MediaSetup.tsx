import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { MediaCheck, saveMediaPrefs } from './mediaCheck';
import { TeacherLookEditor } from './TeacherLookEditor';
import type { MediaPrefs } from './mediaCheck';

export type VideoMode = 'all' | 'teacherSees' | 'teacher' | 'none';
export const VIDEO_MODE_LABELS: Record<VideoMode, string> = {
  all: 'С видео',
  teacherSees: 'Учеников видит только учитель',
  teacher: 'Камера только у учителя',
  none: 'Без видео',
};
export const DEMO_MODES: VideoMode[] = ['teacher', 'none'];
const VIDEO_MODE_KEY = 'videoMode';

function loadVideoMode(): VideoMode {
  try {
    const v = localStorage.getItem(VIDEO_MODE_KEY);
    return v && v in VIDEO_MODE_LABELS ? v as VideoMode : 'all';
  } catch {
    return 'all';
  }
}

export const screenStyle: CSSProperties = {
  minHeight: '100vh', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', alignContent: 'center',
  justifyContent: 'center', gap: '24px 128px', fontFamily: 'sans-serif', padding: 24, boxSizing: 'border-box',
};
export const columnStyle: CSSProperties = { width: 320, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 10 };

export const mainButton: CSSProperties = {
  width: '100%', fontSize: 16, padding: '10px 0', borderRadius: 6, border: 'none',
  background: '#4a90e2', color: '#fff', cursor: 'pointer',
};

export interface DemoStart { code: string; token: string; solo?: boolean }

export function ModeButton({ mode, chosen, onChoose }: { mode: VideoMode; chosen: boolean; onChoose: () => void }) {
  return (
    <button role="radio" aria-checked={chosen} onClick={onChoose} style={{
      padding: '8px 6px', fontSize: 13, borderRadius: 6, cursor: 'pointer', lineHeight: 1.2,
      border: chosen ? '1px solid #4a90e2' : '1px solid #ccc',
      background: chosen ? '#e7f1fc' : '#fff', color: '#222',
    }}>{VIDEO_MODE_LABELS[mode]}</button>
  );
}

// The teacher's start screen after login: check camera/mic, then start a new lesson or join one by code.
export function MediaSetup({ token, initial, error: lessonError, onJoin, onUnauthorized, journalLabel, onJournal, onLogout, classCode, profileLocked }: {
  journalLabel: string;
  classCode?: string; // the chosen class's code from last time
  profileLocked?: boolean; // the profile exists but its password wasn't typed since the page opened
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

  // The class's code from the journal is there already: the same group comes in by the same code
  const [prefilled, setPrefilled] = useState('');
  useEffect(() => {
    if (!classCode || classCode === prefilled) return;
    setPrefilled(classCode);
    setCodeInput(prev => !prev.trim() || prev.trim() === prefilled ? classCode : prev);
  }, [classCode, prefilled]);

  // Starting with the profile closed: no class journal, nothing from the profile — the teacher is asked first
  const [askNoProfile, setAskNoProfile] = useState<{ reuse?: string } | null>(null);
  useEffect(() => { if (!profileLocked) setAskNoProfile(null); }, [profileLocked]);
  function start(reuse?: string) {
    if (profileLocked) { setAskNoProfile({ reuse }); return; }
    createNew(reuse);
  }

  async function createNew(reuse?: string) {
    setCreating(true);
    setCreateError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/lessons`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(reuse ? { videoMode, reuse, strict: true } : { videoMode }),
      });
      if (res.status === 401) { onUnauthorized(); return; }
      if (reuse && res.status === 404) { join(reuse); return; } // not this teacher's code: joining tells why
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
      <div style={{ ...columnStyle, textAlign: 'center' }}>
        <h3 style={{ margin: 0 }}>Камера и микрофон</h3>
        <div style={{ color: '#888', fontSize: 13 }}>Проверьте себя перед занятием</div>
        <MediaCheck prefs={prefs} onChange={setPrefs} />
      </div>

      <div style={columnStyle}>
        <TeacherLookEditor />
        <h3 style={{ margin: '14px 0 0', textAlign: 'center' }}>Занятие</h3>
        <div role="radiogroup" aria-label="Видео на занятии" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {(Object.keys(VIDEO_MODE_LABELS) as VideoMode[]).map(m => (
            <ModeButton key={m} mode={m} chosen={videoMode === m} onChoose={() => setVideoMode(m)} />
          ))}
        </div>
        <button data-testid="journal-open" onClick={onJournal} style={{
          padding: '8px 10px', fontSize: 14, borderRadius: 6, border: '1px solid #ccc', background: '#fff', color: '#222', cursor: 'pointer',
        }}>{journalLabel}</button>
        <button data-testid="new-lesson" onClick={() => start()} disabled={creating} style={mainButton}>
          {creating ? 'Создаём…' : 'Начать занятие с новым кодом'}
        </button>
        <div style={{ color: '#888', fontSize: 13, textAlign: 'center' }}>или начать / продолжить занятие по коду</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={codeInput}
            onChange={e => setCodeInput(e.target.value)}
            placeholder="Код занятия"
            data-testid="code-input"
            onKeyDown={e => { if (e.key === 'Enter' && code && !creating) start(code); }}
            style={{ flex: 1, minWidth: 0, fontSize: 15, padding: 8, borderRadius: 6, border: '1px solid #ccc', letterSpacing: 1 }}
          />
          <button data-testid="code-start" onClick={() => code && start(code)} disabled={!code || creating}
            style={{ ...mainButton, width: 'auto', padding: '8px 14px', fontSize: 14, opacity: code ? 1 : 0.5 }}>
            Начать
          </button>
        </div>
        {askNoProfile && (
          <div data-testid="no-profile-warning" style={{ border: '1px solid #f0c36d', background: '#fff8e6', borderRadius: 6, padding: 10, fontSize: 13, color: '#222', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>Профиль не открыт: урок начнётся без журнала класса, и данные профиля не подтянутся.</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onJournal} style={{ ...mainButton, fontSize: 13, padding: '6px 10px' }}>Открыть профиль</button>
              <button data-testid="start-without-profile" onClick={() => { const a = askNoProfile; setAskNoProfile(null); createNew(a.reuse); }}
                style={{ ...mainButton, fontSize: 13, padding: '6px 10px', background: '#fff', color: '#222', border: '1px solid #ccc' }}>Начать без профиля</button>
            </div>
          </div>
        )}
        {(createError || lessonError) && <div style={{ color: '#e74c3c', fontSize: 13, textAlign: 'center' }}>{createError || lessonError}</div>}
        <button data-testid="logout" onClick={onLogout} style={{
          marginTop: 14, padding: '8px 10px', fontSize: 14, borderRadius: 6, cursor: 'pointer',
          border: '1px solid #e74c3c', background: '#fff', color: '#e74c3c',
        }}>Выйти из аккаунта</button>
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

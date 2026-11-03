import { useState } from 'react';
import type { CSSProperties } from 'react';

const MINUTES_KEY = 'afterLessonMinutes';
const MAX_MINUTES = 15;

function loadMinutes(): number {
  try {
    const n = Number(localStorage.getItem(MINUTES_KEY));
    return n >= 1 && n <= MAX_MINUTES ? n : 5;
  } catch {
    return 5;
  }
}

// Asked every time the teacher ends a lesson: end it for everyone now, or let students talk
// in their fours for a few minutes (the last chosen number of minutes is suggested).
export function EndLessonDialog({ onEnd, onCancel }: {
  onEnd: (chatMinutes: number) => void;
  onCancel: () => void;
}) {
  const [minutes, setMinutes] = useState(loadMinutes);
  const valid = Number.isInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES;

  function withChat() {
    if (!valid) return;
    try { localStorage.setItem(MINUTES_KEY, String(minutes)); } catch { /* private mode */ }
    onEnd(minutes);
  }

  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div role="dialog" aria-label="Завершить урок" onClick={e => e.stopPropagation()} style={{
        background: '#fff', color: '#222', borderRadius: 10, padding: 20, width: 360, maxWidth: '100%',
        display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'sans-serif',
      }}>
        <h3 style={{ margin: 0 }}>Завершить урок</h3>
        <div style={{ fontSize: 13, color: '#666' }}>
          Можно дать ученикам немного поговорить в своих четвёрках — вы при этом выйдете из занятия и их не услышите.
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={withChat} disabled={!valid} style={{ ...btn, flex: 1, background: '#27ae60', opacity: valid ? 1 : 0.5 }}>
            Дать поговорить
          </button>
          <input
            type="number" min={1} max={MAX_MINUTES} step={1} value={Number.isNaN(minutes) ? '' : minutes}
            aria-label="Минут на разговор"
            onChange={e => setMinutes(e.target.valueAsNumber)}
            onKeyDown={e => { if (e.key === 'Enter') withChat(); }}
            style={{ width: 52, fontSize: 15, padding: 6, borderRadius: 6, border: '1px solid #ccc', textAlign: 'center' }}
          />
          <span style={{ fontSize: 14 }}>мин</span>
        </div>
        {!valid && <div style={{ fontSize: 12, color: '#e74c3c' }}>От 1 до {MAX_MINUTES} минут</div>}

        <button onClick={() => onEnd(0)} style={{ ...btn, background: '#e74c3c' }}>Завершить для всех сразу</button>
        <button onClick={onCancel} style={{ ...btn, background: 'transparent', color: '#666', border: '1px solid #ccc' }}>Отмена</button>
      </div>
    </div>
  );
}

const btn: CSSProperties = {
  padding: '9px 12px', borderRadius: 6, border: 'none', color: '#fff', fontSize: 14, cursor: 'pointer',
};

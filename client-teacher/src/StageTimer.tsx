import { useEffect, useState, type CSSProperties } from 'react';
import { socket } from './socket';

// The stage timer over the lesson. A block sets its time but doesn't start it: the teacher starts it
// when the class is ready (after explaining the task, say). Everyone hears 15 s before the end and at it.

export interface TimerState { totalMs: number | null; leftMs: number | null }

const clock = (ms: number) => {
  const s = Math.round(Math.abs(ms) / 1000);
  return `${ms < 0 ? '+' : ''}${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function StageTimer({ endsAt, timer, clockSkew }: { endsAt: number | null; timer?: TimerState; clockSkew: number }) {
  const running = endsAt !== null;
  const [now, setNow] = useState(() => Date.now() + clockSkew);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now() + clockSkew), 250);
    return () => clearInterval(id);
  }, [running, clockSkew]);

  const total = timer?.totalMs ?? null;
  const left = running ? endsAt - now : timer?.leftMs ?? null;
  const over = left !== null && left < 0;
  const soon = left !== null && left >= 0 && left <= 60_000;
  // the clock stands still while the timer does: a press reads it anew, or the first moment after
  // a resume would count from the moment of the pause
  const act = (a: string) => { setNow(Date.now() + clockSkew); socket.emit('timer', a); };
  const fresh = !running && left !== null && left === total; // set, not started

  return (
    <div data-testid="stage-timer" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
      <div data-testid="timer-time" title={over ? 'Время этапа вышло' : running ? 'Осталось на этап' : left !== null ? 'Таймер стоит' : 'Время не задано'} style={{
        fontSize: 20, fontWeight: 'bold', fontVariantNumeric: 'tabular-nums', lineHeight: 1.1, padding: '1px 10px', borderRadius: 6,
        color: over ? '#fff' : soon && running ? '#3a2a00' : left === null ? '#999' : running ? '#222' : '#777',
        background: over ? '#c0392b' : soon && running ? '#f0b429' : 'transparent',
      }}>
        {left === null ? '—:——' : clock(left)}{!running && left !== null && left > 0 && !fresh && <span style={{ fontSize: 12, marginLeft: 4 }}>⏸</span>}
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {running
          ? <button data-testid="timer-pause" onClick={() => act('pause')} title="Пауза" style={btn}>⏸</button>
          : <button data-testid="timer-start" onClick={() => act('start')} disabled={!left || left <= 0} title={fresh ? 'Запустить' : 'Продолжить'}
              style={{ ...btn, ...(left && left > 0 ? { background: '#2ecc71', color: '#fff', borderColor: '#2ecc71' } : {}) }}>▶</button>}
        <button data-testid="timer-restart" onClick={() => act('restart')} disabled={!total} title="Перезапустить: всё время этапа заново, сразу" style={btn}>↻</button>
        <button data-testid="timer-plus" onClick={() => act('plus')} title="Добавить минуту" style={{ ...btn, width: 'auto', padding: '0 6px' }}>+1</button>
        <button data-testid="timer-stop" onClick={() => act('stop')} disabled={left === null || (!running && left === 0)} title="Стоп: таймер на 0:00" style={btn}>
          <span style={{ display: 'block', width: 9, height: 9, margin: 'auto', background: 'currentColor', borderRadius: 1 }} />
        </button>
      </div>
    </div>
  );
}

const btn: CSSProperties = {
  width: 28, height: 24, padding: 0, borderRadius: 5, border: '1px solid #c9b99c', background: '#fff', color: '#333',
  fontSize: 13, lineHeight: 1, cursor: 'pointer',
};

import type { CSSProperties } from 'react';

/** Something isn't ready: no lesson file, or someone without a place. The teacher decides whether to start anyway */
export function StartLessonDialog({ names, noLesson, onStart, onCancel }: { names: string[]; noLesson: boolean; onStart: () => void; onCancel: () => void }) {
  const title = noLesson && names.length ? 'Перед началом' : noLesson ? 'Урок не выбран' : 'Не все рассажены';
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div role="dialog" aria-label={title} data-testid="start-warning" onClick={e => e.stopPropagation()} style={{
        background: '#fff', color: '#222', borderRadius: 10, padding: 20, width: 360, maxWidth: '100%',
        display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'sans-serif',
      }}>
        <h3 style={{ margin: 0 }}>{title}</h3>
        {noLesson && <div data-testid="start-warning-lesson" style={{ fontSize: 14 }}>Файл урока не открыт: урок начнётся с объяснения на чистой доске, дальше задания можно добавлять в меню «Новое задание».</div>}
        {names.length > 0 && <>
          <div data-testid="start-warning-names" style={{ fontSize: 14, overflowWrap: 'anywhere' }}>Без места: {names.join(', ')}</div>
          <div style={{ fontSize: 13, color: '#666' }}>Пока вы не определите им место, они не попадут в работу.</div>
        </>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} style={{ ...btn, background: '#eef1f5', color: '#333' }}>Назад</button>
          <button data-testid="start-anyway" onClick={onStart} style={{ ...btn, background: '#2ecc71', color: '#fff', fontWeight: 'bold' }}>{noLesson ? 'Начать без урока' : 'Начать урок'}</button>
        </div>
      </div>
    </div>
  );
}

const btn: CSSProperties = { flex: 1, padding: '10px 8px', borderRadius: 6, border: 'none', fontSize: 14, cursor: 'pointer' };

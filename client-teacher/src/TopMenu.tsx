import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { socket } from './socket';
import type { TeacherSlides } from './LessonSlides';
import { RecordingsDialog } from './RecordingUI';

// The menus over the lesson: what the lesson is and who gets in («Урок»), and a task the lesson file
// doesn't have, to change the course of the lesson as it goes («Новое задание»)

function Menu({ label, testid, children }: { label: string; testid: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', away); window.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button data-testid={testid} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)} style={{
        padding: '5px 10px', borderRadius: 6, border: '1px solid #c9b99c', cursor: 'pointer', fontSize: 13,
        background: open ? '#fff' : '#f6f0e4', color: '#222', whiteSpace: 'nowrap',
      }}>{label} ▾</button>
      {open && (
        <div role="menu" data-testid={`${testid}-items`} style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 900, minWidth: 210, padding: 4,
          background: '#fff', border: '1px solid #ddd2bd', borderRadius: 8, boxShadow: '0 6px 18px rgba(0,0,0,0.15)',
          display: 'flex', flexDirection: 'column',
        }}>{children(() => setOpen(false))}</div>
      )}
    </div>
  );
}

function Item({ onClick, children, testid, color }: { onClick: () => void; children: ReactNode; testid?: string; color?: string }) {
  return (
    <button role="menuitem" data-testid={testid} onClick={onClick} style={{
      padding: '7px 10px', border: 'none', borderRadius: 5, background: 'transparent', cursor: 'pointer',
      textAlign: 'left', fontSize: 13, color: color ?? '#222', whiteSpace: 'nowrap',
    }}
      onMouseEnter={e => { e.currentTarget.style.background = '#f1ebe0'; }}
      onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
      {children}
    </button>
  );
}

const Line = () => <div style={{ height: 1, background: '#eee5d6', margin: '3px 6px' }} />;

interface Entry { closed: boolean }

/** «Урок»: the file, the way in, the recording */
export function LessonMenu({ slides, entry, recording, onRecord }: {
  slides: TeacherSlides; entry: Entry | null; recording: boolean; onRecord: (() => void) | null; // null: no recording here (a demo lesson)
}) {
  const input = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState(false);
  return (<>
    <input ref={input} type="file" accept=".colesson" style={{ display: 'none' }} data-testid="material-input"
      onChange={e => { const f = e.target.files?.[0]; if (f) slides.open(f); e.target.value = ''; }} />
    <Menu label="Урок" testid="menu-lesson">{close => (<>
      <Item testid="menu-open" onClick={() => { close(); input.current?.click(); }}>{slides.local ? 'Заменить урок…' : 'Открыть урок…'}</Item>
      {entry && <>
        <Line />
        <Item testid="entry-close" color={entry.closed ? '#b07800' : undefined} onClick={() => { close(); socket.emit('entry:close', { closed: !entry.closed }); }}>
          {entry.closed ? '🔒 Вход закрыт — открыть' : 'Закрыть вход'}
        </Item>
        <Item testid="entry-new-code" onClick={() => { close(); socket.emit('entry:newCode'); }}>Сменить код</Item>
      </>}
      {onRecord && <>
        <Line />
        {!recording && <Item testid="record-start" onClick={() => { close(); onRecord(); }}><span style={{ color: '#e74c3c' }}>●</span> Записать урок</Item>}
        <Item testid="recordings-open" onClick={() => { close(); setRecords(true); }}>Записи уроков</Item>
      </>}
    </>)}</Menu>
    {records && <RecordingsDialog onClose={() => setRecords(false)} />}
  </>);
}

const TASK_TYPES: { type: string; label: string; hint: string }[] = [
  { type: 'group', label: 'Объяснение', hint: 'Весь класс вместе: вы объясняете, все слышат и видят доску' },
  { type: 'individual', label: 'Индивидуально', hint: 'Каждый сам, у каждого своя доска' },
  { type: 'pairs', label: 'В парах', hint: 'Пары говорят между собой, доска на двоих' },
  { type: 'fours', label: 'В четвёрках', hint: 'Четвёрки говорят между собой, доска на четверых' },
];

/** «Новое задание»: a task of any kind, right after the running one */
export function TaskMenu({ onPick }: { onPick: (type: string) => void }) {
  return (
    <Menu label="Новое задание" testid="menu-task">{close => TASK_TYPES.map(t => (
      <Item key={t.type} testid={`task-${t.type}`} onClick={() => { close(); onPick(t.type); }}>
        <div>{t.label}</div>
        <div style={{ fontSize: 11, color: '#888', whiteSpace: 'normal', maxWidth: 240, marginTop: 1 }}>{t.hint}</div>
      </Item>
    ))}</Menu>
  );
}

export function NewTaskDialog({ type, running, onClose }: { type: string; running: boolean; onClose: () => void }) {
  const label = TASK_TYPES.find(t => t.type === type)?.label ?? '';
  const [title, setTitle] = useState('');
  const [task, setTask] = useState('');
  const [minutes, setMinutes] = useState('');
  const work = type !== 'group';
  const n = Number(minutes);
  const okMinutes = minutes.trim() === '' || (Number.isInteger(n) && n >= 1 && n <= 120);

  function add(start: boolean) {
    if (!okMinutes) return;
    socket.emit('block:add', { type, title, task, minutes: minutes.trim() ? n : null, start });
    onClose();
  }

  return (
    <div onClick={onClose} style={overlay}>
      <div role="dialog" aria-label="Новое задание" data-testid="new-task" onClick={e => e.stopPropagation()} style={dialog}>
        <h3 style={{ margin: 0 }}>Новое задание: {label.toLowerCase()}</h3>
        <input data-testid="new-task-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder={`Название, например «${label}»`} style={field} autoFocus />
        {work && <textarea data-testid="new-task-text" value={task} onChange={e => setTask(e.target.value)} maxLength={2000} rows={4}
          placeholder="Задание: ученики увидят его над доской" style={{ ...field, resize: 'vertical', fontFamily: 'inherit' }} />}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#333' }}>
          Время
          <input data-testid="new-task-minutes" value={minutes} onChange={e => setMinutes(e.target.value.replace(/\D/g, ''))} inputMode="numeric" placeholder="—"
            style={{ ...field, width: 60, textAlign: 'center', borderColor: okMinutes ? '#ccc' : '#e74c3c' }} />
          мин
          <span style={{ fontSize: 12, color: '#888' }}>можно не указывать</span>
        </label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button data-testid="new-task-start" onClick={() => add(true)} disabled={!okMinutes} style={{ ...btn, background: '#2ecc71', color: '#fff', border: 'none', flex: 1 }}>Начать сейчас</button>
          <button data-testid="new-task-add" onClick={() => add(false)} disabled={!okMinutes} style={{ ...btn, flex: 1 }}>
            {running ? 'Следующим в плане' : 'Добавить в план'}
          </button>
        </div>
        <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13 }}>Отмена</button>
      </div>
    </div>
  );
}

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const dialog: CSSProperties = {
  background: '#fff', borderRadius: 10, padding: 20, width: 420, maxWidth: '100%', boxSizing: 'border-box',
  display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'sans-serif', boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
};
const field: CSSProperties = { fontSize: 14, padding: 8, borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box', width: '100%' };
const btn: CSSProperties = { padding: '9px 12px', borderRadius: 6, border: '1px solid #c9b99c', background: '#fff', color: '#222', fontSize: 14, cursor: 'pointer' };

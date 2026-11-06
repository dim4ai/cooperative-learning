import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import {
  JournalConflict, WeakPassword, WrongPassword, changePassword, createJournal, newId, unlockJournal, updateJournal, useJournal,
} from './journal';
import type { JournalClass, JournalStudent } from './journal';
import { MIN_PASSWORD_LENGTH, passwordProblem } from './passwordStrength';
import { PasswordInput } from './PasswordInput';

const FORGOT_WARNING = 'Журнал зашифрован вашим паролем, и прочитать его можете только вы. Восстановления пароля пока нет: если его забыть, журнал не открыть — никто, включая нас, не сможет этого сделать.';

/** Someone in the lesson now, as the journal needs them */
export interface LessonStudent { name: string; uuid: string | null; seat: string | null }

export function JournalDialog({ email, classId, onClassId, lesson, onClose }: {
  email: string;
  classId: string | null;
  onClassId: (id: string | null) => void;
  lesson?: { students: LessonStudent[]; capacity: number };
  onClose: () => void;
}) {
  const { status, data, saveError } = useJournal();
  const [passwordOpen, setPasswordOpen] = useState(false);
  // Looking through classes changes nothing: the class (and its seat plan) applies on «Выбрать»
  const [draftId, setDraftId] = useState(classId);
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000,
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }}>
      <div role="dialog" aria-label="Журнал" data-testid="journal" onClick={e => e.stopPropagation()} style={{
        background: '#fff', color: '#222', borderRadius: 10, padding: 20, width: 460, maxWidth: '100%', maxHeight: '90vh',
        overflow: 'auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'sans-serif',
      }}>
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <h3 style={{ margin: 0, flex: 1 }}>Журнал</h3>
          <button onClick={onClose} aria-label="Закрыть" style={{ ...plainBtn, fontSize: 18 }}>✕</button>
        </div>
        {status === 'loading' && <div style={hint}>Загружаем…</div>}
        {status === 'unavailable' && <div style={errorText}>Журнал сейчас недоступен. Проверьте связь и обновите страницу</div>}
        {status === 'none' && <CreateJournal email={email} onChangePassword={() => setPasswordOpen(true)} />}
        {status === 'locked' && <Unlock email={email} />}
        {status === 'open' && data && <Classes classes={data.classes} classId={draftId} onClassId={setDraftId} lesson={lesson} />}
        {saveError && <div style={errorText}>{saveError}</div>}
        {(status === 'none' || status === 'open') && (passwordOpen
          ? <ChangePassword email={email} onDone={() => setPasswordOpen(false)} />
          : <button onClick={() => setPasswordOpen(true)} style={{ ...plainBtn, alignSelf: 'flex-start' }}>Сменить пароль</button>)}
        {status === 'open' && data && (
          <button data-testid="journal-choose" onClick={() => { onClassId(draftId); onClose(); }} style={mainBtn}>Выбрать</button>
        )}
      </div>
    </div>
  );
}

function CreateJournal({ email, onChangePassword }: { email: string; onChangePassword: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [weak, setWeak] = useState(false);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    setError('');
    setWeak(false);
    try {
      await createJournal(email, password, async () => {
        const problem = await passwordProblem(password, email);
        if (problem) throw new WeakPassword(problem);
      });
    } catch (e) {
      if (e instanceof WeakPassword) { setError(`${e.message}. Сначала смените пароль`); setWeak(true); }
      else setError(e instanceof WrongPassword ? 'Неверный пароль: нужен тот же, с которым вы входите' : 'Не удалось создать журнал');
    } finally {
      setBusy(false);
    }
  }

  return (<>
    <div style={hint}>{FORGOT_WARNING}</div>
    <PasswordInput value={password} onChange={e => setPassword(e.target.value)} placeholder="Ваш пароль"
      autoComplete="current-password" onKeyDown={e => { if (e.key === 'Enter' && password) create(); }} style={input} />
    {error && <div style={errorText}>{error}</div>}
    {weak && <button onClick={onChangePassword} style={{ ...plainBtn, alignSelf: 'flex-start', color: '#4a90e2' }}>Сменить пароль</button>}
    <button onClick={create} disabled={busy || !password} style={mainBtn}>{busy ? 'Создаём…' : 'Создать журнал'}</button>
  </>);
}

function Unlock({ email }: { email: string }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function open() {
    setBusy(true);
    setError('');
    try {
      await unlockJournal(email, password);
    } catch (e) {
      setError(e instanceof WrongPassword ? 'Неверный пароль' : 'Не удалось открыть журнал');
    } finally {
      setBusy(false);
    }
  }

  return (<>
    <div style={hint}>Журнал закрыт: после обновления страницы или долгого простоя нужен пароль.</div>
    <PasswordInput value={password} onChange={e => setPassword(e.target.value)} placeholder="Ваш пароль"
      autoComplete="current-password" onKeyDown={e => { if (e.key === 'Enter' && password) open(); }} style={input} />
    {error && <div style={errorText}>{error}</div>}
    <button onClick={open} disabled={busy || !password} style={mainBtn}>{busy ? 'Открываем…' : 'Открыть журнал'}</button>
  </>);
}

function ChangePassword({ email, onDone }: { email: string; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (next !== repeat) { setError('Пароли не совпадают'); return; }
    setBusy(true);
    setError('');
    try {
      const problem = await passwordProblem(next, email);
      if (problem) { setError(problem); return; }
      await changePassword(email, current, next);
      onDone();
    } catch (e) {
      setError(e instanceof WrongPassword ? 'Неверный текущий пароль'
        : e instanceof JournalConflict ? 'Журнал изменён в другом окне. Обновите страницу и повторите'
        : 'Не удалось сменить пароль');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid #eee', paddingTop: 12 }}>
      <strong style={{ fontSize: 14 }}>Смена пароля</strong>
      <div style={hint}>Не меньше {MIN_PASSWORD_LENGTH} символов. Лучше всего — несколько случайных слов.</div>
      <PasswordInput value={current} onChange={e => setCurrent(e.target.value)} placeholder="Текущий пароль" autoComplete="current-password" style={input} />
      <PasswordInput value={next} onChange={e => setNext(e.target.value)} placeholder="Новый пароль" autoComplete="new-password" style={input} />
      <PasswordInput value={repeat} onChange={e => setRepeat(e.target.value)} placeholder="Новый пароль ещё раз" autoComplete="new-password"
        onKeyDown={e => { if (e.key === 'Enter') submit(); }} style={input} />
      {error && <div style={errorText}>{error}</div>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={submit} disabled={busy || !current || !next} style={{ ...mainBtn, flex: 1 }}>{busy ? 'Меняем…' : 'Сменить пароль'}</button>
        <button onClick={onDone} style={plainBtn}>Отмена</button>
      </div>
    </div>
  );
}

function patchClass(id: string, change: (c: JournalClass) => JournalClass) {
  updateJournal(d => ({ classes: d.classes.map(c => c.id === id ? change(c) : c) }));
}

function Classes({ classes, classId, onClassId, lesson }: {
  classes: JournalClass[];
  classId: string | null;
  onClassId: (id: string | null) => void;
  lesson?: { students: LessonStudent[]; capacity: number };
}) {
  const [newClass, setNewClass] = useState('');
  const [newStudent, setNewStudent] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [remembered, setRemembered] = useState(false);
  const cls = classes.find(c => c.id === classId) ?? null;

  function addClass() {
    const name = newClass.trim();
    if (!name) return;
    const id = newId();
    updateJournal(d => ({ classes: [...d.classes, { id, name, capacity: 0, students: [] }] }));
    setNewClass('');
    onClassId(id);
  }

  function addStudent(name: string, uuid?: string) {
    if (!cls || !name.trim()) return;
    const student: JournalStudent = { id: newId(), name: name.trim(), uuids: uuid ? [uuid] : [], seat: null };
    patchClass(cls.id, c => ({ ...c, students: [...c.students, student] }));
  }

  function link(studentId: string, uuid: string) {
    if (!cls) return;
    patchClass(cls.id, c => ({ ...c, students: c.students.map(s => s.id === studentId ? { ...s, uuids: [...s.uuids, uuid] } : s) }));
  }

  function rememberSeating() {
    if (!cls || !lesson) return;
    const seatOf = new Map(lesson.students.filter(s => s.uuid).map(s => [s.uuid!, s.seat]));
    patchClass(cls.id, c => ({
      ...c,
      capacity: lesson.capacity,
      students: c.students.map(s => {
        const here = s.uuids.find(u => seatOf.has(u));
        return here ? { ...s, seat: seatOf.get(here) ?? null } : s;
      }),
    }));
    setRemembered(true);
  }

  const unmatched = lesson && cls ? lesson.students.filter(p => p.uuid && !cls.students.some(s => s.uuids.includes(p.uuid!))) : [];
  const here = new Set(lesson?.students.map(p => p.uuid));

  return (<>
    <div style={{ display: 'flex', gap: 6 }}>
      <select aria-label="Класс" value={cls?.id ?? ''} onChange={e => { onClassId(e.target.value || null); setConfirmDelete(false); setRemembered(false); }} style={{ ...input, flex: 1, minWidth: 0 }}>
        <option value="">Без класса</option>
        {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <input value={newClass} onChange={e => setNewClass(e.target.value)} placeholder="Новый класс" aria-label="Новый класс"
        onKeyDown={e => { if (e.key === 'Enter') addClass(); }} style={{ ...input, flex: 1, minWidth: 0 }} />
      <button onClick={addClass} disabled={!newClass.trim()} style={smallBtn}>+</button>
    </div>

    {cls && lesson && unmatched.length > 0 && (
      <Section title="На уроке, но не в журнале">
        {unmatched.map(p => (
          <div key={p.uuid} data-testid="unmatched" style={row}>
            <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
            <select aria-label={`Кто это: ${p.name}`} value="" onChange={e => {
              if (e.target.value === 'new') addStudent(p.name, p.uuid!);
              else if (e.target.value) link(e.target.value, p.uuid!);
            }} style={{ ...input, padding: 4, fontSize: 13, width: 190 }}>
              <option value="">Кто это?</option>
              <option value="new">Новый ученик: {p.name}</option>
              {cls.students.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        ))}
      </Section>
    )}

    {cls && (
      <Section title={`Ученики: ${cls.students.length}`}>
        {cls.students.map(s => (
          <div key={s.id} data-testid="journal-student" style={row}>
            <span style={{ flex: 1, minWidth: 0 }}>
              {s.uuids.some(u => here.has(u)) && <span title="На уроке" style={{ color: '#27ae60' }}>● </span>}
              {s.name}
            </span>
            <span style={hint}>{s.seat ? 'есть место' : s.uuids.length ? '' : 'ещё не заходил'}</span>
            <button onClick={() => patchClass(cls.id, c => ({ ...c, students: c.students.filter(x => x.id !== s.id) }))}
              aria-label={`Удалить: ${s.name}`} style={plainBtn}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6 }}>
          <input value={newStudent} onChange={e => setNewStudent(e.target.value)} placeholder="Добавить ученика" aria-label="Добавить ученика"
            onKeyDown={e => { if (e.key === 'Enter') { addStudent(newStudent); setNewStudent(''); } }} style={{ ...input, flex: 1, minWidth: 0 }} />
          <button onClick={() => { addStudent(newStudent); setNewStudent(''); }} disabled={!newStudent.trim()} style={smallBtn}>+</button>
        </div>
      </Section>
    )}

    {cls && lesson && (
      <button onClick={rememberSeating} disabled={lesson.capacity === 0} style={mainBtn}>
        {remembered ? 'Рассадка запомнена ✓' : 'Запомнить текущую рассадку'}
      </button>
    )}

    {cls && (confirmDelete
      ? <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
          Удалить класс «{cls.name}» со всеми учениками?
          <button onClick={() => { const id = cls.id; onClassId(null); updateJournal(d => ({ classes: d.classes.filter(c => c.id !== id) })); setConfirmDelete(false); }}
            style={{ ...smallBtn, background: '#e74c3c' }}>Удалить</button>
          <button onClick={() => setConfirmDelete(false)} style={plainBtn}>Нет</button>
        </div>
      : <button onClick={() => setConfirmDelete(true)} style={{ ...plainBtn, alignSelf: 'flex-start' }}>Удалить класс</button>)}
  </>);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 12, color: '#888' }}>{title}</div>
      {children}
    </div>
  );
}

const hint: CSSProperties = { fontSize: 12, color: '#777' };
const errorText: CSSProperties = { fontSize: 13, color: '#e74c3c' };
const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 };
const input: CSSProperties = { fontSize: 14, padding: 8, borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box', background: '#fff', color: '#222' };
const mainBtn: CSSProperties = { padding: '9px 12px', borderRadius: 6, border: 'none', color: '#fff', fontSize: 14, cursor: 'pointer', background: '#4a90e2' };
const smallBtn: CSSProperties = { padding: '6px 12px', borderRadius: 6, border: 'none', color: '#fff', fontSize: 14, cursor: 'pointer', background: '#4a90e2' };
const plainBtn: CSSProperties = { border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13, padding: 2 };

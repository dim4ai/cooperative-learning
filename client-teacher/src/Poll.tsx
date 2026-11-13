import { useState, type CSSProperties } from 'react';
import { socket } from './socket';
import { boardPictures } from './BoardPictures';
import type { BoardPicture } from './slides/Board';
import { GRADE_INFO, LETTERS, MAX_OPTIONS, MAX_SECONDS, MIN_SECONDS, POLL_COLORS, clock, useSecondsLeft, type TeacherPollView } from './pollState';

// Голосование (server/src/poll.ts): the teacher asks the class a question with options. One answer: each
// option its colour, or one marked right (green, the rest red). Several: the right ones are marked, and
// each student's answer is coloured by how right it is. The teacher sees who answered what; the class
// sees only how many chose each, once the teacher shows the results.

// ---------- the dialog: a new poll ----------

interface Draft { text: string; color: string; correct: boolean }
const blank = (i: number): Draft => ({ text: '', color: POLL_COLORS[i % POLL_COLORS.length], correct: false });

/** draft: what the dialog opens with (the solo demo suggests its question) */
export interface PollDraft { question: string; options: string[] }

export function NewPollDialog({ running, onClose, draft }: { running: boolean; onClose: () => void; draft?: PollDraft }) {
  const [title, setTitle] = useState('');
  const [question, setQuestion] = useState(draft?.question ?? '');
  const [multi, setMulti] = useState(false);
  const [options, setOptions] = useState<Draft[]>(() => draft ? draft.options.map((text, i) => ({ ...blank(i), text })) : [0, 1, 2, 3].map(blank));
  const [picture, setPicture] = useState<BoardPicture | null>(null);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [picking, setPicking] = useState(false);
  // time to answer: off, or seconds as typed (the field may be empty while typing)
  const [timed, setTimed] = useState(false);
  const [seconds, setSeconds] = useState('60');
  const sec = Math.round(Number(seconds));

  const filled = options.filter(o => o.text.trim());
  const anyRight = options.some(o => o.correct && o.text.trim());
  const problem = filled.length < 2 ? 'Нужно хотя бы два варианта ответа'
    : !question.trim() && !picture ? 'Напишите вопрос или вставьте картинку'
    : multi && !anyRight ? 'Отметьте правильные варианты'
    : timed && !(sec >= MIN_SECONDS && sec <= MAX_SECONDS) ? `Время на ответ — от ${MIN_SECONDS} до ${MAX_SECONDS} секунд` : '';
  const step = (d: number) => setSeconds(String(Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, (Number.isFinite(sec) ? sec : 60) + d))));

  const set = (i: number, d: Partial<Draft>) => setOptions(os => os.map((o, j) => (j === i ? { ...o, ...d } : o)));
  // one answer: one right at most
  const toggleRight = (i: number) => setOptions(os => os.map((o, j) => (j === i ? { ...o, correct: !o.correct } : multi ? o : { ...o, correct: false })));
  const nextColor = (i: number) => {
    const used = new Set(options.map(o => o.color));
    const from = POLL_COLORS.indexOf(options[i].color);
    for (let k = 1; k <= POLL_COLORS.length; k++) {
      const c = POLL_COLORS[(from + k) % POLL_COLORS.length];
      if (!used.has(c) || k === POLL_COLORS.length) return set(i, { color: c });
    }
  };
  function switchMulti(m: boolean) {
    setMulti(m);
    // from several right to one answer: only the first stays right
    if (!m) setOptions(os => { let seen = false; return os.map(o => { const keep = o.correct && !seen; if (o.correct) seen = true; return { ...o, correct: keep }; }); });
  }

  async function pick() {
    setPicking(true);
    try { const got = await boardPictures.pick(); if (got?.[0]) setPicture(got[0]); }
    finally { setPicking(false); }
  }

  function add(start: boolean) {
    if (problem) { setError(problem); return; }
    if (sending) return;
    setSending(true); setError('');
    const poll = { question: question.trim(), multi, picture: picture ?? undefined, seconds: timed ? sec : undefined, options: filled.map(o => ({ text: o.text.trim(), color: o.color, correct: o.correct })) };
    socket.timeout(15_000).emit('block:add', { type: 'poll', title: title.trim() || question.trim().slice(0, 60), poll, start },
      (err: unknown, res?: { ok?: boolean }) => {
        setSending(false);
        if (!err && res?.ok) { onClose(); return; }
        setError(err ? 'Сервер не ответил, попробуйте ещё раз' : 'Сервер не принял опрос: картинка слишком большая?');
      });
  }

  return (
    // a stray click outside mustn't throw the poll away: only «Отмена» closes
    <div style={overlay}>
      <div role="dialog" aria-label="Новое голосование" data-testid="new-poll" style={dialog}>
        <h3 style={{ margin: 0 }}>Новое задание: голосование</h3>
        <input data-testid="poll-title" value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="Название в плане (можно не писать)" style={field} />
        <textarea data-testid="poll-question" value={question} onChange={e => setQuestion(e.target.value)} maxLength={500} rows={2} autoFocus
          placeholder="Вопрос, например «Что изображено на картинке?»" style={{ ...field, resize: 'vertical', fontFamily: 'inherit' }} />

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {picture
            ? <>
                <img data-testid="poll-picture" src={picture.src} alt="" style={{ maxHeight: 120, maxWidth: 260, borderRadius: 6, border: '1px solid #ddd' }} />
                <button onClick={pick} disabled={picking} style={btn}>Заменить</button>
                <button data-testid="poll-picture-remove" onClick={() => setPicture(null)} style={btn}>Убрать</button>
              </>
            : <button data-testid="poll-picture-add" onClick={pick} disabled={picking} style={btn}>🖼 Картинка над вопросом</button>}
        </div>

        <div style={{ display: 'flex', gap: 0, alignSelf: 'flex-start', border: '1px solid #c9b99c', borderRadius: 6, overflow: 'hidden' }}>
          {[false, true].map(m => (
            <button key={String(m)} data-testid={m ? 'poll-multi' : 'poll-single'} onClick={() => switchMulti(m)} style={{
              ...btn, border: 'none', borderRadius: 0, background: multi === m ? '#4a90e2' : '#fff', color: multi === m ? '#fff' : '#222',
            }}>{m ? '☑ Несколько ответов' : '◉ Один ответ'}</button>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#777', marginTop: -4 }}>
          {multi ? 'Отметьте ✓ все правильные. Ответ каждого ученика окрасится: зелёный — всё верно, жёлтый — верно половина или больше, оранжевый — меньше половины, красный — неверно.'
            : anyRight ? 'Правильный ответ будет зелёным, остальные красными.'
            : 'У каждого варианта свой цвет: нажмите на кружок, чтобы сменить. Если есть правильный ответ — отметьте его ✓.'}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {options.map((o, i) => {
            const color = anyRight || multi ? (o.correct ? GRADE_INFO.right.color : multi ? '#c8c8c8' : GRADE_INFO.wrong.color) : o.color;
            return (
              <div key={i} data-testid="poll-option-row" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <button data-testid="poll-option-color" title={anyRight || multi ? undefined : 'Сменить цвет'} disabled={anyRight || multi} onClick={() => nextColor(i)} style={{
                  width: 30, height: 30, flexShrink: 0, borderRadius: '50%', border: 'none', background: color, color: '#fff', fontWeight: 'bold', fontSize: 13,
                  cursor: anyRight || multi ? 'default' : 'pointer', padding: 0,
                }}>{LETTERS[i]}</button>
                <input data-testid="poll-option" value={o.text} onChange={e => set(i, { text: e.target.value })} maxLength={200} placeholder={`Вариант ${LETTERS[i]}`} style={{ ...field, flex: 1 }} />
                <button data-testid="poll-option-right" onClick={() => toggleRight(i)} title={o.correct ? 'Правильный' : 'Отметить правильным'} style={{
                  ...btn, padding: '6px 9px', flexShrink: 0, whiteSpace: 'nowrap',
                  background: o.correct ? GRADE_INFO.right.color : '#fff', color: o.correct ? '#fff' : '#888', borderColor: o.correct ? GRADE_INFO.right.color : '#c9b99c',
                }}>✓{o.correct ? ' верно' : ''}</button>
                {options.length > 2 && <button aria-label="Убрать вариант" onClick={() => setOptions(os => os.filter((_, j) => j !== i))}
                  style={{ border: 'none', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: 18, padding: '0 4px' }}>×</button>}
              </div>
            );
          })}
          {options.length < MAX_OPTIONS && <button data-testid="poll-option-add" onClick={() => setOptions(os => [...os, blank(os.length)])}
            style={{ ...btn, alignSelf: 'flex-start', fontSize: 13 }}>＋ вариант</button>}
        </div>

        <div data-testid="poll-timer-row" style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          <button data-testid="poll-timed" onClick={() => setTimed(t => !t)} style={{
            ...btn, ...(timed ? { background: '#4a90e2', color: '#fff', borderColor: '#4a90e2' } : {}),
          }}>⏱ {timed ? 'Время на ответ:' : 'Ограничить время на ответ'}</button>
          {timed && <>
            <button data-testid="poll-seconds-minus" onClick={() => step(-10)} style={{ ...btn, padding: '9px 10px' }}>−10</button>
            <input data-testid="poll-seconds" value={seconds} inputMode="numeric" onChange={e => setSeconds(e.target.value.replace(/\D/g, '').slice(0, 4))}
              style={{ ...field, width: 70, textAlign: 'center', fontSize: 16 }} />
            <button data-testid="poll-seconds-plus" onClick={() => step(10)} style={{ ...btn, padding: '9px 10px' }}>+10</button>
            <span style={{ fontSize: 14, color: '#555' }}>сек{sec >= 60 && sec <= MAX_SECONDS ? ` (${clock(sec)})` : ''}</span>
          </>}
        </div>
        {timed && <div style={{ fontSize: 12, color: '#777', marginTop: -6 }}>Отсчёт пойдёт, когда голосование начнётся. Когда время выйдет, ответы закроются; добавить время можно и потом.</div>}

        {error && <div data-testid="poll-error" style={{ color: '#e74c3c', fontSize: 13 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button data-testid="poll-start" onClick={() => add(true)} disabled={sending}
            style={{ ...btn, background: '#2ecc71', color: '#fff', border: 'none', flex: '1 1 160px', fontWeight: 'bold' }}>{sending ? 'Отправляем…' : 'Начать'}</button>
          <button data-testid="poll-add" onClick={() => add(false)} disabled={sending} style={{ ...btn, flex: '1 1 160px' }}>
            {running ? 'Следующим в плане' : 'Добавить в план'}
          </button>
          <button onClick={onClose} style={{ border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13, padding: '0 8px' }}>Отмена</button>
        </div>
      </div>
    </div>
  );
}

// ---------- the running poll, on the teacher's screen ----------

export function PollResults({ poll, students }: { poll: TeacherPollView; students: number }) {
  const answered = Object.keys(poll.answers).length;
  const most = Math.max(1, ...poll.counts);
  const right = poll.options.some(o => o.correct);
  const left = useSecondsLeft(poll);
  const out = poll.timeUp || left === 0;
  const grades = poll.multi && right ? Object.values(poll.answers).reduce<Record<string, number>>((g, a) => { if (a.grade) g[a.grade] = (g[a.grade] ?? 0) + 1; return g; }, {}) : null;
  return (
    <div data-testid="poll-results" style={{ background: '#fff', borderRadius: 10, padding: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 760 }}>
      {poll.picture && <img src={poll.picture.src} alt="" style={{ maxWidth: '100%', maxHeight: '28vh', objectFit: 'contain', alignSelf: 'center', borderRadius: 6 }} />}
      {poll.question && <div style={{ fontSize: 18, fontWeight: 'bold' }}>{poll.question}</div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#777' }}>{poll.multi ? 'Несколько ответов' : 'Один ответ'}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {left !== null && <span data-testid="poll-time-left" style={{
            fontSize: 20, fontWeight: 'bold', fontVariantNumeric: 'tabular-nums', color: out ? '#e74c3c' : left <= 10 ? '#e67e22' : '#222',
          }}>{out ? 'Время вышло' : `⏱ ${clock(left)}`}</span>}
          {!poll.revealed && <>
            {left === null
              ? <button data-testid="poll-time-limit" onClick={() => socket.emit('poll:time', { add: 30 })} style={smallBtn}>⏱ Дать 30 с на ответ</button>
              : <>
                  <button data-testid="poll-time-add10" onClick={() => socket.emit('poll:time', { add: 10 })} style={smallBtn}>+10 с</button>
                  <button data-testid="poll-time-add30" onClick={() => socket.emit('poll:time', { add: 30 })} style={smallBtn}>+30 с</button>
                  <button data-testid="poll-time-off" onClick={() => socket.emit('poll:untimed')} title="Убрать ограничение времени" style={smallBtn}>без времени</button>
                </>}
          </>}
        </span>
      </div>
      {poll.options.map((o, i) => {
        const color = right ? (o.correct ? GRADE_INFO.right.color : poll.multi ? '#94a3b8' : GRADE_INFO.wrong.color) : o.color;
        return (
          <div key={i} data-testid="poll-result-row" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 26, height: 26, flexShrink: 0, borderRadius: '50%', background: color, color: '#fff', fontWeight: 'bold', fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{LETTERS[i]}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14 }}>{o.text}{o.correct && <span style={{ color: GRADE_INFO.right.color, fontWeight: 'bold' }}> ✓</span>}</div>
              <div style={{ height: 8, borderRadius: 4, background: '#eee', marginTop: 3, overflow: 'hidden' }}>
                <div style={{ width: `${(poll.counts[i] / most) * 100}%`, height: '100%', background: color, transition: 'width .3s' }} />
              </div>
            </div>
            <span data-testid="poll-count" style={{ width: 28, textAlign: 'right', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' }}>{poll.counts[i]}</span>
          </div>
        );
      })}
      {grades && <div data-testid="poll-grades" style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: 13, color: '#444' }}>
        {Object.entries(GRADE_INFO).map(([g, info]) => <span key={g}><span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: info.color, marginRight: 4 }} />{info.label}: {grades[g] ?? 0}</span>)}
      </div>}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span data-testid="poll-answered" style={{ fontSize: 14, color: '#444' }}>Ответили {answered} из {students}</span>
        <button data-testid="poll-reveal" onClick={() => socket.emit('poll:reveal', { revealed: !poll.revealed })} style={{
          ...btn, marginLeft: 'auto', ...(poll.revealed ? {} : { background: '#4a90e2', color: '#fff', border: 'none' }),
        }}>{poll.revealed ? (out ? 'Скрыть итоги' : 'Скрыть итоги и открыть ответы') : right ? 'Показать итоги и правильный ответ' : 'Показать итоги классу'}</button>
      </div>
      {poll.revealed && <div style={{ fontSize: 12, color: '#777' }}>Класс видит, сколько выбрали каждый вариант, без имён. Ответы закрыты.</div>}
      {!poll.revealed && out && <div data-testid="poll-time-out" style={{ fontSize: 12, color: '#777' }}>Время вышло — ответы закрыты. Можно показать итоги или добавить время.</div>}
    </div>
  );
}

const overlay: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
};
const dialog: CSSProperties = {
  background: '#fff', borderRadius: 10, padding: 20, width: 'min(640px, 96vw)', maxHeight: '96vh', overflowY: 'auto', boxSizing: 'border-box',
  display: 'flex', flexDirection: 'column', gap: 12, fontFamily: 'sans-serif', boxShadow: '0 8px 30px rgba(0,0,0,0.25)',
};
const field: CSSProperties = { fontSize: 14, padding: 8, borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box', width: '100%' };
const smallBtn: CSSProperties = { padding: '4px 8px', borderRadius: 6, border: '1px solid #c9b99c', background: '#fff', color: '#222', fontSize: 12, cursor: 'pointer' };
const btn: CSSProperties = { padding: '9px 12px', borderRadius: 6, border: '1px solid #c9b99c', background: '#fff', color: '#222', fontSize: 14, cursor: 'pointer' };

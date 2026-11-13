import { useState } from 'react';
import { socket } from './socket';
import type { StudentPollView } from './pollState';

// Голосование (server/src/poll.ts) as a student sees it: the question and the options. The answer can
// be changed until the teacher shows the results; then the class sees how many chose each option
// (never who) and, if there is a right answer, which it was.

const LETTERS = 'АБВГДЕЖЗ';
const NEUTRAL = '#4a90e2';
const GRADES: Record<string, { color: string; text: string }> = {
  right: { color: '#2ecc71', text: 'Верно!' },
  most: { color: '#f1c40f', text: 'Почти: верно половина или больше' },
  some: { color: '#e67e22', text: 'Верно меньше половины' },
  wrong: { color: '#e74c3c', text: 'Неверно' },
};

export function PollView({ poll }: { poll: StudentPollView }) {
  // the press shows at once; the server's answer confirms it
  const [pressed, setPressed] = useState<{ blockId: string; choice: number[] } | null>(null);
  const open = !poll.revealed;
  const mine = open && pressed?.blockId === poll.blockId ? pressed.choice : poll.mine;

  function press(i: number) {
    if (!open) return;
    const next = poll.multi ? (mine.includes(i) ? mine.filter(x => x !== i) : [...mine, i].sort((a, b) => a - b)) : [i];
    setPressed({ blockId: poll.blockId, choice: next });
    socket.emit('poll:answer', { blockId: poll.blockId, choice: next });
  }

  const most = Math.max(1, ...(poll.counts ?? [0]));
  const grade = poll.revealed && poll.grade ? GRADES[poll.grade] : null;
  return (
    <div data-testid="poll" style={{ height: '100%', overflowY: 'auto', padding: 16, boxSizing: 'border-box', display: 'flex', justifyContent: 'center' }}>
      <div style={{ width: '100%', maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 12 }}>
        {poll.picture && <img src={poll.picture.src} alt="" style={{ maxWidth: '100%', maxHeight: '40vh', objectFit: 'contain', alignSelf: 'center', borderRadius: 8, background: '#fff' }} />}
        {poll.question && <div data-testid="poll-question" style={{ fontSize: 22, fontWeight: 'bold', color: '#222' }}>{poll.question}</div>}
        <div style={{ fontSize: 13, color: '#777' }}>
          {open ? (poll.multi ? 'Выберите все подходящие ответы' : 'Выберите один ответ') : 'Итоги класса'}
        </div>
        {poll.options.map((o, i) => {
          const picked = mine.includes(i);
          const color = o.color ?? NEUTRAL;
          return (
            <button key={i} data-testid="poll-option" data-picked={picked || undefined} onClick={() => press(i)} disabled={!open} style={{
              display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 10, textAlign: 'left', fontSize: 17,
              border: `3px solid ${picked ? color : '#e2d8c6'}`, background: picked ? `${color}22` : '#fff', color: '#222',
              cursor: open ? 'pointer' : 'default', position: 'relative', overflow: 'hidden',
            }}>
              {poll.counts && <span aria-hidden style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${(poll.counts[i] / most) * 100}%`, background: `${color}26` }} />}
              <span style={{
                position: 'relative', width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: poll.multi ? 7 : '50%', background: picked ? color : '#fff', border: `2px solid ${color}`,
                color: picked ? '#fff' : color, fontWeight: 'bold', fontSize: 15,
              }}>{picked && poll.multi ? '✓' : LETTERS[i]}</span>
              <span style={{ position: 'relative', flex: 1 }}>{o.text}{o.correct && <b style={{ color: GRADES.right.color }}> ✓ верно</b>}</span>
              {poll.counts && <span data-testid="poll-count" style={{ position: 'relative', fontWeight: 'bold', fontVariantNumeric: 'tabular-nums' }}>{poll.counts[i]}</span>}
            </button>
          );
        })}
        {open && mine.length > 0 && <div data-testid="poll-sent" style={{ fontSize: 13, color: '#5c8a5c' }}>Ответ принят. Его можно изменить, пока учитель не покажет итоги.</div>}
        {!open && <div data-testid="poll-closed" style={{ fontSize: 14, color: '#555' }}>
          {grade ? <b style={{ color: grade.color === '#f1c40f' ? '#b8930a' : grade.color }}>{grade.text}. </b> : mine.length === 0 ? 'Вы не ответили. ' : ''}
          Ответили {poll.total ?? 0}.
        </div>}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { LiveKitRoom, useLocalParticipant } from '@livekit/components-react';
import { socket } from './socket';
import { SeatingMap } from './SeatingMap';
import type { Seat } from './SeatingMap';
import { SharedBoard } from './SharedBoard';

interface LivekitInfo {
  url: string;
  token: string;
  room: string;
}

type Stage = 'waiting' | 'group' | 'individual' | 'pairs' | 'fours';

interface Participant {
  id: string;
  name: string;
  role: 'teacher' | 'student';
  livekitRoom: string | null;
}

interface LessonState {
  stage: Stage;
  timerEndsAt: number | null;
  participants: Participant[];
}

const LESSON_STAGES: { value: Stage; label: string }[] = [
  { value: 'group',      label: 'Объяснение' },
  { value: 'individual', label: 'Индивидуально' },
  { value: 'pairs',      label: 'Пары' },
  { value: 'fours',      label: 'Четвёрки' },
];

const PALETTE = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];
const groupColor = (g: number) => PALETTE[g % PALETTE.length];

type GroupMode = 'board' | 'screen';

function ScreenShareSync({ active }: { active: boolean }) {
  const { localParticipant } = useLocalParticipant();
  useEffect(() => {
    localParticipant.setScreenShareEnabled(active);
  }, [active, localParticipant]);
  return null;
}

function StudentGrid({ students, stage, seats, hasLivekit, groupMode }: { students: Participant[]; stage: Stage; seats: Seat[]; hasLivekit: boolean; groupMode: GroupMode }) {
  if (stage === 'waiting') {
    return <SeatingMap seats={seats} showSelf={hasLivekit} />;
  }

  if (stage === 'group') {
    if (groupMode === 'board') return <SharedBoard />;
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: 15 }}>
        Трансляция экрана запущена
      </div>
    );
  }

  if (students.length === 0) {
    return <div style={{ color: '#aaa', padding: 32 }}>Нет подключённых учеников</div>;
  }

  if (stage === 'pairs' || stage === 'fours') {
    const groups = new Map<string, Participant[]>();
    for (const s of students) {
      const room = s.livekitRoom ?? '—';
      if (!groups.has(room)) groups.set(room, []);
      groups.get(room)!.push(s);
    }
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, padding: 16, alignContent: 'flex-start' }}>
        {Array.from(groups.entries()).map(([room, members], i) => (
          <div key={room} style={{
            border: `2px solid ${groupColor(i)}`,
            borderRadius: 8,
            padding: 8,
            display: 'flex',
            gap: 8,
          }}>
            {members.map(s => <StudentTile key={s.id} name={s.name} color={groupColor(i)} />)}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 16 }}>
      {students.map(s => <StudentTile key={s.id} name={s.name} />)}
    </div>
  );
}

function StudentTile({ name, color }: { name: string; color?: string }) {
  return (
    <div style={{
      width: 90,
      background: '#f5f5f5',
      borderRadius: 6,
      padding: '8px 4px',
      textAlign: 'center',
      fontSize: 12,
      borderTop: `3px solid ${color ?? '#ddd'}`,
    }}>
      <div style={{
        width: 36, height: 36, borderRadius: '50%',
        background: color ?? '#ccc',
        margin: '0 auto 6px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontWeight: 'bold', fontSize: 15,
      }}>
        {name[0]?.toUpperCase()}
      </div>
      {name}
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<LessonState>({ stage: 'waiting', timerEndsAt: null, participants: [] });
  const [connected, setConnected] = useState(false);
  const [seats, setSeats] = useState<Seat[]>([]);
const [livekit, setLivekit] = useState<LivekitInfo | null>(null);
  const [groupMode, setGroupMode] = useState<GroupMode>('board');

  useEffect(() => {
    socket.connect();
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', setState);
    socket.on('seats', setSeats);
    socket.on('livekit', (info: LivekitInfo) => setLivekit(info));
    return () => { socket.disconnect(); };
  }, []);

  const students = state.participants.filter(p => p.role === 'student');
  const currentLabel = LESSON_STAGES.find(s => s.value === state.stage)?.label ?? 'Рассадка';

  const inner = (
    <div style={{ fontFamily: 'sans-serif', height: '100vh', display: 'flex', overflow: 'hidden' }}>

      {/* Left sidebar */}
      <div style={{
        width: 160, background: '#1e1e2e', color: '#fff',
        display: 'flex', flexDirection: 'column', padding: 12, gap: 6, flexShrink: 0,
      }}>
        <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
          <span style={{ color: connected ? '#2ecc71' : '#e74c3c' }}>●</span> Учитель
        </div>

{state.stage === 'waiting' ? (
          <button
            onClick={() => socket.emit('setStage', 'group')}
            style={{
              marginTop: 12, padding: '10px 6px', borderRadius: 6, border: 'none',
              cursor: 'pointer', background: '#2ecc71', color: '#fff',
              fontWeight: 'bold', fontSize: 13, textAlign: 'center',
            }}
          >
            Начать урок
          </button>
        ) : (
          <>
            <div style={{ fontSize: 11, color: '#666', marginTop: 12 }}>ЭТАП</div>
            {LESSON_STAGES.map(s => (
              <button
                key={s.value}
                onClick={() => socket.emit('setStage', s.value)}
                style={{
                  padding: '8px 6px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: state.stage === s.value ? '#4a90e2' : '#2e2e3e',
                  color: state.stage === s.value ? '#fff' : '#aaa',
                  fontWeight: state.stage === s.value ? 'bold' : 'normal',
                  fontSize: 13, textAlign: 'left',
                }}
              >
                {s.label}
              </button>
            ))}
            <button
              onClick={() => socket.emit('setStage', 'waiting')}
              style={{
                marginTop: 8, padding: '6px 6px', borderRadius: 6, border: 'none',
                cursor: 'pointer', background: '#2e2e3e', color: '#888',
                fontSize: 11, textAlign: 'left',
              }}
            >
              ← Рассадка
            </button>
          </>
        )}

        <div style={{ marginTop: 'auto', fontSize: 12, color: '#fff' }}>
          {students.length} учеников
        </div>
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '10px 16px', background: '#f8f8f8', borderBottom: '1px solid #eee', fontSize: 14, color: '#555', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{currentLabel}</span>
          {state.stage === 'group' && livekit && (
            <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
              {(['board', 'screen'] as GroupMode[]).map(m => (
                <button key={m} onClick={() => setGroupMode(m)} style={{
                  padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12,
                  background: groupMode === m ? '#4a90e2' : '#e0e0e0',
                  color: groupMode === m ? '#fff' : '#555',
                  fontWeight: groupMode === m ? 'bold' : 'normal',
                }}>
                  {m === 'board' ? 'Доска' : 'Экран'}
                </button>
              ))}
            </div>
          )}
        </div>
        {livekit && state.stage === 'group' && <ScreenShareSync active={groupMode === 'screen'} />}
        <div style={{ flex: 1, overflow: state.stage === 'group' ? 'hidden' : 'auto' }}>
          <StudentGrid students={students} stage={state.stage} seats={seats} hasLivekit={!!livekit} groupMode={groupMode} />
        </div>
      </div>

    </div>
  );

  if (!livekit) return inner;

  return (
    <LiveKitRoom
      serverUrl={livekit.url}
      token={livekit.token}
      connect={true}
      video={true}
      audio={false}
      style={{ display: 'contents' }}
    >
      {inner}
    </LiveKitRoom>
  );
}

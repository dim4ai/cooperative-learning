import { useEffect, useState } from 'react';
import { LiveKitRoom, useLocalParticipant, useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
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

function TeacherPairContent({ onLeave }: { onLeave: () => void }) {
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden', position: 'relative' }}>
      {/* Board */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        <SharedBoard />
      </div>

      {/* Right column: cameras + back button */}
      <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: 8, padding: 8, background: '#1a1a1a', justifyContent: 'center' }}>
        {cameraTracks.map(t => (
          <div key={t.participant.identity} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', background: '#222', aspectRatio: '4/3' }}>
            <VideoTrack trackRef={t} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            <div style={{ position: 'absolute', bottom: 3, left: 0, right: 0, textAlign: 'center', fontSize: 10, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>
              {t.participant.isLocal ? 'Учитель' : (t.participant.name || t.participant.identity)}
            </div>
          </div>
        ))}
        <div style={{ marginTop: 'auto' }}>
          <button
            onClick={onLeave}
            style={{
              width: '100%', padding: '8px 0', borderRadius: 6, border: 'none',
              background: '#2e2e3e', color: '#aaa', cursor: 'pointer', fontSize: 13,
            }}
          >
            ← Назад
          </button>
        </div>
      </div>
    </div>
  );
}

function CapacityInput() {
  const [value, setValue] = useState('16');
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <input
        type="number"
        value={value}
        onChange={e => setValue(e.target.value)}
        min={4} step={4}
        style={{ width: 56, padding: '4px 6px', borderRadius: 4, border: '1px solid #444', background: '#2e2e3e', color: '#fff', fontSize: 13 }}
        onKeyDown={e => { if (e.key === 'Enter') socket.emit('setCapacity', Number(value)); }}
      />
      <button
        onClick={() => socket.emit('setCapacity', Number(value))}
        style={{ flex: 1, padding: '4px 6px', borderRadius: 4, border: 'none', background: '#4a90e2', color: '#fff', cursor: 'pointer', fontSize: 12 }}
      >
        ОК
      </button>
    </div>
  );
}

type GroupMode = 'board' | 'screen';

function ScreenShareSync({ active }: { active: boolean }) {
  const { localParticipant } = useLocalParticipant();
  useEffect(() => {
    localParticipant.setScreenShareEnabled(active);
  }, [active, localParticipant]);
  return null;
}

function StudentGrid({ students, stage, seats, hasLivekit, groupMode, callingRooms, onJoinPair }: { students: Participant[]; stage: Stage; seats: Seat[]; hasLivekit: boolean; groupMode: GroupMode; callingRooms: Set<string>; onJoinPair: (room: string) => void }) {
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
    return <SeatingMap seats={seats} showSelf={hasLivekit} readOnly callingRooms={callingRooms} onJoinPair={onJoinPair} />;
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
  const [callingRooms, setCallingRooms] = useState<Set<string>>(new Set());

  useEffect(() => {
    socket.connect();
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', setState);
    socket.on('seats', setSeats);
    socket.on('livekit', (info: LivekitInfo) => setLivekit(info));
    socket.on('callTeacher', ({ room, calling }: { room: string; calling: boolean }) => {
      setCallingRooms(prev => {
        const next = new Set(prev);
        calling ? next.add(room) : next.delete(room);
        return next;
      });
    });
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

        {state.stage === 'waiting' && (
          <>
            <div style={{ fontSize: 11, color: '#666', marginTop: 8 }}>Мест в классе</div>
            <CapacityInput />
          </>
        )}

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
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {livekit?.room.startsWith('pair-') || livekit?.room.startsWith('fours-')
            ? <TeacherPairContent onLeave={() => socket.emit('leavePair')} />
            : <StudentGrid students={students} stage={state.stage} seats={seats} hasLivekit={!!livekit} groupMode={groupMode} callingRooms={callingRooms} onJoinPair={room => socket.emit('joinPair', { room })} />
          }
        </div>
      </div>

    </div>
  );

  if (!livekit) return inner;

  return (
    <LiveKitRoom
      key={livekit.room}
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

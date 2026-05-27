import { useEffect, useState } from 'react';
import { LiveKitRoom, useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { VideoRoom } from './VideoRoom';
import { DeskLayout } from './DeskLayout';
import { SeatingMap } from './SeatingMap';
import type { Seat } from './SeatingMap';
import { socket, myName } from './socket';

function SelfPreview() {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const localTrackRef = tracks.find(t => t.participant.isLocal);

  return (
    <div style={{
      position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
      width: 200, aspectRatio: '4/3', zIndex: 10,
      borderRadius: 8, overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      background: '#222',
    }}>
      {localTrackRef && (
        <VideoTrack trackRef={localTrackRef} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
      )}
      <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.7)', pointerEvents: 'none' }}>
        {myName}
      </div>
    </div>
  );
}

type Stage = 'waiting' | 'group' | 'individual' | 'pairs' | 'fours';

interface LessonState {
  stage: Stage;
  timerEndsAt: number | null;
  participants: { id: string; name: string; role: string }[];
}

interface LivekitInfo {
  url: string;
  token: string;
  room: string;
}

const STAGE_LABELS: Record<Stage, string> = {
  waiting: 'Рассадка',
  group: 'Объяснение',
  individual: 'Индивидуальная работа',
  pairs: 'Работа в парах',
  fours: 'Работа в четвёрках',
};

function useTimer(timerEndsAt: number | null) {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (!timerEndsAt) { setSecondsLeft(null); return; }
    const tick = () => {
      const left = Math.max(0, Math.round((timerEndsAt - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [timerEndsAt]);

  return secondsLeft;
}

export default function App() {
  const [lessonState, setLessonState] = useState<LessonState>({
    stage: 'waiting',
    timerEndsAt: null,
    participants: [],
  });
  const [connected, setConnected] = useState(false);
  const [livekit, setLivekit] = useState<LivekitInfo | null>(null);
  const [, setSharedText] = useState('');
  const [seats, setSeats] = useState<Seat[]>([]);
  const [poll, setPoll] = useState<{ question: string; options: string[]; myVote: number | null } | null>(null);
  const secondsLeft = useTimer(lessonState.timerEndsAt);

  useEffect(() => {
    socket.connect();
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('state', setLessonState);
    socket.on('seats', setSeats);
    socket.on('livekit', (info: LivekitInfo) => {
      setLivekit(info);
      setSharedText('');
    });
    socket.on('sharedText', ({ text }: { room: string; text: string }) => {
      setSharedText(text);
    });
    socket.on('poll', (data: { question: string; options: string[]; myVote: number | null } | null) => {
      setPoll(data);
    });
    return () => { socket.disconnect(); };
  }, []);

  const students = lessonState.participants.filter(p => p.role === 'student');
  const showDesk = livekit && (lessonState.stage === 'pairs' || lessonState.stage === 'fours');

  return (
    <div style={{ fontFamily: 'sans-serif', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 16px', background: '#f0f0f0', display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ color: connected ? 'green' : 'red', fontWeight: 'bold' }}>
          {connected ? '●' : '○'}
        </span>
        <strong>{STAGE_LABELS[lessonState.stage]}</strong>
        {secondsLeft !== null && (
          <span style={{ fontSize: 20, fontWeight: 'bold', marginLeft: 'auto' }}>
            {secondsLeft}s
          </span>
        )}
        <span style={{ color: '#888', marginLeft: secondsLeft !== null ? 0 : 'auto' }}>
          {students.length} уч.
        </span>
      </div>

      {poll && (
        <div style={{ padding: '12px 16px', background: '#fffbe6', borderBottom: '1px solid #ffe58f' }}>
          <strong>{poll.question}</strong>
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            {poll.options.map((opt, i) => (
              <button
                key={i}
                onClick={() => socket.emit('vote', { optionIndex: i })}
                style={{
                  padding: '6px 14px',
                  background: poll.myVote === i ? '#4a90e2' : '#fff',
                  color: poll.myVote === i ? '#fff' : '#333',
                  border: '1px solid #ccc',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'hidden' }}>
        {livekit ? (
          <LiveKitRoom
            key={livekit.room}
            serverUrl={livekit.url}
            token={livekit.token}
            connect={true}
            video={true}
            audio={true}
            style={{ height: '100%' }}
          >
            {lessonState.stage === 'waiting'
              ? <div style={{ height: '100%', position: 'relative' }}>
                  <SelfPreview />
                  <SeatingMap seats={seats} />
                </div>
              : showDesk
                ? <DeskLayout room={livekit.room} />
                : <VideoRoom />
            }
          </LiveKitRoom>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#888' }}>
            Подключение к видео...
          </div>
        )}
      </div>
    </div>
  );
}

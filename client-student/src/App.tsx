import { useEffect, useRef, useState } from 'react';
import { LiveKitRoom, RoomAudioRenderer, useTracks, VideoTrack, useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { Track, RoomEvent } from 'livekit-client';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { VideoRoom } from './VideoRoom';
import { DeskLayout } from './DeskLayout';
import { FoursLayout } from './FoursLayout';
import { IndividualLayout } from './IndividualLayout';
import { GroupView } from './GroupView';
import { useStudentSlides } from './LessonSlides';
import { SeatingMap } from './SeatingMap';
import type { Seat } from './SeatingMap';
import { SharedBoard } from './SharedBoard';
import { socket, myName, lessonId, isBoardOnly, myBoardRoom, setName, setLessonId } from './socket';

function MicControl({ enabled }: { enabled: boolean }) {
  const { localParticipant } = useLocalParticipant();
  const room = useRoomContext();

  useEffect(() => {
    const apply = () => localParticipant?.setMicrophoneEnabled(enabled);
    apply();
    room.on(RoomEvent.Connected, apply);
    return () => { room.off(RoomEvent.Connected, apply); };
  }, [enabled, localParticipant, room]);

  return null;
}

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

function BoardOnlyMode({ room, readOnly }: { room: string; readOnly: boolean }) {
  useEffect(() => {
    socket.connect();
    return () => { socket.disconnect(); };
  }, []);
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <SharedBoard room={room} readOnly={readOnly} />
    </div>
  );
}

function NameScreen({ onNext }: { onNext: (name: string) => void }) {
  const [name, setNameInput] = useState('');

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', gap: 12, fontFamily: 'sans-serif', padding: 24, boxSizing: 'border-box',
    }}>
      <h2 style={{ margin: 0 }}>Кооперативное обучение</h2>
      <input
        value={name}
        onChange={e => setNameInput(e.target.value)}
        placeholder="Ваше имя"
        onKeyDown={e => { if (e.key === 'Enter' && name.trim()) onNext(name.trim()); }}
        style={{ fontSize: 16, padding: 10, borderRadius: 6, border: '1px solid #ccc', width: 240 }}
      />
      <button
        onClick={() => name.trim() && onNext(name.trim())}
        disabled={!name.trim()}
        style={{
          fontSize: 16, padding: '10px 24px', borderRadius: 6, border: 'none',
          background: '#4a90e2', color: '#fff', cursor: 'pointer', width: 240,
        }}
      >
        Далее
      </button>
    </div>
  );
}

function useMicLevel(stream: MediaStream | null, enabled: boolean) {
  const [level, setLevel] = useState(0);

  useEffect(() => {
    if (!stream || !enabled) { setLevel(0); return; }
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setLevel(Math.min(1, (avg / 255) * 2.5));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
      audioCtx.close();
    };
  }, [stream, enabled]);

  return level;
}

function CameraPreview() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [camOn, setCamOn] = useState(true);
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState('');
  const micLevel = useMicLevel(stream, micOn);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(s => {
        streamRef.current = s;
        setStream(s);
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => setError('Нет доступа к камере/микрофону'));
    return () => { streamRef.current?.getTracks().forEach(t => t.stop()); };
  }, []);

  useEffect(() => { stream?.getVideoTracks().forEach(t => { t.enabled = camOn; }); }, [camOn, stream]);
  useEffect(() => { stream?.getAudioTracks().forEach(t => { t.enabled = micOn; }); }, [micOn, stream]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 220, aspectRatio: '4/3', borderRadius: 8, overflow: 'hidden', background: '#222', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {error
          ? <span style={{ color: '#e74c3c', fontSize: 12, padding: 8, textAlign: 'center' }}>{error}</span>
          : <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        }
      </div>
      {!error && (
        <div style={{ width: 220 }}>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>
            {micOn ? 'Скажите что-нибудь — полоска должна двигаться' : 'Микрофон выключен'}
          </div>
          <div style={{ width: '100%', height: 8, borderRadius: 4, background: '#eee', overflow: 'hidden' }}>
            <div style={{
              width: `${micLevel * 100}%`, height: '100%', borderRadius: 4,
              background: micLevel > 0.1 ? '#2ecc71' : '#ccc',
              transition: 'width 60ms linear',
            }} />
          </div>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => setCamOn(v => !v)} style={{ fontSize: 13, padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc', background: camOn ? '#fff' : '#eee', cursor: 'pointer' }}>
          {camOn ? '📷 вкл' : '📷 выкл'}
        </button>
        <button onClick={() => setMicOn(v => !v)} style={{ fontSize: 13, padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc', background: micOn ? '#fff' : '#eee', cursor: 'pointer' }}>
          {micOn ? '🎤 вкл' : '🎤 выкл'}
        </button>
      </div>
    </div>
  );
}

function PracticeArea({ error, onJoin }: { error: string; onJoin: (code: string) => void }) {
  const [code, setCode] = useState('');

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: 12, fontFamily: 'sans-serif', padding: 24, boxSizing: 'border-box', overflow: 'auto',
    }}>
      <h3 style={{ margin: '8px 0 0' }}>Потренируйтесь перед уроком</h3>
      <CameraPreview />
      <div style={{ width: '100%', maxWidth: 520, height: 280, border: '1px solid #ccc', borderRadius: 8, overflow: 'hidden' }}>
        <Excalidraw />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
        <input
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="Код занятия"
          onKeyDown={e => { if (e.key === 'Enter' && code.trim()) onJoin(code.trim().toLowerCase()); }}
          style={{ fontSize: 16, padding: 10, borderRadius: 6, border: '1px solid #ccc', width: 180, letterSpacing: 1 }}
        />
        <button
          onClick={() => code.trim() && onJoin(code.trim().toLowerCase())}
          disabled={!code.trim()}
          style={{ fontSize: 16, padding: '10px 20px', borderRadius: 6, border: 'none', background: '#4a90e2', color: '#fff', cursor: 'pointer' }}
        >
          Войти в класс
        </button>
      </div>
      {error && <div style={{ color: '#e74c3c', fontSize: 13 }}>{error}</div>}
    </div>
  );
}

export default function App() {
  if (isBoardOnly) {
    const readOnly = new URLSearchParams(window.location.search).get('readonly') === '1';
    return <BoardOnlyMode room={myBoardRoom} readOnly={readOnly} />;
  }

  const [name, setNameState] = useState(myName);
  const [joined, setJoined] = useState(!!myName && !!lessonId);
  const [joinError, setJoinError] = useState('');

  const [lessonState, setLessonState] = useState<LessonState>({
    stage: 'waiting',
    timerEndsAt: null,
    participants: [],
  });
  const [connected, setConnected] = useState(false);
  const [livekit, setLivekit] = useState<LivekitInfo | null>(null);
  const [monitor, setMonitor] = useState<LivekitInfo | null>(null);
  const [, setSharedText] = useState('');
  const [seats, setSeats] = useState<Seat[]>([]);
  const [poll, setPoll] = useState<{ question: string; options: string[]; myVote: number | null } | null>(null);
  const [micOn, setMicOn] = useState(false);
  const [waitingForLesson, setWaitingForLesson] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const secondsLeft = useTimer(lessonState.timerEndsAt);
  const slides = useStudentSlides(joined);

  useEffect(() => {
    setMicOn(lessonState.stage !== 'group');
  }, [lessonState.stage]);

  useEffect(() => {
    if (!joined) return;
    socket.connect();
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('lessonError', ({ error }: { error: string }) => {
      if (error === 'lesson not found') {
        // Teacher may not have started the lesson with this code yet — wait and keep retrying.
        setWaitingForLesson(true);
      } else if (error === 'too many attempts') {
        setJoined(false);
        setJoinError('Слишком много попыток — подождите минуту и попробуйте снова');
      } else {
        setJoined(false);
        setJoinError('Не удалось подключиться');
      }
    });
    socket.on('state', (s: LessonState) => { setLessonState(s); setWaitingForLesson(false); setConfirmed(true); });
    socket.on('seats', setSeats);
    socket.on('monitor', (info: LivekitInfo) => setMonitor(info));
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
    socket.on('muted', () => setMicOn(false));
    // Teacher ended the lesson: back to the start screen
    socket.on('lessonEnded', () => {
      setJoined(false);
      setWaitingForLesson(false);
      setLivekit(null);
      setMonitor(null);
      setLessonState({ stage: 'waiting', timerEndsAt: null, participants: [] });
      setJoinError('Урок завершён');
    });
    return () => { socket.disconnect(); setConfirmed(false); };
  }, [joined]);

  useEffect(() => {
    if (!waitingForLesson) return;
    const id = setInterval(() => { socket.connect(); }, 30000);
    return () => clearInterval(id);
  }, [waitingForLesson]);

  const students = lessonState.participants.filter(p => p.role === 'student');
  const showDesk = livekit && lessonState.stage === 'pairs';
  const showFours = livekit && lessonState.stage === 'fours';
  const showGroup = livekit && lessonState.stage === 'group';
  const showIndividual = livekit && lessonState.stage === 'individual';
  const myGroupIndex = seats.find(s => s.occupant === myName)?.groupIndex ?? -1;
  const groupSeats = seats.filter(s => s.groupIndex === myGroupIndex);

  if (!name) {
    return <NameScreen onNext={n => { setName(n); setNameState(n); }} />;
  }

  if (!joined) {
    return (
      <PracticeArea
        error={joinError}
        onJoin={code => { setLessonId(code); setJoinError(''); setJoined(true); }}
      />
    );
  }

  if (waitingForLesson) {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', gap: 12, fontFamily: 'sans-serif', padding: 24, boxSizing: 'border-box',
      }}>
        <h3 style={{ margin: 0 }}>Ждём начала занятия…</h3>
        <p style={{ color: '#888', margin: 0 }}>Код: {lessonId}</p>
        <p style={{ color: '#888', fontSize: 13, margin: 0 }}>Проверяем каждые 30 секунд</p>
        <button
          onClick={() => socket.connect()}
          style={{ fontSize: 14, padding: '8px 20px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', cursor: 'pointer' }}
        >
          Проверить сейчас
        </button>
        <button
          onClick={() => { setWaitingForLesson(false); setJoined(false); }}
          style={{ fontSize: 13, padding: '6px 16px', borderRadius: 6, border: 'none', background: 'transparent', color: '#aaa', cursor: 'pointer' }}
        >
          Изменить код
        </button>
      </div>
    );
  }

  if (!confirmed) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#888', fontFamily: 'sans-serif' }}>
        Подключаемся к занятию…
      </div>
    );
  }

  function leaveClass() {
    setJoined(false);
    setWaitingForLesson(false);
    setLivekit(null);
    setMonitor(null);
    setLessonState({ stage: 'waiting', timerEndsAt: null, participants: [] });
    setJoinError('');
  }

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
        {livekit && (
          <button
            onClick={() => setMicOn(v => !v)}
            title={micOn ? 'Выключить микрофон' : 'Включить микрофон'}
            style={{
              background: micOn ? '#27ae60' : '#e74c3c',
              color: '#fff',
              border: 'none',
              borderRadius: 20,
              width: 36,
              height: 36,
              fontSize: 18,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {micOn ? '🎤' : '🔇'}
          </button>
        )}
        <button
          onClick={leaveClass}
          title="Выйти из класса"
          style={{
            fontSize: 13, padding: '6px 12px', borderRadius: 6, border: '1px solid #ccc',
            background: '#fff', color: '#666', cursor: 'pointer',
          }}
        >
          Выйти
        </button>
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
        {/* Silent monitor connection to main-room so teacher can see us during pair work */}
        {monitor && livekit && livekit.room !== monitor.room && (
          <LiveKitRoom
            key={'monitor-' + monitor.token}
            serverUrl={monitor.url}
            token={monitor.token}
            connect={true}
            video={true}
            audio={false}
            style={{ display: 'none' }}
          />
        )}
        {livekit ? (
          <LiveKitRoom
            key={livekit.room}
            serverUrl={livekit.url}
            token={livekit.token}
            connect={true}
            video={true}
            audio={false}
            style={{ height: '100%' }}
          >
            <RoomAudioRenderer />
            <MicControl enabled={micOn} />
            {lessonState.stage === 'waiting'
              ? <div style={{ height: '100%', position: 'relative' }}>
                  <SelfPreview />
                  <SeatingMap seats={seats} />
                </div>
              : showGroup
                ? <GroupView slides={slides} />
                : showIndividual
                  ? <IndividualLayout room={livekit.room} />
                  : showFours
                  ? <FoursLayout room={livekit.room} groupSeats={groupSeats} />
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

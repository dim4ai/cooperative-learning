import { useEffect, useMemo, useState } from 'react';
import { LiveKitRoom, RoomAudioRenderer, useTracks, VideoTrack, useLocalParticipant, useRoomContext } from '@livekit/components-react';
import { Track, RoomEvent } from 'livekit-client';
import { VideoRoom } from './VideoRoom';
import { DeskLayout } from './DeskLayout';
import { FoursLayout } from './FoursLayout';
import { IndividualLayout } from './IndividualLayout';
import { GroupView } from './GroupView';
import { useStudentSlides } from './LessonSlides';
import { SeatingMap } from './SeatingMap';
import type { Seat } from './SeatingMap';
import { SharedBoard } from './SharedBoard';
import { Board } from './slides/Board';
import { AVATARS, AvatarPicker, AvatarProvider, DEFAULT_AVATAR, loadAvatar, saveAvatar, useAvatarUrl } from './avatars';
import { forgetProfile, profiles, saveProfileAvatar, enterProfile } from './profiles';
import { socket, myName, lessonId, isBoardOnly, myBoardRoom, setName, setLessonId } from './socket';
import { MediaCheck, LocalMediaSync, loadMediaPrefs, saveMediaPrefs, captureOptions, monitorOptions } from './mediaCheck';
import type { MediaPrefs } from './mediaCheck';

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
  const selfAvatar = useAvatarUrl(myName); // without video: own avatar (or the default one)

  return (
    <div style={{
      position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
      width: 200, aspectRatio: '4/3', zIndex: 10,
      borderRadius: 8, overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      background: '#222',
    }}>
      {localTrackRef && !localTrackRef.publication?.isMuted
        ? <VideoTrack trackRef={localTrackRef} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
        : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 14, boxSizing: 'border-box' }}>
            {selfAvatar && <img src={selfAvatar} alt="" data-testid="self-avatar" style={{ height: '62%' }} />}
          </div>}
      <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.7)', pointerEvents: 'none' }}>
        {myName}
      </div>
    </div>
  );
}

type Stage = 'waiting' | 'group' | 'individual' | 'pairs' | 'fours';

interface LessonState {
  stage: Stage;
  /** Who may show video in this lesson; students only when 'all' */
  videoMode?: 'all' | 'teacherSees' | 'teacher' | 'none';
  timerEndsAt: number | null;
  /** After-lesson chat in fours: the teacher has left, the lesson ends at this time */
  afterUntil?: number | null;
  /** A demo lesson's end, by the server's clock */
  demo?: { endsAt: number } | null;
  now?: number;
  participants: { id: string; name: string; role: string; avatar?: string | null }[];
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

function NameScreen({ onNext: next }: { onNext: (name: string) => void }) {
  const [name, setNameInput] = useState('');
  const [known, setKnown] = useState(profiles);
  function onNext(n: string) {
    enterProfile(n);
    next(n);
  }
  const shown = known.filter(p => p.name.toLowerCase().includes(name.trim().toLowerCase()));

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
      {/* who has used this browser: one click and the name, avatar and seat are theirs */}
      {shown.length > 0 && (
        <div style={{ width: 240, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {shown.map(p => (
            <div key={p.uuid} data-testid="profile" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => onNext(p.name)} style={{
                flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 6,
                border: '1px solid #ddd', background: '#fff', color: '#222', cursor: 'pointer', fontSize: 14, textAlign: 'left',
              }}>
                <img src={(p.avatar && AVATARS[p.avatar]) || DEFAULT_AVATAR} alt="" style={{ height: 22 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              </button>
              <button title="Удалить с этого компьютера" aria-label={`Удалить ${p.name} с этого компьютера`}
                onClick={() => setKnown(forgetProfile(p.uuid))}
                style={{ border: 'none', background: 'transparent', color: '#aaa', cursor: 'pointer', fontSize: 14 }}>✕</button>
            </div>
          ))}
        </div>
      )}
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

function PracticeArea({ error, earlyCode, media, onMedia, onJoin }: { error: string; earlyCode: string; media: MediaPrefs; onMedia: (p: MediaPrefs) => void; onJoin: (code: string) => void }) {
  const [code, setCode] = useState(earlyCode); // came too early: no need to type it again
  const [avatar, setAvatar] = useState<string | null>(loadAvatar);
  return (
    <div style={{
      height: '100vh', display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', alignContent: 'flex-start',
      justifyContent: 'center', gap: '24px 128px', fontFamily: 'sans-serif', padding: 24, boxSizing: 'border-box', overflow: 'auto',
    }}>
      <div style={{ width: 320, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <h3 style={{ margin: 0 }}>Камера и микрофон</h3>
        <MediaCheck prefs={media} onChange={onMedia} />
      </div>

      <div style={{ flex: '1 1 420px', maxWidth: 640, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <input
          value={code}
          onChange={e => setCode(e.target.value)}
          placeholder="Код занятия"
          onKeyDown={e => { if (e.key === 'Enter' && code.trim()) onJoin(code.trim().toLowerCase()); }}
          style={{ fontSize: 16, padding: 10, borderRadius: 6, border: '1px solid #ccc', flex: '1 1 180px', minWidth: 0, boxSizing: 'border-box', letterSpacing: 1 }}
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
      <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Аватарка — её увидят одноклассники, когда у вас нет видео</div>
      <AvatarPicker value={avatar} onChange={id => { setAvatar(id); saveAvatar(id); saveProfileAvatar(myName, id); }} />
      <div style={{ fontSize: 13, color: '#888', marginTop: 4 }}>Доска для разминки — порисуйте, пока ждёте урок</div>
      <div style={{ width: '100%', height: 420, flexShrink: 0, border: '1px solid #ccc', borderRadius: 8, overflow: 'hidden' }}>
        <Board />
      </div>
      </div>
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
  const [earlyCode, setEarlyCode] = useState('');

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
  const [media, setMediaState] = useState<MediaPrefs>(loadMediaPrefs);
  function setMedia(p: MediaPrefs) { setMediaState(p); saveMediaPrefs(p); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const roomOptions = useMemo(() => captureOptions(media), [media.camId, media.micId]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const monitorRoomOptions = useMemo(() => monitorOptions(media), [media.camId, media.micId]);
  const [waitingForLesson, setWaitingForLesson] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const secondsLeft = useTimer(lessonState.timerEndsAt);
  const afterLeft = useTimer(lessonState.afterUntil ?? null);
  const [clockSkew, setClockSkew] = useState(0); // server time − this computer's
  const demoLeft = useTimer(lessonState.demo ? lessonState.demo.endsAt - clockSkew : null);
  const videoMode = lessonState.videoMode ?? 'all';
  const camAllowed = videoMode === 'all' || videoMode === 'teacherSees';
  // teacherSees: the camera goes out through the monitor connection only, never to classmates
  const camInClass = videoMode === 'all';
  const slides = useStudentSlides(joined);

  useEffect(() => {
    setMicOn(lessonState.stage !== 'group');
  }, [lessonState.stage]);

  useEffect(() => {
    if (!joined) return;
    socket.connect();
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('lessonError', ({ error, opensAt }: { error: string; opensAt?: number }) => {
      if (error === 'not open yet') {
        setJoined(false);
        setEarlyCode(lessonId);
        const at = opensAt ? new Date(opensAt) : null;
        setJoinError(at
          ? `Занятие ещё не началось. Вход откроется ${at.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })} в ${at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
          : 'Занятие ещё не началось');
      } else if (error === 'lesson not found') {
        // Teacher may not have started the lesson with this code yet — wait and keep retrying.
        setWaitingForLesson(true);
      } else if (error === 'too many attempts') {
        setJoined(false);
        setJoinError('Слишком много попыток — подождите минуту и попробуйте снова');
      } else if (error === 'lesson ended') {
        setJoined(false);
        setJoinError('Урок завершён');
      } else if (error === 'too many open lessons') {
        setJoined(false);
        setJoinError('Занятие сейчас не открыть: у учителя слишком много занятий одновременно');
      } else if (error === 'lesson full') {
        setJoined(false);
        setJoinError('В классе нет свободных мест');
      } else if (error === 'server full' || error === 'video full') {
        setJoined(false);
        setJoinError('Сейчас на сервере нет мест, попробуйте через несколько минут');
      } else {
        setJoined(false);
        setJoinError('Не удалось подключиться');
      }
    });
    socket.on('state', (s: LessonState) => {
      setLessonState(s);
      if (s.now) setClockSkew(s.now - Date.now());
      setWaitingForLesson(false);
      setConfirmed(true);
    });
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
        earlyCode={earlyCode}
        error={joinError}
        media={media}
        onMedia={setMedia}
        onJoin={code => { setLessonId(code); setJoinError(''); setMicOn(media.micOn); setJoined(true); }}
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

  return (<AvatarProvider participants={lessonState.participants}>
    <div style={{ fontFamily: 'sans-serif', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: '8px 16px', background: '#f0f0f0', display: 'flex', gap: 16, alignItems: 'center' }}>
        <span style={{ color: connected ? 'green' : 'red', fontWeight: 'bold' }}>
          {connected ? '●' : '○'}
        </span>
        {afterLeft !== null
          ? <strong data-testid="after-lesson">
              Урок окончен. Учитель покинул занятие. Можно поболтать ещё {Math.floor(afterLeft / 60)}:{String(afterLeft % 60).padStart(2, '0')}
            </strong>
          : <strong>{STAGE_LABELS[lessonState.stage]}</strong>}
        {demoLeft !== null && demoLeft <= 300 && (
          <span data-testid="demo-ending" style={{ color: '#b9770e', fontSize: 13 }}>
            Демо-урок закончится через {Math.floor(demoLeft / 60)}:{String(demoLeft % 60).padStart(2, '0')}
          </span>
        )}
        {secondsLeft !== null && (
          <span style={{ fontSize: 20, fontWeight: 'bold', marginLeft: 'auto' }}>
            {secondsLeft}s
          </span>
        )}
        <span style={{ color: '#888', marginLeft: secondsLeft !== null ? 0 : 'auto' }}>
          {students.length} уч.
        </span>
        {livekit && videoMode === 'teacherSees' && media.camOn && (
          <span data-testid="teacher-sees-you" style={{ color: '#888', fontSize: 12 }}>Вас видит только учитель</span>
        )}
        {livekit && camAllowed && (
          <button
            onClick={() => setMedia({ ...media, camOn: !media.camOn })}
            title={media.camOn ? 'Выключить камеру' : 'Включить камеру'}
            style={{
              background: media.camOn ? '#27ae60' : '#e74c3c',
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
            📷
          </button>
        )}
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
            video={media.camOn && camAllowed}
            audio={false}
            options={monitorRoomOptions}
            style={{ display: 'none' }}
          >
            <LocalMediaSync camOn={media.camOn && camAllowed} />
          </LiveKitRoom>
        )}
        {livekit ? (
          <LiveKitRoom
            key={livekit.room}
            serverUrl={livekit.url}
            token={livekit.token}
            connect={true}
            video={media.camOn && camInClass}
            audio={false}
            options={roomOptions}
            style={{ height: '100%' }}
          >
            <RoomAudioRenderer />
            <MicControl enabled={micOn} />
            <LocalMediaSync camOn={media.camOn && camInClass} />
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
                  ? <FoursLayout room={livekit.room} groupSeats={groupSeats} noTeacher={afterLeft !== null} />
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
  </AvatarProvider>);
}

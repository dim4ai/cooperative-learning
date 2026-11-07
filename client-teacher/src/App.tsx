import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { isTrackReference, LiveKitRoom, RoomAudioRenderer, useLocalParticipant, useTracks, VideoTrack } from '@livekit/components-react';
import { NameCard, SpeakingRing } from './speaking';
import { AvatarProvider, useTeacherTitle } from './avatars';
import { Track } from 'livekit-client';
import { socket, setLessonCode, setAuthToken } from './socket';
import { SeatingMap } from './SeatingMap';
import type { Marks, Seat, SeatNames } from './SeatingMap';
import { useTeacherSlides, BlockNotes, ExplainBoard, LessonPlan, LessonPreview, MaterialPanel, UnderstoodPanel } from './LessonSlides';
import { ClassCamVideo, ClassCams, useClassCam, useClassCamsRoom, type CamsInfo } from './classCams';
import { MediaSetup, SidebarMediaToggles, VIDEO_MODE_LABELS, type DemoStart, type VideoMode } from './MediaSetup';
import { DemoBanner, DemoChoice, DemoFinished, SoloGuide, startSolo, type DemoEnd, type DemoTimes } from './demo';
import { BookingScreen, hasBookingLink } from './booking';
import { EndLessonDialog } from './EndLessonDialog';
import { StartLessonDialog } from './StartLessonDialog';
import { JournalDialog } from './JournalDialog';
import { PasswordInput } from './PasswordInput';
import { StudentName, StudentNames, useStudentName } from './studentNames';
import { forgetJournal, loadJournal, lockJournal, seatPlanOf, updateJournal, useJournal } from './journal';
import { derivePasswordKeys } from './journalCrypto';
import { adoptTeacherProfile } from './teacherProfile';
import { LocalMediaSync, loadMediaPrefs, saveMediaPrefs, captureOptions } from './mediaCheck';
import type { MediaPrefs } from './mediaCheck';

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
  avatar?: string | null;
}

interface LessonState {
  stage: Stage;
  atDesks?: boolean;
  videoMode?: VideoMode;
  timerEndsAt: number | null;
  demo?: DemoTimes | null;
  now?: number;
  participants: Participant[];
}

const entryBtn: CSSProperties = {
  padding: '3px 6px', borderRadius: 5, border: '1px solid #c9b99c', background: '#fff', color: '#555', fontSize: 11, cursor: 'pointer', textAlign: 'center',
};
const backToSeats: CSSProperties = {
  marginTop: 6, padding: '6px', borderRadius: 6, border: '1px solid #c9b99c', cursor: 'pointer', background: '#fff', color: '#555', fontSize: 11, textAlign: 'center', flexShrink: 0,
};

const LESSON_STAGES: { value: Stage; label: string }[] = [
  { value: 'group',      label: 'Объяснение' },
  { value: 'individual', label: 'Индивидуально' },
  { value: 'pairs',      label: 'Пары' },
  { value: 'fours',      label: 'Четвёрки' },
];

/** A student's camera in the teacherSees mode comes from another room than the pair's */
function PairCamOrName({ identity, name: shown, self }: { identity: string; name: string; self?: boolean }) {
  const cam = useClassCam(identity);
  const student = useStudentName(shown);
  const title = useTeacherTitle();
  const name = self ? title : student;
  return cam
    ? <><ClassCamVideo track={cam} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /><PairTileName identity={identity} name={name} /></>
    : <NameCard name={name} identity={identity} />;
}

/** Over video; a tile without video has the name on its card */
function PairTileName({ identity, name, self }: { identity: string; name?: string; self?: boolean }) {
  const title = useTeacherTitle();
  if (self) name = title;
  return (
    <div style={{ position: 'absolute', bottom: 3, left: 0, right: 0, textAlign: 'center', fontSize: 10, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>
      {name ?? <StudentName identity={identity} />}
    </div>
  );
}

function TeacherPairContent({ onLeave, others, sheet }: { onLeave: () => void; others: string[]; sheet: ReactNode }) {
  // with placeholders: without video everyone still gets a tile with their name
  const cameraTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });

  return (
    <div style={{ height: '100%', display: 'flex', overflow: 'hidden', position: 'relative' }}>
      {/* Board */}
      <div style={{ flex: 1, overflow: 'hidden' }}>
        {sheet}
      </div>

      {/* Right column: cameras + back button */}
      <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: 8, padding: 8, background: '#1a1a1a', justifyContent: 'center' }}>
        {cameraTracks.map(t => (
          <div key={t.participant.identity} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', background: '#222', aspectRatio: '4/3' }}>
            {isTrackReference(t) && !t.publication.isMuted
              ? <VideoTrack trackRef={t} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <PairCamOrName identity={t.participant.identity} name={t.participant.name || t.participant.identity} self={t.participant.isLocal} />}
            <SpeakingRing identity={t.participant.identity} />
            {isTrackReference(t) && !t.publication.isMuted && <PairTileName identity={t.participant.name || t.participant.identity} self={t.participant.isLocal} />}
          </div>
        ))}
        {others.map(name => (
          <div key={name} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', background: '#222', aspectRatio: '4/3', flexShrink: 0 }}>
            <NameCard name={name} identity={name} />
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

function CapacityInput({ initial, onSet }: { initial: number; onSet: (n: number) => void }) {
  const [value, setValue] = useState(String(initial));
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <input
        type="number"
        value={value}
        onChange={e => setValue(e.target.value)}
        min={4} max={32} step={4}
        style={{ width: 56, padding: '4px 6px', borderRadius: 4, border: '1px solid #c9b99c', background: '#fff', color: '#222', fontSize: 13 }}
        onKeyDown={e => { if (e.key === 'Enter') onSet(Number(value)); }}
      />
      <button
        onClick={() => onSet(Number(value))}
        style={{ flex: 1, padding: '4px 6px', borderRadius: 4, border: 'none', background: '#4a90e2', color: '#fff', cursor: 'pointer', fontSize: 12 }}
      >
        ОК
      </button>
    </div>
  );
}

type GroupMode = 'board' | 'screen';

const GROUP_MODE_LABELS: Record<GroupMode, string> = { board: 'Доска', screen: 'Экран' };

/** `pick` grows when the teacher asks for another screen; a closed picker takes them back to the board */
function ScreenShareSync({ active, pick, onCancel }: { active: boolean; pick: number; onCancel: () => void }) {
  const { localParticipant } = useLocalParticipant();
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  useEffect(() => {
    let stale = false;
    (async () => {
      if (active && pick) await localParticipant.setScreenShareEnabled(false);
      await localParticipant.setScreenShareEnabled(active);
    })().catch(() => { if (!stale && active) cancel.current(); });
    return () => { stale = true; };
  }, [active, pick, localParticipant]);
  return null;
}

function StudentGrid({ students, stage, atDesks, seats, hasLivekit, groupMode, callingRooms, onJoinPair, onMute, lessonCode, slidesView, names, marks, mapOpen, waiting }: { students: Participant[]; stage: Stage; atDesks?: boolean; seats: Seat[]; hasLivekit: boolean; groupMode: GroupMode; callingRooms: Set<string>; onJoinPair: (room: string) => void; onMute: (name: string) => void; lessonCode: string; slidesView: ReactNode; names: SeatNames; marks: Marks; mapOpen: boolean; waiting: string[] }) {
  if (stage === 'waiting') {
    return <SeatingMap seats={seats} showSelf={hasLivekit} callingRooms={callingRooms} onJoinPair={onJoinPair} onMute={onMute} lessonCode={lessonCode} names={names} marks={marks} waiting={waiting} atDesks={atDesks} />;
  }

  if (stage === 'group') {
    // Everyone is in the main room: a move takes effect when the next block splits the class
    if (mapOpen) return <SeatingMap seats={seats} showSelf={hasLivekit} noRemove callingRooms={callingRooms} onJoinPair={onJoinPair} lessonCode={lessonCode} names={names} marks={marks} waiting={waiting} />;
    if (groupMode === 'board') return <>{slidesView}</>;
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: 15 }}>
        Трансляция экрана запущена
      </div>
    );
  }

  if (students.length === 0) {
    return <div style={{ color: '#aaa', padding: 32 }}>Нет подключённых учеников</div>;
  }

  if (stage === 'individual') {
    return <SeatingMap seats={seats} showSelf={hasLivekit} readOnly callingRooms={callingRooms} onJoinPair={onJoinPair} onMute={onMute} lessonCode={lessonCode} names={names} marks={marks} joinStage={stage} waiting={waiting} />;
  }

  if (stage === 'pairs' || stage === 'fours') {
    return <SeatingMap seats={seats} showSelf={hasLivekit} readOnly callingRooms={callingRooms} onJoinPair={onJoinPair} onMute={onMute} lessonCode={lessonCode} names={names} marks={marks} joinStage={stage} waiting={waiting} />;
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: 16 }}>
      {students.map(s => <StudentTile key={s.id} name={s.name} />)}
    </div>
  );
}

interface Teacher {
  id: number;
  email: string;
  name: string;
}

const TEACHER_KEY = 'teacher';
const TOKEN_KEY = 'teacherToken';
const tabStyle = (on: boolean): CSSProperties => ({
  padding: '3px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 14,
  border: on ? '1px solid #c9b99c' : '1px solid transparent', background: on ? '#fff' : 'transparent', color: on ? '#222' : '#666',
});
const GROUP_GAP = 24; // between groups of controls in the sidebar
const CLASS_KEY = 'journalClass'; // a random id, tells nothing about the class
const DEMO_KEY = 'demoLesson'; // the running demo lesson: a page reload comes back to it
const JOURNAL_IDLE_MS = (Number(import.meta.env.VITE_JOURNAL_IDLE_MINUTES) || 60) * 60 * 1000;

function loadSavedTeacher(): Teacher | null {
  try {
    const raw = localStorage.getItem(TEACHER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function loadSavedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

function loadSavedDemo(): DemoStart | null {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDemo(demo: DemoStart | null) {
  try {
    if (demo) localStorage.setItem(DEMO_KEY, JSON.stringify(demo));
    else localStorage.removeItem(DEMO_KEY);
  } catch { /* private mode: only the return after a reload is lost */ }
}

const formScreenStyle: CSSProperties = {
  height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center',
  justifyContent: 'center', gap: 12, fontFamily: 'sans-serif', padding: 24, boxSizing: 'border-box',
};
const formInputStyle: CSSProperties = {
  fontSize: 16, padding: 10, borderRadius: 6, border: '1px solid #ccc', width: 240,
};
const formButtonStyle: CSSProperties = {
  fontSize: 16, padding: '10px 24px', borderRadius: 6, border: 'none',
  background: '#4a90e2', color: '#fff', cursor: 'pointer', width: 240,
};

function LoginForm({ onLogin, onDemo }: { onLogin: (teacher: Teacher, token: string, wrapKey: CryptoKey) => void; onDemo: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!email.trim() || !password) return;
    setError('');
    setLoading(true);
    try {
      // The password stays here: the server gets a key derived from it, and another one opens the journal
      const { authKey, wrapKey } = await derivePasswordKeys(email, password);
      const post = (extra: object) => fetch(`${import.meta.env.VITE_API_URL}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), authKey, ...extra }),
      });
      let res = await post({});
      // an account made before this scheme: the password goes to the server once, to replace its hash
      if (res.status === 428) res = await post({ password });
      if (res.status === 429) { setError('Слишком много попыток — подождите минуту и попробуйте снова'); return; }
      if (!res.ok) { setError('Неверный email или пароль'); return; }
      const { teacher, token } = await res.json();
      onLogin(teacher, token, wrapKey);
    } catch {
      setError('Не удалось подключиться к серверу');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={formScreenStyle}>
      <h2 style={{ margin: 0 }}>Кооперативное обучение</h2>
      <input
        value={email}
        onChange={e => setEmail(e.target.value)}
        placeholder="Email"
        autoCapitalize="none"
        style={formInputStyle}
      />
      <PasswordInput
        value={password}
        onChange={e => setPassword(e.target.value)}
        placeholder="Пароль"
        onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        style={formInputStyle}
      />
      {error && <div style={{ color: '#e74c3c', fontSize: 13 }}>{error}</div>}
      <button onClick={submit} disabled={loading || !email.trim() || !password} style={formButtonStyle}>
        {loading ? 'Вход…' : 'Войти'}
      </button>
      <button data-testid="demo-open" onClick={onDemo} style={{ ...formButtonStyle, background: 'transparent', color: '#4a90e2', border: '1px solid #4a90e2' }}>
        Попробовать без регистрации
      </button>
    </div>
  );
}

function StudentTile({ name: identity, color }: { name: string; color?: string }) {
  const name = useStudentName(identity);
  return (
    <div style={{
      width: 90,
      background: '#fff',
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

function journalLabel(status: ReturnType<typeof useJournal>['status'], className?: string): string {
  if (status === 'locked') return '🔒 Открыть профиль';
  if (status === 'none') return '👤 Создать профиль';
  if (status === 'open') return className ? `📒 Журнал: ${className}` : '📒 Выбрать журнал класса';
  return '👤 Профиль';
}

export default function App() {
  const [teacher, setTeacher] = useState<Teacher | null>(loadSavedTeacher);
  const [token, setToken] = useState<string | null>(loadSavedToken);
  const [demo, setDemoState] = useState<DemoStart | null>(loadSavedDemo);
  function setDemo(d: DemoStart | null) { setDemoState(d); saveDemo(d); }
  // null: not in the demo; 'choice': alone or with a class; 'book': the booking screen
  const [demoScreen, setDemoScreen] = useState<'choice' | 'book' | null>(() =>
    loadSavedDemo() ? null : hasBookingLink() ? 'book' : new URLSearchParams(location.search).has('demo') ? 'choice' : null);
  const [demoEnd, setDemoEnd] = useState<DemoEnd | null>(null);
  const lessonToken = demo?.token ?? token; // a demo lesson is run with its own token, not an account's
  const [lessonCode, setLessonCodeReady] = useState<string | null>(demo?.code ?? null);
  const [lessonError, setLessonErrorState] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [media, setMediaState] = useState<MediaPrefs>(loadMediaPrefs);
  function setMedia(p: MediaPrefs) { setMediaState(p); saveMediaPrefs(p); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const roomOptions = useMemo(() => captureOptions(media), [media.camId, media.micId]);

  function logout() {
    localStorage.removeItem(TEACHER_KEY);
    localStorage.removeItem(TOKEN_KEY);
    forgetJournal();
    setTeacher(null);
    setToken(null);
    setLessonCodeReady(null);
    setDemo(null);
  }

  const [state, setState] = useState<LessonState>({ stage: 'waiting', timerEndsAt: null, participants: [] });
  const [clockSkew, setClockSkew] = useState(0); // server time − this computer's
  // The teacher shows video unless the lesson is without video for everyone
  const camAllowed = state.videoMode !== 'none';
  const [connected, setConnected] = useState(false);
  const [seats, setSeats] = useState<Seat[]>([]);
  const [livekit, setLivekit] = useState<LivekitInfo | null>(null);
  const [camsInfo, setCamsInfo] = useState<CamsInfo | null>(null);
  const classCams = useClassCamsRoom(camsInfo);
  const [groupMode, setGroupMode] = useState<GroupMode>('board');
  const [callingRooms, setCallingRooms] = useState<Set<string>>(new Set());
  const [callNotes, setCallNotes] = useState<Record<string, string>>({}); // what the solo demo's class is asking
  const slides = useTeacherSlides(lessonCode, lessonToken, logout);

  const journal = useJournal();
  const [journalOpen, setJournalOpen] = useState(false);
  const [classId, setClassIdState] = useState<string | null>(() => { try { return localStorage.getItem(CLASS_KEY); } catch { return null; } });
  function setClassId(id: string | null) {
    setClassIdState(id);
    try { if (id) localStorage.setItem(CLASS_KEY, id); else localStorage.removeItem(CLASS_KEY); } catch { /* private mode */ }
  }
  const currentClass = journal.data?.classes.find(c => c.id === classId) ?? null;

  // The profile's name and photo, once it opens, replace what this browser had
  const journalProfile = journal.status === 'open' ? journal.data?.profile : undefined;
  useEffect(() => {
    if (journalProfile) adoptTeacherProfile(journalProfile);
  }, [journalProfile]);
  const [studentUuids, setStudentUuids] = useState<Record<string, string>>({});
  const [teacherNames, setTeacherNames] = useState<Record<string, string>>({});
  const [entry, setEntry] = useState<{ roomCode: string; joinCode: string; closed: boolean } | null>(null);

  // After a page reload there's a token but no key: the journal stays locked until asked for
  useEffect(() => {
    if (token && journal.status === 'loading') loadJournal(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Idle: the key leaves memory. Never during a lesson — the journal shows who is who there.
  const inLesson = !!lessonCode;
  useEffect(() => {
    if (inLesson) return;
    let last = Date.now();
    const touch = () => { last = Date.now(); };
    const events = ['pointerdown', 'keydown'] as const;
    events.forEach(e => window.addEventListener(e, touch));
    const timer = setInterval(() => { if (Date.now() - last > JOURNAL_IDLE_MS) lockJournal(); }, 30_000);
    return () => { events.forEach(e => window.removeEventListener(e, touch)); clearInterval(timer); };
  }, [inLesson]);

  // The class's saved seating goes to the server: who sits where, without names
  // (a locked journal says nothing: the server keeps the plan it has)
  const planJson = journal.status === 'open' ? JSON.stringify(currentClass ? seatPlanOf(currentClass) : { seats: {} }) : '';
  const [joins, setJoins] = useState(0); // the server is ready for the plan after each (re)join
  useEffect(() => {
    if (joins && planJson && !demo) socket.emit('seatPlan', JSON.parse(planJson));
  }, [joins, planJson, demo]);

  // The class remembers the code it came in by: next time the same code opens the lesson
  const roomCode = entry?.roomCode;
  const classIdNow = currentClass?.id;
  const lastCode = currentClass?.lastCode;
  useEffect(() => {
    if (demo || !joins || !roomCode || !classIdNow || lastCode === roomCode) return;
    updateJournal(d => ({ ...d, classes: d.classes.map(c => c.id === classIdNow ? { ...c, lastCode: roomCode } : c) }));
  }, [demo, joins, roomCode, classIdNow, lastCode]);

  // After the question the answers open by themselves; the teacher goes back to the slide from there
  const [mapOpen, setMapOpen] = useState(false);
  // Before the lesson the teacher may look through it alone, in place of the seating
  const [previewTab, setPreviewTab] = useState(false);
  const [screenPick, setScreenPick] = useState(0);
  const wasAsking = useRef(false);
  useEffect(() => {
    if (wasAsking.current && !slides.understood.asking) setMapOpen(true);
    wasAsking.current = slides.understood.asking;
  }, [slides.understood.asking]);
  useEffect(() => { setMapOpen(false); }, [slides.state.block, state.stage]);
  useEffect(() => { if (!Object.keys(slides.understood.marks).length && !slides.understood.asking) setMapOpen(false); }, [slides.understood]);

  const [endDialog, setEndDialog] = useState(false);
  const [startWarning, setStartWarning] = useState(false);

  // The solo demo's class works on the sample lesson, so it is open from the start
  const soloLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (!demo?.solo || !confirmed || !lessonCode || soloLoaded.current === lessonCode) return;
    soloLoaded.current = lessonCode;
    fetch('/demo/parallelogram.colesson')
      .then(res => res.ok ? res.blob() : Promise.reject(new Error('no sample lesson')))
      .then(blob => slides.open(new File([blob], 'parallelogram.colesson')))
      .catch(e => console.error('sample lesson not loaded:', e));
  }, [demo, confirmed, lessonCode, slides]);

  /** The demo is over, whoever or whatever ended it: on to the feedback form */
  function finishDemo(info?: { reason?: string | null }) {
    if (!demo) return;
    slides.forget();
    setDemoEnd({ token: demo.token, reason: info?.reason ?? null });
    setDemo(null);
    setGroupMode('board');
    setLessonCodeReady(null);
  }

  function endLesson(chatMinutes: number) {
    setEndDialog(false);
    slides.forget();
    // wait for the server to finish before leaving; don't hang if it doesn't answer
    const leave = (info?: { reason?: string | null }) => {
      if (demo) { finishDemo(info); return; }
      setGroupMode('board');
      setLessonCodeReady(null);
    };
    const timer = setTimeout(leave, 3000);
    socket.emit('endLesson', { chatMinutes }, (info?: { reason?: string | null }) => { clearTimeout(timer); leave(info); });
  }

  useEffect(() => {
    if (!lessonCode) return;
    setLessonCode(lessonCode);
    setAuthToken(lessonToken ?? '');
    socket.connect();
    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('lessonError', ({ error, minutesLeft }: { error: string; minutesLeft?: number }) => {
      if (demo && error === 'lesson ended') { finishDemo(); return; }
      if (demo) { setDemo(null); setDemoScreen('choice'); setLessonCodeReady(null); return; }
      if (error === 'unauthorized') {
        logout();
        return;
      }
      setLessonErrorState(
        error === 'video full' ? 'Сейчас нет мест для занятий с камерой. Можно начать новое занятие «Без видео»'
        : error === 'server full' ? 'Сейчас все места для занятий заняты, попробуйте через несколько минут'
        : error === 'too many attempts' ? 'Слишком много попыток — подождите минуту и попробуйте снова'
        : error === 'not open yet' ? 'Это занятие забронировано на другое время, вход ещё не открыт'
        : error === 'not your lesson' ? 'Это занятие ведёт другой учитель'
        : error === 'after lesson' ? `Урок окончен, ученики ещё общаются без вас — занятие закроется через ${minutesLeft ?? 'несколько'} мин`
        : error === 'too many open lessons' ? 'У вас уже 5 занятий, в которых сейчас есть участники. Завершите одно из них и выйдите из него'
        : 'Занятие не найдено — возможно, код устарел'
      );
      setLessonCodeReady(null);
    });
    socket.on('state', (s: LessonState) => {
      setState(s);
      if (s.now) setClockSkew(s.now - Date.now());
      setConfirmed(true);
    });
    socket.on('demoEnded', finishDemo);
    socket.on('seats', setSeats);
    socket.on('studentUuids', setStudentUuids);
    socket.on('studentNames', setTeacherNames);
    socket.on('entry', setEntry);
    socket.on('joined', () => setJoins(n => n + 1));
    socket.on('livekit', (info: LivekitInfo) => setLivekit(info));
    socket.on('classCams', (info: CamsInfo) => setCamsInfo(info));
    socket.on('callTeacher', ({ room, calling, note }: { room: string; calling: boolean; note?: string }) => {
      setCallNotes(prev => {
        const next = { ...prev };
        if (calling && note) next[room] = note; else delete next[room];
        return next;
      });
      setCallingRooms(prev => {
        const next = new Set(prev);
        calling ? next.add(room) : next.delete(room);
        return next;
      });
    });
    return () => { socket.disconnect(); socket.off(); setConfirmed(false); setJoins(0); setCamsInfo(null); };
  }, [lessonCode]);

  if (!lessonCode && demoEnd) {
    return <DemoFinished end={demoEnd} onAgain={() => { setDemoEnd(null); setDemoScreen('choice'); }} />;
  }

  if (!lessonCode && demoScreen === 'choice') {
    return <DemoChoice onBack={() => setDemoScreen(null)} onBook={() => setDemoScreen('book')} onSolo={async () => {
      const started = await startSolo();
      if ('error' in started) return started.error;
      setDemo({ ...started, solo: true });
      setDemoScreen(null);
      setLessonCodeReady(started.code);
      return null;
    }} />;
  }

  if (!lessonCode && demoScreen === 'book') {
    return <BookingScreen initial={media} onBack={() => setDemoScreen('choice')} onStart={(d, p) => {
      setMedia(p);
      setDemo(d);
      setDemoScreen(null);
      setLessonCodeReady(d.code);
    }} />;
  }

  if (!lessonCode && (!teacher || !token)) {
    return <LoginForm onDemo={() => setDemoScreen('choice')} onLogin={(t, tok, wrapKey) => {
      localStorage.setItem(TEACHER_KEY, JSON.stringify(t));
      localStorage.setItem(TOKEN_KEY, tok);
      setTeacher(t);
      setToken(tok);
      loadJournal(tok, wrapKey);
    }} />;
  }

  if (!lessonCode) {
    return (<>
      <MediaSetup token={token!} initial={media} error={lessonError} onUnauthorized={logout}
        onJoin={(code, p) => { setMedia(p); setLessonErrorState(''); setLessonCodeReady(code); }}
        journalLabel={journalLabel(journal.status, currentClass?.name)} onJournal={() => setJournalOpen(true)} onLogout={logout}
        classCode={currentClass?.lastCode} profileLocked={journal.status === 'locked'} />
      {journalOpen && <JournalDialog email={teacher!.email} classId={classId} onClassId={setClassId} onClose={() => setJournalOpen(false)} />}
    </>);
  }

  if (!confirmed) {
    return (
      <div style={formScreenStyle}>
        <p style={{ color: '#888' }}>Подключаемся к занятию…</p>
      </div>
    );
  }

  const students = state.participants.filter(p => p.role === 'student');
  // An added desk isn't a place in the class yet
  const unseated = students
    .filter(p => !seats.some(s => s.occupant === p.name && s.extra === undefined))
    .map(p => p.name);
  function startLesson() {
    const blocks = slides.material?.blocks;
    if (blocks?.length) socket.emit('block:start', { blockId: slides.state.block ?? blocks[0].id });
    else socket.emit('setStage', 'group');
  }
  const currentLabel = LESSON_STAGES.find(s => s.value === state.stage)?.label ?? 'Рассадка';
  // room names are "<lessonCode>:<base>" — check the base, not the full string
  const roomBase = livekit?.room.split(':')[1] ?? '';
  const inSmallRoom = roomBase.startsWith('pair-') || roomBase.startsWith('fours-') || roomBase.startsWith('individual-');
  const canPreview = state.stage === 'waiting' && !!slides.material && !inSmallRoom && !demo?.solo;
  const preview = canPreview && previewTab;
  // a bell, or a newcomer on an added desk: worth a look at the seating
  const seatingNeedsYou = callingRooms.size > 0 || seats.some(s => s.extra !== undefined && !!s.occupant);
  const currentBlockTitle = state.stage === 'waiting' ? undefined : slides.material?.blocks.find(b => b.id === slides.state.block)?.title;

  // Who is who, seen only here: name in the lesson (what classmates see) → name in the journal
  const lessonStudents = students.map(p => ({
    name: teacherNames[p.name] ?? p.name, uuid: studentUuids[p.id] ?? null, seat: seats.find(s => s.occupant === p.name && s.extra === undefined)?.id ?? null,
  }));
  const journalStudentOf = (uuid: string | null) => uuid ? currentClass?.students.find(s => s.uuids.includes(uuid)) : undefined;
  const seatNames: SeatNames = {
    journalName: occupant => journalStudentOf(studentUuids[students.find(p => p.name === occupant)?.id ?? ''] ?? null)?.name,
    reservedFor: seatId => currentClass?.students.find(s => s.seat === seatId)?.name,
  };
  // One name per student for the teacher: as in the journal, or else the one they gave for the teacher
  const shownNames: Record<string, string> = { ...teacherNames };
  for (const p of students) {
    const inJournal = journalStudentOf(studentUuids[p.id] ?? null)?.name;
    if (inJournal) shownNames[p.name] = inJournal;
  }
  const waitingSeat = seats.length ? students.filter(p => !seats.some(s => s.occupant === p.name)).map(p => p.name) : [];
  const notInJournal = currentClass ? lessonStudents.filter(p => p.uuid && !journalStudentOf(p.uuid)).length : 0;

  const inner = (
    <div style={{ fontFamily: 'sans-serif', height: '100vh', display: 'flex', overflow: 'hidden' }}>

      {/* Left sidebar */}
      <div style={{
        width: 180, background: '#ece2d2', color: '#222', borderRight: '1px solid #d6c8b0', boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', padding: 12, gap: 6, flexShrink: 0, textAlign: 'center',
      }}>
        {!connected && <div data-testid="no-connection" style={{ fontSize: 12, color: '#e74c3c', marginBottom: 4 }}>● Нет связи</div>}

        <div style={{ fontSize: 11, color: '#222' }}>Код занятия</div>
        <div style={{ fontSize: 20, fontWeight: 'bold', letterSpacing: 2, color: '#222' }}>
          {entry?.joinCode ?? (lessonCode || '…')}
        </div>
        {!demo && state.stage !== 'waiting' && entry && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 2 }}>
            <button data-testid="entry-close" onClick={() => socket.emit('entry:close', { closed: !entry.closed })} style={{ ...entryBtn, color: entry.closed ? '#b07800' : '#555' }}>
              {entry.closed ? '🔒 Вход закрыт, открыть' : 'Закрыть вход'}
            </button>
            <button data-testid="entry-new-code" onClick={() => socket.emit('entry:newCode')} title="Кто уже был на уроке, вернётся и со старым" style={entryBtn}>Сменить код</button>
          </div>
        )}
        {state.stage === 'waiting' && state.videoMode && state.videoMode !== 'all' && (
          <div data-testid="video-mode" style={{ fontSize: 11, color: '#b07800', marginTop: 2 }}>{VIDEO_MODE_LABELS[state.videoMode]}</div>
        )}

        {(state.stage === 'waiting' || !slides.local) && <div style={{ marginTop: GROUP_GAP - 8 }}><MaterialPanel slides={slides} /></div>}

        {!demo && state.stage === 'waiting' && <button data-testid="journal-open" onClick={() => setJournalOpen(true)} style={{
          marginTop: GROUP_GAP, padding: '6px', borderRadius: 6, border: '1px solid #c9b99c', cursor: 'pointer',
          background: '#fff', color: journal.status === 'locked' ? '#b07800' : '#222', fontSize: 12, textAlign: 'center',
        }}>
          {journalLabel(journal.status, currentClass?.name)}{notInJournal > 0 && ` · новых: ${notInJournal}`}
        </button>}
        {journalOpen && teacher && !demo && <JournalDialog email={teacher.email} classId={classId} onClassId={setClassId}
          lesson={{ students: lessonStudents, capacity: seats.filter(s => s.extra === undefined).length }} onClose={() => setJournalOpen(false)} />}

        {state.stage === 'waiting' && !demo?.solo && (
          <>
            <div style={{ fontSize: 11, color: '#222', marginTop: 2 }}>Мест в классе</div>
            <CapacityInput initial={seats.filter(s => s.extra === undefined).length || currentClass?.capacity || 16} onSet={n => {
              if (!Number.isInteger(n) || n < 0) return;
              socket.emit('setCapacity', n);
              // the class keeps its number of seats for next time
              const id = currentClass?.id;
              if (id && n > 0 && !demo && journal.status === 'open') {
                updateJournal(d => ({ ...d, classes: d.classes.map(c => c.id === id ? { ...c, capacity: Math.min(n, 32) } : c) }));
              }
            }} />
          </>
        )}

        {state.stage === 'waiting' && !slides.state.block && !demo?.solo && (
          <button data-testid="desks-toggle" onClick={() => socket.emit('desks:set', { on: !state.atDesks })}
            title={state.atDesks ? 'Все вернутся в класс и услышат вас' : 'Кто уже сел, пообщается за своим столом до начала урока'}
            style={{
              marginTop: 8, padding: '8px 6px', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'center',
              background: '#4a90e2', color: '#fff',
            }}>
            {state.atDesks ? 'Собрать в класс' : 'Отпустить за столы'}
          </button>
        )}

        {state.stage === 'waiting' ? null : slides.material?.blocks.length ? (
          <>
            <LessonPlan slides={slides} stage={state.stage} />
            <button onClick={() => socket.emit('setStage', 'waiting')} style={backToSeats}>← Рассадка</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 11, color: '#222', marginTop: 12 }}>ЭТАП</div>
            {LESSON_STAGES.map(s => (
              <button
                key={s.value}
                onClick={() => socket.emit('setStage', s.value)}
                style={{
                  padding: '8px 6px', borderRadius: 6, border: 'none', cursor: 'pointer',
                  background: state.stage === s.value ? '#4a90e2' : '#fff',
                  color: state.stage === s.value ? '#fff' : '#333',
                  fontWeight: state.stage === s.value ? 'bold' : 'normal',
                  fontSize: 13, textAlign: 'left',
                }}
              >
                {s.label}
              </button>
            ))}
            <button onClick={() => socket.emit('setStage', 'waiting')} style={backToSeats}>← Рассадка</button>
          </>
        )}

        {livekit && !demo?.solo && <div style={{ marginTop: state.stage === 'waiting' ? GROUP_GAP - 8 : 0 }}><SidebarMediaToggles prefs={media} onChange={setMedia} camAllowed={camAllowed} /></div>}

        {livekit && !demo?.solo && (
          <button
            onClick={() => socket.emit('mute', { target: 'all' })}
            style={{
              marginTop: 8, padding: '8px 6px', borderRadius: 6, border: 'none',
              cursor: 'pointer', background: '#e74c3c', color: '#fff',
              fontWeight: 'bold', fontSize: 12, textAlign: 'center',
            }}
          >
            🔇 Заглушить всех
          </button>
        )}

        {state.stage === 'waiting' && (
          <button
            onClick={() => { if (unseated.length || !slides.material) setStartWarning(true); else startLesson(); }}
            style={{
              marginTop: GROUP_GAP, padding: '10px 6px', borderRadius: 6, border: 'none',
              cursor: 'pointer', background: '#2ecc71', color: '#fff',
              fontWeight: 'bold', fontSize: 13, textAlign: 'center',
            }}
          >
            {slides.state.block ? 'Продолжить урок' : 'Начать урок'}
          </button>
        )}

        <div style={{ marginTop: 'auto', fontSize: 12, color: '#222' }}>
          {students.length} учеников
        </div>
        <button
          onClick={() => setEndDialog(true)}
          style={{
            marginTop: 6, padding: '6px 6px', borderRadius: 6, border: '1px solid #c9b99c',
            cursor: 'pointer', background: '#fff', color: '#555', fontSize: 11, textAlign: 'center',
          }}
        >
          Завершить урок
        </button>
        {startWarning && <StartLessonDialog
          names={unseated.map(n => shownNames[n] ?? n)}
          noLesson={!slides.material}
          onStart={() => { setStartWarning(false); startLesson(); }}
          onCancel={() => setStartWarning(false)}
        />}
        {endDialog && <EndLessonDialog noChat={!!demo} onEnd={endLesson} onCancel={() => setEndDialog(false)} />}
      </div>

      {/* Main area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {state.demo && <DemoBanner times={state.demo} clockSkew={clockSkew} />}
        <div style={{ padding: '10px 16px 10px 32px', background: '#ece2d2', borderBottom: '1px solid #e0d4c0', fontSize: 14, color: '#555', display: 'flex', alignItems: 'center', gap: 8 }}>
          {canPreview
            ? <div role="tablist" style={{ display: 'flex', gap: 4 }}>
                <button role="tab" data-testid="tab-seating" aria-selected={!preview} onClick={() => setPreviewTab(false)} style={tabStyle(!preview)}>
                  Рассадка{seatingNeedsYou && <span data-testid="seating-attention" title="На рассадке что-то ждёт вас" style={{ color: '#e74c3c', marginLeft: 4 }}>●</span>}
                </button>
                <button role="tab" data-testid="tab-preview" aria-selected={preview} onClick={() => setPreviewTab(true)} style={tabStyle(preview)}>Просмотр урока</button>
              </div>
            : <span data-testid="stage-title">{currentBlockTitle ?? currentLabel}</span>}
          {state.stage === 'group' && livekit && !demo?.solo && (
            <div style={{ display: 'flex', gap: 4, marginLeft: 8 }}>
              {(['board', 'screen'] as GroupMode[]).map(m => (
                <button key={m} onClick={() => { setGroupMode(m); setMapOpen(false); }} style={{
                  padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12,
                  background: groupMode === m ? '#4a90e2' : '#e0e0e0',
                  color: groupMode === m ? '#fff' : '#555',
                  fontWeight: groupMode === m ? 'bold' : 'normal',
                }}>
                  {GROUP_MODE_LABELS[m]}
                </button>
              ))}
              {groupMode === 'screen' && <button data-testid="screen-change" onClick={() => setScreenPick(n => n + 1)} style={{
                padding: '4px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 12, background: '#e0e0e0', color: '#555',
              }}>Сменить экран</button>}
            </div>
          )}
        </div>
        {livekit && state.stage === 'group' && <ScreenShareSync active={groupMode === 'screen'} pick={screenPick} onCancel={() => setGroupMode('board')} />}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {preview ? <LessonPreview slides={slides} /> : inSmallRoom
            ? <TeacherPairContent onLeave={() => socket.emit('leavePair')} others={demo?.solo ? students.filter(p => p.livekitRoom === livekit?.room).map(p => p.name) : []} sheet={<ExplainBoard slides={slides} />} />
            : <StudentGrid students={students} stage={state.stage} atDesks={state.atDesks} seats={seats} hasLivekit={!!livekit} groupMode={groupMode} callingRooms={callingRooms} onJoinPair={room => socket.emit('joinPair', { room })} onMute={name => socket.emit('mute', { target: name })} lessonCode={entry?.roomCode ?? lessonCode}
                slidesView={<ExplainBoard slides={slides} />} names={seatNames} marks={slides.understood.marks} mapOpen={mapOpen} waiting={waitingSeat} />
          }
        </div>
      </div>

      {(demo?.solo || state.stage !== 'waiting') && (
        <div data-testid="right-panel" style={{
          width: 'min(270px, 26vw)', flexShrink: 0, padding: 14, boxSizing: 'border-box', borderLeft: '1px solid #e5e5e5',
          background: '#fbf7f0', display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden',
        }}>
          <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {demo?.solo && <SoloGuide stage={state.stage} calls={Object.values(callNotes)} />}
            {state.stage !== 'waiting' && <BlockNotes slides={slides} />}
          </div>
          {state.stage !== 'waiting' && (
            <UnderstoodPanel understood={slides.understood} canAsk={state.stage === 'group'} mapOpen={mapOpen} onToggleMap={() => setMapOpen(o => !o)} />
          )}
        </div>
      )}
    </div>
  );

  if (!livekit) return <AvatarProvider participants={state.participants}><StudentNames.Provider value={shownNames}><ClassCams.Provider value={classCams}>{inner}</ClassCams.Provider></StudentNames.Provider></AvatarProvider>;

  return (<AvatarProvider participants={state.participants}><StudentNames.Provider value={shownNames}><ClassCams.Provider value={classCams}>
    <LiveKitRoom
      key={livekit.room}
      serverUrl={livekit.url}
      token={livekit.token}
      connect={true}
      video={media.camOn && camAllowed}
      audio={media.micOn && !demo?.solo}
      options={roomOptions}
      style={{ display: 'contents' }}
    >
      <RoomAudioRenderer />
      <LocalMediaSync camOn={media.camOn && camAllowed} micOn={media.micOn && !demo?.solo} />
      {inner}
    </LiveKitRoom>
  </ClassCams.Provider></StudentNames.Provider></AvatarProvider>);
}

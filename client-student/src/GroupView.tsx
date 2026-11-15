import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useEffect, useRef, useState } from 'react';
import { SharedBoard } from './SharedBoard';
import { SlideUnderlay, type StudentSlides } from './LessonSlides';
import { socket } from './socket';
import { useTeacherTitle } from './avatars';

/** "Всем понятно?": a moment to answer; no answer is fine too */
function UnderstoodAsk() {
  const [left, setLeft] = useState(0);
  const [thanks, setThanks] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  useEffect(() => {
    const close = () => { clearInterval(timer.current); setLeft(0); };
    const ask = ({ seconds }: { seconds: number }) => {
      clearInterval(timer.current);
      setThanks(false);
      setLeft(seconds);
      timer.current = setInterval(() => setLeft(s => { if (s <= 1) clearInterval(timer.current); return Math.max(0, s - 1); }), 1000);
    };
    socket.on('understood:ask', ask);
    socket.on('understood:closed', close);
    return () => { socket.off('understood:ask', ask); socket.off('understood:closed', close); clearInterval(timer.current); };
  }, []);

  useEffect(() => {
    if (!thanks) return;
    const t = setTimeout(() => setThanks(false), 1000);
    return () => clearTimeout(t);
  }, [thanks]);

  function answer(a: 'yes' | 'no') {
    socket.emit('understood:answer', a);
    clearInterval(timer.current);
    setLeft(0);
    setThanks(a === 'yes');
  }

  if (thanks) return <div data-testid="understood-thanks" style={{ ...askBox, fontSize: 32 }}>👍</div>;
  if (left <= 0) return null;
  return (
    <div data-testid="understood-ask" style={askBox}>
      <div style={{ fontSize: 16, fontWeight: 'bold', color: '#222' }}>Всё понятно? <span style={{ color: '#999', fontWeight: 'normal' }}>{left}</span></div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button data-testid="understood-yes" onClick={() => answer('yes')} style={{ ...askBtn, background: '#2ecc71' }}>Понятно</button>
        <button data-testid="understood-no" onClick={() => answer('no')} style={{ ...askBtn, background: '#e74c3c' }}>Не понятно</button>
      </div>
    </div>
  );
}

/** ✋ in the explanation: the teacher sees who and in what order, and gives one the word */
function RaiseHand() {
  const [up, setUp] = useState(false);
  const [given, setGiven] = useState(false);

  useEffect(() => {
    const down = () => setUp(false);
    const word = () => { setUp(false); setGiven(true); };
    socket.on('hand:down', down);
    socket.on('hand:given', word);
    return () => { socket.off('hand:down', down); socket.off('hand:given', word); socket.emit('hand', false); };
  }, []);

  useEffect(() => {
    if (!given) return;
    const t = setTimeout(() => setGiven(false), 8000);
    return () => clearTimeout(t);
  }, [given]);

  function toggle() {
    socket.emit('hand', !up);
    setUp(!up);
    setGiven(false);
  }

  return (
    <div style={{ position: 'absolute', left: 16, bottom: 16, zIndex: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
      <button data-testid="raise-hand" onClick={toggle} title={up ? 'Опустить руку' : 'Поднять руку'} style={{
        width: 56, height: 56, borderRadius: '50%', fontSize: 28, cursor: 'pointer',
        border: up ? '3px solid #f5a623' : '1px solid #ccc', background: up ? '#fff6dd' : '#fff',
        boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
      }}>✋</button>
      {given && <div data-testid="hand-given" style={{ padding: '8px 12px', borderRadius: 8, background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.2)', fontSize: 15 }}>
        Учитель даёт вам слово — включите микрофон 🎤
      </div>}
    </div>
  );
}

const askBox: React.CSSProperties = {
  position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 20,
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '14px 20px',
  background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
};
const askBtn: React.CSSProperties = {
  padding: '12px 22px', border: 'none', borderRadius: 8, color: '#fff', fontSize: 16, fontWeight: 'bold', cursor: 'pointer',
};

export function GroupView({ slides }: { slides: StudentSlides }) {
  const screenTracks = useTracks([Track.Source.ScreenShare]);
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });

  const teacherScreen = screenTracks.find(t => t.participant.identity === 'Teacher');
  const teacherCamera = cameraTracks.find(t => t.participant.identity === 'Teacher');
  const myCamera = cameraTracks.find(t => t.participant.isLocal);
  const teacherTitle = useTeacherTitle();


  return (
    <div style={{ height: '100%', position: 'relative', background: 'var(--bg)' }}>
      {/* Main area: screen share or board */}
      <div style={{ position: 'absolute', inset: 0, paddingRight: teacherCamera || myCamera ? 232 : 0, boxSizing: 'border-box' }}>
        {teacherScreen ? (
          <div style={{ width: '100%', height: '100%', background: '#111' }}>
            <VideoTrack trackRef={teacherScreen} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
        ) : (
          <SharedBoard readOnly underlay={slides.view.active ? width => <SlideUnderlay slides={slides} width={width} /> : undefined} />
        )}
      </div>

      <UnderstoodAsk />
      <RaiseHand />

      {/* Teacher camera — top right */}
      {teacherCamera && (
        <div style={{
          position: 'absolute', top: 16, right: 16,
          width: 200, aspectRatio: '4/3',
          borderRadius: 8, overflow: 'hidden',
          boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
          background: '#222',
        }}>
          <VideoTrack trackRef={teacherCamera} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.7)', pointerEvents: 'none' }}>
            {teacherTitle}
          </div>
        </div>
      )}

      {/* Self preview — bottom right */}
      {myCamera && (
        <div style={{
          position: 'absolute', bottom: 16, right: 16,
          width: 160, aspectRatio: '4/3',
          borderRadius: 8, overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
          background: '#222',
        }}>
          <VideoTrack trackRef={myCamera} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        </div>
      )}
    </div>
  );
}

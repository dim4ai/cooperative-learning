import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { useEffect, useRef, useState } from 'react';
import { SharedBoard } from './SharedBoard';
import { SlideUnderlay, type StudentSlides } from './LessonSlides';
import { socket } from './socket';

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
            Учитель
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

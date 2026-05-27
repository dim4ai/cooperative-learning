import { useEffect, useRef, useState } from 'react';
import { useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { SharedBoard } from './SharedBoard';
import { socket } from './socket';

function VideoTile({ track }: { track: ReturnType<typeof useTracks>[0] }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const t = track.publication?.track;
    if (ref.current && t) {
      t.attach(ref.current);
      return () => { t.detach(); };
    }
  }, [track.publication?.track]);

  return (
    <div style={{ position: 'relative', background: '#222', borderRadius: 8, overflow: 'hidden', aspectRatio: '4/3', width: '100%' }}>
      <video ref={ref} autoPlay muted={track.participant.isLocal} playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <div style={{ position: 'absolute', bottom: 4, left: 8, color: '#fff', fontSize: 12,
        background: 'rgba(0,0,0,0.4)', padding: '1px 4px', borderRadius: 3 }}>
        {track.participant.name || track.participant.identity}
      </div>
    </div>
  );
}

export function DeskLayout({ room }: { room: string }) {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const self = tracks.filter(t => t.participant.isLocal);
  const teacher = tracks.find(t => t.participant.identity === 'Teacher');
  const partners = tracks.filter(t => !t.participant.isLocal && t.participant.identity !== 'Teacher');
  const [calling, setCalling] = useState(false);

  useEffect(() => {
    socket.on('teacherJoined', () => setCalling(false));
    return () => { socket.off('teacherJoined'); };
  }, []);

  function toggleCall() {
    const next = !calling;
    setCalling(next);
    socket.emit(next ? 'callTeacher' : 'dismissCall', { room });
  }

  return (
    <div style={{ height: '100%', display: 'flex', gap: 8, padding: 8, boxSizing: 'border-box' }}>

      {/* Left: self + call button */}
      <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'flex-start' }}>
        {self.map(t => <VideoTile key={t.participant.identity} track={t} />)}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button
            onClick={toggleCall}
            title={calling ? 'Отменить вызов' : 'Позвать учителя'}
            style={{
              width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: 26,
              background: calling ? '#f39c12' : '#f0f0f0',
              boxShadow: calling ? '0 0 0 4px #f39c1255' : 'none',
              transition: 'all 0.2s',
              animation: calling ? 'callPulse 1.2s infinite' : 'none',
            }}
          >
            🔔
          </button>
          <style>{`
            @keyframes callPulse {
              0%, 100% { box-shadow: 0 0 0 4px #f39c1255; }
              50% { box-shadow: 0 0 0 10px #f39c1200; }
            }
          `}</style>
        </div>
      </div>

      {/* Center: shared board */}
      <div style={{ flex: 1 }}>
        <SharedBoard room={room} />
      </div>

      {/* Right: partners top, teacher middle */}
      <div style={{ width: 180, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {partners.length === 0 ? (
            <div style={{ aspectRatio: '4/3', background: '#222', borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13 }}>
              Ожидаем...
            </div>
          ) : (
            partners.map(t => <VideoTile key={t.participant.identity} track={t} />)
          )}
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
          {teacher && <VideoTile track={teacher} />}
        </div>
      </div>

    </div>
  );
}

import { useEffect, useState } from 'react';
import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { socket, myName } from './socket';

function CamBox({ track, label }: { track: ReturnType<typeof useTracks>[0]; label: string }) {
  return (
    <div style={{ width: 200, aspectRatio: '4/3', borderRadius: 8, overflow: 'hidden', background: '#222', position: 'relative', flexShrink: 0 }}>
      <VideoTrack trackRef={track} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.7)', pointerEvents: 'none' }}>
        {label}
      </div>
    </div>
  );
}

export function IndividualLayout() {
  const [calling, setCalling] = useState(false);
  const allTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const subscribedTracks = useTracks([Track.Source.Camera]);
  const localTrack = allTracks.find(t => t.participant.isLocal);
  const teacher = subscribedTracks.find(t => t.participant.identity === 'Teacher');

  useEffect(() => {
    socket.on('teacherJoined', () => setCalling(false));
    return () => { socket.off('teacherJoined'); };
  }, []);

  function toggleCall() {
    const next = !calling;
    setCalling(next);
    socket.emit(next ? 'callTeacher' : 'dismissCall', { room: `individual-${myName}` });
  }

  return (
    <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#111', padding: 16, boxSizing: 'border-box' }}>
      {localTrack && <CamBox track={localTrack} label={myName} />}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
        <button
          onClick={toggleCall}
          title={calling ? 'Отменить вызов' : 'Позвать учителя'}
          style={{
            width: 60, height: 60, borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: 28,
            background: calling ? '#f39c12' : '#2e2e3e',
            boxShadow: calling ? '0 0 0 4px #f39c1255' : 'none',
            transition: 'all 0.2s',
            animation: calling ? 'callPulse 1.2s infinite' : 'none',
          }}
        >
          🔔
        </button>
      </div>

      {teacher
        ? <CamBox track={teacher} label="Учитель" />
        : <div style={{ width: 200, aspectRatio: '4/3', borderRadius: 8, background: '#1a1a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 13 }}>
            Учитель
          </div>
      }

      <style>{`
        @keyframes callPulse {
          0%, 100% { box-shadow: 0 0 0 4px #f39c1255; }
          50% { box-shadow: 0 0 0 12px #f39c1200; }
        }
      `}</style>
    </div>
  );
}

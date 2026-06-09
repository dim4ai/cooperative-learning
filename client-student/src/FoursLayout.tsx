import { useEffect, useState, useRef } from 'react';
import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { SharedBoard } from './SharedBoard';
import { socket } from './socket';
import type { Seat } from './SeatingMap';

interface Props {
  room: string;
  groupSeats: Seat[]; // 4 seats of this group, sorted by row/col
}

function CamTile({ identity, label }: { identity: string | null; label: string }) {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const track = identity ? tracks.find(t => t.participant.identity === identity) : undefined;

  return (
    <div style={{
      width: '100%', aspectRatio: '4/3', flexShrink: 0,
      position: 'relative', background: '#222', borderRadius: 6, overflow: 'hidden',
    }}>
      {track
        ? <VideoTrack trackRef={track} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#444', fontSize: 12 }}>—</div>
      }
      <div style={{ position: 'absolute', bottom: 3, left: 0, right: 0, textAlign: 'center', fontSize: 10, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>
        {label}
      </div>
    </div>
  );
}

export function FoursLayout({ room, groupSeats }: Props) {
  const subscribedTracks = useTracks([Track.Source.Camera]);
  const teacher = subscribedTracks.find(t => t.participant.identity === 'Teacher');
  const [calling, setCalling] = useState(false);
  const callBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    socket.on('teacherJoined', () => setCalling(false));
    return () => { socket.off('teacherJoined'); };
  }, []);

  function toggleCall() {
    const next = !calling;
    setCalling(next);
    socket.emit(next ? 'callTeacher' : 'dismissCall', { room });
  }

  // Seat positions: row*2+col+1 → 1,2,3,4
  const seat = (row: number, col: number) => groupSeats.find(s => s.row === row && s.col === col);

  return (
    <div style={{ height: '100%', display: 'flex', gap: 8, padding: 8, boxSizing: 'border-box' }}>

      {/* Left column: seats 1 (top) and 3 (bottom) + call button */}
      <div style={{ width: 160, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CamTile identity={seat(0, 0)?.occupant ?? null} label={seat(0, 0)?.occupant ?? '—'} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <button
            ref={callBtnRef}
            onClick={toggleCall}
            title={calling ? 'Отменить вызов' : 'Позвать учителя'}
            style={{
              width: 44, height: 44, borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: 22,
              background: calling ? '#f39c12' : '#f0f0f0',
              animation: calling ? 'callPulse 1.2s infinite' : 'none',
              transition: 'background 0.2s',
            }}
          >🔔</button>
          <style>{`@keyframes callPulse { 0%,100% { box-shadow: 0 0 0 4px #f39c1255 } 50% { box-shadow: 0 0 0 10px #f39c1200 } }`}</style>
        </div>
        <CamTile identity={seat(1, 0)?.occupant ?? null} label={seat(1, 0)?.occupant ?? '—'} />
      </div>

      {/* Center: board */}
      <div style={{ flex: 1 }}>
        <SharedBoard room={room} />
      </div>

      {/* Right column: seats 2 (top), teacher (middle), seat 4 (bottom) */}
      <div style={{ width: 160, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <CamTile identity={seat(0, 1)?.occupant ?? null} label={seat(0, 1)?.occupant ?? '—'} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', minHeight: 0 }}>
          {teacher
            ? <div style={{ width: '100%', flexShrink: 0, position: 'relative', background: '#222', borderRadius: 6, overflow: 'hidden', aspectRatio: '4/3' }}>
                <VideoTrack trackRef={teacher} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <div style={{ position: 'absolute', bottom: 3, left: 0, right: 0, textAlign: 'center', fontSize: 10, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.8)', pointerEvents: 'none' }}>Учитель</div>
              </div>
            : null
          }
        </div>
        <CamTile identity={seat(1, 1)?.occupant ?? null} label={seat(1, 1)?.occupant ?? '—'} />
      </div>

    </div>
  );
}

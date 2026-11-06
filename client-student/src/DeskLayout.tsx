import { useEffect, useRef, useState } from 'react';
import { useTracks, type TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { SharedBoard } from './SharedBoard';
import { NameCard, SpeakingRing } from './speaking';
import { shownName, socket } from './socket';

function VideoTile({ track }: { track: TrackReferenceOrPlaceholder }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const t = track.publication?.track;
    if (ref.current && t) {
      t.attach(ref.current);
      return () => { t.detach(); };
    }
  }, [track.publication?.track]);

  const name = shownName(track.participant.name || track.participant.identity);
  const hasVideo = !!track.publication?.track && !track.publication.isMuted;
  return (
    <div style={{ position: 'relative', background: '#222', borderRadius: 8, overflow: 'hidden', aspectRatio: '4/3', width: '100%' }}>
      <video ref={ref} autoPlay muted={track.participant.isLocal} playsInline
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: hasVideo ? 'block' : 'none' }} />
      {!hasVideo && <NameCard name={name} identity={track.participant.identity} />}
      {hasVideo && <div style={{ position: 'absolute', bottom: 4, left: 8, color: '#fff', fontSize: 12,
        background: 'rgba(0,0,0,0.4)', padding: '1px 4px', borderRadius: 3 }}>
        {name}
      </div>}
      <SpeakingRing identity={track.participant.identity} />
    </div>
  );
}

export function DeskLayout({ room }: { room: string }) {
  // with placeholders: someone without video (lesson without video, camera off) still gets a tile
  const tracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
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

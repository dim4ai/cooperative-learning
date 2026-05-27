import { useEffect, useRef } from 'react';
import { useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { SharedBoard } from './SharedBoard';

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
  const others = tracks.filter(t => !t.participant.isLocal);

  return (
    <div style={{ height: '100%', display: 'flex', gap: 8, padding: 8, boxSizing: 'border-box' }}>

      {/* Left: self */}
      <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'flex-start' }}>
        {self.map(t => <VideoTile key={t.participant.identity} track={t} />)}
      </div>

      {/* Center: shared board */}
      <div style={{ flex: 1 }}>
        <SharedBoard room={room} />
      </div>

      {/* Right: others */}
      <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: 8, justifyContent: 'flex-start' }}>
        {others.length === 0 ? (
          <div style={{ aspectRatio: '4/3', background: '#222', borderRadius: 8,
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13 }}>
            Ожидаем...
          </div>
        ) : (
          others.map(t => <VideoTile key={t.participant.identity} track={t} />)
        )}
      </div>

    </div>
  );
}

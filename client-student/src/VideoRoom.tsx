import { useEffect, useRef } from 'react';
import { useTracks } from '@livekit/components-react';
import { Track } from 'livekit-client';

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
    <div style={{ position: 'relative', background: '#222', borderRadius: 8, overflow: 'hidden', aspectRatio: '4/3' }}>
      <video ref={ref} autoPlay muted={track.participant.isLocal} playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      <div style={{ position: 'absolute', bottom: 4, left: 8, color: '#fff', fontSize: 12 }}>
        {track.participant.name || track.participant.identity}
      </div>
    </div>
  );
}

export function VideoRoom() {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });

  return (
    <div style={{
      display: 'flex',
      flexWrap: 'wrap',
      gap: 8,
      padding: 8,
      alignContent: 'flex-start',
    }}>
      {tracks.length === 0 && (
        <div style={{ color: '#888', padding: 16 }}>No video tracks yet...</div>
      )}
      {tracks.map(trackRef => (
        <div key={trackRef.participant.identity} style={{ width: 240 }}>
          <VideoTile track={trackRef} />
        </div>
      ))}
    </div>
  );
}

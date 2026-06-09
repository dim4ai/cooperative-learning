import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { SharedBoard } from './SharedBoard';

export function GroupView() {
  const screenTracks = useTracks([Track.Source.ScreenShare]);
  const cameraTracks = useTracks([Track.Source.Camera], { onlySubscribed: false });

  const teacherScreen = screenTracks.find(t => t.participant.identity === 'Teacher');
  const teacherCamera = cameraTracks.find(t => t.participant.identity === 'Teacher');
  const myCamera = cameraTracks.find(t => t.participant.isLocal);


  return (
    <div style={{ height: '100%', position: 'relative', background: '#f8f8f8' }}>
      {/* Main area: screen share or board */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {teacherScreen ? (
          <div style={{ width: '100%', height: '100%', background: '#111' }}>
            <VideoTrack trackRef={teacherScreen} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </div>
        ) : (
          <SharedBoard room="main-room" readOnly />
        )}
      </div>

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

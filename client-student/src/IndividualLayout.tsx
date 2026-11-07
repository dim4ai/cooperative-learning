import { useEffect, useState, type ReactNode } from 'react';
import { isTrackReference, useTracks, VideoTrack, type TrackReferenceOrPlaceholder } from '@livekit/components-react';
import { NameCard, NAME_CARD_BG, SpeakingRing } from './speaking';
import { Track } from 'livekit-client';
import { socket, ownName } from './socket';
import { WorkBoard, type StudentSlides } from './LessonSlides';
import { Board } from './slides/Board';

interface Props {
  room: string;
  /** The work and its board; a newcomer has none yet and only talks to the teacher */
  slides?: StudentSlides;
  /** Newcomer's screen: go under their own card and the teacher's */
  mediaControls?: ReactNode;
  leaveButton?: ReactNode;
}

function CamBox({ track, label, width = 200 }: { track: TrackReferenceOrPlaceholder; label: string; width?: number | string }) {
  const hasVideo = !!track.publication && !track.publication.isMuted;
  return (
    <div style={{ width, aspectRatio: '4/3', borderRadius: 8, overflow: 'hidden', background: '#222', position: 'relative', flexShrink: 0 }}>
      {hasVideo && isTrackReference(track)
        ? <VideoTrack trackRef={track} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        : <NameCard name={label} identity={track.participant.identity} />}
      <SpeakingRing identity={track.participant.identity} />
      {hasVideo && <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.7)', pointerEvents: 'none' }}>
        {label}
      </div>}
    </div>
  );
}

export function IndividualLayout({ room, slides, mediaControls, leaveButton }: Props) {
  const [calling, setCalling] = useState(false);
  const allTracks = useTracks([{ source: Track.Source.Camera, withPlaceholder: true }], { onlySubscribed: false });
  const subscribedTracks = allTracks;
  const localTrack = allTracks.find(t => t.participant.isLocal);
  const teacher = subscribedTracks.find(t => t.participant.identity === 'Teacher');

  useEffect(() => {
    socket.on('teacherJoined', () => setCalling(false));
    return () => { socket.off('teacherJoined'); };
  }, []);

  function toggleCall() {
    const next = !calling;
    setCalling(next);
    socket.emit(next ? 'callTeacher' : 'dismissCall', { room });
  }

  const bell = (
    <button
      onClick={toggleCall}
      title={calling ? 'Отменить вызов' : 'Позвать учителя'}
      style={{
        width: 60, height: 60, borderRadius: '50%', border: 'none', cursor: 'pointer', fontSize: 28,
        background: calling ? '#f39c12' : '#eee',
        boxShadow: calling ? '0 0 0 4px #f39c1255' : 'none',
        transition: 'all 0.2s',
        animation: calling ? 'callPulse 1.2s infinite' : 'none',
      }}
    >
      🔔
    </button>
  );
  const pulse = `
    @keyframes callPulse {
      0%, 100% { box-shadow: 0 0 0 4px #f39c1255; }
      50% { box-shadow: 0 0 0 12px #f39c1200; }
    }
  `;

  if (slides) return (
    <div data-testid="individual-work" style={{ height: '100%', display: 'flex', gap: 8, padding: 8, boxSizing: 'border-box' }}>
      <div style={{ width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {localTrack && <CamBox track={localTrack} label={ownName} width="100%" />}
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{bell}</div>
        {teacher && <CamBox track={teacher} label="Учитель" width="100%" />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}><WorkBoard slides={slides} /></div>
      <style>{pulse}</style>
    </div>
  );

  return (
    <div className="wait-page">
      <div className="setup-left">
        <div data-testid="newcomer-controls" style={{
          margin: 'auto', width: 416, maxWidth: '100%',
          display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '48px 16px', justifyItems: 'center', alignItems: 'start',
        }}>
          <div style={{ width: '100%' }}>{localTrack && <CamBox track={localTrack} label={ownName} width="100%" />}</div>
          <div style={{ width: '100%' }}>
            {teacher
              ? <CamBox track={teacher} label="Учитель" width="100%" />
              : <div style={{ width: '100%', aspectRatio: '4/3', borderRadius: 8, background: NAME_CARD_BG, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13 }}>
                  Учитель
                </div>
            }
          </div>
          <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>{mediaControls}</div>
          {leaveButton}
        </div>
      </div>
      <div className="setup-right">
        <div className="wait-board" data-testid="newcomer-board"><Board /></div>
      </div>
    </div>
  );
}

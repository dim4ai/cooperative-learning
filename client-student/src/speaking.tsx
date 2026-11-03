// "Who is talking" for video tiles — the only cue in lessons without video. Identical copies in
// client-teacher/src/speaking.tsx and client-student/src/speaking.tsx. Must be inside a LiveKitRoom.
import { useSpeakingParticipants } from '@livekit/components-react';
import { useAvatarUrl } from './avatars';

export function useSpeaking(identity: string | null | undefined): boolean {
  const speaking = useSpeakingParticipants();
  return !!identity && speaking.some(p => p.identity === identity);
}

/** Green frame over a tile while that participant is speaking (the tile must be position: relative) */
export function SpeakingRing({ identity }: { identity: string | null | undefined }) {
  if (!useSpeaking(identity)) return null;
  return <div data-testid="speaking" style={{
    position: 'absolute', inset: 0, border: '3px solid #2ecc71', borderRadius: 'inherit',
    pointerEvents: 'none', zIndex: 2,
  }} />;
}

/** What a tile shows instead of video: the avatar (if chosen) and the name */
export function NameCard({ name, identity }: { name: string; identity?: string | null }) {
  const avatar = useAvatarUrl(identity);
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
      color: '#ddd', fontSize: 16, fontWeight: 'bold', textAlign: 'center', padding: 6, boxSizing: 'border-box',
    }}>
      {avatar && <img src={avatar} alt="" data-testid="avatar" style={{ height: '55%', maxWidth: '80%', objectFit: 'contain' }} />}
      <span style={avatar ? { fontSize: 12 } : undefined}>{name}</span>
    </div>
  );
}

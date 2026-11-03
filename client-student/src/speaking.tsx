// "Who is talking" for video tiles — the only cue in lessons without video. Identical copies in
// client-teacher/src/speaking.tsx and client-student/src/speaking.tsx. Must be inside a LiveKitRoom.
import { useSpeakingParticipants } from '@livekit/components-react';

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

/** What a tile shows instead of video: the name, large */
export function NameCard({ name }: { name: string }) {
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#ddd', fontSize: 16, fontWeight: 'bold', textAlign: 'center', padding: 6, boxSizing: 'border-box',
    }}>{name}</div>
  );
}

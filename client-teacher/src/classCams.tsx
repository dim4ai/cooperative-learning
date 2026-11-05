import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Room, RoomEvent, Track, type RemoteTrack } from 'livekit-client';

export interface CamsInfo { url: string; token: string; room: string }

const NO_CAMS = new Map<string, RemoteTrack>();

/** Students' cameras in the "only the teacher sees students" mode: identity → track */
export const ClassCams = createContext<Map<string, RemoteTrack>>(NO_CAMS);
export const useClassCam = (identity: string) => useContext(ClassCams).get(identity);

/** Watch the room of students' cameras. It's separate from the room the teacher is in,
 *  so the class stays visible from a pair or a four. Teachers of other modes pass null. */
export function useClassCamsRoom(info: CamsInfo | null): Map<string, RemoteTrack> {
  const [cams, setCams] = useState(NO_CAMS);
  const url = info?.url;
  const token = info?.token;

  useEffect(() => {
    if (!url || !token) return;
    const room = new Room({ adaptiveStream: true });
    let closed = false;
    const refresh = () => {
      if (closed) return; // disconnecting fires these events too, and would bring back old tiles
      const next = new Map<string, RemoteTrack>();
      for (const p of room.remoteParticipants.values()) {
        const pub = p.getTrackPublication(Track.Source.Camera);
        if (pub?.track && !pub.isMuted) next.set(p.identity, pub.track);
      }
      setCams(next);
    };
    room
      .on(RoomEvent.TrackSubscribed, refresh)
      .on(RoomEvent.TrackUnsubscribed, refresh)
      .on(RoomEvent.TrackMuted, refresh)
      .on(RoomEvent.TrackUnmuted, refresh)
      .on(RoomEvent.ParticipantDisconnected, refresh);
    room.connect(url, token).catch(e => console.warn('class cameras:', e));
    return () => { closed = true; room.disconnect(); setCams(NO_CAMS); };
  }, [url, token]);

  return cams;
}

export function ClassCamVideo({ track, style }: { track: RemoteTrack; style?: CSSProperties }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => { track.detach(el); };
  }, [track]);
  return <video ref={ref} data-testid="class-cam" autoPlay playsInline muted style={style} />;
}

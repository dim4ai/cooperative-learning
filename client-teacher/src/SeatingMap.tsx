import { useState } from 'react';
import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { socket } from './socket';
import { SpeakingRing } from './speaking';
import { useAvatarUrl } from './avatars';
import { ClassCamVideo, useClassCam } from './classCams';

function SeatVideo({ identity }: { identity: string }) {
  const tracks = useTracks([Track.Source.Camera]);
  const trackRef = tracks.find(t => t.participant.identity === identity);
  const classCam = useClassCam(identity);
  const avatar = useAvatarUrl(identity);
  return (<>
    {/* in the tile's centered column, above the name */}
    {!trackRef && !classCam && avatar && <img src={avatar} alt="" data-testid="avatar" style={{
      position: 'relative', zIndex: 1, height: 52, marginBottom: 2, pointerEvents: 'none',
    }} />}
    {trackRef && <VideoTrack trackRef={trackRef} style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%',
      objectFit: 'cover', borderRadius: 5,
    }} />}
    {classCam && <ClassCamVideo track={classCam} style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%',
      objectFit: 'cover', borderRadius: 5,
    }} />}
    <SpeakingRing identity={identity} />
  </>);
}

function SelfPreview() {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const localTrackRef = tracks.find(t => t.participant.isLocal);
  const selfAvatar = useAvatarUrl('Teacher'); // without video: own avatar (or the default one)

  return (
    <div style={{
      position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
      width: 200, aspectRatio: '4/3',
      borderRadius: 8, overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      background: '#222',
    }}>
      {localTrackRef && !localTrackRef.publication?.isMuted
        ? <VideoTrack trackRef={localTrackRef} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
        : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 14, boxSizing: 'border-box' }}>
            {selfAvatar && <img src={selfAvatar} alt="" data-testid="self-avatar" style={{ height: '62%' }} />}
          </div>}
      <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.7)', pointerEvents: 'none' }}>
        Учитель
      </div>
    </div>
  );
}

export type Marks = Record<string, 'yes' | 'no'>;

export interface Seat {
  id: string;
  groupIndex: number;
  row: number;
  col: number;
  occupant: string | null;
  reserved?: boolean;
}

/** From the journal; only the teacher's browser knows these names */
export interface SeatNames {
  journalName: (occupant: string) => string | undefined;
  reservedFor: (seatId: string) => string | undefined;
}

const PALETTE = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];
const groupColor = (g: number) => PALETTE[g % PALETTE.length];


const NOT_UNDERSTOOD = '#d00000';
const UNDERSTOOD = '#4cae6e';

/** Everyone sitting here said they did not understand */
const allLost = (seats: Seat[], marks: Marks | undefined, atLeast: number) => {
  const taken = seats.filter(s => s.occupant);
  return taken.length >= atLeast && taken.every(s => marks?.[s.occupant!] === 'no');
};

export function SeatingMap({ seats, showSelf, readOnly, callingRooms, onJoinPair, onMute, lessonCode, names, marks, joinStage }: { seats: Seat[]; showSelf?: boolean; readOnly?: boolean; callingRooms?: Set<string>; onJoinPair?: (room: string) => void; onMute?: (name: string) => void; lessonCode?: string; names?: SeatNames; marks?: Marks; joinStage?: string }) {
  const hasLivekit = !!showSelf;
  const [selected, setSelected] = useState<string | null>(null);

  if (seats.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ccc', fontSize: 15 }}>
      Задайте количество мест в левой панели
    </div>
  );

  const numGroups = Math.max(...seats.map(s => s.groupIndex)) + 1;

  function handleOccupiedClick(studentName: string, seatId: string) {
    if (selected && selected !== studentName) {
      socket.emit('moveSeat', { studentName: selected, toSeatId: seatId }); // the two swap
      setSelected(null);
    } else setSelected(prev => prev === studentName ? null : studentName);
  }

  function handleEmptyClick(seatId: string) {
    if (!selected) return;
    socket.emit('moveSeat', { studentName: selected, toSeatId: seatId });
    setSelected(null);
  }

  function clearSeat(e: React.MouseEvent, seatId: string) {
    e.stopPropagation();
    socket.emit('clearSeat', seatId);
    setSelected(null);
  }

  return (
    <div data-testid="seating-map" style={{ position: 'relative', height: '100%', overflow: 'auto', padding: `${showSelf ? 200 : 16}px 16px 16px`, boxSizing: 'border-box' }}>
      <style>{`
        @keyframes pairPulse {
          0%, 100% { border-color: #f39c12; box-shadow: 0 0 0 2px #f39c1266; }
          50% { border-color: #f39c1244; box-shadow: none; }
        }
      `}</style>
      {showSelf && <SelfPreview />}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignContent: 'flex-start' }}>
      {Array.from({ length: numGroups }, (_, g) => {
        const groupSeats = seats.filter(s => s.groupIndex === g);
        const color = groupColor(g);
        const foursRoom = `${lessonCode}:fours-${g + 1}`;
        const isGroupCalling = callingRooms?.has(foursRoom) ?? false;
        const groupLost = allLost(groupSeats, marks, 3);
        return (
          <div key={g} data-testid={groupLost ? 'four-lost' : undefined} style={{
            border: `${groupLost ? 6 : 3}px solid ${isGroupCalling ? '#f39c12' : groupLost ? NOT_UNDERSTOOD : color}`,
            borderRadius: 10,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            position: 'relative',
            animation: isGroupCalling ? 'pairPulse 1.2s infinite' : 'none',
          }}>
            {isGroupCalling && (
              <div
                onClick={() => onJoinPair?.(foursRoom)}
                style={{
                  position: 'absolute', left: '50%', top: '50%',
                  transform: 'translate(-50%, -50%)',
                  fontSize: 44, zIndex: 10,
                  cursor: onJoinPair ? 'pointer' : 'default',
                  filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))',
                }}
                title="Перейти к группе"
              >🔔</div>
            )}
            {[0, 1].map(row => {
              const pairRoom = `${lessonCode}:pair-g${g}-r${row}`;
              const isCalling = callingRooms?.has(pairRoom) ?? false;
              const pairLost = allLost(groupSeats.filter(s => s.row === row), marks, 2);
              return (
              <div key={row} data-testid={pairLost ? 'pair-lost' : undefined} style={{
                display: 'flex',
                gap: 6,
                background: pairLost ? '#fde3e3' : 'transparent',
                border: `${pairLost ? 2 : 1}px solid ${isCalling ? '#f39c12' : pairLost ? NOT_UNDERSTOOD : color}`,
                borderRadius: 6,
                padding: 6,
                position: 'relative',
                animation: isCalling ? 'pairPulse 1.2s infinite' : 'none',
              }}>
            {[0, 1].map(col => {
              const seat = groupSeats.find(s => s.row === row && s.col === col);
              if (!seat) return null;
              const seatNum = row * 2 + col + 1;
              const isSelected = !!selected && seat.occupant === selected;
              const isTarget = !!selected && seat.occupant !== selected;
              const individualRoom = seat.occupant ? `${lessonCode}:individual-${seat.occupant}` : null;
              const isSeatCalling = !!(individualRoom && callingRooms?.has(individualRoom));
              const joinRoom = joinStage === 'individual' ? individualRoom : joinStage === 'pairs' ? pairRoom : joinStage === 'fours' ? foursRoom : null;
              const mark = seat.occupant ? marks?.[seat.occupant] : undefined;
              return (
                <div key={seat.id}
                  onClick={() => {
                    if (!readOnly) { if (seat.occupant) handleOccupiedClick(seat.occupant, seat.id); else handleEmptyClick(seat.id); return; }
                    // During work the teacher can walk up to anyone, called or not
                    if (seat.occupant && joinRoom) onJoinPair?.(joinRoom);
                  }}
                  style={{
                    width: 160, height: 120,
                    background: '#f5f5f5',
                    border: isSeatCalling ? '2px solid #f39c12' : isTarget ? `2px dashed #4a4` : `1px solid #ccc`,
                    boxShadow: isSelected ? `0 0 0 3px ${color}` : 'none',
                    borderRadius: 6,
                    position: 'relative', overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    cursor: readOnly ? (seat.occupant && joinRoom && onJoinPair ? 'pointer' : 'default') : seat.occupant || isTarget ? 'pointer' : 'default',
                    transition: 'all 0.15s',
                    fontSize: 12, color: '#555',
                    animation: isSeatCalling ? 'pairPulse 1.2s infinite' : 'none',
                  }}
                >
                  {mark && <div data-testid={`mark-${mark}`} style={{
                    position: 'absolute', inset: 0, borderRadius: 5, zIndex: 2, pointerEvents: 'none',
                    border: `${mark === 'no' ? 4 : 3}px solid ${mark === 'no' ? NOT_UNDERSTOOD : UNDERSTOOD}`,
                  }} />}
                  {seat.occupant ? (
                    <>
                      {hasLivekit && <SeatVideo identity={seat.occupant} />}
                      <div style={{ position: 'relative', zIndex: 1, fontWeight: 'bold', fontSize: 13, color: '#222', textShadow: '0 1px 3px rgba(0,0,0,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>
                        {seat.occupant}
                      </div>
                      {names?.journalName(seat.occupant) && (
                        <div data-testid="seat-journal-name" style={{ position: 'relative', zIndex: 1, fontSize: 11, color: '#222', textShadow: '0 1px 3px rgba(255,255,255,0.8)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {names.journalName(seat.occupant)}
                        </div>
                      )}
                      {!readOnly && (
                        <div style={{ display: 'flex', gap: 6, position: 'relative', zIndex: 1, marginTop: 2 }}>
                          <div onClick={e => clearSeat(e, seat.id)} style={{ fontSize: 10, color: '#bbb', cursor: 'pointer' }}>✕</div>
                          {onMute && <div onClick={e => { e.stopPropagation(); onMute(seat.occupant!); }} style={{ fontSize: 13, cursor: 'pointer' }} title="Заглушить">🔇</div>}
                        </div>
                      )}
                      {isSeatCalling && (
                        <div
                          onClick={e => { e.stopPropagation(); onJoinPair?.(individualRoom!); }}
                          style={{
                            position: 'absolute', right: 4, top: 4,
                            fontSize: 22, zIndex: 10,
                            cursor: onJoinPair ? 'pointer' : 'default',
                            filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.5))',
                          }}
                          title="Ответить"
                        >🔔</div>
                      )}
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize: 32, color: isTarget ? '#4a4' : '#ddd', lineHeight: 1 }}>{seatNum}</div>
                      {names?.reservedFor(seat.id) && <div data-testid="seat-reserved" style={{ fontSize: 11, color: '#999', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{names.reservedFor(seat.id)}</div>}
                    </>
                  )}
                </div>
              );
            })}
              {isCalling && (
                <div
                  onClick={() => onJoinPair?.(pairRoom)}
                  style={{
                    position: 'absolute', left: '50%', top: '50%',
                    transform: 'translate(-50%, -50%)',
                    fontSize: 36, zIndex: 10,
                    cursor: onJoinPair ? 'pointer' : 'default',
                    filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))',
                  }}
                  title="Перейти к паре"
                >🔔</div>
              )}
              </div>
              );
            })}
          </div>
        );
      })}
      </div>
    </div>
  );
}

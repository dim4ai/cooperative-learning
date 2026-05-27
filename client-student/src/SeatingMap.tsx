import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { socket, myName } from './socket';

export interface Seat {
  id: string;
  groupIndex: number;
  row: number;
  col: number;
  occupant: string | null;
}

const PALETTE = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];
const groupColor = (g: number) => PALETTE[g % PALETTE.length];

function SeatVideo({ identity }: { identity: string; color?: string; isMe?: boolean }) {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const trackRef = tracks.find(t => t.participant.identity === identity);
  if (!trackRef) return null;
  return (
    <VideoTrack trackRef={trackRef} style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%',
      objectFit: 'cover', borderRadius: 8,
    }} />
  );
}

export function SeatingMap({ seats }: { seats: Seat[] }) {
  if (seats.length === 0) return (
    <div style={{ color: '#aaa', fontSize: 16, padding: 32 }}>
      Учитель ещё не настроил рассадку
    </div>
  );

  const numGroups = Math.max(...seats.map(s => s.groupIndex)) + 1;
  const mySeat = seats.find(s => s.occupant === myName);

  function handleClick(seat: Seat) {
    if (seat.occupant) return;
    socket.emit('claimSeat', seat.id);
  }

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '200px 16px 16px', boxSizing: 'border-box' }}>
      <div style={{ marginBottom: 12, fontSize: 15, color: '#555' }}>
        {mySeat ? `Вы сидите в группе ${mySeat.groupIndex + 1}, место ${mySeat.row * 2 + mySeat.col + 1}` : 'Выберите место'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        {Array.from({ length: numGroups }, (_, g) => {
          const groupSeats = seats.filter(s => s.groupIndex === g);
          const color = groupColor(g);
          return (
            <div key={g} style={{
              border: `2px solid ${color}`,
              borderRadius: 10,
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
            }}>
              {[0, 1].map(row => (
                <div key={row} style={{
                  display: 'flex',
                  gap: 8,
                  border: `1px solid ${color}66`,
                  borderRadius: 6,
                  padding: 4,
                }}>
              {[0, 1].map(col => {
                const seat = groupSeats.find(s => s.row === row && s.col === col);
                if (!seat) return null;
                const isMe = seat.occupant === myName;
                const isFree = !seat.occupant;
                const isTaken = seat.occupant && !isMe;
                const seatNum = row * 2 + col + 1;
                return (
                  <div
                    key={seat.id}
                    onClick={() => !isTaken && handleClick(seat)}
                    style={{
                      width: 160,
                      height: 120,
                      borderRadius: 8,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 12,
                      cursor: isTaken ? 'default' : 'pointer',
                      border: isMe ? `3px solid ${color}` : `1px solid ${isFree ? '#ddd' : color}`,
                      background: isTaken ? `${color}55` : isMe ? `${color}33` : '#f8f8f8',
                      color: isMe ? '#fff' : isTaken ? '#555' : '#aaa',
                      transition: 'all 0.15s',
                      position: 'relative',
                      overflow: 'hidden',
                    }}
                  >
                    {seat.occupant ? (
                      <>
                        <SeatVideo identity={seat.occupant} color={color} isMe={isMe} />
                        <div style={{ position: 'relative', zIndex: 1, fontWeight: 'bold', fontSize: 20, textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                          {seat.occupant[0]?.toUpperCase()}
                        </div>
                        <div style={{ position: 'relative', zIndex: 1, fontSize: 11, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>
                          {isMe ? 'Вы' : seat.occupant}
                        </div>
                      </>
                    ) : (
                      <div style={{ fontSize: 60, color: '#ccc', lineHeight: 1 }}>{seatNum}</div>
                    )}
                  </div>
                );
              })}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

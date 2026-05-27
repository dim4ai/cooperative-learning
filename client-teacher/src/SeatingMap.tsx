import { useState } from 'react';
import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { socket } from './socket';

function SeatVideo({ identity }: { identity: string }) {
  const tracks = useTracks([Track.Source.Camera]);
  const trackRef = tracks.find(t => t.participant.identity === identity);
  if (!trackRef) return null;
  return (
    <VideoTrack trackRef={trackRef} style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%',
      objectFit: 'cover', borderRadius: 5,
    }} />
  );
}

function SelfPreview() {
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const localTrackRef = tracks.find(t => t.participant.isLocal);

  return (
    <div style={{
      position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
      width: 200, aspectRatio: '4/3',
      borderRadius: 8, overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      background: '#222',
    }}>
      {localTrackRef && (
        <VideoTrack trackRef={localTrackRef} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
      )}
      <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.7)', pointerEvents: 'none' }}>
        Учитель
      </div>
    </div>
  );
}

export interface Seat {
  id: string;
  groupIndex: number;
  row: number;
  col: number;
  occupant: string | null;
}

const PALETTE = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];
const groupColor = (g: number) => PALETTE[g % PALETTE.length];


export function SeatingMap({ seats, showSelf }: { seats: Seat[]; showSelf?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);

  if (seats.length === 0) return (
    <div style={{ color: '#aaa', padding: 24 }}>Задайте количество мест</div>
  );

  const numGroups = Math.max(...seats.map(s => s.groupIndex)) + 1;

  function handleOccupiedClick(studentName: string) {
    setSelected(prev => prev === studentName ? null : studentName);
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
    <div style={{ position: 'relative', padding: `${showSelf ? 200 : 16}px 16px 16px`, boxSizing: 'border-box' }}>
      {showSelf && <SelfPreview />}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignContent: 'flex-start' }}>
      {Array.from({ length: numGroups }, (_, g) => {
        const groupSeats = seats.filter(s => s.groupIndex === g);
        const color = groupColor(g);
        return (
          <div key={g} style={{
            border: `3px solid ${color}`,
            borderRadius: 10,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}>
            {[0, 1].map(row => (
              <div key={row} style={{
                display: 'flex',
                gap: 6,
                border: `1px solid ${color}`,
                borderRadius: 6,
                padding: 6,
              }}>
            {[0, 1].map(col => {
              const seat = groupSeats.find(s => s.row === row && s.col === col);
              if (!seat) return null;
              const seatNum = row * 2 + col + 1;
              const isSelected = !!selected && seat.occupant === selected;
              const isTarget = !seat.occupant && !!selected;
              return (
                <div key={seat.id}
                  onClick={() => seat.occupant ? handleOccupiedClick(seat.occupant) : handleEmptyClick(seat.id)}
                  style={{
                    width: 160, height: 120,
                    background: '#f5f5f5',
                    border: isTarget ? `2px dashed #4a4` : `1px solid #ccc`,
                    boxShadow: isSelected ? `0 0 0 3px ${color}` : 'none',
                    borderRadius: 6,
                    position: 'relative', overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    cursor: seat.occupant || isTarget ? 'pointer' : 'default',
                    transition: 'all 0.15s',
                    fontSize: 12, color: '#555',
                  }}
                >
                  {seat.occupant ? (
                    <>
                      <SeatVideo identity={seat.occupant} />
                      <div style={{ position: 'relative', zIndex: 1, fontWeight: 'bold', fontSize: 13, color: '#222', textShadow: '0 1px 3px rgba(0,0,0,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 90 }}>
                        {seat.occupant}
                      </div>
                      <div onClick={e => clearSeat(e, seat.id)} style={{ position: 'relative', zIndex: 1, fontSize: 10, color: '#bbb', cursor: 'pointer', marginTop: 2 }}>✕</div>
                    </>
                  ) : (
                    <div style={{ fontSize: 32, color: isTarget ? '#4a4' : '#ddd', lineHeight: 1 }}>{seatNum}</div>
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

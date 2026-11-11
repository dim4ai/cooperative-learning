import { useEffect, useState } from 'react';
import { useTracks, VideoTrack } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { socket } from './socket';
import { NAME_CARD_BG, SpeakingRing } from './speaking';
import { useAvatarUrl, useTeacherTitle } from './avatars';
import { ClassCamVideo, useClassCam } from './classCams';
import { StudentName, useStudentName } from './studentNames';

function SeatVideo({ identity }: { identity: string }) {
  const tracks = useTracks([Track.Source.Camera]);
  // a camera switched off stays published, muted: then it's the avatar, not a black frame
  const trackRef = tracks.find(t => t.participant.identity === identity && !t.publication?.isMuted);
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
  const title = useTeacherTitle(); // as students see it
  const hasVideo = !!localTrackRef && !localTrackRef.publication?.isMuted;

  return (
    <div style={{
      position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
      width: 200, aspectRatio: '4/3',
      borderRadius: 8, overflow: 'hidden',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
      background: hasVideo ? '#222' : NAME_CARD_BG,
    }}>
      {hasVideo
        ? <VideoTrack trackRef={localTrackRef} style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 8 }} />
        : <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 14, boxSizing: 'border-box' }}>
            {selfAvatar && <img src={selfAvatar} alt="" data-testid="self-avatar" style={{ height: '62%' }} />}
          </div>}
      <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', fontSize: 11, pointerEvents: 'none', ...(hasVideo ? { color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.7)' } : { color: '#444', fontWeight: 'bold' }) }}>
        {title}
      </div>
    </div>
  );
}

/** What classmates call this student, when the teacher knows them by another name */
function SeatNick({ nick }: { nick: string }) {
  if (useStudentName(nick) === nick) return null;
  return (
    <div data-testid="seat-nick" title="Так его видят одноклассники" style={{ position: 'relative', zIndex: 1, fontSize: 11, color: '#555', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      ({nick})
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
  extra?: number; // an added desk for newcomers to a class with a saved seating
}

/** From the journal; only the teacher's browser knows these names */
export interface SeatNames {
  journalName: (occupant: string) => string | undefined;
  reservedFor: (seatId: string) => string | undefined;
}

const PALETTE = ['#e74c3c','#3498db','#2ecc71','#f39c12','#9b59b6','#1abc9c','#e67e22','#e91e63'];
const groupColor = (g: number) => PALETTE[g % PALETTE.length];


const NOT_UNDERSTOOD = '#d00000';

// ---------- who talks and writes at work ----------
export interface StudentActivity { talk: number; ops: number; lastTalk: number | null; lastOp: number | null }
/** From the server: seconds talked and board actions by student since the stage began; skew: server − this clock */
export interface ClassActivity { now: number; since: number; skew?: number; students: Record<string, StudentActivity> }

type Lamp = 'live' | 'slow' | 'silent';
const LAMP: Record<Lamp, { color: string; title: string }> = {
  live: { color: '#2fb344', title: 'Работают: говорят или пишут' },
  slow: { color: '#f2b705', title: 'Притихли: больше 20 секунд ни слова и ни строчки' },
  silent: { color: '#e03131', title: 'Молчат больше минуты: может, стоит подойти' },
};

/** The group's light: how long since anyone in it said or wrote something (alone at work: wrote) */
function lampOf(names: string[], act: ClassActivity, now: number, writingOnly: boolean): Lamp {
  let last = act.since;
  for (const n of names) {
    const a = act.students[n];
    if (!a) continue;
    last = Math.max(last, a.lastOp ?? 0, writingOnly ? 0 : a.lastTalk ?? 0);
  }
  const age = now - last;
  return age < 20_000 ? 'live' : age < 60_000 ? 'slow' : 'silent';
}

function LampDot({ lamp, style }: { lamp: Lamp; style?: React.CSSProperties }) {
  return <div data-testid="lamp" data-lamp={lamp} title={LAMP[lamp].title} style={{
    position: 'absolute', width: 12, height: 12, borderRadius: '50%', zIndex: 4, background: LAMP[lamp].color,
    boxShadow: `0 0 0 2px #fff, 0 0 6px ${LAMP[lamp].color}`, pointerEvents: 'auto', ...style,
  }} />;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Under a student's tile: how long they talked, how much they did on the board; the bar is their part of the group's talk */
function SeatActivity({ name, group, act, showTalk }: { name: string; group: string[]; act: ClassActivity; showTalk: boolean }) {
  const a = act.students[name];
  const talk = a?.talk ?? 0;
  const total = group.reduce((sum, n) => sum + (act.students[n]?.talk ?? 0), 0);
  const share = total > 0 ? talk / total : 0;
  // the group talks, this one hardly at all
  const quietOne = showTalk && group.length > 1 && total >= 20 && share < 0.15;
  return (
    <div data-testid="seat-activity" style={{
      position: 'absolute', left: 0, right: 0, bottom: 0, zIndex: 3, padding: '2px 6px 3px', background: 'rgba(255,255,255,0.9)',
      fontSize: 11, color: '#333', display: 'flex', flexDirection: 'column', gap: 2, pointerEvents: 'none',
    }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
        {showTalk && <span title="Сколько говорил на этом этапе">🗣 {mmss(talk)}</span>}
        <span title="Действий на доске на этом этапе">✏️ {a?.ops ?? 0}</span>
      </div>
      {showTalk && group.length > 1 && (
        <div title={`Доля в разговоре группы: ${Math.round(share * 100)}%`} style={{ height: 4, borderRadius: 2, background: '#e6e6e6', overflow: 'hidden' }}>
          <div style={{ width: `${Math.round(share * 100)}%`, height: '100%', background: quietOne ? '#f08c00' : '#4a90e2', transition: 'width 0.6s' }} />
        </div>
      )}
    </div>
  );
}

function useNow(skew: number, on: boolean): number {
  const [now, setNow] = useState(() => Date.now() + skew);
  useEffect(() => {
    if (!on) return;
    setNow(Date.now() + skew);
    const t = setInterval(() => setNow(Date.now() + skew), 2000);
    return () => clearInterval(t);
  }, [skew, on]);
  return now;
}
const UNDERSTOOD = '#4cae6e';

/** Everyone sitting here said they did not understand */
const allLost = (seats: Seat[], marks: Marks | undefined, atLeast: number) => {
  const taken = seats.filter(s => s.occupant);
  return taken.length >= atLeast && taken.every(s => marks?.[s.occupant!] === 'no');
};

export function SeatingMap({ seats, showSelf, readOnly, callingRooms, onJoinPair, onMute, lessonCode, names, marks, joinStage, noRemove, waiting = [], atDesks, activity }: { activity?: ClassActivity | null; seats: Seat[]; showSelf?: boolean; readOnly?: boolean; callingRooms?: Set<string>; onJoinPair?: (room: string, toTalk?: boolean) => void; onMute?: (name: string) => void; lessonCode?: string; names?: SeatNames; marks?: Marks; joinStage?: string; noRemove?: boolean; waiting?: string[]; atDesks?: boolean }) {
  const hasLivekit = !!showSelf;
  const [selected, setSelected] = useState<string | null>(null);
  const [swap, setSwap] = useState<{ a: string; b: string; seatId: string } | null>(null);
  // at work the map shows who talks and writes, and a light on each group
  const act = joinStage === 'individual' || joinStage === 'pairs' || joinStage === 'fours' ? activity ?? null : null;
  const now = useNow(act?.skew ?? 0, !!act);

  if (seats.length === 0) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ccc', fontSize: 15 }}>
      Задайте количество мест в левой панели
    </div>
  );

  const numGroups = Math.max(...seats.map(s => s.groupIndex)) + 1;

  function handleOccupiedClick(studentName: string, seatId: string) {
    // A swap is easy to make by a stray click and hard to notice: it waits for a yes
    const selectedSeated = !!selected && seats.some(s => s.occupant === selected);
    if (selectedSeated && selected !== studentName) setSwap({ a: selected!, b: studentName, seatId });
    else setSelected(prev => prev === studentName ? null : studentName);
  }

  function confirmSwap() {
    if (swap) socket.emit('moveSeat', { studentName: swap.a, toSeatId: swap.seatId }); // the two swap
    setSwap(null);
    setSelected(null);
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
      {swap && (
        <div onClick={() => setSwap(null)} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div data-testid="swap-confirm" onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, padding: 20, maxWidth: 360, boxShadow: '0 4px 20px rgba(0,0,0,0.25)', color: '#222', fontSize: 15 }}>
            <div style={{ marginBottom: 16 }}>
              Поменять местами <b><StudentName identity={swap.a} /></b> и <b><StudentName identity={swap.b} /></b>?
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button data-testid="swap-cancel" onClick={() => { setSwap(null); setSelected(null); }} style={{ padding: '8px 14px', borderRadius: 6, border: '1px solid #ccc', background: '#fff', color: '#222', cursor: 'pointer', fontSize: 14 }}>Отмена</button>
              <button data-testid="swap-yes" onClick={confirmSwap} style={{ padding: '8px 14px', borderRadius: 6, border: 'none', background: '#4a90e2', color: '#fff', cursor: 'pointer', fontSize: 14 }}>Поменять</button>
            </div>
          </div>
        </div>
      )}
      <style>{`
        @keyframes pairPulse {
          0%, 100% { border-color: #f39c12; box-shadow: 0 0 0 2px #f39c1266; }
          50% { border-color: #f39c1244; box-shadow: none; }
        }
      `}</style>
      {showSelf && <SelfPreview />}
      {waiting.length > 0 && (
        <div data-testid="seat-waiting" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 13, color: '#555' }}>
          Ждут место:
          {waiting.map(name => (
            <button key={name} data-testid="seat-waiting-name" title="Выберите, потом кликните свободное место" onClick={() => setSelected(s => s === name ? null : name)} style={{
              padding: '4px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 13,
              border: selected === name ? '2px solid #4a90e2' : '1px solid #bbb', background: '#fff', color: '#222',
            }}><StudentName identity={name} />{onJoinPair && <span data-testid="newcomer-talk" title="Поговорить" onClick={e => { e.stopPropagation(); onJoinPair(`${lessonCode}:individual-${name}`, true); }} style={{ marginLeft: 6 }}>💬</span>}</button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignContent: 'flex-start' }}>
      {Array.from({ length: numGroups }, (_, g) => {
        const groupSeats = seats.filter(s => s.groupIndex === g);
        const color = groupColor(g);
        const foursRoom = `${lessonCode}:fours-${g + 1}`;
        const isGroupCalling = callingRooms?.has(foursRoom) ?? false;
        const groupLost = allLost(groupSeats, marks, 3);
        return (
          <div key={g} data-testid={groupLost ? 'four-lost' : groupSeats[0]?.extra !== undefined ? 'extra-desk' : undefined} style={{
            border: `${groupLost ? 6 : 3}px solid ${isGroupCalling ? '#f39c12' : groupLost ? NOT_UNDERSTOOD : color}`,
            borderRadius: 10,
            padding: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
            position: 'relative',
            animation: isGroupCalling ? 'pairPulse 1.2s infinite' : 'none',
          }}>
            {groupSeats[0]?.extra !== undefined && <div style={{ fontSize: 12, color: '#777', marginBottom: -4 }}>Новые ученики</div>}
            {atDesks && groupSeats[0]?.extra === undefined && groupSeats.some(s => s.occupant) && (
              <button data-testid="desk-visit" onClick={() => onJoinPair?.(foursRoom)} style={{
                alignSelf: 'flex-end', marginBottom: -2, padding: '2px 10px', borderRadius: 12, cursor: 'pointer',
                border: `1px solid ${color}`, background: '#fff', color: '#444', fontSize: 12,
              }}>💬 Подойти</button>
            )}
            {act && joinStage === 'fours' && groupSeats.some(s => s.occupant) && (
              <LampDot lamp={lampOf(groupSeats.flatMap(s => s.occupant ? [s.occupant] : []), act, now, false)} style={{ top: -7, right: -7 }} />
            )}
            {isGroupCalling && (
              <div data-calling-room={foursRoom}
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
              <div key={row} data-testid={pairLost ? 'pair-lost' : undefined} data-pair-room={pairRoom} style={{
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
              const isTarget = !!selected && seat.occupant !== selected && (!seat.occupant || (!readOnly && !waiting.includes(selected)));
              const individualRoom = seat.occupant ? `${lessonCode}:individual-${seat.occupant}` : null;
              const isSeatCalling = !!(individualRoom && callingRooms?.has(individualRoom));
              // Someone on an added desk needs a place, so it keeps asking for attention
              const pulsing = isSeatCalling || (seat.extra !== undefined && !!seat.occupant);
              const joinRoom = seat.extra !== undefined || joinStage === 'individual' ? individualRoom : joinStage === 'pairs' ? pairRoom : joinStage === 'fours' ? foursRoom : null;
              const mark = seat.occupant ? marks?.[seat.occupant] : undefined;
              return (
                <div key={seat.id} data-desk={seat.groupIndex} data-seat-occupant={seat.occupant ?? undefined}
                  onClick={() => {
                    if (!readOnly) { if (seat.occupant) handleOccupiedClick(seat.occupant, seat.id); else handleEmptyClick(seat.id); return; }
                    if (selected && !seat.occupant) { handleEmptyClick(seat.id); return; }
                    // During work the teacher can walk up to anyone, called or not
                    if (seat.occupant && joinRoom) onJoinPair?.(joinRoom);
                  }}
                  style={{
                    width: 160, height: 120,
                    // the activity strip takes the bottom: the avatar and name sit above it
                    ...(act && seat.occupant ? { paddingBottom: 28, boxSizing: 'border-box' as const } : {}),
                    background: '#fff',
                    border: pulsing ? '2px solid #f39c12' : isTarget ? `2px dashed #4a4` : `1px solid #ccc`,
                    boxShadow: isSelected ? `0 0 0 3px ${color}` : 'none',
                    borderRadius: 6,
                    position: 'relative', overflow: 'hidden',
                    display: 'flex', flexDirection: 'column',
                    alignItems: 'center', justifyContent: 'center',
                    cursor: readOnly ? (seat.occupant && joinRoom && onJoinPair ? 'pointer' : 'default') : seat.occupant || isTarget ? 'pointer' : 'default',
                    transition: 'all 0.15s',
                    fontSize: 12, color: '#555',
                    animation: pulsing ? 'pairPulse 1.2s infinite' : 'none',
                  }}
                >
                  {mark && <div data-testid={`mark-${mark}`} style={{
                    position: 'absolute', inset: 0, borderRadius: 5, zIndex: 2, pointerEvents: 'none',
                    border: `${mark === 'no' ? 4 : 3}px solid ${mark === 'no' ? NOT_UNDERSTOOD : UNDERSTOOD}`,
                  }} />}
                  {seat.occupant ? (
                    <>
                      {hasLivekit && <SeatVideo identity={seat.occupant} />}
                      <div style={{ position: 'relative', zIndex: 1, fontWeight: 'bold', fontSize: 13, color: '#222', textShadow: '0 1px 3px rgba(0,0,0,0.4)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 150 }} title={seat.occupant} data-testid="seat-name">
                        <StudentName identity={seat.occupant} />
                      </div>
                      <SeatNick nick={seat.occupant} />
                      {act && (
                        <SeatActivity name={seat.occupant} act={act} showTalk={joinStage !== 'individual'}
                          group={(joinStage === 'fours' ? groupSeats : joinStage === 'pairs' ? groupSeats.filter(s => s.row === row) : [seat]).flatMap(s => s.occupant ? [s.occupant] : [])} />
                      )}
                      {act && joinStage === 'individual' && <LampDot lamp={lampOf([seat.occupant], act, now, true)} style={{ top: 5, left: 5 }} />}
                      {!readOnly && (
                        <div style={{ display: 'flex', gap: 6, position: 'relative', zIndex: 1, marginTop: 2 }}>
                          {!noRemove && <div onClick={e => clearSeat(e, seat.id)} style={{ fontSize: 10, color: '#bbb', cursor: 'pointer' }}>✕</div>}
                          {onMute && <div onClick={e => { e.stopPropagation(); onMute(seat.occupant!); }} style={{ fontSize: 13, cursor: 'pointer' }} title="Заглушить">🔇</div>}
                        </div>
                      )}
                      {seat.extra !== undefined && !isSeatCalling && onJoinPair && (
                        <div data-testid="newcomer-talk" onClick={e => { e.stopPropagation(); onJoinPair(individualRoom!, true); }} title="Поговорить"
                          style={{ position: 'absolute', right: 4, top: 4, fontSize: 18, zIndex: 3, cursor: 'pointer' }}>💬</div>
                      )}
                      {isSeatCalling && (
                        <div data-calling-room={individualRoom!}
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
              {act && joinStage === 'pairs' && groupSeats.some(s => s.row === row && s.occupant) && (
                <LampDot lamp={lampOf(groupSeats.filter(s => s.row === row && s.occupant).map(s => s.occupant!), act, now, false)} style={{ top: -6, right: -6 }} />
              )}
              {isCalling && (
                <div data-calling-room={pairRoom}
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

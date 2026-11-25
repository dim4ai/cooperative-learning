// At work the teacher sees the groups' boards instead of the students' tiles: a board each when alone, one per pair,
// one per four; names and who talks and writes are under the board. How many fours fit in a row is up to the teacher.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Board } from './slides/Board';
import { SlidePlayer, type Positions } from './slides/SlidePlayer';
import type { Scene } from './slides/model';
import type { TeacherSlides } from './LessonSlides';
import { boardShown, useBoardsWatch, watchLink } from './boardsWatch';
import { SpeakingRing } from './speaking';
import { StudentName } from './studentNames';
import { socket } from './socket';
import { ActivityLegend, LampDot, NOT_UNDERSTOOD, SeatActivity, SeatNick, SelfPreview, UNDERSTOOD, groupColor, lampOf, useNow, type ClassActivity, type Marks, type Seat } from './SeatingMap';

const MAX_COLS = 4;
const COLS_KEY = 'boardsCols';
const VIEW_KEY = 'workView';
const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* not kept, that's all */ } };

/** Boards or the students' tiles at work; the teacher's choice is remembered */
export function useWorkView(): ['boards' | 'students', (v: 'boards' | 'students') => void] {
  const [view, setView] = useState<'boards' | 'students'>(() => read(VIEW_KEY) === 'students' ? 'students' : 'boards');
  return [view, v => { setView(v); write(VIEW_KEY, v); }];
}

const btn = (on = false): CSSProperties => ({
  height: 30, padding: '0 12px', borderRadius: 6, border: `1px solid ${on ? '#4a90e2' : '#c9b99c'}`, background: on ? '#4a90e2' : '#fff',
  color: on ? '#fff' : '#333', fontSize: 14, cursor: 'pointer',
});

export function WorkViewSwitch({ view, onView }: { view: 'boards' | 'students'; onView: (v: 'boards' | 'students') => void }) {
  return (
    <div style={{ display: 'flex', gap: 4 }}>
      <button data-testid="view-boards" onClick={() => onView('boards')} style={btn(view === 'boards')}>Доски</button>
      <button data-testid="view-students" onClick={() => onView('students')} style={btn(view === 'students')}>Ученики</button>
    </div>
  );
}

// The boards' canvases outlive the map: entering a group and coming back rebuilds the whole page (LiveKitRoom is keyed by
// the room), so BoardsKeeper, above it, draws them into elements of their own, and the map only puts those in place.
const hosts = new Map<string, HTMLDivElement>();
let wanted: string[] = [];
const wantedSubs = new Set<() => void>();
const setWanted = (w: string[]) => { wanted = w; wantedSubs.forEach(f => f()); };
function hostOf(room: string): HTMLDivElement {
  let el = hosts.get(room);
  if (!el) {
    el = document.createElement('div');
    el.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    hosts.set(room, el);
    setWanted([...wanted, room]);
  }
  return el;
}

/** A group's small board blown up over its big one till that has drawn itself */
export function BoardShot({ room, width }: { room: string; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const c = ref.current!, host = hosts.get(room);
    const layers = [...host?.querySelectorAll<HTMLCanvasElement>('canvas.lower-canvas') ?? []].filter(x => x.width > 0);
    if (!layers.length) { c.style.display = 'none'; return; }
    c.width = layers[0].width;
    c.height = layers[0].height;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    for (const l of layers) g.drawImage(l, 0, 0, c.width, c.height);
  }, [room]);
  return <canvas ref={ref} data-testid="board-shot" style={{ position: 'absolute', left: 0, top: 0, zIndex: 3, width, pointerEvents: 'none' }} />;
}

function useScene(slides: TeacherSlides): Scene | undefined {
  const { local, state, material } = slides;
  const block = state.active ? (local ?? material)?.blocks.find(b => b.id === state.blockId) : undefined;
  return block?.slides?.[state.index];
}

/** Above the keyed LiveKitRoom for the whole work stage: keeps every board shown once up to date */
export function BoardsKeeper({ slides }: { slides: TeacherSlides }) {
  const positions = useBoardsWatch();
  const rooms = useSyncExternalStore(f => { wantedSubs.add(f); return () => { wantedSubs.delete(f); }; }, () => wanted);
  const scene = useScene(slides);
  const { local, state } = slides;
  const resolve = useCallback((name: string) => local?.urls.get(name), [local]);
  const revealed = useMemo(() => new Set(state.revealed), [state.revealed]);
  const placed = useMemo(() => Object.fromEntries(Object.entries(positions).map(([r, p]) => [r, { ...state.positions, ...p }])), [positions, state.positions]);
  // a new stage, other rooms: what its map hasn't put in place by now is the last stage's
  useLayoutEffect(() => {
    for (const [room, el] of hosts) if (!el.isConnected) hosts.delete(room);
    setWanted([...hosts.keys()]);
  }, []);
  return <>{rooms.map(room => createPortal(
    <KeptBoard room={room} scene={scene} resolve={resolve} revealed={revealed} positions={placed[room] ?? (state.positions as Positions)} />, hostOf(room), room))}</>;
}

/** The task's sheet with this room's drawing over it */
function KeptBoard({ room, scene, resolve, revealed, positions }: {
  room: string; scene?: Scene; resolve: (name: string) => string | undefined; revealed: ReadonlySet<string>; positions: Positions;
}) {
  const underlay = useCallback((width: number) => scene && (
    <SlidePlayer key={scene.id} scene={scene} resolveMedia={resolve} role="student" revealed={revealed} positions={positions} canDrag={false} width={width} />
  ), [scene, resolve, revealed, positions]);
  return <Board key={scene ? 'sheet' : 'blank'} readOnly link={watchLink(room)} underlay={scene ? underlay : undefined} />;
}

/** One board to look at */
function MiniBoard({ room, scene, children, frame, onOpen }: { room: string; scene?: Scene; children?: ReactNode; frame: string; onOpen?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = hostOf(room);
    ref.current!.prepend(el);
    boardShown(room, true);
    return () => { el.remove(); boardShown(room, false); };
  }, [room]);
  return (
    <div ref={ref} data-testid="mini-board" data-board-room={room} onClick={onOpen} title={onOpen && 'Подойти'} style={{
      position: 'relative', width: '100%', aspectRatio: `${scene?.width ?? 1600} / ${scene?.height ?? 900}`, borderRadius: 4, overflow: 'hidden',
      boxShadow: `0 0 0 1px ${frame}`, cursor: onOpen ? 'pointer' : 'default', background: '#fff',
    }}>
      {children}
    </div>
  );
}

export function BoardsMap({ seats, stage, slides, callingRooms, onJoinPair, lessonCode, marks, waiting, activity, view, onView, showSelf }: {
  seats: Seat[]; stage: 'individual' | 'pairs' | 'fours'; slides: TeacherSlides; callingRooms: Set<string>; onJoinPair: (room: string, toTalk?: boolean) => void;
  lessonCode: string; marks: Marks; waiting: string[]; activity: ClassActivity | null; view: 'boards' | 'students'; onView: (v: 'boards' | 'students') => void; showSelf: boolean;
}) {
  const [cols, setCols] = useState(() => Math.min(MAX_COLS, Math.max(1, Number(read(COLS_KEY)) || 2)));
  useEffect(() => write(COLS_KEY, String(cols)), [cols]);
  const [selected, setSelected] = useState<string | null>(null); // one waiting for a place
  const now = useNow(activity?.skew ?? 0, !!activity);

  const scene = useScene(slides);

  const chip = (seat: Seat, group: string[]) => {
    const name = seat.occupant;
    if (!name) return (
      <div key={seat.id} data-desk={seat.groupIndex} onClick={() => { if (selected) { socket.emit('moveSeat', { studentName: selected, toSeatId: seat.id }); setSelected(null); } }}
        style={{ flex: 1, minWidth: 0, minHeight: 30, borderRadius: 6, border: `1px dashed ${selected ? '#4a4' : '#ddd'}`, cursor: selected ? 'pointer' : 'default', boxSizing: 'border-box' }} />
    );
    const own = `${lessonCode}:individual-${name}`;
    const room = roomOf(seat);
    const mark = marks?.[name];
    return (
      <div key={seat.id} data-desk={seat.groupIndex} data-seat-occupant={name} onClick={() => onJoinPair(room)} style={{
        flex: 1, minWidth: 0, position: 'relative', borderRadius: 6, background: '#fff', padding: '3px 6px', boxSizing: 'border-box', cursor: 'pointer', textAlign: 'center', lineHeight: 1.25,
        border: mark ? `${mark === 'no' ? 3 : 2}px solid ${mark === 'no' ? NOT_UNDERSTOOD : UNDERSTOOD}` : '1px solid #ccc',
      }}>
        <SpeakingRing identity={name} />
        <div data-testid="seat-name" title={name} style={{ fontWeight: 'bold', fontSize: 13, color: '#222', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}><StudentName identity={name} /></div>
        <SeatNick nick={name} />
        {activity && <SeatActivity inline name={name} act={activity} group={group} showTalk={stage !== 'individual'} />}
        {seat.extra !== undefined && !callingRooms.has(own) && (
          <div data-testid="newcomer-talk" title="Поговорить" onClick={e => { e.stopPropagation(); onJoinPair(own, true); }} style={{ position: 'absolute', right: 4, top: 1, fontSize: 16, cursor: 'pointer' }}>💬</div>
        )}
      </div>
    );
  };
  function roomOf(seat: Seat): string {
    if (seat.extra !== undefined || stage === 'individual') return `${lessonCode}:individual-${seat.occupant}`;
    return stage === 'pairs' ? `${lessonCode}:pair-g${seat.groupIndex}-r${seat.row}` : `${lessonCode}:fours-${seat.groupIndex + 1}`;
  }
  const bell = (room: string, size: number) => callingRooms.has(room) && (
    <div data-calling-room={room} title="Подойти" onClick={e => { e.stopPropagation(); onJoinPair(room); }} style={{
      position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', fontSize: size, lineHeight: 1, zIndex: 10, cursor: 'pointer', filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.3))',
    }}>🔔</div>
  );
  /** a board and those who write on it */
  const desk = (room: string, members: Seat[], color: string, lamp: boolean) => {
    const names = members.flatMap(s => s.occupant ? [s.occupant] : []);
    const calling = callingRooms.has(room);
    return (
      <div key={room} data-pair-room={stage === 'pairs' ? room : undefined} style={{
        flex: stage === 'pairs' ? undefined : 1, minWidth: 0, position: 'relative', display: 'flex', flexDirection: 'column', gap: 4, borderRadius: 6,
        outline: calling ? '3px solid #f39c12' : 'none', outlineOffset: 2, animation: calling ? 'boardCall 1.2s infinite' : 'none',
      }}>
        <MiniBoard room={room} scene={scene} frame={color} onOpen={() => onJoinPair(room)}>
          {bell(room, stage === 'fours' ? 56 : 40)}
        </MiniBoard>
        {lamp && activity && names.length > 0 && <LampDot lamp={lampOf(names, activity, now, stage === 'individual')} style={{ top: -5, right: -5 }} />}
        <div style={{ display: 'flex', gap: 4 }}>{members.map(s => chip(s, names))}</div>
      </div>
    );
  };

  const groups = [...new Set(seats.map(s => s.groupIndex))].sort((a, b) => a - b)
    .map(g => ({ g, seats: seats.filter(s => s.groupIndex === g) }))
    .filter(x => selected || x.seats.some(s => s.occupant)); // an empty four takes no room, unless someone is looking for a place

  return (
    <div data-testid="boards-map" style={{ height: '100%', display: 'flex', flexDirection: 'column', boxSizing: 'border-box' }}>
      <style>{'@keyframes boardCall { 0%, 100% { outline-color: #f39c12 } 50% { outline-color: #f39c1233 } }'}</style>
      <div style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 16, padding: '8px 16px', borderBottom: '1px solid #e0d4c0' }}>
        <WorkViewSwitch view={view} onView={onView} />
        <div style={{ display: 'flex', gap: 4 }}>
          <button data-testid="boards-smaller" title="Доски мельче" disabled={cols >= MAX_COLS} onClick={() => setCols(c => c + 1)} style={{ ...btn(), width: 34, padding: 0, fontSize: 18, opacity: cols >= MAX_COLS ? 0.4 : 1 }}>−</button>
          <button data-testid="boards-bigger" title="Доски крупнее" disabled={cols <= 1} onClick={() => setCols(c => c - 1)} style={{ ...btn(), width: 34, padding: 0, fontSize: 18, opacity: cols <= 1 ? 0.4 : 1 }}>+</button>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>{activity && <ActivityLegend alone={stage === 'individual'} />}</div>
        {showSelf && <SelfPreview small />}
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', containerType: 'size', padding: 16, boxSizing: 'border-box' }}>
        {waiting.length > 0 && (
          <div data-testid="seat-waiting" style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginBottom: 12, fontSize: 13, color: '#555' }}>
            Ждут место:
            {waiting.map(name => (
              <button key={name} data-testid="seat-waiting-name" title="Выберите, потом кликните свободное место" onClick={() => setSelected(s => s === name ? null : name)} style={{
                padding: '4px 10px', borderRadius: 14, cursor: 'pointer', fontSize: 13, border: selected === name ? '2px solid #4a90e2' : '1px solid #bbb', background: '#fff', color: '#222',
              }}><StudentName identity={name} /><span data-testid="newcomer-talk" title="Поговорить" onClick={e => { e.stopPropagation(); onJoinPair(`${lessonCode}:individual-${name}`, true); }} style={{ marginLeft: 6 }}>💬</span></button>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignContent: 'flex-start', justifyContent: cols === 1 ? 'center' : 'flex-start' }}>
          {groups.map(({ g, seats: gs }) => {
            const color = groupColor(g);
            const extra = gs[0]?.extra !== undefined;
            const foursRoom = `${lessonCode}:fours-${g + 1}`;
            const bySeat = [...gs].sort((a, b) => a.row - b.row || a.col - b.col);
            const row = (r: number) => bySeat.filter(s => s.row === r);
            return (
              <div key={g} data-group={g} data-testid={extra ? 'extra-desk' : undefined} style={{
                // whole on the screen even when it is the only one in the row
                width: `min((100% - ${(cols - 1) * 16}px) / ${cols}, (100cqh - 190px) * 16 / 9)`, minWidth: 220,
                boxSizing: 'border-box', border: `3px solid ${callingRooms.has(foursRoom) ? '#f39c12' : color}`, borderRadius: 10, padding: 8, display: 'flex', flexDirection: 'column', gap: 8,
              }}>
                {extra && <div style={{ fontSize: 12, color: '#777', marginBottom: -4 }}>Новые ученики</div>}
                {stage === 'fours' && !extra ? desk(foursRoom, bySeat, color, true)
                  : stage === 'pairs' && !extra
                    ? <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{[0, 1].map(r => row(r).some(s => s.occupant)
                        ? desk(`${lessonCode}:pair-g${g}-r${r}`, row(r), color, true)
                        : <div key={r} style={{ display: 'flex', gap: 4 }}>{row(r).map(s => chip(s, []))}</div>)}</div>
                    : [0, 1].filter(r => row(r).some(s => s.occupant) || selected).map(r => (
                        <div key={r} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                          {row(r).map(s => s.occupant ? desk(roomOf(s), [s], color, false) : chip(s, []))}
                        </div>
                      ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// What the groups have on their boards, live: the server sends every working group's board while the teacher looks at them
import { useEffect, useState } from 'react';
import type { BoardLink, BoardObject, BoardOp } from './slides/Board';
import type { Positions } from './slides/SlidePlayer';
import { socket } from './socket';

interface RoomBoard { room: string; objects: BoardObject[]; positions: Positions }

const boards = new Map<string, Map<string, BoardObject>>();
const subs = new Map<string, Set<{ op: (o: BoardOp) => void; state: (o: BoardObject[]) => void }>>();

function onOp({ room, op }: { room: string; op: BoardOp }) {
  let b = boards.get(room);
  if (!b) { b = new Map(); boards.set(room, b); }
  if (op.t === 'clear') b.clear();
  else if (op.t === 'del') b.delete(op.uid);
  else b.set(op.obj.uid, op.obj);
  if (op.t === 'clear') pending.set(room, [op]);
  else {
    const q = pending.get(room) ?? [];
    const uid = op.t === 'del' ? op.uid : op.obj.uid;
    const i = q.findLastIndex(o => o.t !== 'clear' && (o.t === 'del' ? o.uid : o.obj.uid) === uid);
    // a stroke being drawn comes as many versions of it: the last one will do
    if (op.t !== 'del' && i >= 0 && q[i].t !== 'del') q[i] = { t: q[i].t as 'add' | 'mod', obj: op.obj };
    else q.push(op);
    pending.set(room, q);
  }
  if (!timers.has(room)) timers.set(room, window.setTimeout(() => flushBoard(room), shown.has(room) ? SHOWN_MS : HIDDEN_MS));
}

// The boards are redrawn once a second at most, the ones not on the screen now seldom: a whole class is a lot of drawing
const SHOWN_MS = 1000, HIDDEN_MS = 3000;
const pending = new Map<string, BoardOp[]>();
const timers = new Map<string, number>();
const shown = new Set<string>();
function flushBoard(room: string) {
  clearTimeout(timers.get(room));
  timers.delete(room);
  const q = pending.get(room) ?? [];
  pending.delete(room);
  for (const op of q) subs.get(room)?.forEach(s => s.op(op));
}
/** The room's board is on the screen (what it missed is drawn at once) or away from it */
export function boardShown(room: string, on: boolean) {
  if (!on) { shown.delete(room); return; }
  shown.add(room);
  flushBoard(room);
}

const same = (a: Map<string, BoardObject> | undefined, b: BoardObject[]) =>
  (a?.size ?? 0) === b.length && b.every(o => JSON.stringify(a!.get(o.uid)) === JSON.stringify(o));

const links = new Map<string, BoardLink>();
/** A room's board to look at; nothing is ever sent from it */
export function watchLink(room: string): BoardLink {
  let link = links.get(room);
  if (!link) {
    link = {
      send: () => {},
      subscribe(op, state) {
        const s = { op, state };
        const of = subs.get(room) ?? new Set();
        subs.set(room, of.add(s));
        state([...boards.get(room)?.values() ?? []]);
        return () => { of.delete(s); };
      },
    };
    links.set(room, link);
  }
  return link;
}

/** Ask for the boards while mounted; where each room dragged the sheet's ✋ objects */
export function useBoardsWatch(): Record<string, Positions> {
  const [positions, setPositions] = useState<Record<string, Positions>>({});
  useEffect(() => {
    const onState = (all: RoomBoard[]) => {
      const now = new Map(all.map(r => [r.room, r]));
      for (const room of new Set([...boards.keys(), ...now.keys()])) {
        const objects = now.get(room)?.objects ?? [];
        if (same(boards.get(room), objects)) continue;
        pending.delete(room);
        boards.set(room, new Map(objects.map(o => [o.uid, o])));
        subs.get(room)?.forEach(s => s.state(objects));
      }
      setPositions(Object.fromEntries(all.map(r => [r.room, r.positions])));
    };
    const onMove = ({ room, uid, left, top }: { room: string; uid: string; left: number; top: number }) =>
      setPositions(p => ({ ...p, [room]: { ...p[room], [uid]: { left, top } } }));
    const ask = () => socket.emit('boards:watch', { on: true });
    socket.on('boards:state', onState);
    socket.on('boards:op', onOp);
    socket.on('boards:move', onMove);
    socket.on('connect', ask);
    ask();
    return () => {
      socket.off('boards:state', onState);
      socket.off('boards:op', onOp);
      socket.off('boards:move', onMove);
      socket.off('connect', ask);
      socket.emit('boards:watch', { on: false });
      boards.clear();
      pending.clear();
    };
  }, []);
  return positions;
}

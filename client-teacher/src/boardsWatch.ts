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
  subs.get(room)?.forEach(s => s.op(op));
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
    };
  }, []);
  return positions;
}

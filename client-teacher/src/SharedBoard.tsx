// The lesson's shared board: the common Fabric board (slides/Board.tsx) synced over the socket.
// The server keeps one board per LiveKit room and sends the current one on request.
import { useMemo, type ReactNode } from 'react';
import { Board, type BoardLink, type BoardObject, type BoardOp } from './slides/Board';
import { socket } from './socket';
import { boardPictures } from './BoardPictures';
import { knownBoard } from './boardsWatch';

/** known: the room's board as the map of boards had it, shown at once, before the server answers */
const linkFor = (room?: string): BoardLink => ({
  send: op => socket.emit('boardOp', op),
  subscribe(onOp, onState) {
    const known = room ? knownBoard(room) : undefined;
    let untouched = known && JSON.stringify(known); // what's on the canvas, while nothing has been added to it
    // the page is on the screen first, with the small board's picture: drawing it all takes a moment
    let held: (() => void)[] | null = room ? [] : null;
    const later = (f: () => void) => { if (held) held.push(f); else f(); };
    const go = () => { const h = held; held = null; h?.forEach(f => f()); };
    const raf = held ? requestAnimationFrame(() => { timer = window.setTimeout(go, 0); }) : 0;
    let timer = held ? window.setTimeout(go, 300) : 0; // no frames in a hidden tab
    const op = (o: BoardOp) => later(() => { untouched = undefined; onOp(o); });
    const state = (objs: BoardObject[]) => later(() => {
      if (untouched !== undefined && JSON.stringify(objs) === untouched) return; // the same: nothing to redraw
      untouched = undefined;
      onState(objs);
    });
    if (known) later(() => onState(known));
    socket.on('boardOp', op);
    socket.on('boardState', state);
    socket.emit('boardSync');
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); held = []; socket.off('boardOp', op); socket.off('boardState', state); };
  },
});

export function SharedBoard({ room, readOnly, underlay, onLoaded }: { room?: string; readOnly?: boolean; underlay?: (width: number) => ReactNode; onLoaded?: () => void }) {
  const link = useMemo(() => linkFor(room), [room]);
  return <Board role="teacher" readOnly={readOnly} link={link} underlay={underlay} pictures={boardPictures} onLoaded={onLoaded} />;
}

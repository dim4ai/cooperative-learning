// The lesson's shared board: the common Fabric board (slides/Board.tsx) synced over the socket.
// The server keeps one board per LiveKit room and sends the current one on request.
import type { ReactNode } from 'react';
import { Board, type BoardLink, type BoardObject, type BoardOp } from './slides/Board';
import { socket } from './socket';

const link: BoardLink = {
  send: op => socket.emit('boardOp', op),
  subscribe(onOp, onState) {
    const op = (o: BoardOp) => onOp(o);
    const state = (objs: BoardObject[]) => onState(objs);
    socket.on('boardOp', op);
    socket.on('boardState', state);
    socket.emit('boardSync');
    return () => { socket.off('boardOp', op); socket.off('boardState', state); };
  },
};

export function SharedBoard({ readOnly, underlay }: { room?: string; readOnly?: boolean; underlay?: (width: number) => ReactNode }) {
  return <Board role="teacher" readOnly={readOnly} link={link} underlay={underlay} />;
}

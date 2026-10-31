import { io } from 'socket.io-client';

const params = new URLSearchParams(window.location.search);
const urlName = params.get('name');
const boardOnly = params.get('boardonly') === '1';
const boardRoom = params.get('room') ?? '';

export const myName = urlName || prompt('Your name:') || 'Student';
export const isBoardOnly = boardOnly;
export const myBoardRoom = boardRoom;

const auth = boardOnly
  ? { name: myName, role: 'board' as const, boardRoom }
  : { name: myName, role: 'student' as const };

export const socket = io(import.meta.env.VITE_API_URL, {
  auth,
  autoConnect: false,
});

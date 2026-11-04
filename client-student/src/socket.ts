import { io } from 'socket.io-client';
import { loadAvatar } from './avatars';
import { profileUuid } from './profiles';

const params = new URLSearchParams(window.location.search);
const boardOnly = params.get('boardonly') === '1';
const boardRoom = params.get('room') ?? '';

export const isBoardOnly = boardOnly;
export const myBoardRoom = boardRoom;

export let myName = params.get('name') ?? '';
export let lessonId = params.get('lessonId') ?? '';

export function setJoinInfo(name: string, code: string) {
  myName = name;
  lessonId = code;
}

export function setName(name: string) {
  myName = name;
}

export function setLessonId(code: string) {
  lessonId = code;
}

const auth = boardOnly
  ? (cb: (data: object) => void) => cb({ name: myName, role: 'board', boardRoom, lessonId })
  : (cb: (data: object) => void) => cb({ name: myName, role: 'student', lessonId, avatar: loadAvatar(), uuid: profileUuid(myName) });

export const socket = io(import.meta.env.VITE_API_URL, {
  auth,
  autoConnect: false,
});

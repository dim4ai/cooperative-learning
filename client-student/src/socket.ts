import { io } from 'socket.io-client';
import { loadAvatar } from './avatars';
import { profileNames, profileUuid } from './profiles';

const params = new URLSearchParams(window.location.search);
const boardOnly = params.get('boardonly') === '1';
const boardRoom = params.get('room') ?? '';

export const isBoardOnly = boardOnly;
export const myBoardRoom = boardRoom;

/** Who this student is in the lesson: their nick. Seats, rooms and classmates' screens all go by it */
export let myName = params.get('name') ?? '';
/** The profile's name: how the student sees themselves */
export let ownName = myName;
export let lessonId = params.get('lessonId') ?? '';

export function setJoinInfo(name: string, code: string) {
  setName(name);
  lessonId = code;
}

export function setName(name: string) {
  ownName = name;
  myName = profileNames(name).nick;
}

/** The profile's names were edited */
export function refreshNick() {
  myName = profileNames(ownName).nick;
}

/** Everyone appears by their nick, except the student to themselves */
export const shownName = (identity: string) => identity === myName ? ownName : identity;

export function setLessonId(code: string) {
  lessonId = code;
}

const auth = boardOnly
  ? (cb: (data: object) => void) => cb({ name: myName, role: 'board', boardRoom, lessonId })
  : (cb: (data: object) => void) => cb({ name: myName, role: 'student', lessonId, avatar: loadAvatar(), uuid: profileUuid(ownName), teacherName: profileNames(ownName).teacherName });

export const socket = io(import.meta.env.VITE_API_URL, {
  auth,
  autoConnect: false,
});

// Someone in the lesson already goes by this nick
socket.on('myName', (name: string) => { myName = name; });

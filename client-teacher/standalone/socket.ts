// src/socket.ts in the standalone demo: the same module, but the socket goes to the server in this tab (bus.ts)
import { ClientSocket } from './bus';
import { getTeacherProfile, lookOf } from '../src/teacherProfile';

let lessonCode = '';
let authToken = '';

export function setLessonCode(code: string) {
  lessonCode = code;
}

export function setAuthToken(token: string) {
  authToken = token;
}

export const socket = new ClientSocket(cb => {
  const p = getTeacherProfile();
  cb({ name: 'Teacher', role: 'teacher', lessonId: lessonCode, token: authToken, avatar: p.photo ? null : p.avatar, look: lookOf(p) });
});

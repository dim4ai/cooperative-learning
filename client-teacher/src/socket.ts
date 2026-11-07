import { io } from 'socket.io-client';
import { getTeacherProfile, lookOf } from './teacherProfile';

let lessonCode = '';
let authToken = '';

export function setLessonCode(code: string) {
  lessonCode = code;
}

export function setAuthToken(token: string) {
  authToken = token;
}

export const socket = io(import.meta.env.VITE_API_URL, {
  auth: cb => {
    const p = getTeacherProfile();
    cb({ name: 'Teacher', role: 'teacher', lessonId: lessonCode, token: authToken, avatar: p.photo ? null : p.avatar, look: lookOf(p) });
  },
  autoConnect: false,
});

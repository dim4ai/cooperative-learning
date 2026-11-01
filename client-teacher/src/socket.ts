import { io } from 'socket.io-client';

let lessonCode = '';
let authToken = '';

export function setLessonCode(code: string) {
  lessonCode = code;
}

export function setAuthToken(token: string) {
  authToken = token;
}

export const socket = io(import.meta.env.VITE_API_URL, {
  auth: cb => cb({ name: 'Teacher', role: 'teacher', lessonId: lessonCode, token: authToken }),
  autoConnect: false,
});

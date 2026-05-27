import { io } from 'socket.io-client';

export const myName = prompt('Your name:') || 'Student';

export const socket = io('https://redacted-domain.example:13013', {
  auth: { name: myName, role: 'student' },
  autoConnect: false,
});

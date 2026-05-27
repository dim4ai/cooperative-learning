import { io } from 'socket.io-client';

export const socket = io('https://redacted-domain.example:13013', {
  auth: { name: 'Teacher', role: 'teacher' },
  autoConnect: false,
});

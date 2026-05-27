import { io } from 'socket.io-client';

export const myName = prompt('Your name:') || 'Student';

export const socket = io('https://d4-claude-voice.duckdns.org:13013', {
  auth: { name: myName, role: 'student' },
  autoConnect: false,
});

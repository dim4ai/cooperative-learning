import { io } from 'socket.io-client';

export const socket = io('https://d4-claude-voice.duckdns.org:13013', {
  auth: { name: 'Teacher', role: 'teacher' },
  autoConnect: false,
});

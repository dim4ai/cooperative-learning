import { useEffect, useState } from 'react';
import { socket } from './socket';

// The running poll as the server shows it to this student (Poll.tsx draws it)

export interface StudentPollView {
  blockId: string; question: string; multi: boolean; revealed: boolean;
  picture?: { src: string; width: number; height: number };
  options: { text: string; color: string | null; correct?: boolean }[];
  mine: number[];
  counts?: number[]; total?: number; grade?: string | null;
}

export function usePoll(): StudentPollView | null {
  const [poll, setPoll] = useState<StudentPollView | null>(null);
  useEffect(() => {
    socket.on('poll', setPoll);
    return () => { socket.off('poll', setPoll); };
  }, []);
  return poll;
}


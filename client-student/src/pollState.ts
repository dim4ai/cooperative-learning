import { useEffect, useState } from 'react';
import { socket } from './socket';

// The running poll as the server shows it to this student (Poll.tsx draws it)

export interface StudentPollView {
  blockId: string; question: string; multi: boolean; revealed: boolean;
  seconds: number | null; msLeft: number | null; timeUp: boolean;
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


/** Seconds left to answer, counting down between the server's messages; null without a time limit.
 *  The server sends what's left rather than a clock time: the clocks of computers differ. */
export function useSecondsLeft(poll: { msLeft: number | null } | null): number | null {
  const [now, setNow] = useState(() => performance.now());
  const [deadline, setDeadline] = useState<number | null>(null);
  useEffect(() => { setDeadline(poll?.msLeft == null ? null : performance.now() + poll.msLeft); }, [poll]);
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  return deadline === null ? null : Math.max(0, Math.ceil((deadline - now) / 1000));
}

export const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

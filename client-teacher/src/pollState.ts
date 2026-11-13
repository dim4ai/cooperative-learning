import { useEffect, useState } from 'react';
import { socket } from './socket';
import type { BoardPicture } from './slides/Board';

// What the teacher's poll screens share (Poll.tsx): the server's view of the running poll, and its colours

export const LETTERS = 'АБВГДЕЖЗ';
/** Colours of options with no right answer: none of them green, yellow, orange or red, those mean right and wrong */
export const POLL_COLORS = ['#3b82f6', '#8b5cf6', '#14b8a6', '#ec4899', '#a16207', '#4338ca', '#0891b2', '#64748b'];
export const GRADE_INFO: Record<string, { color: string; label: string }> = {
  right: { color: '#2ecc71', label: 'всё верно' },
  most: { color: '#f1c40f', label: 'верно половина или больше' },
  some: { color: '#e67e22', label: 'верно меньше половины' },
  wrong: { color: '#e74c3c', label: 'неверно' },
};
export const MAX_OPTIONS = 8;
export const MIN_SECONDS = 5;
export const MAX_SECONDS = 3600;

export interface PollOption { text: string; color: string; correct: boolean }
export interface TeacherPollView {
  blockId: string; question: string; multi: boolean; options: PollOption[]; picture?: BoardPicture;
  revealed: boolean; counts: number[]; seconds?: number; msLeft: number | null; timeUp: boolean;
  answers: Record<string, { choice: number[]; color: string | null; grade: string | null }>;
}

/** The running block's poll, as the server tells it */
export function usePoll(): TeacherPollView | null {
  const [poll, setPoll] = useState<TeacherPollView | null>(null);
  useEffect(() => {
    socket.on('poll', setPoll);
    return () => { socket.off('poll', setPoll); };
  }, []);
  return poll;
}

/** How each student answered, for the seating map: the frame's colour and the letters chosen */
export function pollMarks(poll: TeacherPollView | null): Record<string, { color: string; label: string }> | undefined {
  if (!poll) return undefined;
  return Object.fromEntries(Object.entries(poll.answers).map(([name, a]) =>
    [name, { color: a.color ?? '#64748b', label: a.choice.map(i => LETTERS[i]).join('') }]));
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

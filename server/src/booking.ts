// A class has to be gathered in advance, so a demo lesson is booked for a set time. A booked
// place takes the whole of the lesson's window, from the moment the door opens to the end.

export type BookingMode = 'teacher' | 'none';
export type BookingStatus = 'booked' | 'open' | 'over' | 'cancelled' | 'no show';

export interface BookingRecord {
  code: string;
  tokenHash: string;
  ipHash: string;
  videoMode: BookingMode;
  startsAt: number;
  createdAt: number;
  status: BookingStatus;
  teacherCame: boolean;
  barUntil: number; // the address can't book until then: it left a booked place empty
}

export const isHeld = (b: BookingRecord) => b.status === 'booked' || b.status === 'open';

export interface Window { from: number; to: number }

/** The most places taken at any moment of the window. Takes the windows of one kind of place. */
export function peakTaken(windows: Window[], want: Window): number {
  const overlapping = windows.filter(w => w.from < want.to && want.from < w.to);
  const moments = [want.from, ...overlapping.map(w => w.from).filter(t => t > want.from)];
  return Math.max(0, ...moments.map(t => overlapping.filter(w => w.from <= t && t < w.to).length));
}

/** The times that can be booked: on the step, after now, up to the horizon */
export function bookableStarts(now: number, stepMs: number, horizonMs: number): number[] {
  const starts: number[] = [];
  for (let t = Math.floor(now / stepMs + 1) * stepMs; t <= now + horizonMs; t += stepMs) starts.push(t);
  return starts;
}

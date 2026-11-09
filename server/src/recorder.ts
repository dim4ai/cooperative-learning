// Recording a lesson happens in the teacher's browser; the server only lets it hear and see
// everything. While the teacher records and the lesson runs (from «Начать урок» to its end), each
// student's traffic is copied to the teacher's socket as it goes: what the server sent them and
// what they sent. With it, the lesson can be played back later as any student saw it. The server
// keeps nothing: a batch is out within half a second and forgotten.
//
// Media chunks (binary, the slide pictures) and LiveKit tokens never go into the copy.

export interface RecEntry {
  t: number;          // server time, ms
  ev: string;
  data: unknown[];
  to?: string[];      // sent by the server to these students
  from?: string;      // sent by this student
  snap?: boolean;     // not really sent: what the student had on screen when the recording began
}

const SKIPPED = /^media:/;

/** Tokens would let the holder into someone's LiveKit room: they are cut out of everything copied */
function withoutTokens(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(withoutTokens);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => k !== 'token').map(([k, x]) => [k, withoutTokens(x)]));
}

export class RecordingTap {
  /** Teacher sockets that record this lesson */
  readonly listeners = new Set<string>();
  active = false;
  /** LiveKit rooms the teacher's browser was last told to listen to */
  rooms = '';
  private batch: RecEntry[] = [];
  // the same packet to several students at once (a broadcast) is one entry with all of them
  private byPacket = new Map<string, RecEntry>();

  /** Packets socket.io writes to a student's connection, as encoded: '2["event",…]' is an event */
  out(who: string, packets: unknown[]) {
    if (!this.active) return;
    for (const p of packets) {
      if (typeof p !== 'string' || p[0] !== '2') continue; // binary events (5…) are media
      const same = this.byPacket.get(p);
      if (same && !same.to!.includes(who)) { same.to!.push(who); continue; }
      const at = p.indexOf('[');
      if (at < 0) continue;
      let arr: unknown;
      try { arr = JSON.parse(p.slice(at)); } catch { continue; }
      if (!Array.isArray(arr) || typeof arr[0] !== 'string' || SKIPPED.test(arr[0])) continue;
      const entry: RecEntry = { t: Date.now(), ev: arr[0], data: withoutTokens(arr.slice(1)) as unknown[], to: [who] };
      this.byPacket.set(p, entry);
      this.batch.push(entry);
    }
  }

  /** An event a student sent */
  in(who: string, ev: string, args: unknown[]) {
    if (!this.active || SKIPPED.test(ev)) return;
    this.batch.push({ t: Date.now(), ev, data: withoutTokens(args.filter(a => typeof a !== 'function')) as unknown[], from: who });
  }

  snapshot(who: string, events: [string, unknown][]) {
    const t = Date.now();
    for (const [ev, data] of events) this.batch.push({ t, ev, data: [withoutTokens(data)], to: [who], snap: true });
  }

  /** What has gathered since the last time; the caller sends it to the listeners */
  take(): RecEntry[] {
    const out = this.batch;
    this.batch = [];
    this.byPacket.clear();
    return out;
  }
}

// Relays lesson media (slide pictures, videos) from whoever has a file to whoever needs it,
// through the server, without storing it: the server is a pipe, not a warehouse.
//
//   source (teacher, or a student that already got the file)
//     ── media:chunk {tid, seq, data} ──▶ server ── media:chunk {hash, seq, data, last} ──▶ receivers
//     ◀── ack {go} when receivers keep up ──
//
// - Files are cut into CHUNK-byte pieces. The source sends the next piece only after the server
//   acks the previous one, and the server acks only when every receiver has fewer than WINDOW
//   pieces in flight. So at any moment a transfer holds at most WINDOW pieces per receiver.
// - A receiver that blocks the transfer for RECEIVER_STALL_MS is dropped from it (media:abort)
//   and asks again later; the others don't wait for it.
// - Receivers wanting the same file at the same moment are served by ONE transfer.
// - Whoever has received a file becomes a holder. Later requests (late joiners, reconnects,
//   dropped receivers) are served by the holder with the best recently measured upload speed;
//   the teacher — whose connection matters most — is asked only if no student has the file.
// - Every file is checked against its SHA-256 (from the teacher's catalog) while it passes
//   through; a source that sends something else is never asked for that file again.
import crypto from 'crypto';
import type { Server } from 'socket.io';

export const CHUNK = 256 * 1024;
const WINDOW = 4;
const RECEIVER_STALL_MS = 3000;
const SOURCE_TIMEOUT_MS = 20_000;
const RECEIVER_ACK_TIMEOUT_MS = 30_000;
const PUMP_DELAY_MS = 60;            // gather wants that arrive together into one transfer
const STATS_FRESH_MS = 10 * 60_000;  // speed measurements older than this are ignored
const DEFAULT_UP_BPS = 200_000;      // assumed upload speed of a student not measured yet
const EWMA = 0.3;

export interface LinkStats {
  up?: { bps: number; at: number };   // how fast this peer sends to the server
  down?: { bps: number; at: number }; // how fast it receives from the server
}

interface Receiver { inFlight: number; acked: number }

interface Transfer {
  id: string;
  hash: string;
  size: number;
  type: string;
  source: string;
  receivers: Map<string, Receiver>;
  seq: number;
  bytes: number;
  hasher: crypto.Hash;
  release: ((r: { go?: boolean; stop?: boolean }) => void) | null;
  askedAt: number;
  sourceTimer: NodeJS.Timeout | null;
  stallTimer: NodeJS.Timeout | null;
  done: boolean;
}

export interface ChunkMsg { tid?: unknown; seq?: unknown; data?: unknown }

export class MediaRelay {
  private catalog = new Map<string, { size: number; type: string }>();
  private allowed: string[] = [];
  private teachers = new Set<string>();               // sources holding the whole lesson
  private holders = new Map<string, Set<string>>();    // hash → students that have it
  private wants = new Map<string, Set<string>>();      // hash → students waiting for it
  private transfers = new Map<string, Transfer>();
  private busy = new Set<string>();                    // sources currently sending
  private distrusted = new Map<string, Set<string>>(); // hash → sources that sent garbage
  readonly stats = new Map<string, LinkStats>();
  private pumpTimer: NodeJS.Timeout | null = null;

  constructor(private io: Server, private label: string) {}

  /** A new lesson file (or none): everything in flight is about the old one */
  setCatalog(catalog: Map<string, { size: number; type: string }>) {
    for (const t of [...this.transfers.values()]) this.abort(t, 'lesson changed');
    this.catalog = catalog;
    this.allowed = [];
    this.teachers.clear();
    this.holders.clear();
    this.wants.clear();
    this.distrusted.clear();
  }

  /** What students may receive now, most urgent first; wants for anything else are dropped */
  setAllowed(hashes: string[]) {
    this.allowed = hashes.filter(h => this.catalog.has(h));
    const ok = new Set(this.allowed);
    for (const h of [...this.wants.keys()]) if (!ok.has(h)) this.wants.delete(h);
    this.schedulePump();
  }

  /** The teacher's browser has the lesson file open and can send any of its media */
  addTeacher(socketId: string) {
    this.teachers.add(socketId);
    this.schedulePump();
  }

  /** A student says it already has these files (e.g. after a reconnect). Not trusted blindly: checked when it sends. */
  addHoldings(socketId: string, hashes: unknown) {
    if (!Array.isArray(hashes)) return;
    for (const h of hashes.slice(0, 1000)) if (typeof h === 'string' && this.catalog.has(h)) this.holderSet(h).add(socketId);
    this.schedulePump();
  }

  want(socketId: string, hashes: unknown) {
    if (!Array.isArray(hashes)) return;
    const ok = new Set(this.allowed);
    for (const h of hashes.slice(0, 200)) {
      if (typeof h !== 'string' || !ok.has(h)) continue; // hidden or not current — not yours yet
      if (this.holders.get(h)?.has(socketId) || this.receiving(socketId, h)) continue;
      let w = this.wants.get(h);
      if (!w) this.wants.set(h, (w = new Set()));
      w.add(socketId);
    }
    this.schedulePump();
  }

  /** Socket gone: forget it everywhere; transfers it was sending fail over to another source */
  removePeer(socketId: string) {
    this.teachers.delete(socketId);
    this.stats.delete(socketId);
    for (const set of this.holders.values()) set.delete(socketId);
    for (const set of this.wants.values()) set.delete(socketId);
    for (const t of [...this.transfers.values()]) {
      if (t.source === socketId) this.abort(t, 'source left');
      else if (t.receivers.delete(socketId)) this.afterReceiverChange(t);
    }
    this.schedulePump();
  }

  /** A piece of a file from a source; `ack` is the go-ahead for the next one */
  onChunk(socketId: string, msg: ChunkMsg, ack: (r: { go?: boolean; stop?: boolean }) => void) {
    const t = typeof msg?.tid === 'string' ? this.transfers.get(msg.tid) : undefined;
    if (!t || t.source !== socketId || t.done) { ack({ stop: true }); return; }
    const data = msg.data;
    if (!Buffer.isBuffer(data) || msg.seq !== t.seq || data.length === 0 || data.length > CHUNK || t.bytes + data.length > t.size) {
      ack({ stop: true });
      this.abort(t, 'malformed chunk');
      return;
    }
    const now = Date.now();
    this.measure(socketId, 'up', data.length, now - t.askedAt);
    t.hasher.update(data);
    t.bytes += data.length;
    const seq = t.seq++;
    const last = t.bytes === t.size;
    if (last && t.hasher.digest('hex') !== t.hash) {
      ack({ stop: true });
      this.distrust(t.hash, socketId);
      this.abort(t, 'hash mismatch');
      return;
    }

    for (const [rid, r] of [...t.receivers]) {
      const sock = this.io.sockets.sockets.get(rid);
      if (!sock) { t.receivers.delete(rid); continue; }
      r.inFlight++;
      const sentAt = Date.now();
      sock.timeout(RECEIVER_ACK_TIMEOUT_MS).emit('media:chunk', { hash: t.hash, seq, data, last }, (err: Error | null) => {
        this.onReceiverAck(t, rid, data.length, sentAt, err);
      });
    }

    if (last) {
      ack({ stop: true }); // nothing more to send
      this.finishSending(t);
      return;
    }
    if (t.receivers.size === 0) { ack({ stop: true }); this.abort(t, 'no receivers left'); return; }
    t.release = ack;
    this.tryRelease(t);
  }

  // ---------- internals ----------

  private holderSet(hash: string) {
    let s = this.holders.get(hash);
    if (!s) this.holders.set(hash, (s = new Set()));
    return s;
  }

  private receiving(socketId: string, hash: string) {
    for (const t of this.transfers.values()) if (t.hash === hash && t.receivers.has(socketId)) return true;
    return false;
  }

  private measure(socketId: string, dir: 'up' | 'down', bytes: number, ms: number) {
    if (bytes < 16 * 1024) return; // too small to say anything about the link
    const bps = (bytes * 1000) / Math.max(ms, 5);
    const s = this.stats.get(socketId) ?? {};
    const prev = s[dir];
    const fresh = prev && Date.now() - prev.at < STATS_FRESH_MS;
    s[dir] = { bps: fresh ? prev.bps * (1 - EWMA) + bps * EWMA : bps, at: Date.now() };
    this.stats.set(socketId, s);
  }

  private upScore(socketId: string) {
    const up = this.stats.get(socketId)?.up;
    return up && Date.now() - up.at < STATS_FRESH_MS ? up.bps : DEFAULT_UP_BPS;
  }

  private distrust(hash: string, socketId: string) {
    let s = this.distrusted.get(hash);
    if (!s) this.distrusted.set(hash, (s = new Set()));
    s.add(socketId);
    this.holders.get(hash)?.delete(socketId);
    console.warn(`[${this.label}] ${socketId} sent a wrong file for ${hash.slice(0, 8)}`);
  }

  private pickSource(hash: string, receivers: Set<string>): string | null {
    const bad = this.distrusted.get(hash);
    const able = (id: string) => !receivers.has(id) && !bad?.has(id) && this.io.sockets.sockets.has(id);
    const students = [...(this.holders.get(hash) ?? [])].filter(able);
    // A classmate has it: wait for one to be free rather than load the teacher's connection
    if (students.length) return students.filter(id => !this.busy.has(id)).sort((a, b) => this.upScore(b) - this.upScore(a))[0] ?? null;
    return [...this.teachers].find(id => able(id) && !this.busy.has(id)) ?? null;
  }

  private schedulePump() {
    if (this.pumpTimer) return;
    this.pumpTimer = setTimeout(() => { this.pumpTimer = null; this.pump(); }, PUMP_DELAY_MS);
  }

  private pump() {
    for (const hash of this.allowed) {
      const waiting = this.wants.get(hash);
      if (!waiting?.size) continue;
      for (const id of waiting) if (!this.io.sockets.sockets.has(id)) waiting.delete(id);
      // one transfer per file at a time; whoever comes late is served after it, by a fresh holder
      if (!waiting.size || [...this.transfers.values()].some(t => t.hash === hash)) continue;
      const source = this.pickSource(hash, waiting);
      if (!source) continue; // nobody can send it yet (e.g. teacher hasn't opened the file)
      this.wants.delete(hash);
      this.start(hash, source, waiting);
    }
  }

  private start(hash: string, source: string, receivers: Set<string>) {
    const info = this.catalog.get(hash)!;
    const t: Transfer = {
      id: crypto.randomBytes(9).toString('base64url'), hash, size: info.size, type: info.type, source,
      receivers: new Map([...receivers].map(id => [id, { inFlight: 0, acked: 0 }])),
      seq: 0, bytes: 0, hasher: crypto.createHash('sha256'),
      release: null, askedAt: Date.now(), sourceTimer: null, stallTimer: null, done: false,
    };
    this.transfers.set(t.id, t);
    this.busy.add(source);
    for (const id of receivers) this.io.sockets.sockets.get(id)?.emit('media:begin', { hash, size: t.size, type: t.type });
    this.io.sockets.sockets.get(source)?.emit('media:send', { tid: t.id, hash, chunk: CHUNK });
    this.armSourceTimer(t);
  }

  private armSourceTimer(t: Transfer) {
    if (t.sourceTimer) clearTimeout(t.sourceTimer);
    t.sourceTimer = setTimeout(() => this.abort(t, 'source too slow'), SOURCE_TIMEOUT_MS);
  }

  /** Let the source send the next piece once nobody has a full window; drop whoever stalls */
  private tryRelease(t: Transfer) {
    if (!t.release || t.done) return;
    const blocking = [...t.receivers].filter(([, r]) => r.inFlight >= WINDOW).map(([id]) => id);
    if (blocking.length === 0) {
      if (t.stallTimer) { clearTimeout(t.stallTimer); t.stallTimer = null; }
      const go = t.release;
      t.release = null;
      t.askedAt = Date.now();
      this.armSourceTimer(t);
      go({ go: true });
      return;
    }
    if (t.stallTimer) return;
    t.stallTimer = setTimeout(() => {
      t.stallTimer = null;
      for (const [id, r] of [...t.receivers]) {
        if (r.inFlight < WINDOW) continue;
        t.receivers.delete(id);
        this.io.sockets.sockets.get(id)?.emit('media:abort', { hash: t.hash, reason: 'slow' });
      }
      this.afterReceiverChange(t);
    }, RECEIVER_STALL_MS);
  }

  private afterReceiverChange(t: Transfer) {
    if (t.done) return;
    if (t.receivers.size === 0 && t.bytes < t.size) { this.abort(t, 'no receivers left'); return; }
    this.tryRelease(t);
  }

  private onReceiverAck(t: Transfer, rid: string, bytes: number, sentAt: number, err: Error | null) {
    const r = t.receivers.get(rid);
    if (!r) return; // dropped meanwhile
    if (err) { // never confirmed — treat as gone
      t.receivers.delete(rid);
      this.io.sockets.sockets.get(rid)?.emit('media:abort', { hash: t.hash, reason: 'timeout' });
      this.afterReceiverChange(t);
      return;
    }
    r.inFlight--;
    r.acked += bytes;
    this.measure(rid, 'down', bytes, Date.now() - sentAt);
    if (r.acked >= t.size) {
      t.receivers.delete(rid);
      this.holderSet(t.hash).add(rid); // can now serve it to others
      this.schedulePump();
      return;
    }
    this.tryRelease(t);
  }

  /** The source sent everything (receivers may still be acking the last pieces) */
  private finishSending(t: Transfer) {
    t.done = true;
    this.clearTimers(t);
    this.transfers.delete(t.id);
    this.busy.delete(t.source);
    this.schedulePump();
  }

  private abort(t: Transfer, reason: string) {
    if (t.done) return;
    t.done = true;
    this.clearTimers(t);
    t.release?.({ stop: true });
    t.release = null;
    this.transfers.delete(t.id);
    this.busy.delete(t.source);
    for (const id of t.receivers.keys()) this.io.sockets.sockets.get(id)?.emit('media:abort', { hash: t.hash, reason });
    t.receivers.clear();
    if (reason !== 'lesson changed') console.log(`[${this.label}] transfer of ${t.hash.slice(0, 8)} aborted: ${reason}`);
    this.schedulePump();
  }

  private clearTimers(t: Transfer) {
    if (t.sourceTimer) clearTimeout(t.sourceTimer);
    if (t.stallTimer) clearTimeout(t.stallTimer);
    t.sourceTimer = t.stallTimer = null;
  }

  /** Close everything (lesson dropped) */
  dispose() {
    this.setCatalog(new Map());
    if (this.pumpTimer) clearTimeout(this.pumpTimer);
    this.pumpTimer = null;
  }
}

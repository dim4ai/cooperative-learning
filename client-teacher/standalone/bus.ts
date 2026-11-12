// The standalone demo: the lesson server runs in this very tab (server/src/index.ts, built with the shims
// beside this file). Here is what stands for socket.io between them: the teacher's page holds a
// ClientSocket, the server sees a ServerSocket; whatever goes across is copied as JSON and arrives a
// moment later, as over the wire, so neither side can tell.

/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (...args: any[]) => unknown;

const copy = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const later = (fn: () => void) => setTimeout(fn, 0);
let lastId = 0;
const newId = () => `s${++lastId}${Math.random().toString(36).slice(2, 8)}`;

class Emitter {
  protected handlers = new Map<string, Set<Handler>>();
  protected anyHandlers = new Set<Handler>();

  on(ev: string, fn: Handler) {
    let set = this.handlers.get(ev);
    if (!set) this.handlers.set(ev, (set = new Set()));
    set.add(fn);
    return this;
  }

  once(ev: string, fn: Handler) {
    const once: Handler = (...a) => { this.off(ev, once); return fn(...a); };
    return this.on(ev, once);
  }

  off(ev?: string, fn?: Handler) {
    if (ev === undefined) { this.handlers.clear(); this.anyHandlers.clear(); }
    else if (fn === undefined) this.handlers.delete(ev);
    else this.handlers.get(ev)?.delete(fn);
    return this;
  }

  onAny(fn: Handler) { this.anyHandlers.add(fn); return this; }

  protected fire(ev: string, args: unknown[]) {
    for (const fn of [...this.anyHandlers]) fn(ev, ...args);
    for (const fn of [...(this.handlers.get(ev) ?? [])]) fn(...args);
  }
}

/** Splits off a trailing callback (an acknowledgement) and copies the rest */
function packed(args: unknown[]): { data: unknown[]; ack: Handler | null } {
  const ack = typeof args[args.length - 1] === 'function' ? (args[args.length - 1] as Handler) : null;
  return { data: copy(ack ? args.slice(0, -1) : args), ack };
}

export class ServerSocket extends Emitter {
  readonly id = newId();
  readonly handshake: { auth: Record<string, unknown>; headers: Record<string, string>; address: string; query: Record<string, string> };
  readonly rooms = new Set<string>();
  readonly data: Record<string, unknown> = {};
  disconnected = false;
  get connected() { return !this.disconnected; }
  // socket.io's engine: the recording tap wraps it; nothing goes through it here
  readonly client = { writeToEngine: (_packets: unknown[], _opts: unknown) => {} };
  readonly conn = { remoteAddress: '127.0.0.1' };

  constructor(private server: Server, private peer: ClientSocket, auth: Record<string, unknown>) {
    super();
    this.handshake = { auth, headers: { 'user-agent': navigator.userAgent }, address: '127.0.0.1', query: {} };
  }

  join(room: string | string[]) { for (const r of ([] as string[]).concat(room)) { this.rooms.add(r); this.server.roomSet(r).add(this.id); } }

  leave(room: string) { this.rooms.delete(room); this.server.sockets.adapter.rooms.get(room)?.delete(this.id); }

  emit(ev: string, ...args: unknown[]) {
    if (this.disconnected) return true;
    const { data } = packed(args);
    later(() => this.peer.receive(ev, data));
    return true;
  }

  to(room: string) { return this.server.toRooms([room], this.id); }
  in(room: string) { return this.to(room); }
  get broadcast() { return { emit: (ev: string, ...args: unknown[]) => this.server.everyone(ev, args, this.id) }; }

  /** From the teacher's page */
  receive(ev: string, data: unknown[], ack: Handler | null) {
    if (this.disconnected) return;
    this.fire(ev, ack ? [...data, (...reply: unknown[]) => { const r = copy(reply); later(() => ack(...r)); }] : data);
  }

  disconnect(_close?: boolean) {
    this.drop('server namespace disconnect');
    later(() => this.peer.dropped('io server disconnect'));
    return this;
  }

  /** Gone, whichever side ended it */
  drop(reason: string) {
    if (this.disconnected) return;
    this.disconnected = true;
    for (const r of [...this.rooms]) this.leave(r);
    this.server.sockets.sockets.delete(this.id);
    later(() => this.fire('disconnect', [reason]));
  }
}

export class Server extends Emitter {
  readonly sockets = { sockets: new Map<string, ServerSocket>(), adapter: { rooms: new Map<string, Set<string>>() } };

  constructor(_http?: unknown, _opts?: unknown) {
    super();
    current = this;
  }

  roomSet(room: string) {
    let set = this.sockets.adapter.rooms.get(room);
    if (!set) this.sockets.adapter.rooms.set(room, (set = new Set()));
    return set;
  }

  toRooms(rooms: string[], except?: string) {
    const chain = {
      to: (room: string) => this.toRooms([...rooms, room], except),
      in: (room: string) => this.toRooms([...rooms, room], except),
      emit: (ev: string, ...args: unknown[]) => {
        const ids = new Set(rooms.flatMap(r => [...(this.sockets.adapter.rooms.get(r) ?? [])]));
        for (const id of ids) if (id !== except) this.sockets.sockets.get(id)?.emit(ev, ...args);
        return true;
      },
    };
    return chain;
  }

  to(room: string) { return this.toRooms([room]); }
  in(room: string) { return this.to(room); }

  everyone(ev: string, args: unknown[], except?: string) {
    for (const s of this.sockets.sockets.values()) if (s.id !== except) s.emit(ev, ...args);
    return true;
  }

  emit(ev: string, ...args: unknown[]) { return this.everyone(ev, args); }

  /** A page connects */
  accept(peer: ClientSocket, auth: Record<string, unknown>): ServerSocket {
    const s = new ServerSocket(this, peer, copy(auth));
    this.sockets.sockets.set(s.id, s);
    s.join(s.id);
    later(() => this.fire('connection', [s]));
    return s;
  }
}

let current: Server | null = null;

export class ClientSocket extends Emitter {
  id = '';
  connected = false;
  get disconnected() { return !this.connected; }
  private peer: ServerSocket | null = null;
  private waiting: { ev: string; args: unknown[] }[] = []; // sent before connecting: goes once connected, as socket.io does
  readonly io = { on: () => {}, off: () => {}, opts: {} };

  constructor(private auth: (cb: (a: Record<string, unknown>) => void) => void) { super(); }

  connect() {
    if (this.connected || this.peer) return this;
    this.auth(a => {
      if (!current) { console.error('standalone: no lesson server in this page'); return; }
      const peer = current.accept(this, a);
      this.peer = peer;
      this.id = peer.id;
      later(() => {
        if (this.peer !== peer) return;
        this.connected = true;
        this.fire('connect', []);
        for (const { ev, args } of this.waiting.splice(0)) this.send(ev, args);
      });
    });
    return this;
  }

  open() { return this.connect(); }

  emit(ev: string, ...args: unknown[]) {
    if (!this.connected) { this.waiting.push({ ev, args }); return this; }
    this.send(ev, args);
    return this;
  }

  private send(ev: string, args: unknown[]) {
    const peer = this.peer;
    const { data, ack } = packed(args);
    later(() => peer?.receive(ev, data, ack));
  }

  disconnect() {
    const peer = this.peer;
    this.peer = null;
    this.waiting = [];
    if (!peer) return this;
    peer.drop('client namespace disconnect');
    if (this.connected) { this.connected = false; later(() => this.fire('disconnect', ['io client disconnect'])); }
    return this;
  }

  close() { return this.disconnect(); }

  /** From the server */
  receive(ev: string, data: unknown[]) { if (this.connected || this.peer) this.fire(ev, copy(data)); }

  dropped(reason: string) {
    this.peer = null;
    if (!this.connected) return;
    this.connected = false;
    this.fire('disconnect', [reason]);
  }
}

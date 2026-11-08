// WebSocket to the signaling server. Only used to find the other side and
// swap WebRTC descriptions; reconnects on its own if the socket drops.

export type PeerInfo = { id: string; role: string; name: string; teacher: boolean }

type Events = {
  joined: (id: string, peers: PeerInfo[], iceServers: RTCIceServer[]) => void
  peerJoined: (peer: PeerInfo) => void
  peerLeft: (id: string) => void
  signal: (from: string, data: unknown) => void
  full: () => void
  badKey: () => void
  offline: () => void
}

export class Signaling {
  private ws: WebSocket | null = null
  private retry = 0
  private stopped = false

  constructor(
    private room: string,
    private role: 'main' | 'cam',
    private name: string,
    private key: string | null,
    private on: Events,
  ) {
    this.open()
  }

  private open() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${location.host}/ws`)
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      ws.send(JSON.stringify({ t: 'join', room: this.room, role: this.role, name: this.name, ...(this.key ? { key: this.key } : {}) }))
    }
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.t === 'joined') this.on.joined(msg.id, msg.peers.map((p: PeerInfo) => ({ ...p, teacher: !!p.teacher })), Array.isArray(msg.iceServers) ? msg.iceServers : [])
      else if (msg.t === 'peer-joined') this.on.peerJoined({ id: msg.id, role: msg.role, name: msg.name, teacher: !!msg.teacher })
      else if (msg.t === 'peer-left') this.on.peerLeft(msg.id)
      else if (msg.t === 'signal') this.on.signal(msg.from, msg.data)
      else if (msg.t === 'error' && msg.error === 'bad key') {
        this.stopped = true
        this.on.badKey()
      } else if (msg.t === 'full') {
        this.stopped = true
        this.on.full()
      }
    }
    ws.onclose = () => {
      if (this.stopped) return
      this.on.offline()
      const delay = Math.min(15000, 1000 * 2 ** this.retry++)
      setTimeout(() => !this.stopped && this.open(), delay)
    }
  }

  send(to: string, data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ t: 'signal', to, data }))
  }

  close() {
    this.stopped = true
    this.ws?.close()
  }
}

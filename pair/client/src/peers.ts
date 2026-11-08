// Direct WebRTC links to every other participant ("perfect negotiation":
// either side may start, collisions resolve themselves). No TURN on purpose —
// see the server's header comment.

import { Signaling, type PeerInfo } from './signaling'
import { JsonChannel } from './channel'

const CONNECT_TIMEOUT_MS = 15000

export type LinkState = 'connecting' | 'connected' | 'failed'

export type PeerEvents = {
  state: (peer: PeerInfo, state: LinkState) => void
  stream: (peer: PeerInfo, stream: MediaStream) => void
  channelOpen: (peer: PeerInfo, ch: JsonChannel) => void
  message: (peer: PeerInfo, msg: any) => void
  gone: (peer: PeerInfo) => void
}

class PeerLink {
  readonly pc: RTCPeerConnection
  readonly channel: JsonChannel
  private makingOffer = false
  private ignoreOffer = false
  private timer: number
  private restarted = false
  /** set once a remote description has been applied; until then only the initiator may offer */
  private negotiated = false

  constructor(
    readonly peer: PeerInfo,
    private polite: boolean,
    /** the newcomer makes the first offer; the other side waits for it, so the first offers never collide */
    private initiator: boolean,
    private sig: Signaling,
    local: MediaStream | null,
    iceServers: RTCIceServer[],
    private on: PeerEvents,
  ) {
    // STUN addresses come from the server's .env with the 'joined' message, never from the code
    const pc = new RTCPeerConnection({ iceServers })
    this.pc = pc
    // negotiated: both sides create the same channel, no need to wait for ondatachannel
    const dc = pc.createDataChannel('board', { negotiated: true, id: 0, ordered: true })
    this.channel = new JsonChannel(dc, (msg) => on.message(peer, msg))
    dc.addEventListener('open', () => on.channelOpen(peer, this.channel))

    if (peer.role === 'cam') {
      // a notebook camera: the phone sends its picture (local), the computer only receives it (no local)
      if (!local) pc.addTransceiver('video', { direction: 'recvonly' })
      else for (const track of local.getVideoTracks()) pc.addTrack(track, local)
    } else if (local) for (const track of local.getTracks()) pc.addTrack(track, local)
    else {
      // still ask for the other side's camera and microphone
      pc.addTransceiver('audio', { direction: 'recvonly' })
      pc.addTransceiver('video', { direction: 'recvonly' })
    }

    pc.ontrack = ({ streams }) => streams[0] && on.stream(peer, streams[0])
    pc.onicecandidate = ({ candidate }) => sig.send(peer.id, { candidate })
    pc.onnegotiationneeded = async () => {
      // the browser asks again once the first exchange is done, if anything is still left to negotiate
      if (!this.initiator && !this.negotiated) return
      try {
        this.makingOffer = true
        await pc.setLocalDescription()
        sig.send(peer.id, { description: pc.localDescription })
      } catch (e) {
        console.warn('negotiation', e)
      } finally {
        this.makingOffer = false
      }
    }
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState
      if (s === 'connected') {
        clearTimeout(this.timer)
        on.state(peer, 'connected')
      } else if (s === 'failed') {
        if (!this.restarted) {
          this.restarted = true
          pc.restartIce()
          this.armTimeout()
        } else on.state(peer, 'failed')
      } else if (s === 'disconnected' || s === 'connecting') on.state(peer, 'connecting')
    }
    on.state(peer, 'connecting')
    this.timer = 0
    this.armTimeout()
  }

  private armTimeout() {
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => {
      if (this.pc.connectionState !== 'connected') this.on.state(this.peer, 'failed')
    }, CONNECT_TIMEOUT_MS)
  }

  private inbox: Promise<void> = Promise.resolve()

  /** Signals are applied strictly in arrival order: a candidate must not overtake its description. */
  signal(data: any) {
    this.inbox = this.inbox.then(() => this.handle(data))
  }

  private async handle(data: any) {
    const pc = this.pc
    try {
      if (data.description) {
        const d = data.description as RTCSessionDescriptionInit
        const collision = d.type === 'offer' && (this.makingOffer || pc.signalingState !== 'stable')
        this.ignoreOffer = !this.polite && collision
        if (this.ignoreOffer) return
        await pc.setRemoteDescription(d)
        this.negotiated = true
        if (d.type === 'offer') {
          await pc.setLocalDescription()
          this.sig.send(this.peer.id, { description: pc.localDescription })
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate)
        } catch (e) {
          if (!this.ignoreOffer) throw e
        }
      }
    } catch (e) {
      console.warn('signal', e)
    }
  }

  close() {
    clearTimeout(this.timer)
    this.pc.close()
  }
}

export class Peers {
  readonly links = new Map<string, PeerLink>()
  private myId = ''
  private iceServers: RTCIceServer[] = []
  private sig: Signaling

  constructor(
    room: string,
    name: string,
    key: string | null,
    private local: MediaStream | null,
    private on: PeerEvents & { waiting: () => void; full: () => void; badKey: () => void; offline: () => void },
    /** 'cam': a phone that only sends its camera to the people in the lesson */
    private role: 'main' | 'cam' = 'main',
  ) {
    this.sig = new Signaling(room, role, name, key, {
      joined: (id, peers, iceServers) => {
        this.iceServers = iceServers
        // after a reconnect we get a new id: old links are dead
        for (const l of this.links.values()) this.drop(l.peer.id)
        this.myId = id
        if (!peers.some((p) => this.wants(p))) on.waiting()
        for (const p of peers) if (this.wants(p)) this.link(p, true)
      },
      peerJoined: (p) => this.wants(p) && this.link(p, false),
      peerLeft: (id) => {
        this.drop(id)
        if (this.links.size === 0) on.waiting()
      },
      signal: (from, data) => this.links.get(from)?.signal(data),
      full: () => on.full(),
      badKey: () => on.badKey(),
      offline: () => on.offline(),
    })
  }

  /** people link with everyone; a phone camera only with people, never with another phone */
  private wants(p: PeerInfo) {
    return this.role === 'main' || p.role === 'main'
  }

  private link(p: PeerInfo, initiator: boolean) {
    this.drop(p.id)
    // a phone's link is described by the phone's role, so both ends set it up the same way
    const peer = this.role === 'cam' ? { ...p, role: 'cam' } : p
    // nothing of ours goes to a phone: it only shows its own picture
    const local = this.role === 'main' && p.role === 'cam' ? null : this.local
    const link = new PeerLink(peer, this.myId > p.id, initiator, this.sig, local, this.iceServers, this.on)
    this.links.set(p.id, link)
  }

  private drop(id: string) {
    const l = this.links.get(id)
    if (!l) return
    l.close()
    this.links.delete(id)
    this.on.gone(l.peer)
  }

  /** the board goes only to people; phone cameras don't need it */
  private people() {
    return [...this.links.values()].filter((l) => l.peer.role !== 'cam')
  }

  broadcast(msg: unknown) {
    for (const l of this.people()) l.channel.send(msg)
  }

  broadcastVolatile(msg: unknown) {
    for (const l of this.people()) l.channel.sendVolatile(msg)
  }

  leave() {
    for (const id of [...this.links.keys()]) this.drop(id)
    this.sig.close()
  }
}

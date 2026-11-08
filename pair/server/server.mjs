// Signaling-only server for one-on-one lessons.
//
// It does exactly one job: lets the browsers in a room find each other and
// exchange WebRTC offers/answers/ICE candidates. Video, audio and the board go
// directly between the browsers; nothing heavy ever passes through here, so a
// misbehaving client can cost us a few kilobytes, not bandwidth.
// There is deliberately no TURN relay: if two browsers can't reach each other
// directly, the client tells the user so instead of us paying for their traffic.

import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer } from 'ws'

const PORT = Number(process.env.PORT ?? 13119)
const HOST = process.env.HOST ?? '127.0.0.1'

export const LIMITS = {
  maxPayload: 64 * 1024, // an SDP offer is a few KB; anything bigger is not signaling
  roomSize: 4, // two people, plus a phone camera each later
  maxRooms: 5000,
  maxSockets: 10000,
  socketsPerIp: 12,
  connectsPerIpPerMinute: 30,
  msgsPerSecond: 30, // token bucket per socket; ICE trickle bursts fit comfortably
  msgsBurst: 120,
  roomTtlMs: 12 * 60 * 60 * 1000, // nobody holds a lesson for 12 hours
  pingMs: 30_000,
}

const ROOM_RE = /^[a-z0-9]{6,32}$/
const ROLES = new Set(['main', 'cam'])

export function createServer({ log = console.log, iceServers = [] } = {}) {
  /** @type {Map<string, {peers: Map<string, any>, created: number}>} */
  const rooms = new Map()
  /** @type {Map<string, number>} */
  const socketsByIp = new Map()
  /** @type {Map<string, number[]>} */
  const connectTimes = new Map()

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, sockets: wss.clients.size }))
      return
    }
    res.writeHead(404).end()
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: LIMITS.maxPayload, perMessageDeflate: false })

  // nginx overwrites X-Real-IP with the real client address; only trust it from nginx itself
  function clientIp(req) {
    const remote = req.socket.remoteAddress ?? ''
    const local = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1'
    const header = req.headers['x-real-ip']
    return local && typeof header === 'string' && header ? header : remote
  }

  function admit(ip) {
    if (wss.clients.size >= LIMITS.maxSockets) return 'server busy'
    if ((socketsByIp.get(ip) ?? 0) >= LIMITS.socketsPerIp) return 'too many connections'
    const now = Date.now()
    const recent = (connectTimes.get(ip) ?? []).filter((t) => now - t < 60_000)
    if (recent.length >= LIMITS.connectsPerIpPerMinute) return 'too many connections'
    recent.push(now)
    connectTimes.set(ip, recent)
    return null
  }

  httpServer.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/ws')) return socket.destroy()
    const ip = clientIp(req)
    const refused = admit(ip)
    if (refused) {
      socket.end(`HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\n\r\n`)
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, ip))
  })

  function send(ws, msg) {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
  }

  function leave(ws) {
    const room = ws.room && rooms.get(ws.room)
    if (!room) return
    room.peers.delete(ws.id)
    for (const other of room.peers.values()) send(other, { t: 'peer-left', id: ws.id })
    if (room.peers.size === 0) rooms.delete(ws.room)
    ws.room = null
  }

  wss.on('connection', (ws, ip) => {
    ws.id = randomUUID().slice(0, 8)
    ws.ip = ip
    ws.room = null
    ws.alive = true
    ws.tokens = LIMITS.msgsBurst
    ws.lastRefill = Date.now()
    socketsByIp.set(ip, (socketsByIp.get(ip) ?? 0) + 1)

    ws.on('pong', () => (ws.alive = true))

    ws.on('message', (raw, isBinary) => {
      const now = Date.now()
      ws.tokens = Math.min(LIMITS.msgsBurst, ws.tokens + ((now - ws.lastRefill) / 1000) * LIMITS.msgsPerSecond)
      ws.lastRefill = now
      if (--ws.tokens < 0) return ws.close(4008, 'rate limit')
      if (isBinary) return ws.close(4003, 'binary not allowed')

      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return ws.close(4003, 'bad json')
      }
      if (!msg || typeof msg !== 'object') return ws.close(4003, 'bad message')

      if (msg.t === 'join') {
        if (ws.room) return send(ws, { t: 'error', error: 'already joined' })
        if (typeof msg.room !== 'string' || !ROOM_RE.test(msg.room)) return send(ws, { t: 'error', error: 'bad room' })
        const role = ROLES.has(msg.role) ? msg.role : 'main'
        const name = typeof msg.name === 'string' ? msg.name.slice(0, 40) : ''
        let room = rooms.get(msg.room)
        if (!room) {
          if (rooms.size >= LIMITS.maxRooms) return send(ws, { t: 'error', error: 'server busy' })
          room = { peers: new Map(), created: now }
          rooms.set(msg.room, room)
        }
        if (room.peers.size >= LIMITS.roomSize) return send(ws, { t: 'full' })
        ws.role = role
        ws.name = name
        const others = [...room.peers.values()].map((p) => ({ id: p.id, role: p.role, name: p.name }))
        room.peers.set(ws.id, ws)
        ws.room = msg.room
        send(ws, { t: 'joined', id: ws.id, peers: others, iceServers })
        for (const other of room.peers.values()) {
          if (other !== ws) send(other, { t: 'peer-joined', id: ws.id, role, name })
        }
        return
      }

      if (msg.t === 'signal') {
        const room = ws.room && rooms.get(ws.room)
        const target = room?.peers.get(msg.to)
        if (!target) return
        send(target, { t: 'signal', from: ws.id, data: msg.data })
        return
      }

      if (msg.t === 'leave') return leave(ws)

      ws.close(4003, 'unknown message')
    })

    ws.on('close', () => {
      leave(ws)
      const n = (socketsByIp.get(ip) ?? 1) - 1
      if (n <= 0) socketsByIp.delete(ip)
      else socketsByIp.set(ip, n)
    })

    ws.on('error', () => {})
  })

  const sweeper = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) {
        ws.terminate()
        continue
      }
      ws.alive = false
      ws.ping()
    }
    const now = Date.now()
    for (const [code, room] of rooms) {
      if (now - room.created > LIMITS.roomTtlMs) {
        for (const ws of room.peers.values()) ws.close(4000, 'room expired')
        rooms.delete(code)
      }
    }
    for (const [ip, times] of connectTimes) {
      if (times.every((t) => now - t >= 60_000)) connectTimes.delete(ip)
    }
  }, LIMITS.pingMs)

  httpServer.on('close', () => clearInterval(sweeper))

  return {
    httpServer,
    listen(port = PORT, host = HOST) {
      return new Promise((resolve) =>
        httpServer.listen(port, host, () => {
          log(`pair signaling on ${host}:${httpServer.address().port}`)
          resolve(httpServer.address().port)
        }),
      )
    },
    close() {
      for (const ws of wss.clients) ws.terminate()
      return new Promise((resolve) => httpServer.close(resolve))
    },
  }
}

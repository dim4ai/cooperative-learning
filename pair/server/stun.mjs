// Minimal STUN server (RFC 5389, Binding only): tells a browser which public
// address and port it is seen from, so two browsers behind home routers can
// find each other. One tiny UDP packet in, one out; no media ever passes here.
// Ours because public ones (Google) are unreachable from Russia.

import dgram from 'node:dgram'

const MAGIC = 0x2112a442
const BINDING_REQUEST = 0x0001
const BINDING_SUCCESS = 0x0101
const XOR_MAPPED_ADDRESS = 0x0020
const SOFTWARE = 0x8022

export const STUN_LIMITS = {
  perIpPerSecond: 20, // a browser sends a handful per connection attempt
  burst: 40,
}

/** Builds the response for a Binding request, or null if the packet isn't one. */
export function bindingResponse(msg, address, port) {
  if (msg.length < 20 || msg.readUInt16BE(0) !== BINDING_REQUEST || msg.readUInt32BE(4) !== MAGIC) return null
  const tid = msg.subarray(8, 20)

  let family, xaddr
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address
  if (/^\d+\.\d+\.\d+\.\d+$/.test(v4)) {
    family = 0x01
    xaddr = Buffer.from(v4.split('.').map(Number))
    const cookie = Buffer.alloc(4)
    cookie.writeUInt32BE(MAGIC)
    for (let i = 0; i < 4; i++) xaddr[i] ^= cookie[i]
  } else {
    family = 0x02
    xaddr = ipv6Bytes(address)
    const key = Buffer.concat([Buffer.alloc(4), tid])
    key.writeUInt32BE(MAGIC, 0)
    for (let i = 0; i < 16; i++) xaddr[i] ^= key[i]
  }

  const attr = Buffer.alloc(4 + 4 + xaddr.length)
  attr.writeUInt16BE(XOR_MAPPED_ADDRESS, 0)
  attr.writeUInt16BE(4 + xaddr.length, 2)
  attr.writeUInt8(0, 4)
  attr.writeUInt8(family, 5)
  attr.writeUInt16BE(port ^ (MAGIC >>> 16), 6)
  xaddr.copy(attr, 8)

  const name = Buffer.from('co-learn')
  const soft = Buffer.alloc(4 + name.length)
  soft.writeUInt16BE(SOFTWARE, 0)
  soft.writeUInt16BE(name.length, 2)
  name.copy(soft, 4) // 8 bytes: already 4-aligned

  const header = Buffer.alloc(20)
  header.writeUInt16BE(BINDING_SUCCESS, 0)
  header.writeUInt16BE(attr.length + soft.length, 2)
  header.writeUInt32BE(MAGIC, 4)
  tid.copy(header, 8)
  return Buffer.concat([header, attr, soft])
}

function ipv6Bytes(addr) {
  const [head, tail = ''] = addr.split('%')[0].split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const groups = addr.includes('::') ? [...h, ...Array(8 - h.length - t.length).fill('0'), ...t] : h
  const b = Buffer.alloc(16)
  groups.forEach((g, i) => b.writeUInt16BE(parseInt(g || '0', 16), i * 2))
  return b
}

export function createStunServer({ port = 3478, log = console.log } = {}) {
  const buckets = new Map() // ip -> { tokens, last }

  function allowed(ip) {
    const now = Date.now()
    const b = buckets.get(ip) ?? { tokens: STUN_LIMITS.burst, last: now }
    b.tokens = Math.min(STUN_LIMITS.burst, b.tokens + ((now - b.last) / 1000) * STUN_LIMITS.perIpPerSecond)
    b.last = now
    buckets.set(ip, b)
    if (b.tokens < 1) return false
    b.tokens -= 1
    return true
  }

  const sweeper = setInterval(() => {
    const now = Date.now()
    for (const [ip, b] of buckets) if (now - b.last > 10_000) buckets.delete(ip)
  }, 10_000)
  sweeper.unref()

  // dual-stack socket: IPv4 clients arrive as ::ffff:a.b.c.d
  let socket = dgram.createSocket({ type: 'udp6', ipv6Only: false })
  const handle = (msg, rinfo) => {
    if (!allowed(rinfo.address)) return
    const res = bindingResponse(msg, rinfo.address, rinfo.port)
    if (res) socket.send(res, rinfo.port, rinfo.address)
  }

  return {
    listen() {
      return new Promise((resolve, reject) => {
        const bind = (s, host, fallback) => {
          s.on('message', handle)
          s.once('error', (e) => {
            if (!fallback) return reject(e)
            s.close()
            socket = dgram.createSocket('udp4')
            bind(socket, '0.0.0.0', false)
          })
          s.bind(port, host, () => {
            log(`stun on udp ${host}:${s.address().port}`)
            resolve(s.address().port)
          })
        }
        bind(socket, '::', true)
      })
    },
    close() {
      clearInterval(sweeper)
      return new Promise((resolve) => socket.close(() => resolve()))
    },
  }
}

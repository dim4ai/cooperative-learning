import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import { createServer, LIMITS } from './server.mjs'

async function withServer(fn) {
  const server = createServer({ log: () => {} })
  const port = await server.listen(0, '127.0.0.1')
  try {
    await fn(`ws://127.0.0.1:${port}/ws`, port)
  } finally {
    await server.close()
  }
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    const inbox = []
    const waiters = []
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      const i = waiters.findIndex((w) => w.pred(msg))
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg)
      else inbox.push(msg)
    })
    ws.next = (t) =>
      new Promise((res, rej) => {
        const pred = (m) => m.t === t
        const i = inbox.findIndex(pred)
        if (i >= 0) return res(inbox.splice(i, 1)[0])
        waiters.push({ pred, resolve: res })
        setTimeout(() => rej(new Error(`timeout waiting for ${t}`)), 2000)
      })
    ws.sendJson = (m) => ws.send(JSON.stringify(m))
    ws.on('open', () => resolve(ws))
    ws.on('error', reject)
  })
}

test('two peers meet and relay signals', async () => {
  await withServer(async (url) => {
    const a = await connect(url)
    a.sendJson({ t: 'join', room: 'abcdef12' })
    const ja = await a.next('joined')
    assert.deepEqual(ja.peers, [])

    const b = await connect(url)
    b.sendJson({ t: 'join', room: 'abcdef12', name: 'Ученик' })
    const jb = await b.next('joined')
    assert.equal(jb.peers.length, 1)
    assert.equal(jb.peers[0].id, ja.id)

    const pj = await a.next('peer-joined')
    assert.equal(pj.id, jb.id)
    assert.equal(pj.name, 'Ученик')

    b.sendJson({ t: 'signal', to: ja.id, data: { sdp: 'x' } })
    const sig = await a.next('signal')
    assert.equal(sig.from, jb.id)
    assert.deepEqual(sig.data, { sdp: 'x' })

    b.close()
    const left = await a.next('peer-left')
    assert.equal(left.id, jb.id)
    a.close()
  })
})

test('room is capped', async () => {
  await withServer(async (url) => {
    const peers = []
    for (let i = 0; i < LIMITS.roomSize; i++) {
      const p = await connect(url)
      p.sendJson({ t: 'join', room: 'fullroom' })
      await p.next('joined')
      peers.push(p)
    }
    const extra = await connect(url)
    extra.sendJson({ t: 'join', room: 'fullroom' })
    await extra.next('full')
    for (const p of [...peers, extra]) p.close()
  })
})

test('bad room code is rejected', async () => {
  await withServer(async (url) => {
    const p = await connect(url)
    p.sendJson({ t: 'join', room: '../etc' })
    const err = await p.next('error')
    assert.equal(err.error, 'bad room')
    p.close()
  })
})

test('signals do not cross rooms', async () => {
  await withServer(async (url) => {
    const a = await connect(url)
    a.sendJson({ t: 'join', room: 'roomaaaa' })
    const ja = await a.next('joined')
    const b = await connect(url)
    b.sendJson({ t: 'join', room: 'roombbbb' })
    await b.next('joined')
    b.sendJson({ t: 'signal', to: ja.id, data: 'hi' })
    await assert.rejects(a.next('signal'))
    a.close()
    b.close()
  })
})

test('flooding closes the socket', async () => {
  await withServer(async (url) => {
    const p = await connect(url)
    const closed = new Promise((res) => p.on('close', (code) => res(code)))
    for (let i = 0; i < LIMITS.msgsBurst + 50; i++) p.sendJson({ t: 'leave' })
    assert.equal(await closed, 4008)
  })
})

test('oversized message closes the socket', async () => {
  await withServer(async (url) => {
    const p = await connect(url)
    const closed = new Promise((res) => p.on('close', (code) => res(code)))
    p.sendJson({ t: 'signal', to: 'x', data: 'a'.repeat(LIMITS.maxPayload + 10) })
    assert.equal(await closed, 1009)
  })
})

test('too many sockets from one ip are refused', async () => {
  await withServer(async (url) => {
    const open = []
    for (let i = 0; i < LIMITS.socketsPerIp; i++) open.push(await connect(url))
    await assert.rejects(connect(url))
    for (const p of open) p.close()
  })
})

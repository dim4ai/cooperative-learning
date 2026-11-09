import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import { createServer, LIMITS, FEEDBACK, roomFromKey } from './server.mjs'
import { feedbackMailer } from './mailer.mjs'

async function withServer(fn, opts = {}) {
  const server = createServer({ log: () => {}, ...opts })
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

import dgram from 'node:dgram'
import { createStunServer, bindingResponse, STUN_LIMITS } from './stun.mjs'

function bindingRequest() {
  const b = Buffer.alloc(20)
  b.writeUInt16BE(0x0001, 0)
  b.writeUInt32BE(0x2112a442, 4)
  for (let i = 8; i < 20; i++) b[i] = (Math.random() * 256) | 0
  return b
}

function parseXorMapped(res) {
  let off = 20
  while (off < res.length) {
    const type = res.readUInt16BE(off)
    const len = res.readUInt16BE(off + 2)
    if (type === 0x0020) {
      const port = res.readUInt16BE(off + 6) ^ 0x2112
      const ip = [0, 1, 2, 3].map((i) => res[off + 8 + i] ^ [0x21, 0x12, 0xa4, 0x42][i]).join('.')
      return { ip, port }
    }
    off += 4 + len + ((4 - (len % 4)) % 4)
  }
}

test('stun answers with the address the request came from', async () => {
  const stun = createStunServer({ port: 0, log: () => {} })
  const port = await stun.listen()
  const client = dgram.createSocket('udp4')
  await new Promise((r) => client.bind(0, '127.0.0.1', r))
  const req = bindingRequest()
  const res = await new Promise((resolve, reject) => {
    client.once('message', resolve)
    client.send(req, port, '127.0.0.1')
    setTimeout(() => reject(new Error('no stun answer')), 2000)
  })
  assert.equal(res.readUInt16BE(0), 0x0101)
  assert.deepEqual(res.subarray(8, 20), req.subarray(8, 20))
  assert.deepEqual(parseXorMapped(res), { ip: '127.0.0.1', port: client.address().port })
  client.close()
  await stun.close()
})

test('stun ignores garbage and rate-limits per ip', async () => {
  assert.equal(bindingResponse(Buffer.from('hello world, not stun'), '1.2.3.4', 5), null)
  const stun = createStunServer({ port: 0, log: () => {} })
  const port = await stun.listen()
  const client = dgram.createSocket('udp4')
  let answers = 0
  client.on('message', () => answers++)
  await new Promise((r) => client.bind(0, '127.0.0.1', r))
  for (let i = 0; i < STUN_LIMITS.burst * 3; i++) client.send(bindingRequest(), port, '127.0.0.1')
  await new Promise((r) => setTimeout(r, 300))
  assert.ok(answers >= STUN_LIMITS.burst && answers < STUN_LIMITS.burst + 15, `answers: ${answers}`)
  client.close()
  await stun.close()
})

test('stun encodes ipv6 addresses', () => {
  const req = bindingRequest()
  const res = bindingResponse(req, '2001:db8::1', 40000)
  assert.equal(res.readUInt8(20 + 5), 0x02)
  assert.equal(res.readUInt16BE(20 + 2), 20)
})

test('teacher is recognised by the key, never by the bare code', async () => {
  await withServer(async (url) => {
    const key = 'k3y0fth3t3ach3rabcdef'
    const room = roomFromKey(key)
    assert.match(room, /^[23456789abcdefghjkmnpqrstuvwxyz]{12}$/)

    const t = await connect(url)
    t.sendJson({ t: 'join', room, key, name: 'Учитель' })
    const jt = await t.next('joined')
    assert.equal(jt.teacher, true)

    const s = await connect(url)
    s.sendJson({ t: 'join', room, name: 'Ученик' })
    const js = await s.next('joined')
    assert.equal(js.teacher, false)
    assert.equal(js.peers[0].teacher, true)
    const pj = await t.next('peer-joined')
    assert.equal(pj.teacher, false)

    // a wrong key for this room is refused
    const fake = await connect(url)
    fake.sendJson({ t: 'join', room, key: 'notthekeynotthekey00' })
    assert.equal((await fake.next('error')).error, 'bad key')
    for (const p of [t, s, fake]) p.close()
  })
})

test('feedback goes to the mailer cleaned, a few letters an hour per address', async () => {
  const letters = []
  await withServer(
    async (url) => {
      const ws = await connect(url)
      ws.sendJson({ t: 'feedback', kind: 'bug', text: '  Доска не грузится\r\nвторая строка ', contact: 'a@b.ru\nBcc: x@y.z', where: 'занятие, учитель' })
      assert.equal((await ws.next('feedback')).ok, true)
      assert.deepEqual(letters[0], { kind: 'bug', text: 'Доска не грузится\nвторая строка', contact: 'a@b.ru Bcc: x@y.z', where: 'занятие, учитель', ua: '', pics: [] })

      ws.sendJson({ t: 'feedback', kind: 'spam', text: 'hello' })
      assert.equal((await ws.next('feedback')).error, 'bad kind')
      ws.sendJson({ t: 'feedback', kind: 'idea', text: ' ' })
      assert.equal((await ws.next('feedback')).error, 'empty')
      for (let i = 1; i < FEEDBACK.perIpPerHour; i++) {
        ws.sendJson({ t: 'feedback', kind: 'other', text: `спасибо ${i}` })
        assert.equal((await ws.next('feedback')).ok, true)
      }
      ws.sendJson({ t: 'feedback', kind: 'other', text: 'ещё одно' })
      assert.equal((await ws.next('feedback')).error, 'too many')
      assert.equal(letters.length, FEEDBACK.perIpPerHour)
      ws.close()
    },
    { feedback: async (l) => void letters.push(l) },
  )
})

test('feedback without mail set up says so, and a failed send is reported', async () => {
  await withServer(async (url) => {
    const ws = await connect(url)
    ws.sendJson({ t: 'feedback', kind: 'idea', text: 'добавьте чат' })
    assert.equal((await ws.next('feedback')).error, 'not configured')
    ws.close()
  })
  await withServer(
    async (url) => {
      const ws = await connect(url)
      ws.sendJson({ t: 'feedback', kind: 'idea', text: 'добавьте чат' })
      assert.equal((await ws.next('feedback')).error, 'not sent')
      ws.close()
    },
    { feedback: async () => { throw new Error('smtp down') } },
  )
  assert.equal(feedbackMailer({ SMTP_HOST: 'h', SMTP_USER: 'u', SMTP_PASS: 'p' }, () => {}), null)
})

test('feedback pictures come in parts, only whole JPEGs of limited size', async () => {
  const letters = []
  const jpeg = (n) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n, 7), Buffer.from([0xff, 0xd9])])
  const sendPic = (ws, n, buf) => {
    const b64 = buf.toString('base64')
    for (let i = 0; i < b64.length; i += FEEDBACK.partChars) ws.sendJson({ t: 'feedback-pic', n, data: b64.slice(i, i + FEEDBACK.partChars) })
  }
  await withServer(
    async (url) => {
      const ws = await connect(url)
      const a = jpeg(100_000)
      const b = jpeg(10)
      sendPic(ws, 0, a)
      sendPic(ws, 1, b)
      ws.sendJson({ t: 'feedback', kind: 'bug', text: 'вот снимок', pics: 2 })
      assert.equal((await ws.next('feedback')).ok, true)
      assert.equal(letters[0].pics.length, 2)
      assert.ok(letters[0].pics[0].equals(a) && letters[0].pics[1].equals(b))

      // not a JPEG (a PNG, an SVG, anything): no letter
      sendPic(ws, 0, Buffer.from('<svg onload="alert(1)"/>'.padEnd(24)))
      ws.sendJson({ t: 'feedback', kind: 'bug', text: 'вот снимок', pics: 1 })
      assert.equal((await ws.next('feedback')).error, 'bad picture')
      // pictures announced but not sent
      ws.sendJson({ t: 'feedback', kind: 'bug', text: 'вот снимок', pics: 1 })
      assert.equal((await ws.next('feedback')).error, 'bad picture')
      // a third picture, a picture out of turn, not base64
      ws.sendJson({ t: 'feedback-pic', n: 2, data: 'AAAA' })
      assert.equal((await ws.next('feedback')).error, 'bad picture')
      ws.sendJson({ t: 'feedback-pic', n: 1, data: 'AAAA' })
      assert.equal((await ws.next('feedback')).error, 'bad picture')
      ws.sendJson({ t: 'feedback-pic', n: 0, data: 'A$A=' })
      assert.equal((await ws.next('feedback')).error, 'bad picture')
      ws.close()

      // too big
      const big = await connect(url)
      sendPic(big, 0, jpeg(FEEDBACK.maxPicBytes))
      assert.equal((await big.next('feedback')).error, 'picture too big')
      big.close()
      assert.equal(letters.length, 1)
    },
    { feedback: async (l) => void letters.push(l) },
  )
})

test('the mailer attaches the pictures under its own names', async () => {
  const sent = []
  const mail = feedbackMailer({ SMTP_HOST: 'h', SMTP_USER: 'u@x.ru', SMTP_PASS: 'p', FEEDBACK_TO: 'to@x.ru' }, () => {})
  assert.ok(mail)
  const nodemailer = (await import('nodemailer')).default
  const orig = nodemailer.createTransport
  nodemailer.createTransport = () => ({ sendMail: async (m) => void sent.push(m) })
  try {
    const m2 = feedbackMailer({ SMTP_HOST: 'h', SMTP_USER: 'u@x.ru', SMTP_PASS: 'p', FEEDBACK_TO: 'to@x.ru' }, () => {})
    await m2({ kind: 'bug', text: 'текст', contact: 'a@b.ru', where: '', ua: '', pics: [Buffer.from([1]), Buffer.from([2])] })
  } finally {
    nodemailer.createTransport = orig
  }
  assert.deepEqual(sent[0].attachments.map((a) => [a.filename, a.contentType]), [['картинка-1.jpg', 'image/jpeg'], ['картинка-2.jpg', 'image/jpeg']])
  assert.match(sent[0].text, /Картинок: 2/)
})

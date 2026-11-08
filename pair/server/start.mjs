import { existsSync } from 'node:fs'

// addresses live only in .env on the machine, never in the repo (see .env.example);
// loaded before importing the server, which reads its limits at import time
const envFile = new URL('./.env', import.meta.url).pathname
if (existsSync(envFile)) process.loadEnvFile(envFile)

const { createServer } = await import('./server.mjs')
const { createStunServer } = await import('./stun.mjs')

function iceServers() {
  const raw = process.env.ICE_SERVERS
  if (!raw) {
    console.warn('ICE_SERVERS is not set: browsers get no STUN and connect only inside one network')
    return []
  }
  try {
    const list = JSON.parse(raw)
    if (!Array.isArray(list) || !list.every((s) => s && (typeof s.urls === 'string' || Array.isArray(s.urls)))) throw new Error('expected [{ "urls": ... }]')
    return list
  } catch (e) {
    console.error(`ICE_SERVERS is not valid JSON (${e.message}); browsers get no STUN`)
    return []
  }
}

const ice = iceServers()
const server = createServer({ iceServers: ice })
await server.listen()
console.log(`ice servers: ${ice.flatMap((s) => [].concat(s.urls)).join(', ') || 'none'}`)

// built-in STUN; STUN_PORT=0 turns it off (e.g. when coturn already runs on the host)
const stunPort = Number(process.env.STUN_PORT ?? 3478)
const stun = stunPort ? createStunServer({ port: stunPort }) : null
await stun?.listen()

const stop = () => Promise.all([server.close(), stun?.close()]).then(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

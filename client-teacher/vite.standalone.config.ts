// The standalone demo (standalone/): the teacher's page and the lesson server in one static bundle,
// served at co-learn.ru/demo/. The server's own code goes in as it is; what it needs from Node and
// from outside (sockets, HTTP, the database, mail, LiveKit) is replaced by standalone/shims.
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const SERVER = path.resolve(here, '../server/src') + path.sep
const CLIENT = path.resolve(here, 'src') + path.sep
const shim = (f: string) => path.resolve(here, 'standalone/shims', f)

const SERVER_SHIMS: Record<string, string> = {
  'socket.io': shim('socketio-server.ts'), express: shim('express.ts'), http: shim('http.ts'), crypto: shim('crypto.ts'),
  jsonwebtoken: shim('jwt.ts'), 'livekit-server-sdk': shim('livekit-server.ts'), 'dotenv/config': shim('empty.ts'), fs: shim('fs.ts'),
  './db': shim('db.ts'), './mailer': shim('mailer.ts'),
}

function standalone(): Plugin {
  return {
    name: 'standalone-demo',
    enforce: 'pre',
    resolveId(id, importer) {
      if (!importer) return null
      if (importer.startsWith(SERVER) && SERVER_SHIMS[id]) return SERVER_SHIMS[id]
      if (importer.startsWith(CLIENT) && id === './socket') return path.resolve(here, 'standalone/socket.ts')
      return null
    },
  }
}

// where the feedback goes and where one books a lesson with a class: the real site (dev: REAL_API_URL, REAL_TEACHER_URL)
process.env.VITE_REAL_API_URL = process.env.REAL_API_URL ?? 'https://api.co-learn.ru'
process.env.VITE_REAL_TEACHER_URL = process.env.REAL_TEACHER_URL ?? 'https://teacher.co-learn.ru/?demo'

// What the server reads from its .env: nothing secret, the page keeps no secrets
const SERVER_ENV = {
  LIVEKIT_URL: 'http://local', LIVEKIT_WS_URL: 'ws://local', LIVEKIT_API_KEY: 'local', LIVEKIT_API_SECRET: 'local', JWT_SECRET: 'local',
}

// the page's API address: fetch() to it is answered in the page (standalone/api.ts)
process.env.VITE_API_URL = 'https://in-page.api'
process.env.VITE_STANDALONE = '1'

export default defineConfig(() => ({
  base: '/demo/',
  root: path.resolve(here, 'standalone'), // its own index.html: the page starts with standalone/main.tsx
  publicDir: path.resolve(here, 'public'),
  plugins: [standalone(), react()],
  define: {
    'process.env': JSON.stringify(SERVER_ENV),
  },
  build: { outDir: path.resolve(here, 'dist-demo'), emptyOutDir: true },
  server: { port: 13127, fs: { allow: [path.resolve(here, '..')] } },
  // dev only (pm2 cl-demo behind nginx); on co-learn.ru nginx serves dist-demo itself
  preview: { port: 13127, allowedHosts: true },
}))

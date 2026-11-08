import { createServer } from './server.mjs'

const server = createServer()
server.listen()
const stop = () => server.close().then(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)

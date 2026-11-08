// JSON messages over an RTCDataChannel. Big messages (pictures, long strokes)
// are split into chunks, and sending waits when the channel's buffer is full.

const CHUNK = 16 * 1024 // chars; well below every browser's SCTP message limit
const HIGH_WATER = 1024 * 1024

export class JsonChannel {
  private queue: string[] = []
  private seq = 0
  private partial = new Map<string, string[]>()

  constructor(
    private dc: RTCDataChannel,
    onMessage: (msg: any) => void,
  ) {
    dc.bufferedAmountLowThreshold = 256 * 1024
    dc.onbufferedamountlow = () => this.flush()
    dc.addEventListener('open', () => this.flush())
    dc.addEventListener('message', (e) => {
      const s = String(e.data)
      if (s[0] === 'w') return onMessage(JSON.parse(s.slice(1)))
      // c<id>,<index>,<count>|<data>
      const bar = s.indexOf('|')
      const [id, i, n] = s.slice(1, bar).split(',')
      const parts = this.partial.get(id) ?? new Array<string>(Number(n))
      parts[Number(i)] = s.slice(bar + 1)
      this.partial.set(id, parts)
      if (parts.filter((p) => p !== undefined).length === parts.length) {
        this.partial.delete(id)
        onMessage(JSON.parse(parts.join('')))
      }
    })
  }

  get open() {
    return this.dc.readyState === 'open'
  }

  send(msg: unknown) {
    const s = JSON.stringify(msg)
    if (s.length <= CHUNK) this.queue.push('w' + s)
    else {
      const id = (++this.seq).toString(36)
      const n = Math.ceil(s.length / CHUNK)
      for (let i = 0; i < n; i++) this.queue.push(`c${id},${i},${n}|${s.slice(i * CHUNK, (i + 1) * CHUNK)}`)
    }
    this.flush()
  }

  /** Fire-and-forget for things like the cursor: dropped when the channel is busy. */
  sendVolatile(msg: unknown) {
    if (this.open && this.dc.bufferedAmount < 64 * 1024 && this.queue.length === 0) this.dc.send('w' + JSON.stringify(msg))
  }

  private flush() {
    while (this.open && this.queue.length && this.dc.bufferedAmount < HIGH_WATER) this.dc.send(this.queue.shift()!)
  }
}

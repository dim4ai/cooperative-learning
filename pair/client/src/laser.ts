// The pointer: a red trail that fades out in a second. Not part of the board —
// it is drawn on its own canvas over the board and sent as volatile messages.

type Pt = { x: number; y: number; t: number; start: boolean }

const LIFE = 1200 // ms

export class Laser {
  private trails = new Map<string, Pt[]>()
  private raf = 0

  constructor(
    private cv: HTMLCanvasElement,
    private toScreen: (x: number, y: number) => { x: number; y: number },
  ) {}

  add(who: string, x: number, y: number, start: boolean) {
    let t = this.trails.get(who)
    if (!t) this.trails.set(who, (t = []))
    t.push({ x, y, t: performance.now(), start })
    if (!this.raf) this.raf = requestAnimationFrame(() => this.draw())
  }

  private draw() {
    this.raf = 0
    const cv = this.cv
    const dpr = window.devicePixelRatio || 1
    const W = cv.clientWidth
    const H = cv.clientHeight
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) {
      cv.width = Math.round(W * dpr)
      cv.height = Math.round(H * dpr)
    }
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    const now = performance.now()
    let alive = false
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const [who, pts] of this.trails) {
      while (pts.length && now - pts[0].t > LIFE) pts.shift()
      if (!pts.length) {
        this.trails.delete(who)
        continue
      }
      alive = true
      for (let i = 1; i < pts.length; i++) {
        if (pts[i].start) continue
        const a = this.toScreen(pts[i - 1].x, pts[i - 1].y)
        const b = this.toScreen(pts[i].x, pts[i].y)
        const k = 1 - (now - pts[i].t) / LIFE
        ctx.strokeStyle = `rgba(239, 68, 68, ${0.85 * k})`
        ctx.lineWidth = 3 + 4 * k
        ctx.beginPath()
        ctx.moveTo(a.x, a.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
      const head = pts[pts.length - 1]
      const p = this.toScreen(head.x, head.y)
      const k = 1 - (now - head.t) / LIFE
      ctx.fillStyle = `rgba(239, 68, 68, ${k})`
      ctx.beginPath()
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2)
      ctx.fill()
    }
    if (alive) this.raf = requestAnimationFrame(() => this.draw())
  }
}

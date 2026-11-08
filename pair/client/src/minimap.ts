// The board map: everything drawn, shrunk into a small panel, with a frame for the part
// that is on screen. Click or drag on the map to look elsewhere.
import type { Board } from './board'

type Box = { x: number; y: number; w: number; h: number }

const W = 220
const H = 150

export class Minimap {
  readonly el: HTMLCanvasElement
  private content: { img: HTMLCanvasElement; box: Box } | null = null
  private frame: Box = { x: 0, y: 0, w: 1, h: 1 }
  private dragFrame: Box | null = null
  private ownRender = false
  private timer = 0

  constructor(private board: Board) {
    const cv = document.createElement('canvas')
    const dpr = window.devicePixelRatio || 1
    cv.width = W * dpr
    cv.height = H * dpr
    cv.style.width = `${W}px`
    cv.style.height = `${H}px`
    this.el = cv
    // re-shoot the content a moment after the board changes (our own shot renders the board too)
    board.canvas.on('after:render', () => {
      if (this.ownRender || this.el.hidden || this.timer) return
      this.timer = window.setTimeout(() => {
        this.timer = 0
        this.shoot()
        this.draw()
      }, 400)
    })
    const go = (e: PointerEvent) => {
      const f = this.dragFrame ?? this.frame
      const r = cv.getBoundingClientRect()
      const s = Math.min(W / f.w, H / f.h)
      const ox = (W - f.w * s) / 2
      const oy = (H - f.h * s) / 2
      board.lookAt(f.x + (e.clientX - r.left - ox) / s, f.y + (e.clientY - r.top - oy) / s, board.canvas.getZoom())
    }
    cv.addEventListener('pointerdown', (e) => {
      this.dragFrame = { ...this.frame } // keep the map still while dragging over it
      cv.setPointerCapture(e.pointerId)
      go(e)
    })
    cv.addEventListener('pointermove', (e) => this.dragFrame && go(e))
    const end = () => {
      this.dragFrame = null
      this.draw()
    }
    cv.addEventListener('pointerup', end)
    cv.addEventListener('pointercancel', end)
  }

  show(on: boolean) {
    this.el.hidden = !on
    if (on) {
      this.shoot()
      this.draw()
    }
  }

  /** Renders everything on the board into a small picture */
  private shoot() {
    const c = this.board.canvas
    const objs = c.getObjects()
    if (!objs.length) {
      this.content = null
      return
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const o of objs) {
      const r = o.getBoundingRect()
      x0 = Math.min(x0, r.left)
      y0 = Math.min(y0, r.top)
      x1 = Math.max(x1, r.left + r.width)
      y1 = Math.max(y1, r.top + r.height)
    }
    const box = { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) }
    const v = c.viewportTransform
    const z = v[0]
    const k = Math.min(1, (2 * Math.max(W, H)) / Math.max(box.w, box.h)) // enough pixels for the map
    this.ownRender = true
    try {
      const img = c.toCanvasElement(k / z, { left: box.x * z + v[4], top: box.y * z + v[5], width: box.w * z, height: box.h * z })
      this.content = { img, box }
    } finally {
      this.ownRender = false
    }
  }

  /** The content plus the frame of the screen */
  draw() {
    if (this.el.hidden) return
    const b = this.board
    const c = b.canvas
    const v = c.viewportTransform
    const view = { x: -v[4] / v[0], y: -v[5] / v[3], w: c.width / v[0], h: c.height / v[3] }
    let f = this.dragFrame
    if (!f) {
      const all = this.content ? [this.content.box, view] : [view]
      const x0 = Math.min(...all.map((a) => a.x))
      const y0 = Math.min(...all.map((a) => a.y))
      const x1 = Math.max(...all.map((a) => a.x + a.w))
      const y1 = Math.max(...all.map((a) => a.y + a.h))
      const pad = Math.max(x1 - x0, y1 - y0) * 0.06
      f = this.frame = { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad }
    }
    const s = Math.min(W / f.w, H / f.h)
    const ox = (W - f.w * s) / 2
    const oy = (H - f.h * s) / 2
    const map = (a: Box) => [ox + (a.x - f.x) * s, oy + (a.y - f.y) * s, a.w * s, a.h * s] as const
    const ctx = this.el.getContext('2d')!
    const dpr = this.el.width / W
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#f1f5f9'
    ctx.fillRect(0, 0, W, H)
    ctx.fillStyle = '#fff'
    ctx.fillRect(...map(f))
    if (this.content) ctx.drawImage(this.content.img, ...map(this.content.box))
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 1.5
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)'
    const r = map(view)
    ctx.fillRect(...r)
    ctx.strokeRect(r[0] + 0.75, r[1] + 0.75, Math.max(2, r[2] - 1.5), Math.max(2, r[3] - 1.5))
  }
}

// Straightening a notebook page seen by a phone camera at an angle.
// The owner marks the page's four corners on the live picture; every frame is then
// warped (a perspective transform on the GPU) so the page looks as if seen from above.
// The corners travel to the other person, who straightens the same video the same way.

export type Fix = {
  /** corners TL, TR, BR, BL as fractions of the frame: x0,y0, x1,y1, x2,y2, x3,y3 */
  c: number[]
  /** quarter turns clockwise */
  rot: number
  mirror: boolean
}

export function validFix(x: any): Fix | null {
  if (!x || typeof x !== 'object' || !Array.isArray(x.c) || x.c.length !== 8) return null
  if (!x.c.every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > -1 && n < 2)) return null
  const rot = Number(x.rot)
  if (![0, 1, 2, 3].includes(rot)) return null
  return { c: x.c.slice(), rot, mirror: !!x.mirror }
}

type M3 = number[] // row-major 3×3

const mul = (a: M3, b: M3): M3 => {
  const r: M3 = []
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r.push(a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j])
  return r
}

/** The unit square (u right, v down) onto the quad TL, TR, BR, BL (Heckbert's square-to-quad). */
function squareToQuad(c: number[]): M3 {
  const [x0, y0, x1, y1, x2, y2, x3, y3] = c
  const sx = x0 - x1 + x2 - x3
  const sy = y0 - y1 + y2 - y3
  const dx1 = x1 - x2
  const dx2 = x3 - x2
  const dy1 = y1 - y2
  const dy2 = y3 - y2
  const den = dx1 * dy2 - dx2 * dy1
  let g = 0
  let h = 0
  if (Math.abs(den) > 1e-12 && (Math.abs(sx) > 1e-12 || Math.abs(sy) > 1e-12)) {
    g = (sx * dy2 - dx2 * sy) / den
    h = (dx1 * sy - sx * dy1) / den
  }
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1]
}

/** Where a point of the straightened picture (display, 0..1) comes from in the camera frame (0..1). */
function displayToFrame(fix: Fix): M3 {
  const mirror: M3 = fix.mirror ? [-1, 0, 1, 0, 1, 0, 0, 0, 1] : [1, 0, 0, 0, 1, 0, 0, 0, 1]
  // a page turned a quarter clockwise: the display point (x, y) shows the page point (y, 1 - x)
  const quarter: M3 = [0, 1, 0, -1, 0, 1, 0, 0, 1]
  let m = squareToQuad(fix.c)
  for (let i = 0; i < fix.rot; i++) m = mul(m, quarter)
  return mul(m, mirror)
}

/** Width:height of the page, judged from the marked corners (the nearer, longer edges win). */
export function pageAspect(fix: Fix, frameW: number, frameH: number) {
  const p = (i: number) => [fix.c[i * 2] * frameW, fix.c[i * 2 + 1] * frameH]
  const d = (a: number, b: number) => Math.hypot(p(a)[0] - p(b)[0], p(a)[1] - p(b)[1])
  const w = Math.max(d(0, 1), d(3, 2))
  const h = Math.max(d(0, 3), d(1, 2))
  const r = w / Math.max(h, 1)
  return fix.rot % 2 ? 1 / r : r
}

const VERT = `attribute vec2 p; varying vec2 a;
void main() { a = vec2(p.x * 0.5 + 0.5, 0.5 - p.y * 0.5); gl_Position = vec4(p, 0.0, 1.0); }`
const FRAG = `precision highp float; varying vec2 a; uniform mat3 T; uniform sampler2D t;
void main() {
  vec3 s = T * vec3(a, 1.0);
  vec2 uv = s.xy / s.z;
  if (s.z <= 0.0 || uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) gl_FragColor = vec4(0.12, 0.16, 0.22, 1.0);
  else gl_FragColor = texture2D(t, uv);
}`

/** Draws a video, straightened, into its own canvas, frame by frame. */
export class Rectifier {
  readonly canvas = document.createElement('canvas')
  private gl: WebGLRenderingContext | null
  private uT: WebGLUniformLocation | null = null
  private fix: Fix | null = null
  private running = false
  private frame = 0

  constructor(private video: HTMLVideoElement) {
    // preserveDrawingBuffer: a snapshot reads the canvas between frames
    this.gl = this.canvas.getContext('webgl', { preserveDrawingBuffer: true, antialias: false })
    const gl = this.gl
    if (!gl) return
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const p = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(p)
    gl.vertexAttribPointer(p, 2, gl.FLOAT, false, 0, 0)
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture())
    // video sizes are rarely powers of two: no mipmaps, clamp at the edges
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.uT = gl.getUniformLocation(prog, 'T')
  }

  get supported() {
    return !!this.gl
  }

  setFix(fix: Fix | null) {
    this.fix = fix
    if (fix && !this.running) {
      this.running = true
      this.loop()
    }
    if (fix) this.draw()
  }

  private loop() {
    if (!this.running || !this.fix) {
      this.running = false
      return
    }
    this.draw()
    this.frame = requestAnimationFrame(() => this.loop())
  }

  /** the canvas size for the current fix: the page's shape, about as many pixels as the camera gives */
  private size() {
    const v = this.video
    const r = pageAspect(this.fix!, v.videoWidth, v.videoHeight)
    const long = Math.min(1600, Math.max(v.videoWidth, v.videoHeight))
    return r >= 1 ? [long, Math.round(long / r)] : [Math.round(long * r), long]
  }

  draw() {
    const gl = this.gl
    const v = this.video
    if (!gl || !this.fix || !v.videoWidth || v.readyState < 2) return
    const [w, h] = this.size()
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    gl.viewport(0, 0, w, h)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v)
    const m = displayToFrame(this.fix)
    // GLSL wants column-major
    gl.uniformMatrix3fv(this.uT, false, [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]])
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
  }

  stop() {
    this.running = false
    cancelAnimationFrame(this.frame)
  }
}

// ---------- the owner's setup window ----------

const DEFAULT_CORNERS = [0.12, 0.1, 0.88, 0.1, 0.88, 0.9, 0.12, 0.9]

function h(tag: string, attrs: Record<string, string> = {}, text = '') {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  if (text) e.textContent = text
  return e
}

/**
 * Mark the page's corners on the live picture, then turn and mirror the result.
 * Resolves with the new fix, null to show the picture as it is, or undefined when cancelled.
 */
export function setupFix(stream: MediaStream, current: Fix | null): Promise<Fix | null | undefined> {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Настройка тетрадной камеры' })
    const card = h('div', { class: 'modal-card camfix' })
    const head = h('div', { class: 'modal-head' })
    head.append(h('b', {}, 'Настройка тетрадной камеры'))
    const hint = h('p', { class: 'muted camfix-hint' })
    const stage = h('div', { class: 'camfix-stage' })
    const foot = h('div', { class: 'modal-foot' })
    card.append(head, hint, stage, foot)
    overlay.append(card)
    document.body.append(overlay)

    const video = h('video', { autoplay: '', playsinline: '', muted: '' }) as HTMLVideoElement
    video.muted = true
    video.srcObject = stream
    const corners = (current?.c ?? DEFAULT_CORNERS).slice()
    let rot = current?.rot ?? 0
    let mirror = current?.mirror ?? false
    let rect: Rectifier | null = null

    const close = (result: Fix | null | undefined) => {
      document.removeEventListener('keydown', onKey, true)
      rect?.stop()
      video.srcObject = null
      overlay.remove()
      resolve(result)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close(undefined)
    }
    document.addEventListener('keydown', onKey, true)

    const button = (text: string, cls: string, on: () => void) => {
      const b = h('button', { class: cls }, text)
      b.addEventListener('click', on)
      return b
    }

    // the picture fits the window, whatever shape the phone sends
    const fitBox = (box: HTMLElement, w: number, ht: number) => {
      const maxW = Math.min(720, window.innerWidth - 64)
      const maxH = window.innerHeight - 240
      const k = Math.min(maxW / w, maxH / ht)
      box.style.width = `${Math.round(w * k)}px`
      box.style.height = `${Math.round(ht * k)}px`
    }

    function cornersStep() {
      rect?.stop()
      rect = null
      hint.textContent = 'Поставьте телефон на подставку так, чтобы лист был виден целиком, и перетащите зелёные кружки на углы листа.'
      stage.replaceChildren()
      const box = h('div', { class: 'camfix-box' })
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      svg.setAttribute('viewBox', '0 0 1 1')
      svg.setAttribute('preserveAspectRatio', 'none')
      const poly = document.createElementNS(svg.namespaceURI, 'polygon')
      svg.append(poly)
      box.append(video, svg)
      const dots = [0, 1, 2, 3].map((i) => {
        const d = h('div', { class: 'camfix-dot', role: 'slider', 'aria-label': ['левый верхний', 'правый верхний', 'правый нижний', 'левый нижний'][i] + ' угол' })
        box.append(d)
        d.addEventListener('pointerdown', (e) => {
          e.preventDefault()
          d.setPointerCapture(e.pointerId)
          const move = (ev: PointerEvent) => {
            const r = box.getBoundingClientRect()
            corners[i * 2] = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width))
            corners[i * 2 + 1] = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))
            place()
          }
          const up = () => {
            d.removeEventListener('pointermove', move)
            d.removeEventListener('pointerup', up)
            d.removeEventListener('pointercancel', up)
          }
          d.addEventListener('pointermove', move)
          d.addEventListener('pointerup', up)
          d.addEventListener('pointercancel', up)
        })
        return d
      })
      const place = () => {
        dots.forEach((d, i) => {
          d.style.left = `${corners[i * 2] * 100}%`
          d.style.top = `${corners[i * 2 + 1] * 100}%`
        })
        poly.setAttribute('points', [0, 1, 2, 3].map((i) => `${corners[i * 2]},${corners[i * 2 + 1]}`).join(' '))
      }
      place()
      stage.append(box)
      const sized = () => video.videoWidth && fitBox(box, video.videoWidth, video.videoHeight)
      video.onloadedmetadata = sized
      video.onresize = sized
      sized()

      foot.replaceChildren(
        ...(current ? [button('Показывать без выпрямления', 'secondary', () => close(null))] : []),
        h('div', { class: 'grow' }),
        button('Отмена', 'secondary', () => close(undefined)),
        button('Вперёд', 'primary-sm', resultStep),
      )
    }

    function resultStep() {
      hint.textContent = 'Так лист увидят оба. Если нужно, поверните или отразите его. Что-то не так — вернитесь назад и поправьте углы.'
      stage.replaceChildren()
      rect = new Rectifier(video)
      const box = h('div', { class: 'camfix-box result' })
      box.append(video, rect.canvas)
      video.onloadedmetadata = null
      video.onresize = null
      stage.append(box)
      const show = () => {
        rect!.setFix({ c: corners.slice(), rot, mirror })
        const r = pageAspect({ c: corners, rot, mirror }, video.videoWidth || 4, video.videoHeight || 3)
        fitBox(box, r * 1000, 1000)
      }
      show()
      const turn = (d: number) => () => {
        rot = (rot + d + 4) % 4
        show()
      }
      const mirrorBox = h('label', { class: 'camfix-mirror' })
      const check = h('input', { type: 'checkbox' }) as HTMLInputElement
      check.checked = mirror
      check.addEventListener('change', () => {
        mirror = check.checked
        show()
      })
      mirrorBox.append(check, document.createTextNode(' зеркально'))
      foot.replaceChildren(
        button('↺', 'secondary turn', turn(-1)),
        button('↻', 'secondary turn', turn(1)),
        mirrorBox,
        h('div', { class: 'grow' }),
        button('Назад', 'secondary', cornersStep),
        button('Применить', 'primary-sm', () => close({ c: corners.slice(), rot, mirror })),
      )
      foot.querySelectorAll('.turn').forEach((b, i) => b.setAttribute('title', i ? 'Повернуть по часовой' : 'Повернуть против часовой'))
    }

    cornersStep()
  })
}

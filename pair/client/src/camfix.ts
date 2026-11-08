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
  /** the page's width:height chosen by hand (upright, the short side across); absent = from the corners */
  ratio?: number
}

export function validFix(x: any): Fix | null {
  if (!x || typeof x !== 'object' || !Array.isArray(x.c) || x.c.length !== 8) return null
  if (!x.c.every((n: unknown) => typeof n === 'number' && Number.isFinite(n) && n > -1 && n < 2)) return null
  const rot = Number(x.rot)
  if (![0, 1, 2, 3].includes(rot)) return null
  const ratio = Number(x.ratio)
  return { c: x.c.slice(), rot, mirror: !!x.mirror, ...(ratio > 0.1 && ratio <= 1 ? { ratio } : {}) }
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

/** Page shapes to pick by hand, width:height upright; 0 = worked out from the corners. */
export const SHAPES: { ratio: number; label: string }[] = [
  { ratio: 0, label: 'по углам' },
  { ratio: 1 / Math.SQRT2, label: 'А4, А5' },
  { ratio: 170 / 205, label: 'тетрадь' },
  { ratio: 1, label: 'квадрат' },
]

/**
 * Width:height of the marked rectangle as it really is, not as the camera foreshortens it.
 * After Zhang & He, "Whiteboard scanning and image enhancement" (2007): knowing the camera's
 * focal length, the four corners give the true shape. Their method also guesses the focal length
 * from the corners, but a phone on a stand tilts the page only one way, and then the guess is
 * hopeless (one pair of edges stays parallel; a few pixels off swing it wildly). So we take the
 * focal length of a phone's main camera instead: about a 26 mm equivalent lens, ≈ 0.75 of the
 * frame's long side. On projected test pages it's within a few percent.
 */
export function cornerAspect(c: number[], frameW: number, frameH: number) {
  const pt = (i: number): [number, number, number] => [(c[i * 2] - 0.5) * frameW, (c[i * 2 + 1] - 0.5) * frameH, 1]
  // their order: m1 top-left, m2 top-right, m3 bottom-left, m4 bottom-right
  const m1 = pt(0)
  const m2 = pt(1)
  const m3 = pt(3)
  const m4 = pt(2)
  const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  const m14 = cross(m1, m4)
  const k2 = dot(m14, m3) / dot(cross(m2, m4), m3)
  const k3 = dot(m14, m2) / dot(cross(m3, m4), m2)
  const n2 = m2.map((v, i) => k2 * v - m1[i])
  const n3 = m3.map((v, i) => k3 * v - m1[i])
  const f2 = (0.75 * Math.max(frameW, frameH)) ** 2
  const len = (n: number[]) => (n[0] * n[0] + n[1] * n[1]) / f2 + n[2] * n[2]
  let r = Math.sqrt(len(n2) / len(n3))
  // nonsense corners (a twisted quad) fall back to the edges
  if (!Number.isFinite(r) || r <= 0.1 || r >= 10) {
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])
    r = Math.max(d(m1, m2), d(m3, m4)) / Math.max(1, Math.max(d(m1, m3), d(m2, m4)))
  }
  return r
}

/** Width:height of the straightened picture, as shown (after turning). */
export function pageAspect(fix: Fix, frameW: number, frameH: number) {
  const r = fix.ratio ? (cornerAspect(fix.c, frameW, frameH) >= 1 ? 1 / fix.ratio : fix.ratio) : cornerAspect(fix.c, frameW, frameH)
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
    let ratio = current?.ratio ?? 0
    const fixNow = (): Fix => ({ c: corners.slice(), rot, mirror, ...(ratio ? { ratio } : {}) })
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
        rect!.setFix(fixNow())
        const r = pageAspect(fixNow(), video.videoWidth || 4, video.videoHeight || 3)
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
      const shapeBox = h('label', { class: 'camfix-mirror' }, 'Лист: ')
      const shape = h('select', { 'aria-label': 'Форма листа' }) as HTMLSelectElement
      for (const sh of SHAPES) shape.append(new Option(sh.label, String(sh.ratio), false, Math.abs(sh.ratio - ratio) < 1e-6))
      shape.addEventListener('change', () => {
        ratio = Number(shape.value)
        show()
      })
      shapeBox.append(shape)
      foot.replaceChildren(
        button('↺', 'secondary turn', turn(-1)),
        button('↻', 'secondary turn', turn(1)),
        mirrorBox,
        shapeBox,
        h('div', { class: 'grow' }),
        button('Назад', 'secondary', cornersStep),
        button('Применить', 'primary-sm', () => close(fixNow())),
      )
      foot.querySelectorAll('.turn').forEach((b, i) => b.setAttribute('title', i ? 'Повернуть по часовой' : 'Повернуть против часовой'))
    }

    cornersStep()
  })
}

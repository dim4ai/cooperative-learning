// The notebook camera. A phone opens the link from the QR code, joins the lesson
// as a 'cam' participant and sends its back camera straight to both people.
// No app, no account: the link carries the lesson's student code and the owner.
//
// Link:  #c.<room>.<owner>   owner = a few random chars + the owner's name,
// so both people see whose notebook it is.

import { Peers, type LinkState } from './peers'
import { renderSVG } from 'uqr'
import { pretty } from './roles'

const ROOM_RE = /^[a-z0-9]{6,32}$/

export function camLink(room: string, owner: string) {
  return `${location.origin}${location.pathname}#c.${room}.${encodeURIComponent(owner)}`
}

/** '#c.<room>.<owner>' → the parts, or null for any other link */
export function camEntry(): { room: string; owner: string } | null {
  const m = /^#c\.([a-z0-9]+)\.(.*)$/.exec(location.hash)
  if (!m || !ROOM_RE.test(m[1])) return null
  let owner = m[2]
  try {
    owner = decodeURIComponent(owner)
  } catch {}
  return { room: m[1], owner: owner.slice(0, 40) }
}

/** Phone participants are named 'xxxxxx:Owner name' */
export function camOwner(name: string) {
  const i = name.indexOf(':')
  return { tag: i < 0 ? name : name.slice(0, i), name: i < 0 ? '' : name.slice(i + 1) }
}

/** The tag that marks my own phone; kept for the tab's life so a reload still knows it */
export function myCamTag() {
  try {
    let t = sessionStorage.getItem('pair.camTag')
    if (!t) {
      t = Math.random().toString(36).slice(2, 8)
      sessionStorage.setItem('pair.camTag', t)
    }
    return t
  } catch {
    return Math.random().toString(36).slice(2, 8)
  }
}

export function qrSvg(text: string) {
  return renderSVG(text, { border: 2, ecc: 'M' })
}

// ---------- the phone's own page ----------

export function phoneScreen(app: HTMLElement, room: string, owner: string) {
  const who = camOwner(owner).name
  app.className = 'screen phone'
  app.innerHTML = `
    <main class="card">
      <h1>Тетрадная камера</h1>
      <p>Камера телефона покажет на занятии лист тетради${who ? ` — как камера «${escapeHtml(who)}»` : ''}.
      Код занятия: <code class="code">${pretty(room)}</code></p>
      <button class="primary" id="go">Подключиться</button>
      <p class="hint">Браузер спросит доступ к камере — разрешите. Звук с телефона не передаётся.</p>
    </main>`
  app.querySelector('#go')!.addEventListener('click', () => connect(app, room, owner))
}

async function connect(app: HTMLElement, room: string, owner: string) {
  let stream: MediaStream
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      // the back camera, as sharp as it gets: handwriting needs pixels more than frames
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 15, max: 24 } },
    })
  } catch {
    const hint = app.querySelector<HTMLElement>('.hint')!
    hint.textContent = 'Нет доступа к камере. Разрешите его в настройках браузера для этого сайта и нажмите «Подключиться» снова.'
    hint.classList.add('error')
    return
  }
  for (const t of stream.getVideoTracks()) t.contentHint = 'detail'

  app.innerHTML = `
    <div class="phone-live">
      <p id="state">Соединяемся…</p>
      <video autoplay playsinline muted></video>
      <button id="stop">Отключиться</button>
    </div>`
  const v = app.querySelector('video')!
  v.srcObject = stream
  const state = app.querySelector<HTMLElement>('#state')!

  // keep the screen on: a sleeping phone stops its camera
  let lock: WakeLockSentinel | null = null
  const wake = async () => {
    try {
      lock = await navigator.wakeLock?.request('screen')
    } catch {}
  }
  wake()
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake())

  const states = new Map<string, LinkState>()
  const show = () => {
    const list = [...states.values()]
    state.textContent = !list.length
      ? 'Ждём участников занятия…'
      : list.includes('connected')
        ? `Соединение установлено${list.includes('failed') ? ' (не со всеми)' : ''}`
        : list.includes('connecting')
          ? 'Соединяемся…'
          : 'Не получается соединиться напрямую. Подключите телефон к той же сети Wi-Fi, что и компьютер.'
    state.classList.toggle('ok', list.includes('connected'))
  }
  const peers = new Peers(
    room,
    owner,
    null,
    stream,
    {
      waiting: show,
      full: () => (state.textContent = 'В занятии нет места для ещё одной камеры.'),
      badKey: () => {},
      offline: () => (state.textContent = 'Нет связи с сервером, переподключаемся…'),
      state: (p, s) => {
        states.set(p.id, s)
        show()
      },
      stream: () => {},
      channelOpen: () => {},
      message: () => {},
      gone: (p) => {
        states.delete(p.id)
        show()
      },
    },
    'cam',
  )
  show()
  app.querySelector('#stop')!.addEventListener('click', () => {
    peers.leave()
    stream.getTracks().forEach((t) => t.stop())
    lock?.release().catch(() => {})
    app.className = 'screen phone'
    app.innerHTML = `<main class="card"><h1>Камера отключена</h1><button class="primary" id="again">Подключить снова</button></main>`
    app.querySelector('#again')!.addEventListener('click', () => location.reload())
  })
  window.addEventListener('beforeunload', () => peers.leave())
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

import './style.css'
import { Board, type Tool } from './board'
import { Peers, type LinkState } from './peers'
import type { PeerInfo } from './signaling'
import { icons } from './icons'
import { entryFromHash, newKey, parseCode, pretty, studentLink, teacherLink, type Entry } from './roles'

const app = document.getElementById('app')!

const TOOLS: { id: Tool | 'image'; title: string; key: string }[] = [
  { id: 'select', title: 'Выбор', key: 'V' },
  { id: 'hand', title: 'Рука — двигать доску (или пробел)', key: 'H' },
  { id: 'pen', title: 'Ручка', key: 'P' },
  { id: 'marker', title: 'Маркер', key: 'M' },
  { id: 'eraser', title: 'Ластик — провести по объекту', key: 'E' },
  { id: 'line', title: 'Линия (Shift — шаг 15°)', key: 'L' },
  { id: 'arrow', title: 'Стрелка', key: 'A' },
  { id: 'rect', title: 'Прямоугольник (Shift — квадрат)', key: 'R' },
  { id: 'ellipse', title: 'Эллипс (Shift — круг)', key: 'O' },
  { id: 'triangle', title: 'Треугольник', key: 'Y' },
  { id: 'text', title: 'Текст', key: 'T' },
  { id: 'image', title: 'Картинка (или вставить Ctrl+V)', key: 'I' },
]
const COLORS = ['#1f2937', '#dc2626', '#2563eb', '#16a34a', '#ea580c', '#9333ea']
const WIDTHS = [2, 4, 8]

function savedName() {
  try {
    return localStorage.getItem('pair.name') ?? ''
  } catch {
    return ''
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = '') {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  e.innerHTML = html
  return e
}

// ---------- start / join ----------

function startScreen(error = '') {
  app.className = 'screen'
  app.innerHTML = `
    <main class="card">
      <h1>Занятие вдвоём</h1>
      <p>Общая доска, видео и звук для учителя и ученика. Бесплатно и без регистрации: связь идёт напрямую между вашими браузерами.</p>
      <button class="primary" id="create">Начать занятие с новым кодом</button>
      <form id="enter" class="enter">
        <label for="code">Войти по коду занятия</label>
        <div class="copyline">
          <input id="code" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="xxxx-xxxx-xxxx">
          <button type="submit">Войти</button>
        </div>
        <p class="hint" id="code-hint">Код ученика — 12 знаков, код учителя — 20. Можно вставить и ссылку целиком.</p>
      </form>
    </main>`
  app.querySelector('#create')!.addEventListener('click', () => {
    location.hash = 't.' + newKey()
  })
  const input = app.querySelector<HTMLInputElement>('#code')!
  const hint = app.querySelector<HTMLElement>('#code-hint')!
  const fail = (text: string) => {
    hint.textContent = text
    hint.classList.add('error')
    input.focus()
  }
  if (error) fail(error)
  app.querySelector('#enter')!.addEventListener('submit', async (e) => {
    e.preventDefault()
    const entry = await parseCode(input.value)
    if (!entry) return fail('Код не распознан. Проверьте его: 12 знаков у ученика, 20 у учителя.')
    location.hash = entry.key ? `t.${entry.key}` : entry.room
  })
}

function codeBlock(title: string, code: string, link: string, id: string) {
  return `<div class="code-block">
      <p>${title}</p>
      <div class="copyline"><code class="code">${pretty(code)}</code><button data-copy-link="${link}" id="${id}"><span class="long">Скопировать ссылку</span><span class="short">Ссылка</span></button></div>
    </div>`
}


function joinScreen(entry: Entry) {
  const teacher = !!entry.key
  app.className = 'screen'
  app.innerHTML = `
    <main class="card">
      <h1>${teacher ? 'Вы учитель' : 'Занятие вдвоём'}</h1>
      ${
        teacher
          ? `<div class="links">
        ${codeBlock('Код для ученика', entry.room, studentLink(entry.room), 'copy-student')}
        ${codeBlock('Код для учителя', entry.key!, teacherLink(entry.key!), 'copy-teacher')}
        <p class="hint">Код для ученика продиктуйте ученику или отправьте ему ссылку. Код для учителя сохраните
        и никому не давайте: по нему входят учителем. Оба кода можно использовать снова — занятие то же, доска новая.</p>
      </div>`
          : `<p class="hint code-line">Код занятия: <code class="code">${pretty(entry.room)}</code></p>`
      }
      <label>Ваше имя (будет отображаться на уроке)
        <input id="name" maxlength="40" autocomplete="name" placeholder="Например, Анна Сергеевна">
      </label>
      <button class="primary" id="join">Войти</button>
      <p class="hint">Браузер спросит доступ к камере и микрофону. Без них доска тоже работает.</p>
    </main>`
  for (const btn of app.querySelectorAll<HTMLButtonElement>('[data-copy-link]')) {
    btn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(btn.dataset.copyLink!)
        btn.textContent = 'Скопировано'
      } catch {
        btn.textContent = btn.dataset.copyLink!
      }
    })
  }
  const input = app.querySelector<HTMLInputElement>('#name')!
  input.value = savedName()
  const go = () => {
    const name = input.value.trim()
    try {
      localStorage.setItem('pair.name', name)
    } catch {}
    lesson(entry, name)
  }
  app.querySelector('#join')!.addEventListener('click', go)
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go())
  input.focus()
}

async function getMedia(): Promise<MediaStream | null> {
  const video = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } }
  for (const c of [{ audio: true, video }, { audio: true }, { video }] as MediaStreamConstraints[]) {
    try {
      return await navigator.mediaDevices.getUserMedia(c)
    } catch {}
  }
  return null
}

// ---------- the lesson ----------

async function lesson(entry: Entry, name: string) {
  const { room, key } = entry
  const teacher = !!key
  app.className = 'lesson'
  app.innerHTML = `
    <div id="wrap"><canvas id="board"></canvas><div id="cursors"></div></div>
    <nav id="tools" class="panel"></nav>
    <div id="topbar" class="panel"></div>
    <div id="videos"></div>
    <aside id="side"></aside>
    <div id="status" hidden></div>
    <div id="toast" hidden></div>
    <input id="file" type="file" accept="image/*" hidden>`

  const $ = <T extends HTMLElement>(s: string) => app.querySelector<T>(s)!
  const board = new Board($<HTMLCanvasElement>('#board'), $('#wrap'))
  if (import.meta.env.DEV) Object.assign(window, { board })

  // left: tools
  const tools = $('#tools')
  for (const t of TOOLS) {
    const b = el('button', { 'data-tool': t.id, title: `${t.title} · ${t.key}`, 'aria-label': t.title }, icons[t.id])
    b.addEventListener('click', () => (t.id === 'image' ? $<HTMLInputElement>('#file').click() : board.setTool(t.id)))
    tools.append(b)
  }
  board.onToolChange = (tool) => {
    for (const b of tools.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tool === tool)
  }
  board.onToolChange(board.tool)

  // top: undo, zoom, colour, width
  const top = $('#topbar')
  const undo = el('button', { title: 'Отменить своё последнее · Ctrl+Z', 'aria-label': 'Отменить' }, icons.undo)
  undo.addEventListener('click', () => board.undo())
  const zOut = el('button', { title: 'Отдалить', 'aria-label': 'Отдалить' }, icons.zoomOut)
  const zLabel = el('button', { class: 'zoom', title: 'Масштаб 100%' }, '100%')
  const zIn = el('button', { title: 'Приблизить', 'aria-label': 'Приблизить' }, icons.zoomIn)
  zOut.addEventListener('click', () => board.zoomBy(1 / 1.25))
  zIn.addEventListener('click', () => board.zoomBy(1.25))
  zLabel.addEventListener('click', () => board.resetZoom())
  top.append(undo, el('span', { class: 'sep' }), zOut, zLabel, zIn, el('span', { class: 'sep' }))
  const swatches = COLORS.map((c) => {
    const b = el('button', { class: 'swatch', title: c, 'aria-label': `Цвет ${c}` })
    b.style.setProperty('--c', c)
    b.addEventListener('click', () => pickColor(c))
    top.append(b)
    return b
  })
  const custom = el('input', { type: 'color', title: 'Свой цвет', class: 'custom' }) as HTMLInputElement
  custom.addEventListener('input', () => pickColor(custom.value))
  top.append(custom, el('span', { class: 'sep' }))
  const widths = WIDTHS.map((w) => {
    const b = el('button', { class: 'width', title: `Толщина ${w}`, 'aria-label': `Толщина ${w}` }, `<i style="width:${w + 2}px;height:${w + 2}px"></i>`)
    b.addEventListener('click', () => pickWidth(w))
    top.append(b)
    return b
  })
  function pickColor(c: string) {
    board.setColor(c)
    swatches.forEach((s, i) => s.classList.toggle('on', COLORS[i] === c))
    custom.value = c
  }
  function pickWidth(w: number) {
    board.setWidth(w)
    widths.forEach((b, i) => b.classList.toggle('on', WIDTHS[i] === w))
  }
  pickColor(COLORS[0])
  pickWidth(WIDTHS[0])

  // tool shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const editing = (board.canvas.getActiveObject() as { isEditing?: boolean } | undefined)?.isEditing
    if (editing || (e.target as HTMLElement).closest('input, textarea')) return
    const t = TOOLS.find((x) => x.key === e.key.toUpperCase() || x.key === e.code.replace('Key', ''))
    if (!t) return
    if (t.id === 'image') $<HTMLInputElement>('#file').click()
    else board.setTool(t.id)
  })

  // pictures: file, paste, drop
  $<HTMLInputElement>('#file').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (f) board.addImage(f)
    ;(e.target as HTMLInputElement).value = ''
  })
  window.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
    const f = item?.getAsFile()
    if (f) {
      e.preventDefault()
      board.addImage(f)
    }
  })
  $('#wrap').addEventListener('dragover', (e) => e.preventDefault())
  $('#wrap').addEventListener('drop', (e) => {
    e.preventDefault()
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'))
    if (f) board.addImage(f)
  })

  // right: camera, microphone, link, leave
  const side = $('#side')
  const local = await getMedia()
  const camBtn = el('button', { title: 'Камера', 'aria-label': 'Камера' }, icons.cam)
  const micBtn = el('button', { title: 'Микрофон', 'aria-label': 'Микрофон' }, icons.mic)
  const linkBtn = el('button', { title: 'Скопировать ссылку для ученика', 'aria-label': 'Ссылка для ученика' }, icons.link)
  const leaveBtn = el('button', { class: 'leave', title: 'Выйти', 'aria-label': 'Выйти' }, icons.leave)
  const toggle = (kind: 'audio' | 'video', btn: HTMLElement, on: string, off: string) => {
    const tracks = local?.getTracks().filter((t) => t.kind === kind) ?? []
    if (!tracks.length) {
      btn.classList.add('off')
      btn.innerHTML = off
      btn.title += ' — нет доступа'
      return
    }
    btn.addEventListener('click', () => {
      const enabled = !tracks[0].enabled
      tracks.forEach((t) => (t.enabled = enabled))
      btn.classList.toggle('off', !enabled)
      btn.innerHTML = enabled ? on : off
    })
  }
  toggle('video', camBtn, icons.cam, icons.camOff)
  toggle('audio', micBtn, icons.mic, icons.micOff)
  linkBtn.addEventListener('click', copyLink)
  side.append(camBtn, micBtn, linkBtn, el('div', { class: 'grow' }), leaveBtn)

  const toast = $('#toast')
  let toastTimer = 0
  function say(text: string) {
    toast.textContent = text
    toast.hidden = false
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => (toast.hidden = true), 2500)
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(studentLink(room))
      say(teacher ? 'Ссылка для ученика скопирована' : 'Ссылка на занятие скопирована')
    } catch {
      say(studentLink(room))
    }
  }

  // videos
  const videos = $('#videos')
  const tile = (key: string, label: string, mirrored: boolean) => {
    let t = videos.querySelector<HTMLElement>(`[data-key="${key}"]`)
    if (!t) {
      t = el('figure', { 'data-key': key }, `<video autoplay playsinline></video><figcaption></figcaption>`)
      if (mirrored) t.classList.add('me')
      key === 'me' ? videos.append(t) : videos.prepend(t)
    }
    t.querySelector('figcaption')!.textContent = label
    return t
  }
  if (local?.getVideoTracks().length) {
    const v = tile('me', label(name || 'Вы', teacher), true).querySelector('video')!
    v.muted = true
    v.srcObject = local
  }

  // status line
  const status = $('#status')
  const states = new Map<string, { peer: PeerInfo; state: LinkState }>()
  function showStatus(html: string | null) {
    status.hidden = html === null
    if (html !== null) status.innerHTML = html
    status.querySelector('[data-copy]')?.addEventListener('click', copyLink)
  }
  function refreshStatus() {
    const list = [...states.values()]
    if (!list.length)
      return showStatus(
        teacher ? `Ждём ученика. Код для ученика: <b>${pretty(room)}</b> <button data-copy>Скопировать ссылку</button>` : 'Ждём учителя…',
      )
    const failed = list.find((s) => s.state === 'failed')
    if (failed)
      return showStatus(
        `Не получается соединиться напрямую${failed.peer.name ? ` с «${escapeHtml(failed.peer.name)}»` : ''}. ` +
          'Так бывает в школьных и офисных сетях. Попробуйте другую сеть, например раздайте интернет с телефона, и обновите страницу.',
      )
    const connecting = list.find((s) => s.state === 'connecting')
    if (connecting) return showStatus(`Соединяемся${connecting.peer.name ? ` с «${escapeHtml(connecting.peer.name)}»` : ''}…`)
    showStatus(null)
  }

  // remote cursors
  const cursors = $('#cursors')
  const cursorAt = new Map<string, { x: number; y: number; el: HTMLElement; timer: number }>()
  function placeCursors() {
    for (const c of cursorAt.values()) {
      const p = board.sceneToScreen(c.x, c.y)
      c.el.style.transform = `translate(${p.x}px, ${p.y}px)`
    }
  }
  board.onViewport = () => {
    placeCursors()
    zLabel.textContent = `${Math.round(board.canvas.getZoom() * 100)}%`
  }

  const peers = new Peers(room, name, key, local, {
    waiting: () => refreshStatus(),
    full: () => showStatus('В этом занятии уже двое. Попросите новую ссылку.'),
    badKey: () => showStatus('Ссылка учителя повреждена. Скопируйте её заново целиком.'),
    offline: () => showStatus('Нет связи с сервером, переподключаемся…'),
    state: (peer, state) => {
      states.set(peer.id, { peer, state })
      refreshStatus()
    },
    stream: (peer, stream) => {
      const t = tile(peer.id, label(peer.name || (peer.teacher ? 'Учитель' : 'Ученик'), peer.teacher), false)
      const v = t.querySelector('video')!
      if (v.srcObject !== stream) v.srcObject = stream
      t.classList.toggle('novideo', !stream.getVideoTracks().length)
    },
    channelOpen: (_peer, ch) => ch.send(board.snapshot()),
    message: (peer, msg) => {
      if (msg.op === 'cur') {
        let c = cursorAt.get(peer.id)
        if (!c) {
          const e = el('div', { class: 'cursor' }, `<span>${escapeHtml(peer.name || (peer.teacher ? 'Учитель' : 'Ученик'))}</span>`)
          cursors.append(e)
          c = { x: 0, y: 0, el: e, timer: 0 }
          cursorAt.set(peer.id, c)
        }
        c.x = msg.x
        c.y = msg.y
        c.el.hidden = false
        clearTimeout(c.timer)
        const cc = c
        c.timer = window.setTimeout(() => (cc.el.hidden = true), 4000)
        placeCursors()
        return
      }
      board.apply(msg)
    },
    gone: (peer) => {
      states.delete(peer.id)
      videos.querySelector(`[data-key="${peer.id}"]`)?.remove()
      cursorAt.get(peer.id)?.el.remove()
      cursorAt.delete(peer.id)
      refreshStatus()
    },
  })
  refreshStatus()

  if (import.meta.env.DEV) Object.assign(window, { peers })
  board.onOp = (op) => peers.broadcast(op)
  board.onCursor = (x, y) => peers.broadcastVolatile({ op: 'cur', x, y })

  leaveBtn.addEventListener('click', () => {
    peers.leave()
    local?.getTracks().forEach((t) => t.stop())
    app.className = 'screen'
    app.innerHTML = `<main class="card"><h1>Вы вышли из занятия</h1><p>Доска хранилась только в ваших браузерах.</p><button class="primary" id="back">Вернуться</button></main>`
    app.querySelector('#back')!.addEventListener('click', () => location.reload())
  })
  window.addEventListener('beforeunload', () => peers.leave())
}

/** Caption under a video: the name, with a mark for the teacher. */
function label(name: string, teacher: boolean) {
  return teacher && name !== 'Учитель' ? `${name} · учитель` : name
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
}

async function route() {
  const entry = await entryFromHash()
  if (entry) joinScreen(entry)
  else startScreen(location.hash.length > 1 ? 'Ссылка не распознана — возможно, она скопирована не целиком. Введите код занятия.' : '')
}
window.addEventListener('hashchange', () => location.reload())
route()

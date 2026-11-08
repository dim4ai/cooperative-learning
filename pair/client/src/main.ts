import './style.css'
import { Board, isShape, throttle, type Tool } from './board'
import { Peers, type LinkState } from './peers'
import type { PeerInfo } from './signaling'
import { icons } from './icons'
import { entryFromHash, newKey, parseCode, pretty, studentLink, teacherLink, type Entry } from './roles'
import { LINE_MARKS, MARKS, WORD_MARKS } from './marks'
import { SHAPES, SHAPE_KINDS } from './shapes'
import { PAPERS } from './paper'
import { Laser } from './laser'

const app = document.getElementById('app')!

type ToolId = Exclude<Tool, 'pipette'> | 'image'
const TOOLS: { id: ToolId; title: string; key?: string }[] = [
  { id: 'select', title: 'Выбор', key: 'V' },
  { id: 'lock', title: 'Закрепление: щёлкните объект, чтобы закрепить или открепить его', key: 'K' },
  { id: 'hand', title: 'Перемещение доски (или пробел)', key: 'H' },
  { id: 'pointer', title: 'Указка: собеседник видит след', key: 'U' },
  { id: 'pen', title: 'Ручка', key: 'P' },
  { id: 'marker', title: 'Маркер', key: 'M' },
  { id: 'eraser', title: 'Ластик: стирает там, где провели', key: 'E' },
  { id: 'broom', title: 'Метёлка: убирает объект целиком', key: 'B' },
  ...LINE_MARKS.map((id) => ({ id, title: MARKS[id].title, key: ({ line: 'L', arrow: 'A' } as Record<string, string>)[id] })),
  ...WORD_MARKS.map((id) => ({ id, title: MARKS[id].title })),
  ...SHAPE_KINDS.map((id) => ({ id, title: SHAPES[id], key: ({ rect: 'R', ellipse: 'O', triangle: 'Y' } as Record<string, string>)[id] })),
  { id: 'polygon', title: 'Многоугольник по точкам: щелчок — вершина; замкнуть — щелчок по первой точке, двойной щелчок или Enter', key: 'G' },
  { id: 'text', title: 'Текст', key: 'T' },
  { id: 'image', title: 'Картинка (или вставить Ctrl+V, перетащить файл)', key: 'I' },
]
/** The left panel: single tools and groups that open sideways; a group shows its last used tool. */
const PANEL: { members: ToolId[]; title?: string }[] = [
  { members: ['select', 'lock'] },
  { members: ['hand'] },
  { members: ['pointer'] },
  { members: ['pen', 'marker'] },
  { members: ['eraser', 'broom'] },
  { members: LINE_MARKS, title: 'Линии' },
  { members: WORD_MARKS, title: 'Разбор слова' },
  { members: [...SHAPE_KINDS, 'polygon'], title: 'Фигуры' },
  { members: ['text'] },
  { members: ['image'] },
]
const COLORS = ['#1f2937', '#dc2626', '#2563eb', '#16a34a', '#ea580c', '#9333ea']
const TINTS = ['#e5e7eb', '#fecaca', '#bfdbfe', '#bbf7d0', '#fed7aa', '#e9d5ff']
const WIDTHS = [2, 4, 8]
const FONTS = [
  { label: 'Обычный', value: 'Inter, system-ui, sans-serif' },
  { label: 'С засечками', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Моноширинный', value: "ui-monospace, 'Cascadia Mono', Consolas, monospace" },
  { label: 'Рукописный', value: "'Segoe Print', 'Comic Sans MS', 'Marker Felt', cursive" },
]
const SIZES = [16, 20, 24, 28, 36, 48, 64, 96]

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
        <input id="name" maxlength="40" autocomplete="name" placeholder="${teacher ? 'Например, Анна Сергеевна' : 'Например, Павел'}">
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
    <div id="wrap"><canvas id="paper"></canvas><canvas id="board"></canvas><canvas id="laser"></canvas><div id="cursors"></div></div>
    <nav id="tools" class="panel"></nav>
    <div id="topbar" class="panel"></div>
    <div id="videos"></div>
    <aside id="side"></aside>
    <div id="status" hidden></div>
    <div id="toast" hidden></div>
    <input id="file" type="file" accept="image/*" hidden>`

  const $ = <T extends HTMLElement>(s: string) => app.querySelector<T>(s)!
  const board = new Board($<HTMLCanvasElement>('#board'), $('#wrap'), $<HTMLCanvasElement>('#paper'))
  const laser = new Laser($<HTMLCanvasElement>('#laser'), (x, y) => board.sceneToScreen(x, y))
  if (import.meta.env.DEV) Object.assign(window, { board })

  const toast = $('#toast')
  let toastTimer = 0
  function say(text: string, ms = 2500) {
    toast.textContent = text
    toast.hidden = false
    clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => (toast.hidden = true), ms)
  }

  // popovers under top-bar buttons: one open at a time, closed by a click elsewhere or Esc
  const pops: HTMLElement[] = []
  const closePops = () => pops.forEach((p) => (p.hidden = true))
  function popover(button: HTMLElement, fill: (pop: HTMLElement) => void) {
    const pop = el('div', { class: 'pop panel', hidden: '' })
    document.body.append(pop)
    pops.push(pop)
    button.addEventListener('click', () => {
      const open = pop.hidden
      closePops()
      if (!open) return
      pop.innerHTML = ''
      fill(pop)
      const r = button.getBoundingClientRect()
      pop.hidden = false
      pop.style.top = `${r.bottom + 6}px`
      pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`
    })
    return pop
  }

  // ---------- left: tools — single buttons and groups with a flyout to the right ----------
  const tools = $('#tools')
  const info = (id: ToolId) => TOOLS.find((t) => t.id === id)!
  const label = (id: ToolId) => {
    const t = info(id)
    return t.key ? `${t.title} · ${t.key}` : t.title
  }
  const pick = (id: ToolId) => (id === 'image' ? $<HTMLInputElement>('#file').click() : board.setTool(id))
  type G = { members: ToolId[]; current: ToolId; button: HTMLButtonElement; flyout: HTMLElement | null; show: () => void }
  const groups: G[] = []
  const closeFlyouts = () => groups.forEach((g) => g.flyout?.setAttribute('hidden', ''))
  for (const { members, title } of PANEL) {
    const wrap = el('div', { class: 'tool-group' })
    const button = el('button') as HTMLButtonElement
    const g: G = {
      members,
      current: members[0],
      button,
      flyout: null,
      show() {
        button.innerHTML = icons[g.current] + (members.length > 1 ? '<i class="more"></i>' : '')
        button.title = title ? `${title}: ${label(g.current)}` : label(g.current)
        button.setAttribute('aria-label', info(g.current).title)
        button.dataset.tool = g.current
      },
    }
    g.show()
    wrap.append(button)
    if (members.length > 1) {
      const flyout = el('div', { class: 'flyout panel', hidden: '' })
      flyout.style.setProperty('--cols', String(Math.min(members.length, 5)))
      for (const id of members) {
        const b = el('button', { 'data-tool': id, title: label(id), 'aria-label': info(id).title }, icons[id])
        b.addEventListener('click', () => {
          g.current = id
          g.show()
          closeFlyouts()
          pick(id)
        })
        flyout.append(b)
      }
      wrap.append(flyout)
      g.flyout = flyout
    }
    button.addEventListener('click', () => {
      const open = g.flyout && g.flyout.hidden
      closeFlyouts()
      if (g.current === 'image' || board.tool !== g.current) pick(g.current)
      if (open) g.flyout!.hidden = false
    })
    groups.push(g)
    tools.append(wrap)
  }
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement
    if (!t.closest('#tools')) closeFlyouts()
    if (!t.closest('.pop, #topbar')) closePops()
  })
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    closeFlyouts()
    closePops()
  })

  // ---------- top: history, view, colour, width, then what fits the tool or the selection ----------
  const top = $('#topbar')
  const btn = (icon: string, title: string, on: () => void, cls = '') => {
    const b = el('button', { title, 'aria-label': title, class: cls }, icon) as HTMLButtonElement
    b.addEventListener('click', on)
    return b
  }
  const section = (cls: string, ...kids: HTMLElement[]) => {
    const s = el('div', { class: `section ${cls}` })
    s.append(...kids)
    return s
  }
  const sep = () => el('span', { class: 'sep' })

  const undoBtn = btn(icons.undo, 'Отменить · Ctrl+Z', () => board.undo(), 'edit')
  const redoBtn = btn(icons.redo, 'Повторить · Ctrl+Shift+Z', () => board.redo(), 'edit')
  board.onHistory = () => {
    undoBtn.disabled = !board.canUndo
    redoBtn.disabled = !board.canRedo
  }
  board.onHistory()

  const zLabel = btn('100%', 'Масштаб 100%', () => board.resetZoom(), 'zoom')
  const view = section(
    'view',
    btn(icons.zoomOut, 'Отдалить', () => board.zoomBy(1 / 1.25)),
    zLabel,
    btn(icons.zoomIn, 'Приблизить', () => board.zoomBy(1.25)),
    btn(icons.home, 'К началу доски', () => board.home()),
  )

  const swatches = COLORS.map((c) => {
    const b = btn('', `Цвет ${c}`, () => pickColor(c), 'swatch')
    b.style.setProperty('--c', c)
    return b
  })
  const custom = el('input', { type: 'color', title: 'Свой цвет', class: 'custom' }) as HTMLInputElement
  custom.addEventListener('input', () => pickColor(custom.value))
  const pipette = btn(icons.pipette, 'Пипетка: взять цвет', async () => {
    const ED = (window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper
    if (ED) {
      // the browser's own pipette: anywhere on the screen, video included
      try {
        pickColor((await new ED().open()).sRGBHex)
      } catch {}
    } else {
      board.setTool('pipette')
      say('Щёлкните по доске там, где нужный цвет')
    }
  })
  board.onPipette = (c) => pickColor(c)
  const colors = section('colors edit', ...swatches, custom, pipette)

  const widthBtns = WIDTHS.map((w) =>
    btn(`<i style="width:${w + 2}px;height:${w + 2}px"></i>`, `Толщина ${w}`, () => pickWidth(w), 'width'),
  )
  const widths = section('widths edit', ...widthBtns)

  const fillBtn = btn(icons.fill, 'Заливка', () => {}, 'fill-btn')
  popover(fillBtn, (pop) => {
    const none = el('button', { class: 'wide' }, 'Без заливки')
    none.addEventListener('click', () => pickFill(''))
    const grid = el('div', { class: 'swatches' })
    for (const c of [...TINTS, ...COLORS]) {
      const b = el('button', { class: 'swatch', title: c, 'aria-label': `Заливка ${c}` })
      b.style.setProperty('--c', c)
      b.classList.toggle('on', board.fill === c)
      b.addEventListener('click', () => pickFill(c))
      grid.append(b)
    }
    pop.append(none, grid)
  })
  const fills = section('fills edit', fillBtn)

  const fontSel = el('select', { title: 'Шрифт', 'aria-label': 'Шрифт' }, FONTS.map((f) => `<option value="${f.value}">${f.label}</option>`).join('')) as HTMLSelectElement
  const sizeSel = el('select', { title: 'Размер шрифта', 'aria-label': 'Размер шрифта' }, SIZES.map((s) => `<option>${s}</option>`).join('')) as HTMLSelectElement
  fontSel.addEventListener('change', () => board.setTextStyle({ fontFamily: fontSel.value }))
  sizeSel.addEventListener('change', () => board.setTextStyle({ fontSize: +sizeSel.value }))
  const boldBtn = btn(icons.bold, 'Жирный', () => {
    board.setTextStyle({ fontWeight: board.text.fontWeight === 'bold' ? 'normal' : 'bold' })
    syncText()
  })
  const italicBtn = btn(icons.italic, 'Курсив', () => {
    board.setTextStyle({ fontStyle: board.text.fontStyle === 'italic' ? 'normal' : 'italic' })
    syncText()
  })
  const underBtn = btn(icons.underline, 'Подчёркнутый', () => {
    board.setTextStyle({ underline: !board.text.underline })
    syncText()
  })
  const texts = section('texts edit', fontSel, sizeSel, boldBtn, italicBtn, underBtn)
  function syncText() {
    const t = board.text
    fontSel.value = t.fontFamily
    sizeSel.value = String(t.fontSize)
    if (!sizeSel.value) sizeSel.value = '28'
    boldBtn.classList.toggle('on', t.fontWeight === 'bold')
    italicBtn.classList.toggle('on', t.fontStyle === 'italic')
    underBtn.classList.toggle('on', t.underline)
  }

  const groupBtn = btn(icons.group, 'Сгруппировать', () => board.group())
  const ungroupBtn = btn(icons.ungroup, 'Разгруппировать', () => board.ungroup())
  // actions on the selection float above it rather than crowding the top bar
  const sel = el('div', { id: 'selbar', class: 'panel edit', hidden: '' })
  sel.append(
    btn(icons.duplicate, 'Дублировать · Ctrl+D', () => board.duplicate()),
    btn(icons.front, 'На передний план', () => board.bringToFront()),
    btn(icons.back, 'На задний план', () => board.sendToBack()),
    btn(icons.flip, 'Отразить', () => board.flip()),
    groupBtn,
    ungroupBtn,
    btn(icons.lock, 'Закрепить (открепить — инструментом «Закрепление»)', () => board.lockSelection()),
    btn(icons.trash, 'Удалить · Delete', () => board.deleteSelection()),
  )
  $('#wrap').append(sel)
  function placeSelbar() {
    const a = board.canvas.getActiveObject()
    if (!a || (a as { isEditing?: boolean }).isEditing) return void (sel.hidden = true)
    sel.hidden = false
    const pts = a.getCoords().map((p) => board.sceneToScreen(p.x, p.y))
    const x0 = Math.min(...pts.map((p) => p.x))
    const x1 = Math.max(...pts.map((p) => p.x))
    const y0 = Math.min(...pts.map((p) => p.y))
    const y1 = Math.max(...pts.map((p) => p.y))
    const W = $('#wrap').clientWidth
    const H = $('#wrap').clientHeight
    const w = sel.offsetWidth
    const h = sel.offsetHeight
    const left = Math.max(8, Math.min((x0 + x1) / 2 - w / 2, W - w - 8))
    // above the selection (clear of the rotate handle), below it if there's no room, on screen in any case
    let top = y0 - h - 36
    if (top < 8) top = y1 + 14
    sel.style.left = `${left}px`
    sel.style.top = `${Math.max(8, Math.min(top, H - h - 8))}px`
  }
  for (const ev of ['object:moving', 'object:scaling', 'object:rotating'] as const) board.canvas.on(ev, () => (sel.hidden = true))
  for (const ev of ['object:modified', 'text:editing:exited', 'text:editing:entered'] as const) board.canvas.on(ev, () => placeSelbar())

  // right end: the sheet, the teacher's controls, the board menu
  const paperBtn = btn(icons.grid, 'Разлиновка листа', () => {}, 'edit')
  popover(paperBtn, (pop) => {
    for (const p of PAPERS) {
      const b = el('button', { class: 'wide' }, p.label)
      b.classList.toggle('on', board.paper === p.value)
      b.addEventListener('click', () => {
        board.setPaper(p.value)
        closePops()
      })
      pop.append(b)
    }
  })
  const followBtn = btn(icons.follow, 'Следовать за мной: ученик видит доску так же, как вы', () => setFollow(!following))
  const lockBtn = btn(icons.boardLock, 'Заблокировать доску ученика: он сможет только смотреть и показывать указкой', () =>
    setBoardLock(!boardLocked),
  )
  const menuBtn = btn(icons.menu, 'Меню доски', () => {})
  popover(menuBtn, (pop) => {
    const save = el('button', { class: 'wide' }, `${icons.download}<span>Сохранить доску картинкой</span>`)
    save.addEventListener('click', async () => {
      closePops()
      const blob = await board.exportPng()
      if (!blob) return say('Доска пуста')
      const a = el('a', { href: URL.createObjectURL(blob), download: `доска-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.png` })
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.getAttribute('href')!), 10_000)
    })
    const clear = el('button', { class: 'wide danger edit' }, `${icons.trash}<span>Очистить доску</span>`)
    clear.addEventListener('click', () => {
      if (!clear.dataset.sure) {
        clear.dataset.sure = '1'
        clear.querySelector('span')!.textContent = 'Точно очистить? Нажмите ещё раз (можно отменить Ctrl+Z)'
        return
      }
      closePops()
      board.clear()
    })
    pop.append(save, clear)
  })

  top.append(
    section('history', undoBtn, redoBtn),
    sep(),
    view,
    sep(),
    colors,
    sep(),
    widths,
    fills,
    texts,
    el('div', { class: 'grow' }),
    paperBtn,
    ...(teacher ? [followBtn, lockBtn] : []),
    menuBtn,
  )

  function pickColor(c: string) {
    board.setColor(c)
    swatches.forEach((s, i) => s.classList.toggle('on', COLORS[i] === c))
    custom.value = c
  }
  function pickWidth(w: number) {
    board.setWidth(w)
    widthBtns.forEach((b, i) => b.classList.toggle('on', WIDTHS[i] === w))
  }
  function pickFill(c: string) {
    board.setFill(c)
    fillBtn.style.setProperty('--c', c || 'transparent')
    fillBtn.classList.toggle('has', !!c)
    closePops()
  }
  pickColor(COLORS[0])
  pickWidth(WIDTHS[0])
  syncText()

  /** Shows only the top-bar sections that apply to the current tool and selection. */
  function refreshBar() {
    const t = board.tool
    const objs = board.canvas.getActiveObjects()
    const types = new Set(objs.map((o) => o.type))
    const hasText = types.has('i-text') || types.has('text')
    const shapeSel = ['rect', 'ellipse', 'polygon'].some((x) => types.has(x))
    fills.hidden = !(isShape(t) || t === 'polygon' || shapeSel)
    texts.hidden = !(t === 'text' || hasText)
    placeSelbar()
    widths.hidden = t === 'text' || t === 'pointer' || t === 'hand' || (objs.length > 0 && objs.every((o) => o.type === 'i-text' || o.type === 'image'))
    groupBtn.hidden = !board.canGroup
    ungroupBtn.hidden = !board.canUngroup
    if (objs.length === 1 && hasText) {
      const o = objs[0] as unknown as Record<string, unknown>
      Object.assign(board.text, {
        fontFamily: o.fontFamily,
        fontSize: o.fontSize,
        fontWeight: o.fontWeight === 'bold' ? 'bold' : 'normal',
        fontStyle: o.fontStyle === 'italic' ? 'italic' : 'normal',
        underline: !!o.underline,
      })
      syncText()
    }
  }
  board.onSelection = refreshBar

  board.onToolChange = (tool) => {
    for (const g of groups) {
      if (g.members.includes(tool as ToolId) && g.current !== tool) {
        g.current = tool as ToolId
        g.show()
      }
      g.button.classList.toggle('on', g.members.includes(tool as ToolId))
    }
    for (const b of tools.querySelectorAll<HTMLElement>('.flyout button')) b.classList.toggle('on', b.dataset.tool === tool)
    refreshBar()
  }
  board.onToolChange(board.tool)

  // tool shortcuts
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const editing = (board.canvas.getActiveObject() as { isEditing?: boolean } | undefined)?.isEditing
    if (editing || (e.target as HTMLElement).closest('input, textarea, select')) return
    const t = TOOLS.find((x) => x.key && (x.key === e.code.replace('Key', '') || x.key === e.key.toUpperCase()))
    if (!t) return
    closeFlyouts()
    pick(t.id)
  })

  // pictures: file, paste, drop; Ctrl+V of board objects copied with Ctrl+C
  $<HTMLInputElement>('#file').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (f && !board.readOnly) board.addImage(f)
    ;(e.target as HTMLInputElement).value = ''
  })
  window.addEventListener('paste', (e) => {
    if ((e.target as HTMLElement).closest?.('input, textarea') || board.readOnly) return
    if ((board.canvas.getActiveObject() as { isEditing?: boolean } | undefined)?.isEditing) return
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'))
    const f = item?.getAsFile()
    if (f) {
      e.preventDefault()
      board.addImage(f)
    } else if (board.hasClip) {
      e.preventDefault()
      board.paste()
    }
  })
  $('#wrap').addEventListener('dragover', (e) => e.preventDefault())
  $('#wrap').addEventListener('drop', (e) => {
    e.preventDefault()
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'))
    if (f && !board.readOnly) board.addImage(f)
  })

  // ---------- right: camera, microphone, link, leave ----------
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
    const v = tile('me', name || 'Вы', true).querySelector('video')!
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

  // ---------- the teacher's controls: follow me, lock the student's board ----------
  let following = false
  let boardLocked = false
  const sendView = throttle(() => {
    const c = board.viewCenter()
    peers.broadcastVolatile({ op: 'view', x: c.x, y: c.y, z: board.canvas.getZoom() })
  }, 60)
  function setFollow(on: boolean) {
    following = on
    followBtn.classList.toggle('on', on)
    peers.broadcast({ op: 'follow', on })
    if (on) sendView()
    say(on ? 'Ученик видит доску так же, как вы' : 'Ученик снова сам выбирает, что смотреть')
  }
  function setBoardLock(on: boolean) {
    boardLocked = on
    lockBtn.classList.toggle('on', on)
    peers.broadcast({ op: 'lock', on })
    say(on ? 'Доска ученика заблокирована' : 'Ученик снова может рисовать')
  }
  function lockedByTeacher(on: boolean) {
    board.setReadOnly(on)
    app.classList.toggle('readonly', on)
    say(on ? 'Учитель заблокировал доску: можно смотреть и показывать указкой' : 'Учитель разблокировал доску', 4000)
  }

  board.onViewport = () => {
    placeCursors()
    placeSelbar()
    zLabel.textContent = `${Math.round(board.canvas.getZoom() * 100)}%`
    if (following) sendView()
  }
  board.onViewport()

  const peerName = (peer: PeerInfo) => peer.name || (peer.teacher ? 'Учитель' : 'Ученик')
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
      const t = tile(peer.id, peerName(peer), false)
      const v = t.querySelector('video')!
      if (v.srcObject !== stream) v.srcObject = stream
      t.classList.toggle('novideo', !stream.getVideoTracks().length)
    },
    channelOpen: (_peer, ch) => {
      ch.send(board.snapshot())
      if (teacher && boardLocked) ch.send({ op: 'lock', on: true })
      if (teacher && following) {
        ch.send({ op: 'follow', on: true })
        sendView()
      }
    },
    message: (peer, msg) => {
      switch (msg.op) {
        case 'cur': {
          let c = cursorAt.get(peer.id)
          if (!c) {
            const e = el('div', { class: 'cursor' }, `<span>${escapeHtml(peerName(peer))}</span>`)
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
        case 'laser':
          return laser.add(peer.id, msg.x, msg.y, msg.s)
        // only the teacher (the server vouches for the flag) may steer the student's board
        case 'view':
          if (peer.teacher && !teacher) board.lookAt(msg.x, msg.y, msg.z)
          return
        case 'follow':
          if (peer.teacher && !teacher) say(msg.on ? 'Учитель ведёт доску: вы видите то же, что он' : 'Теперь доску можно листать самому', 4000)
          return
        case 'lock':
          if (peer.teacher && !teacher && msg.on !== board.readOnly) lockedByTeacher(!!msg.on)
          return
      }
      board.apply(msg)
    },
    gone: (peer) => {
      states.delete(peer.id)
      videos.querySelector(`[data-key="${peer.id}"]`)?.remove()
      cursorAt.get(peer.id)?.el.remove()
      cursorAt.delete(peer.id)
      if (peer.teacher && board.readOnly) lockedByTeacher(false)
      refreshStatus()
    },
  })
  refreshStatus()

  if (import.meta.env.DEV) Object.assign(window, { peers })
  board.onOp = (op) => peers.broadcast(op)
  board.onCursor = (x, y) => peers.broadcastVolatile({ op: 'cur', x, y })
  board.onLaser = (x, y, s) => {
    laser.add('me', x, y, s)
    peers.broadcastVolatile({ op: 'laser', x, y, s })
  }

  leaveBtn.addEventListener('click', () => {
    peers.leave()
    local?.getTracks().forEach((t) => t.stop())
    app.className = 'screen'
    app.innerHTML = `<main class="card"><h1>Вы вышли из занятия</h1><p>Доска хранилась только в ваших браузерах.</p><button class="primary" id="back">Вернуться</button></main>`
    app.querySelector('#back')!.addEventListener('click', () => location.reload())
  })
  window.addEventListener('beforeunload', () => peers.leave())
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

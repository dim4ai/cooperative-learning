import './style.css'
import { Board, isShape, throttle, type TextStyle, type Tool } from './board'
import { Peers, type LinkState } from './peers'
import type { PeerInfo } from './signaling'
import { icons } from './icons'
import { entryFromHash, newKey, parseCode, pretty, studentLink, teacherLink, type Entry } from './roles'
import { LINE_MARKS, MARKS, WORD_MARKS } from './marks'
import { SHAPES, SHAPE_KINDS } from './shapes'
import { BORDER_COLORS, LINE_COLORS, LINE_WEIGHTS, PAGE_SIZES, PAPERS, pageAt, type Sheet } from './paper'
import { Laser } from './laser'
import { FONTS, watchFonts } from './fonts'
import { Minimap } from './minimap'
import { camEntry, camLink, camOwner, myCamTag, phoneScreen, qrSvg } from './phonecam'

const app = document.getElementById('app')!

type ToolId = Exclude<Tool, 'pipette'> | 'image' | 'snapshot' | 'pdf'
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
  { id: 'image', title: 'Картинка из файла (или вставить Ctrl+V, перетащить файл)', key: 'I' },
  { id: 'pdf', title: 'PDF: выбрать страницы, обрезать поля и разложить по страницам доски (или перетащить файл)' },
  { id: 'snapshot', title: 'Снимок со своей камеры на доску (снимок с камеры собеседника — кнопкой на его видео)' },
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
  { members: ['image', 'pdf', 'snapshot'], title: 'Вставить: картинку, PDF или снимок с камеры' },
]
/** Not tools but one-off actions */
const ACTIONS: ToolId[] = ['image', 'pdf', 'snapshot']
const COLORS = ['#1f2937', '#dc2626', '#2563eb', '#16a34a', '#ea580c', '#9333ea']
const TINTS = ['#e5e7eb', '#fecaca', '#bfdbfe', '#bbf7d0', '#fed7aa', '#e9d5ff']
const WIDTHS = [2, 4, 8]
const SIZES = [16, 20, 24, 28, 36, 48, 64, 96]

const PREFS_KEY = 'pair.prefs'
type Prefs = { sheet?: Partial<Sheet>; color?: string; width?: number; fill?: string; text?: Partial<TextStyle> }

function loadPrefs(): Prefs {
  try {
    const v = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
    return v && typeof v === 'object' ? v : {}
  } catch {
    return {}
  }
}

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
    <input id="file" type="file" accept="image/*" hidden>
    <input id="pdf" type="file" accept="application/pdf,.pdf" hidden>`

  const $ = <T extends HTMLElement>(s: string) => app.querySelector<T>(s)!
  const board = new Board($<HTMLCanvasElement>('#board'), $('#wrap'), $<HTMLCanvasElement>('#paper'))
  board.isTeacher = teacher
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
    const show = () => {
      pop.innerHTML = ''
      fill(pop)
      const r = button.getBoundingClientRect()
      pop.hidden = false
      pop.style.top = `${r.bottom + pop.offsetHeight + 8 > innerHeight ? Math.max(8, r.top - pop.offsetHeight - 6) : r.bottom + 6}px`
      pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`
    }
    button.addEventListener('click', () => {
      const open = pop.hidden
      closePops()
      if (open) show()
    })
    /** redraws an open popover after its data changed */
    return () => {
      if (!pop.hidden) show()
    }
  }

  // ---------- left: tools — single buttons and groups with a flyout to the right ----------
  const tools = $('#tools')
  const info = (id: ToolId) => TOOLS.find((t) => t.id === id)!
  const label = (id: ToolId) => {
    const t = info(id)
    return t.key ? `${t.title} · ${t.key}` : t.title
  }
  const pick = (id: ToolId) => {
    if (board.readOnly && id !== 'hand' && id !== 'pointer') return
    if (id === 'image') $<HTMLInputElement>('#file').click()
    else if (id === 'pdf') importPdf()
    else if (id === 'snapshot') snapshot(null)
    else board.setTool(id)
  }
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
        button.title = !title ? label(g.current) : members.every((id) => ACTIONS.includes(id)) ? title : `${title}: ${label(g.current)}`
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
    // a group of one-off actions (picture, PDF, snapshot) only opens its row: nothing pops up by surprise
    const actions = members.every((id) => ACTIONS.includes(id))
    button.addEventListener('click', () => {
      const open = g.flyout && g.flyout.hidden
      closeFlyouts()
      if (actions && g.flyout) {
        if (open) g.flyout.hidden = false
        return
      }
      if (ACTIONS.includes(g.current) || board.tool !== g.current) pick(g.current)
      if (open) g.flyout!.hidden = false
    })
    groups.push(g)
    tools.append(wrap)
  }
  document.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement
    if (!t.closest('#tools')) closeFlyouts()
    if (!t.closest('.pop, #topbar, #corner')) closePops()
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
  // the page in the middle of the screen, [column:row] as written on the pages; click to go to another one
  const pageBtn = btn('0:0', 'Лист в центре экрана (столбец:строка). Нажмите, чтобы перейти к листу', () => {}, 'page-at')
  view.append(pageBtn)
  popover(pageBtn, (pop) => {
    const [ci, cj] = pageAt(board.sheet, board.viewCenter().x, board.viewCenter().y)
    const form = el('form', { class: 'mark-form' }) as HTMLFormElement
    const col = el('input', { type: 'number', value: String(ci), 'aria-label': 'Столбец', class: 'num' }) as HTMLInputElement
    const row = el('input', { type: 'number', value: String(cj), 'aria-label': 'Строка', class: 'num' }) as HTMLInputElement
    const go = el('button', { type: 'submit' }, 'Перейти')
    form.append(el('span', { class: 'pop-label' }, 'Лист'), col, el('span', { class: 'pop-label' }, ':'), row, go)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      board.goToPage(Math.round(+col.value || 0), Math.round(+row.value || 0))
      closePops()
    })
    pop.append(form, el('p', { class: 'pop-hint' }, 'Столбец и строка листа, как в метке в углу листа: [0:0] — первый лист, [1:0] — справа от него, [0:1] — под ним.'))
    setTimeout(() => col.select())
  })
  const showPage = () => {
    const [i, j] = pageAt(board.sheet, board.viewCenter().x, board.viewCenter().y)
    pageBtn.textContent = `${i}:${j}`
    pageBtn.hidden = !board.sheet.borders
    pageBtn.style.color = board.sheet.borderColor
  }
  showPage()

  const swatches = COLORS.map((c) => {
    const b = btn('', `Цвет ${c}`, () => pickColor(c), 'swatch')
    b.style.setProperty('--c', c)
    return b
  })
  // own colour: a rainbow circle (the browser's colour picker opens from it); the chosen colour shows in its middle
  const customWrap = el('label', { class: 'custom', title: 'Свой цвет' })
  const custom = el('input', { type: 'color', 'aria-label': 'Свой цвет' }) as HTMLInputElement
  customWrap.append(custom)
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
  const colors = section('colors edit', ...swatches, customWrap, pipette)

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

  const fontSel = el('select', { title: 'Шрифт', 'aria-label': 'Шрифт' }, FONTS.map((f) => `<option value="${f.value}" style="font-family:${f.value.replace(/"/g, '')}">${f.label}</option>`).join('')) as HTMLSelectElement
  const sizeSel = el('select', { title: 'Размер шрифта', 'aria-label': 'Размер шрифта' }, SIZES.map((s) => `<option>${s}</option>`).join('')) as HTMLSelectElement
  fontSel.addEventListener('change', () => setText({ fontFamily: fontSel.value }))
  sizeSel.addEventListener('change', () => setText({ fontSize: +sizeSel.value }))
  const boldBtn = btn(icons.bold, 'Жирный', () => {
    setText({ fontWeight: board.text.fontWeight === 'bold' ? 'normal' : 'bold' })
    syncText()
  })
  const italicBtn = btn(icons.italic, 'Курсив', () => {
    setText({ fontStyle: board.text.fontStyle === 'italic' ? 'normal' : 'italic' })
    syncText()
  })
  const underBtn = btn(icons.underline, 'Подчёркнутый', () => {
    setText({ underline: !board.text.underline })
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
  const cropBtn = btn(icons.crop, 'Обрезать картинку', () => board.startCrop())
  const uncropBtn = btn(icons.uncrop, 'Вернуть картинку целиком', () => board.uncropSelection())
  const cropDone = btn(`${icons.check}<span>Обрезать</span>`, 'Обрезать по рамке · Enter', () => board.finishCrop(true), 'labeled')
  const cropCancel = btn(icons.close, 'Отмена · Esc', () => board.finishCrop(false))
  const selActions = [
    cropBtn,
    uncropBtn,
    btn(icons.duplicate, 'Дублировать · Ctrl+D', () => board.duplicate()),
    btn(icons.front, 'На передний план', () => board.bringToFront()),
    btn(icons.back, 'На задний план', () => board.sendToBack()),
    btn(icons.flip, 'Отразить', () => board.flip()),
    groupBtn,
    ungroupBtn,
    btn(icons.lock, 'Закрепить (открепить — инструментом «Закрепление»)', () => board.lockSelection()),
    btn(icons.trash, 'Удалить · Delete', () => board.deleteSelection()),
  ]
  sel.append(...selActions, cropDone, cropCancel)
  $('#wrap').append(sel)
  function placeSelbar() {
    const a = board.canvas.getActiveObject()
    if (!a || (a as { isEditing?: boolean }).isEditing) return void (sel.hidden = true)
    sel.hidden = false
    const cropping = !!board.cropping
    selActions.forEach((b) => (b.hidden = cropping))
    cropDone.hidden = cropCancel.hidden = !cropping
    if (!cropping) {
      cropBtn.hidden = !board.canCrop
      uncropBtn.hidden = !board.canUncrop
      groupBtn.hidden = !board.canGroup
      ungroupBtn.hidden = !board.canUngroup
    }
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
  const paperBtn = btn(icons.grid, 'Лист: разлиновка, линии, страницы', () => {}, 'edit')
  const refreshSheet = popover(paperBtn, (pop) => {
    const sh = board.sheet
    const head = (t: string) => pop.append(el('p', { class: 'pop-head' }, t))
    const row = (cls = '') => {
      const r = el('div', { class: `pop-row ${cls}` })
      pop.append(r)
      return r
    }
    const choice = (parent: HTMLElement, label: string, on: boolean, act: () => void, cls = 'chip') => {
      const b = el('button', { class: cls }, label)
      b.classList.toggle('on', on)
      b.addEventListener('click', act)
      parent.append(b)
      return b
    }
    head('Разлиновка')
    const papers = row('papers')
    for (const p of PAPERS) choice(papers, p.label, sh.paper === p.value, () => setSheet({ paper: p.value }))
    head('Линии разметки')
    const colorsRow = row()
    for (const c of LINE_COLORS) {
      const b = choice(colorsRow, '', sh.color === c.value, () => setSheet({ color: c.value }), 'swatch')
      b.title = c.label
      b.setAttribute('aria-label', `Цвет линий: ${c.label}`)
      b.style.setProperty('--c', c.value)
    }
    const weights = row()
    for (const w of LINE_WEIGHTS) choice(weights, w.label, sh.weight === w.value, () => setSheet({ weight: w.value }))
    head('Страницы')
    const sizes = row()
    for (const p of PAGE_SIZES) choice(sizes, p.label, sh.page === p.value, () => setSheet({ page: p.value }))
    choice(sizes, 'Книжная', !sh.landscape, () => setSheet({ landscape: false }))
    choice(sizes, 'Альбомная', sh.landscape, () => setSheet({ landscape: true }))
    const borders = el('label', { class: 'check' }, `<input type="checkbox"${sh.borders ? ' checked' : ''}> Показывать границы страниц`)
    borders.querySelector('input')!.addEventListener('change', (e) => setSheet({ borders: (e.target as HTMLInputElement).checked }))
    pop.append(borders)
    const borderColors = row()
    for (const c of BORDER_COLORS) {
      const b = choice(borderColors, '', sh.borderColor === c.value, () => setSheet({ borderColor: c.value, borders: true }), 'swatch')
      b.title = `Границы: ${c.label}`
      b.setAttribute('aria-label', `Цвет границ: ${c.label}`)
      b.style.setProperty('--c', c.value)
    }
    pop.append(el('p', { class: 'pop-hint' }, 'Доска делится на страницы выбранного размера. В PDF сохраняются страницы, на которых что-то есть.'))
  })
  board.onSheet = () => {
    refreshSheet()
    showPage()
  }

  // layers, as in the lesson editor
  const layersBtn = btn(icons.layers, 'Слои', () => {})
  const refreshLayers = popover(layersBtn, (pop) => {
    pop.classList.add('layers-pop')
    const sel = board.canvas.getActiveObjects()
    for (const l of [...board.layers].reverse()) {
      const r = el('div', { class: 'layer' })
      r.classList.toggle('on', l.id === board.activeLayer)
      const name = el('button', { class: 'layer-name', title: 'Сделать текущим: новое рисуется в нём. Двойной щелчок — переименовать' }, '')
      name.textContent = `${l.name} · ${board.countInLayer(l.id)}`
      name.addEventListener('click', () => board.setActiveLayer(l.id))
      name.addEventListener('dblclick', () => {
        const input = el('input', { value: l.name, maxlength: '40', class: 'layer-rename' }) as HTMLInputElement
        name.replaceWith(input)
        input.focus()
        input.select()
        const done = () => {
          const v = input.value.trim()
          if (v && v !== l.name) board.patchLayer(l.id, { name: v })
          else refreshLayers()
        }
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') done()
          if (e.key === 'Escape') refreshLayers()
        })
        input.addEventListener('blur', done)
      })
      const icon = (svg: string, title: string, on: boolean, act: () => void, cls = '') => {
        const b = btn(svg, title, act, cls)
        b.classList.toggle('on', on)
        return b
      }
      const mine = board.hiddenForMe.has(l.id)
      r.append(
        name,
        ...(sel.length ? [icon(icons.moveIn, 'Перенести выделенное в этот слой', false, () => board.moveSelectionToLayer(l.id), 'edit')] : []),
        icon(mine ? icons.eyeOff : icons.eye, mine ? 'Показать у себя' : 'Скрыть у себя (собеседник видит)', mine, () => board.toggleHidden(l.id)),
        icon(icons.boardLock, l.locked ? 'Разблокировать слой' : 'Заблокировать слой: его нельзя выделить и стереть', !!l.locked, () =>
          board.patchLayer(l.id, { locked: !l.locked }), 'edit'),
        ...(teacher
          ? [icon(icons.studentHidden, l.studentHidden ? 'Показать ученику' : 'Скрыть от ученика (у вас слой бледный)', !!l.studentHidden, () =>
              board.patchLayer(l.id, { studentHidden: !l.studentHidden }), 'edit')]
          : []),
        icon(icons.up, 'Выше', false, () => board.moveLayer(l.id, 1), 'edit'),
        icon(icons.down, 'Ниже', false, () => board.moveLayer(l.id, -1), 'edit'),
      )
      if (board.layers.length > 1) {
        const del = icon(icons.trash, 'Удалить слой', false, () => {
          if (board.countInLayer(l.id) && !del.dataset.sure) {
            del.dataset.sure = '1'
            del.classList.add('sure')
            del.title = `Удалить вместе с объектами (${board.countInLayer(l.id)})? Нажмите ещё раз; вернуть — Ctrl+Z`
            return
          }
          board.deleteLayer(l.id)
        }, 'edit')
        r.append(del)
      }
      pop.append(r)
    }
    const add = el('button', { class: 'wide edit' }, `${icons.plus}<span>Новый слой</span>`)
    add.addEventListener('click', () => board.addLayer())
    pop.append(add)
    if (!teacher) return
    pop.append(el('p', { class: 'pop-hint' }, 'Скрытое от ученика всё равно передаётся в его браузер: для заготовок и ответов, а не для секретов.'))
  })
  board.onLayers = () => refreshLayers()
  board.onNotice = (text) => say(text, 3500)
  board.canvas.on('selection:created', () => refreshLayers())
  board.canvas.on('selection:cleared', () => refreshLayers())

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
    const pdf = el('button', { class: 'wide' }, `${icons.download}<span>Сохранить в PDF (страницы, где что-то есть)</span>`)
    pdf.addEventListener('click', async () => {
      closePops()
      say('Готовим PDF…', 60_000)
      const blob = await board.exportPdf((done, total) => say(`Готовим PDF: страница ${done} из ${total}`, 60_000))
      if (!blob) return say('Доска пуста')
      say('PDF готов')
      const a = el('a', { href: URL.createObjectURL(blob), download: `доска-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.pdf` })
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.getAttribute('href')!), 30_000)
    })
    pop.append(save, pdf, clear)
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
    layersBtn,
    ...(teacher ? [followBtn, lockBtn] : []),
    menuBtn,
  )

  // my settings stay in this browser: the sheet, colour, width, fill, text
  let restored = false
  function savePrefs() {
    if (!restored) return
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ sheet: board.sheet, color: board.color, width: board.width, fill: board.fill, text: board.text }))
    } catch {}
  }
  function setSheet(patch: Partial<Sheet>) {
    board.setSheet(patch)
    savePrefs()
  }
  function setText(patch: Partial<TextStyle>) {
    board.setTextStyle(patch)
    savePrefs()
  }

  function pickColor(c: string) {
    board.setColor(c)
    savePrefs()
    swatches.forEach((s, i) => s.classList.toggle('on', COLORS[i] === c))
    custom.value = c
    const own = !COLORS.includes(c)
    customWrap.classList.toggle('on', own)
    customWrap.style.setProperty('--c', own ? c : 'transparent')
  }
  function pickWidth(w: number) {
    board.setWidth(w)
    savePrefs()
    widthBtns.forEach((b, i) => b.classList.toggle('on', WIDTHS[i] === w))
  }
  function pickFill(c: string) {
    board.setFill(c)
    savePrefs()
    fillBtn.style.setProperty('--c', c || 'transparent')
    fillBtn.classList.toggle('has', !!c)
    closePops()
  }
  {
    const prefs = loadPrefs()
    const hex = (v: unknown) => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)
    if (prefs.sheet) board.setSheet(prefs.sheet, false) // until the lesson meets the teacher's sheet
    pickColor(hex(prefs.color) ? prefs.color! : COLORS[0])
    pickWidth(WIDTHS.includes(prefs.width!) ? prefs.width! : WIDTHS[0])
    if (prefs.fill === '' || hex(prefs.fill)) pickFill(prefs.fill!)
    const t = prefs.text ?? {}
    if (FONTS.some((f) => f.value === t.fontFamily)) board.text.fontFamily = t.fontFamily!
    if (SIZES.includes(t.fontSize!)) board.text.fontSize = t.fontSize!
    if (t.fontWeight === 'bold' || t.fontWeight === 'normal') board.text.fontWeight = t.fontWeight
    if (t.fontStyle === 'italic' || t.fontStyle === 'normal') board.text.fontStyle = t.fontStyle
    if (typeof t.underline === 'boolean') board.text.underline = t.underline
    syncText()
    restored = true
  }

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
  board.onCrop = refreshBar
  board.onFont = watchFonts(board.canvas)

  // ---------- bottom left: bookmarks and the board map ----------
  const corner = el('div', { id: 'corner' })
  const minimap = new Minimap(board)
  minimap.el.id = 'minimap'
  minimap.el.hidden = true
  const marksBtn = btn(icons.bookmark, 'Закладки: запомнить место на доске и вернуться к нему', () => {})
  const mapBtn = btn(icons.map, 'Карта доски', () => {
    minimap.show(Boolean(minimap.el.hidden))
    mapBtn.classList.toggle('on', !minimap.el.hidden)
  })
  const cornerBar = el('div', { class: 'panel corner-bar' })
  cornerBar.append(marksBtn, mapBtn)
  corner.append(minimap.el, cornerBar)
  $('#wrap').append(corner)
  popover(marksBtn, (pop) => {
    const form = el('form', { class: 'mark-form' }) as HTMLFormElement
    const input = el('input', { placeholder: `Закладка ${board.bookmarks.length + 1}`, maxlength: '40', 'aria-label': 'Название закладки' }) as HTMLInputElement
    const add = el('button', { type: 'submit', title: 'Запомнить то, что сейчас на экране' }, 'Добавить')
    form.append(input, add)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      board.addBookmark(input.value.trim() || input.placeholder)
      closePops()
      say('Закладка добавлена: она видна обоим')
    })
    pop.append(form)
    if (!board.bookmarks.length) pop.append(el('p', { class: 'pop-hint' }, 'Закладка запоминает, какая часть доски сейчас на экране и в каком масштабе.'))
    for (const b of board.bookmarks) {
      const row = el('div', { class: 'mark-row' })
      const go = el('button', { class: 'wide' }, `${icons.bookmark}<span></span>`)
      go.querySelector('span')!.textContent = b.name
      go.addEventListener('click', () => {
        board.goTo(b)
        closePops()
      })
      const del = el('button', { title: 'Удалить закладку', 'aria-label': 'Удалить закладку', class: 'edit' }, icons.close)
      del.addEventListener('click', () => {
        board.removeBookmark(b.id)
        row.remove()
      })
      row.append(go, del)
      pop.append(row)
    }
    setTimeout(() => input.focus())
  })
  board.onBookmarks = () => marksBtn.classList.toggle('has', board.bookmarks.length > 0)

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
  $<HTMLInputElement>('#pdf').addEventListener('change', (e) => {
    const f = (e.target as HTMLInputElement).files?.[0]
    if (f) importPdf(f)
    ;(e.target as HTMLInputElement).value = ''
  })
  async function importPdf(file?: File) {
    if (board.readOnly) return
    if (file) say('Открываем PDF…')
    try {
      const { pdfDialog } = await import('./pdfimport')
      const pages = await pdfDialog(file)
      if (!pages?.length) return
      await board.placePages(pages)
      say(`Вставлено страниц: ${pages.length}`)
    } catch (err) {
      console.warn(err)
      say('Не удалось открыть PDF')
    }
  }
  $('#wrap').addEventListener('drop', (e) => {
    e.preventDefault()
    const pdfFile = [...(e.dataTransfer?.files ?? [])].find((x) => x.type === 'application/pdf' || /\.pdf$/i.test(x.name))
    if (pdfFile) return void importPdf(pdfFile)
    const f = [...(e.dataTransfer?.files ?? [])].find((x) => x.type.startsWith('image/'))
    if (f && !board.readOnly) board.addImage(f)
  })

  // ---------- right: camera, microphone, link, leave ----------
  const side = $('#side')
  const local = await getMedia()
  const camBtn = el('button', { title: 'Камера', 'aria-label': 'Камера' }, icons.cam)
  const micBtn = el('button', { title: 'Микрофон', 'aria-label': 'Микрофон' }, icons.mic)
  const phoneBtn = el('button', { title: 'Подключить смартфон как камеру для тетради', 'aria-label': 'Подключить смартфон' }, icons.phone)
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
  side.append(camBtn, micBtn, phoneBtn, linkBtn, el('div', { class: 'grow' }), leaveBtn)

  // ---------- notebook camera: a phone joins by a QR code ----------
  const camTag = myCamTag()
  const isMyCam = (peer: PeerInfo) => peer.role === 'cam' && camOwner(peer.name).tag === camTag
  let closePhoneDialog: (() => void) | null = null
  phoneBtn.addEventListener('click', () => {
    const link = camLink(room, `${camTag}:${name || (teacher ? 'Учитель' : 'Ученик')}`.slice(0, 40))
    const overlay = el('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Подключить смартфон' })
    overlay.innerHTML = `<div class="modal-card phone-pick">
        <div class="modal-head"><b>Подключить смартфон</b></div>
        <div class="phone-body">
          <div class="qr">${qrSvg(link)}</div>
          <ol>
            <li>Отсканируйте код камерой телефона и откройте ссылку.</li>
            <li>Нажмите на телефоне «Подключиться» и разрешите доступ к камере.</li>
            <li>Поставьте телефон так, чтобы камера смотрела на лист. Подойдёт любая подставка, хоть катушка скотча.</li>
          </ol>
        </div>
        <p class="muted">Или откройте на телефоне ссылку:</p>
        <div class="copyline"><code class="link">${escapeHtml(link)}</code><button data-copy>Скопировать</button></div>
        <p class="muted">Картинка идёт с телефона напрямую вам и собеседнику, как видео. Если не соединяется, подключите телефон к той же сети Wi-Fi, что и компьютер.</p>
        <div class="modal-foot"><div class="grow"></div><button class="secondary" data-close>Закрыть</button></div>
      </div>`
    document.body.append(overlay)
    const close = () => {
      document.removeEventListener('keydown', onKey, true)
      overlay.remove()
      closePhoneDialog = null
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      close()
    }
    document.addEventListener('keydown', onKey, true)
    overlay.addEventListener('pointerdown', (e) => e.target === overlay && close())
    overlay.querySelector('[data-close]')!.addEventListener('click', close)
    overlay.querySelector('[data-copy]')!.addEventListener('click', async (e) => {
      try {
        await navigator.clipboard.writeText(link)
        ;(e.target as HTMLElement).textContent = 'Скопировано'
      } catch {}
    })
    closePhoneDialog = close
  })

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
      const shot = el('button', { class: 'shot edit', title: 'Снимок с этой камеры на доску', 'aria-label': 'Снимок на доску' }, icons.snapshot)
      const v = t.querySelector('video')!
      shot.addEventListener('click', () => snapshot(v))
      t.append(shot)
      if (mirrored) t.classList.add('me')
      key === 'me' ? videos.append(t) : videos.prepend(t)
    }
    t.querySelector('figcaption')!.textContent = label
    return t
  }
  /** A frame from a camera onto the board; my own camera when no video is given */
  function snapshot(video: HTMLVideoElement | null) {
    if (board.readOnly) return
    video ??= videos.querySelector<HTMLVideoElement>('[data-key="me"] video')
    if (!video || !video.videoWidth) return say('Камера выключена или недоступна')
    const cv = document.createElement('canvas')
    cv.width = video.videoWidth
    cv.height = video.videoHeight
    const ctx = cv.getContext('2d')!
    // my own video is shown mirrored, the snapshot is not: writing in a notebook reads right
    ctx.drawImage(video, 0, 0)
    cv.toBlob((b) => b && board.addImage(b), 'image/jpeg', 0.9)
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
    if (!list.some((s) => s.peer.role !== 'cam') && !list.some((s) => s.state === 'failed'))
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
    showPage()
    placeCursors()
    minimap.draw()
    placeSelbar()
    zLabel.textContent = `${Math.round(board.canvas.getZoom() * 100)}%`
    if (following) sendView()
  }
  board.onViewport()

  const peerName = (peer: PeerInfo) => {
    if (peer.role !== 'cam') return peer.name || (peer.teacher ? 'Учитель' : 'Ученик')
    if (isMyCam(peer)) return 'Ваша тетрадь'
    const owner = camOwner(peer.name).name
    return owner ? `Тетрадь: ${owner}` : 'Тетрадь'
  }
  const peers = new Peers(room, name, key, local, {
    waiting: () => refreshStatus(),
    full: () => showStatus('В этом занятии уже двое. Попросите новую ссылку.'),
    badKey: () => showStatus('Ссылка учителя повреждена. Скопируйте её заново целиком.'),
    offline: () => showStatus('Нет связи с сервером, переподключаемся…'),
    state: (peer, state) => {
      states.set(peer.id, { peer, state })
      refreshStatus()
      if (state === 'connected' && isMyCam(peer) && closePhoneDialog) {
        closePhoneDialog()
        say('Телефон подключён', 3000)
      }
    },
    stream: (peer, stream) => {
      const t = tile(peer.id, peerName(peer), false)
      t.classList.toggle('notebook', peer.role === 'cam')
      const v = t.querySelector('video')!
      if (peer.role === 'cam') {
        // a phone may be held either way: the tile takes the picture's shape
        const fit = () => v.videoWidth && (t.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`)
        v.onloadedmetadata = fit
        v.onresize = fit
      }
      if (v.srcObject !== stream) v.srcObject = stream
      t.classList.toggle('novideo', !stream.getVideoTracks().length)
    },
    channelOpen: (peer, ch) => {
      if (peer.role === 'cam') return
      ch.send(board.snapshot())
      if (teacher && boardLocked) ch.send({ op: 'lock', on: true })
      if (teacher && following) {
        ch.send({ op: 'follow', on: true })
        sendView()
      }
    },
    message: (peer, msg) => {
      if (peer.role === 'cam') return // a phone camera has nothing to say to the board
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
      // the teacher's sheet wins when two boards meet
      if (msg.op === 'sync' && teacher && !peer.teacher) delete msg.sheet
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
  const cam = camEntry()
  if (cam) return phoneScreen(app, cam.room, cam.owner)
  const entry = await entryFromHash()
  if (entry) joinScreen(entry)
  else startScreen(location.hash.length > 1 ? 'Ссылка не распознана — возможно, она скопирована не целиком. Введите код занятия.' : '')
}
window.addEventListener('hashchange', () => location.reload())
route()

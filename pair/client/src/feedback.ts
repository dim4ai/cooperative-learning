// "Write to us": an error, an idea or a review. The letter goes over a short WebSocket to our own
// signaling server, which mails it to our box; the address lives only in the server's .env.

const KINDS = [
  { id: 'bug', label: 'Ошибка', hint: 'Что делали, что ожидали, что вышло. Чем подробнее, тем быстрее найдём.' },
  { id: 'idea', label: 'Предложение', hint: 'Чего не хватает на занятии, что сделать удобнее.' },
  { id: 'other', label: 'Отзыв', hint: 'Как прошло занятие, что понравилось, что нет.' },
] as const

const MAX_PICS = 2
const MAX_PIC_BYTES = 1024 * 1024 // as on the server
const PART_CHARS = 48 * 1024

const ERRORS: Record<string, string> = {
  'bad picture': 'Картинку не удалось отправить. Попробуйте другую.',
  'picture too big': 'Картинка слишком большая.',
  busy: 'Сервер занят. Попробуйте через минуту.',
  'too many': 'Слишком много писем подряд. Попробуйте через час.',
  'not configured': 'Отправка писем пока не настроена. Попробуйте позже.',
  empty: 'Напишите хотя бы пару слов.',
}

/**
 * A picture → a JPEG of our own, at most 1800 px and 1 MB: drawing it anew leaves behind
 * everything in the file but the pixels (where it was taken, hidden parts).
 */
async function toJpeg(file: Blob): Promise<Blob | null> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    return null
  }
  let side = Math.min(1800, Math.max(bmp.width, bmp.height))
  try {
    for (let q = 0.85; ; ) {
      const f = side / Math.max(bmp.width, bmp.height)
      const cv = document.createElement('canvas')
      cv.width = Math.max(1, Math.round(bmp.width * f))
      cv.height = Math.max(1, Math.round(bmp.height * f))
      const ctx = cv.getContext('2d')!
      ctx.fillStyle = '#fff' // transparent screenshots: white, not black
      ctx.fillRect(0, 0, cv.width, cv.height)
      ctx.drawImage(bmp, 0, 0, cv.width, cv.height)
      const out = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/jpeg', q))
      if (!out) return null
      if (out.size <= MAX_PIC_BYTES) return out
      if (q > 0.65) q -= 0.1
      else side = Math.round(side * 0.75)
      if (side < 200) return null
    }
  } finally {
    bmp.close()
  }
}

async function base64(b: Blob) {
  const bytes = new Uint8Array(await b.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

/** One letter over a fresh socket; resolves to null when sent, or to the reason it wasn't. */
function send(letter: { kind: string; text: string; contact: string; where: string }, pics: Blob[]): Promise<string | null> {
  return new Promise((resolve) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    let ws: WebSocket
    try {
      ws = new WebSocket(`${proto}://${location.host}/ws`)
    } catch {
      return resolve('Нет связи с сервером. Проверьте интернет.')
    }
    let done = false
    const finish = (r: string | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      ws.close()
      resolve(r)
    }
    const timer = setTimeout(() => finish('Сервер не ответил. Попробуйте ещё раз.'), 60_000)
    ws.onopen = async () => {
      // pictures first, in parts; the letter last says how many
      for (const [n, pic] of pics.entries()) {
        const b64 = await base64(pic)
        for (let i = 0; i < b64.length; i += PART_CHARS) {
          if (done) return
          ws.send(JSON.stringify({ t: 'feedback-pic', n, data: b64.slice(i, i + PART_CHARS) }))
        }
      }
      if (!done) ws.send(JSON.stringify({ t: 'feedback', ...letter, pics: pics.length }))
    }
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      if (msg.t !== 'feedback') return
      finish(msg.ok ? null : (ERRORS[msg.error] ?? 'Не получилось отправить. Попробуйте позже.'))
    }
    ws.onclose = () => finish('Нет связи с сервером. Проверьте интернет.')
  })
}

/** Opens the form; `where` tells us which screen it came from (and who), never the lesson code. */
export function openFeedback(where: string) {
  const overlay = document.createElement('div')
  overlay.className = 'modal'
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-label', 'Написать нам')
  overlay.innerHTML = `<form class="modal-card feedback">
      <div class="modal-head"><b>Написать нам</b></div>
      <div class="feedback-body">
        <div class="feedback-kinds" role="radiogroup" aria-label="О чём письмо">
          ${KINDS.map((k, i) => `<label><input type="radio" name="kind" value="${k.id}"${i === 0 ? ' checked' : ''}><span>${k.label}</span></label>`).join('')}
        </div>
        <textarea name="text" rows="7" maxlength="4000" required aria-label="Текст письма"></textarea>
        <div class="feedback-pics">
          <button type="button" class="secondary" data-attach>Прикрепить картинку</button>
          <span class="muted">или вставьте снимок экрана: Ctrl+V. Проверьте, что на нём нет лишнего.</span>
          <input type="file" accept="image/*" multiple hidden>
        </div>
        <label class="feedback-contact"><span>Почта для ответа <span class="muted">(необязательно)</span></span>
          <input name="contact" type="email" maxlength="200" autocomplete="email" placeholder="name@example.ru">
        </label>
        <p class="muted">К письму приложим только название экрана, браузер и размер окна, и картинки, если вы их добавите. Код занятия и то, что на доске, не отправляем.</p>
        <p class="feedback-state" role="status"></p>
      </div>
      <div class="modal-foot"><div class="grow"></div><button type="button" class="secondary" data-close>Закрыть</button><button type="submit" class="primary-sm">Отправить</button></div>
    </form>`
  document.body.append(overlay)
  const form = overlay.querySelector('form')!
  const text = form.querySelector('textarea')!
  const state = form.querySelector<HTMLElement>('.feedback-state')!
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!
  const kind = () => (form.querySelector<HTMLInputElement>('input[name=kind]:checked')?.value ?? 'other') as (typeof KINDS)[number]['id']
  const showHint = () => (text.placeholder = KINDS.find((k) => k.id === kind())!.hint)
  showHint()
  form.querySelectorAll('input[name=kind]').forEach((r) => r.addEventListener('change', showHint))

  const close = () => {
    dropAll()
    document.removeEventListener('keydown', onKey, true)
    overlay.remove()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    close()
  }
  document.addEventListener('keydown', onKey, true)
  // the board below has its own shortcuts: typing a letter here mustn't pick a tool
  overlay.addEventListener('keydown', (e) => e.stopPropagation())
  overlay.addEventListener('pointerdown', (e) => e.target === overlay && close())
  form.querySelector('[data-close]')!.addEventListener('click', close)

  // pictures: from a file or pasted; shown as thumbnails, each can be taken back
  const pics: { blob: Blob; url: string }[] = []
  const box = form.querySelector<HTMLElement>('.feedback-pics')!
  const attach = box.querySelector<HTMLButtonElement>('[data-attach]')!
  const fileIn = box.querySelector<HTMLInputElement>('input[type=file]')!
  const hint = attach.nextElementSibling as HTMLElement
  const drawPics = () => {
    box.querySelectorAll('.feedback-pic').forEach((e) => e.remove())
    for (const p of pics) {
      const fig = document.createElement('span')
      fig.className = 'feedback-pic'
      fig.innerHTML = `<img alt="Картинка к письму"><button type="button" aria-label="Убрать картинку" title="Убрать">×</button>`
      fig.querySelector('img')!.src = p.url
      fig.querySelector('button')!.addEventListener('click', () => {
        URL.revokeObjectURL(p.url)
        pics.splice(pics.indexOf(p), 1)
        drawPics()
      })
      box.insertBefore(fig, attach)
    }
    attach.hidden = pics.length >= MAX_PICS
    hint.hidden = pics.length >= MAX_PICS
  }
  const addPics = async (files: Blob[]) => {
    for (const f of files) {
      if (pics.length >= MAX_PICS) {
        state.className = 'feedback-state error'
        state.textContent = `Можно приложить не больше ${MAX_PICS} картинок.`
        break
      }
      const blob = await toJpeg(f)
      if (!blob) {
        state.className = 'feedback-state error'
        state.textContent = 'Эту картинку не получилось открыть.'
        continue
      }
      state.textContent = ''
      pics.push({ blob, url: URL.createObjectURL(blob) })
    }
    drawPics()
  }
  attach.addEventListener('click', () => fileIn.click())
  fileIn.addEventListener('change', () => {
    addPics([...(fileIn.files ?? [])].filter((f) => f.type.startsWith('image/')))
    fileIn.value = ''
  })
  // a pasted picture belongs to the letter, not to the board below
  overlay.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
    e.stopPropagation()
    if (!files.length) return
    e.preventDefault()
    addPics(files)
  })
  const dropAll = () => pics.forEach((p) => URL.revokeObjectURL(p.url))

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    submit.disabled = true
    state.className = 'feedback-state'
    state.textContent = 'Отправляем…'
    const contact = form.querySelector<HTMLInputElement>('input[name=contact]')!.value
    const error = await send({ kind: kind(), text: text.value, contact, where: `${where}; окно ${innerWidth}×${innerHeight}` }, pics.map((p) => p.blob))
    if (error) {
      submit.disabled = false
      state.className = 'feedback-state error'
      state.textContent = error
      return
    }
    form.querySelector('.feedback-body')!.innerHTML = `<p class="feedback-done">Спасибо! Письмо отправлено${contact.trim() ? ', ответим на вашу почту' : ''}.</p>`
    submit.remove()
    form.querySelector<HTMLButtonElement>('[data-close]')!.focus()
  })
  text.focus()
}

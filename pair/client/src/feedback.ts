// "Write to us": an error, an idea or a review. The letter goes over a short WebSocket to our own
// signaling server, which mails it to our box; the address lives only in the server's .env.

const KINDS = [
  { id: 'bug', label: 'Ошибка', hint: 'Что делали, что ожидали, что вышло. Чем подробнее, тем быстрее найдём.' },
  { id: 'idea', label: 'Предложение', hint: 'Чего не хватает на занятии, что сделать удобнее.' },
  { id: 'other', label: 'Отзыв', hint: 'Как прошло занятие, что понравилось, что нет.' },
] as const

const ERRORS: Record<string, string> = {
  'too many': 'Слишком много писем подряд. Попробуйте через час.',
  'not configured': 'Отправка писем пока не настроена. Попробуйте позже.',
  empty: 'Напишите хотя бы пару слов.',
}

/** One letter over a fresh socket; resolves to null when sent, or to the reason it wasn't. */
function send(letter: { kind: string; text: string; contact: string; where: string }): Promise<string | null> {
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
    const timer = setTimeout(() => finish('Сервер не ответил. Попробуйте ещё раз.'), 40_000)
    ws.onopen = () => ws.send(JSON.stringify({ t: 'feedback', ...letter }))
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
        <label class="feedback-contact"><span>Как вам ответить <span class="muted">(необязательно)</span></span>
          <input name="contact" maxlength="200" autocomplete="email" placeholder="почта, телефон или телеграм">
        </label>
        <p class="muted">К письму приложим только название экрана, браузер и размер окна. Код занятия и то, что на доске, не отправляем.</p>
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

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    submit.disabled = true
    state.className = 'feedback-state'
    state.textContent = 'Отправляем…'
    const contact = form.querySelector<HTMLInputElement>('input[name=contact]')!.value
    const error = await send({ kind: kind(), text: text.value, contact, where: `${where}; окно ${innerWidth}×${innerHeight}` })
    if (error) {
      submit.disabled = false
      state.className = 'feedback-state error'
      state.textContent = error
      return
    }
    form.querySelector('.feedback-body')!.innerHTML = `<p class="feedback-done">Спасибо! Письмо отправлено${contact.trim() ? ', ответим по указанному адресу' : ''}.</p>`
    submit.remove()
    form.querySelector<HTMLButtonElement>('[data-close]')!.focus()
  })
  text.focus()
}

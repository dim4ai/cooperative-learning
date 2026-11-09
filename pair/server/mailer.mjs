// Letters from the feedback form: through our own mail server, logged in as the platform's
// sending box (SMTP_* in .env, like the main server). Where each kind goes is also only in .env:
// FEEDBACK_TO_BUG, FEEDBACK_TO_IDEA, and FEEDBACK_TO for the rest (and for a missing one).
import nodemailer from 'nodemailer'

const KIND_TITLE = { bug: 'Ошибка', idea: 'Предложение', other: 'Отзыв' }
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/

/** Returns feedback(letter) for createServer, or null when mail isn't set up. */
export function feedbackMailer(env = process.env, log = console.log) {
  const { SMTP_HOST: host, SMTP_USER: user, SMTP_PASS: pass } = env
  const to = { bug: env.FEEDBACK_TO_BUG || env.FEEDBACK_TO, idea: env.FEEDBACK_TO_IDEA || env.FEEDBACK_TO, other: env.FEEDBACK_TO }
  if (!host || !user || !pass || !to.other) {
    log('feedback form is off: set SMTP_HOST, SMTP_USER, SMTP_PASS and FEEDBACK_TO in .env')
    return null
  }
  const transport = nodemailer.createTransport({
    host,
    port: Number(env.SMTP_PORT) || 587,
    secure: false,
    requireTLS: true, // the password never goes in the clear
    auth: { user, pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  })
  const from = env.MAIL_FROM || `Занятие вдвоём <${user}>`
  log(`feedback form mails to ${[...new Set(Object.values(to))].join(', ')}`)

  return async ({ kind, text, contact, where, ua, pics = [] }) => {
    const first = text.split('\n')[0].replace(/\s+/g, ' ').slice(0, 60)
    const body = [
      text,
      '',
      '—',
      `Ответить: ${contact || 'не указано'}`,
      `Где: ${where || '—'}`,
      `Браузер: ${ua || '—'}`,
      ...(pics.length ? [`Картинок: ${pics.length}`] : []),
      `Время: ${new Date().toISOString()}`,
    ].join('\n')
    await transport.sendMail({
      from,
      to: to[kind],
      subject: `[pair] ${KIND_TITLE[kind]}: ${first}`,
      text: body,
      ...(EMAIL_RE.test(contact) ? { replyTo: contact } : {}),
      // checked JPEGs, our own names: nothing from the sender's file reaches the letter but the pixels
      attachments: pics.map((content, i) => ({ filename: `картинка-${i + 1}.jpg`, content, contentType: 'image/jpeg' })),
    })
  }
}

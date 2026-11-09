// Letters from the platform: through our own mail server (Postfix on the prod host), logged in as
// noreply@co-learn.ru on port 587. The mail server signs them (DKIM) and won't let this login
// send under any other address. Without SMTP_* in .env nothing is sent and callers are told so.
import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST;
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;

const transport = host && user && pass
  ? nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: false,
    requireTLS: true, // the password never goes in the clear
    auth: { user, pass },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  })
  : null;

const from = process.env.MAIL_FROM || (user ? `Кооперативное обучение <${user}>` : '');

export const canSendMail = () => transport !== null;

export async function sendMail(to: string, subject: string, text: string, replyTo?: string): Promise<void> {
  if (!transport) throw new Error('mail is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS)');
  await transport.sendMail({ from, to, subject, text, ...(replyTo ? { replyTo } : {}) });
}

// ---------- «Написать нам»: letters from the forms in our apps ----------
// Same rules as pair's form (pair/server). Where each kind goes is only in .env:
// FEEDBACK_TO_BUG, FEEDBACK_TO_IDEA, and FEEDBACK_TO for the rest (and for a missing one).

const FEEDBACK_KINDS = { bug: 'Ошибка', idea: 'Предложение', other: 'Отзыв' } as const;
type FeedbackKind = keyof typeof FEEDBACK_KINDS;
/** Apps that have the form; the name goes into the subject */
const FEEDBACK_APPS = ['editor', 'teacher', 'student'] as const;
export const FEEDBACK_PER_IP_PER_HOUR = 5;
const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;

const feedbackTo: Record<FeedbackKind, string | undefined> = {
  bug: process.env.FEEDBACK_TO_BUG || process.env.FEEDBACK_TO,
  idea: process.env.FEEDBACK_TO_IDEA || process.env.FEEDBACK_TO,
  other: process.env.FEEDBACK_TO,
};
export const canSendFeedback = () => transport !== null && !!feedbackTo.other;

export interface Letter { app: string; kind: FeedbackKind; text: string; contact: string; where: string; ua: string }

/** A letter from a browser, cleaned; or the reason it can't go */
export function cleanFeedback(body: unknown, ua: unknown): Letter | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const app = FEEDBACK_APPS.find(a => a === b.app);
  const kind = (Object.keys(FEEDBACK_KINDS) as FeedbackKind[]).find(k => k === b.kind);
  if (!app || !kind) return { error: 'bad kind' };
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').trim().slice(0, max) : '');
  const text = str(b.text, 4000);
  if (text.length < 3) return { error: 'empty' };
  // one line each: these end up in the letter's body, never in its headers
  const line = (v: unknown, max: number) => str(v, max).replace(/[\x00-\x1f\x7f]+/g, ' ');
  return { app, kind, text, contact: line(b.contact, 200), where: line(b.where, 300), ua: line(ua, 300) };
}

export async function sendFeedback(l: Letter): Promise<void> {
  const first = l.text.split('\n')[0].replace(/\s+/g, ' ').slice(0, 60);
  const body = [
    l.text,
    '',
    '—',
    `Ответить: ${l.contact || 'не указано'}`,
    `Где: ${l.where || '—'}`,
    `Браузер: ${l.ua || '—'}`,
    `Время: ${new Date().toISOString()}`,
  ].join('\n');
  await sendMail(feedbackTo[l.kind]!, `[${l.app}] ${FEEDBACK_KINDS[l.kind]}: ${first}`, body, EMAIL_RE.test(l.contact) ? l.contact : undefined);
}

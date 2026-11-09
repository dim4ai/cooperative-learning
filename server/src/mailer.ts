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

export async function sendMail(to: string, subject: string, text: string): Promise<void> {
  if (!transport) throw new Error('mail is not configured (SMTP_HOST, SMTP_USER, SMTP_PASS)');
  await transport.sendMail({ from, to, subject, text });
}

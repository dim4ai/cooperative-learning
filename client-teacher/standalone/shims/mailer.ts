// server/src/mailer.ts for the server running in the page: no mail from here. The one thing that must
// still reach us, the demo's feedback, goes to the real server's «Написать нам» (POST /feedback)
const REAL_API = import.meta.env.VITE_REAL_API_URL as string;

export const FEEDBACK_PER_IP_PER_HOUR = 5;
export const canSendMail = () => false;
export async function sendMail() {}
export const canSendFeedback = () => !!REAL_API;
export function cleanFeedback() { return { error: 'not here' }; }
export async function sendFeedback() {}

const STAGES: Record<string, string> = {
  waiting: 'рассадка', group: 'объяснение', individual: 'индивидуальная работа', pairs: 'пары', fours: 'четвёрки',
};

export async function sendDemoFeedback(f: { code: string; rating: number | null; comment: string; email: string; solo: boolean; reached: string | null }) {
  const text = [
    'Отзыв после демо-урока (отдельная демо-страница)',
    `Оценка: ${f.rating ?? '—'}`,
    `Дошёл до: ${f.reached ? STAGES[f.reached] ?? f.reached : '—'}`,
    '',
    f.comment || '(без комментария)',
  ].join('\n');
  const res = await fetch(`${REAL_API}/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: 'teacher', kind: 'other', text, contact: f.email, where: location.href }),
  });
  if (!res.ok) throw new Error(`feedback ${res.status}`);
}

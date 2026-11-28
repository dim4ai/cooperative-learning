import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { JournalData } from './journal';

export interface DemoTimes { endsAt: number; noStudentsAt: number | null; solo?: boolean }
export interface DemoEnd { token: string; reason: string | null; solo?: boolean }

const WARN_LAST_MS = 5 * 60 * 1000;

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
};

/** What is left of the demo lesson, always in sight of the teacher */
export function DemoBanner({ times, clockSkew }: { times: DemoTimes; clockSkew: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const serverNow = now + clockSkew;
  const left = times.endsAt - serverNow;
  const ending = left <= WARN_LAST_MS;
  const urgent = ending || times.noStudentsAt !== null;
  return (
    <div data-testid="demo-banner" style={{
      padding: '6px 16px', fontSize: 13, display: 'flex', flexWrap: 'wrap', gap: '2px 16px',
      background: urgent ? '#fdf1d6' : '#eef3fa', color: urgent ? '#8a5a00' : '#46607f',
    }}>
      <span data-testid="demo-left">{ending ? `Демо-урок закончится через ${clock(left)}` : `Демо-урок: осталось ${clock(left)}`}</span>
      {times.noStudentsAt !== null && (
        <span data-testid="demo-no-students">Если никто не войдёт, занятие закроется через {clock(times.noStudentsAt - serverNow)}</span>
      )}
    </div>
  );
}

function endText({ reason }: DemoEnd): string {
  return reason === 'time is up' ? 'Час закончился.'
    : reason === 'no teacher' ? 'Вы вышли из урока, поэтому он завершился.'
    : reason === 'no students' ? 'За 15 минут после начала никто не вошёл, поэтому занятие закрылось.'
    : 'Демо-урок завершён.';
}

const EDITOR_URL = 'https://editor.co-learn.ru';
/** The standalone demo (client-teacher/standalone): the lesson server runs in the page, nothing else is here */
/** The sample lesson's blocks the solo demo goes through; the rest are in the plan, pale (server/src/demoBots.ts, SOLO_LIVE_BLOCKS).
 *  Tasks added during the lesson (a poll) run too. */
export const SOLO_LIVE_BLOCKS = new Set(['b1', 'b2', 'b3', 'b9', 'b10', 'b12']);
export const soloBlockOff = (b: { id: string }) => !SOLO_LIVE_BLOCKS.has(b.id) && !b.id.startsWith('live-');

/** The poll the solo demo suggests, both times: the class's answers are in server/src/demoBots.ts (POLL_ANSWERS), by option */
/** The solo demo's explanations where the class is polled (b9 first, b12 again): «Всем понятно?» waits till then */
export const soloPollDue = (block: string | null, blocks: { type?: string }[]) => {
  const polls = blocks.filter(b => b.type === 'poll').length;
  return (block === 'b9' && polls < 1) || (block === 'b12' && polls < 2);
};

export const SOLO_POLL = { question: 'Свойство и признак — это одно и то же?', options: ['Да, одно и то же', 'Нет, разные вещи', 'Иногда совпадают', 'Не знаю'], seconds: 20 };

/** ?fast=<block>: testing — no pages before the lesson, the lesson starts on that block as soon as the class is in;
 *  ?fast=ready: the lesson and the journal open, the class seated, not started yet. &teacher=m: Николай Иванович */
export const FAST_BLOCK = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('fast') || null;

/** The solo demo's class in the teacher's journal: names, the device each comes in from, the seat each has.
 *  The devices are the bots' own (server/src/demoBots.ts, botUuid); Миша comes in from another one and sits apart */
const SOLO_SEATING: [string, string][] = [
  ['Аня', 'g0r0c0'], ['Тимур', 'g0r0c1'], ['Глеб', 'g0r1c0'], ['Соня', 'g0r1c1'],
  ['Миша', 'g1r0c0'], ['Артём', 'g1r0c1'], ['Лена', 'g1r1c0'], ['Вика', 'g1r1c1'],
];
const SOLO_BOTS = ['Аня', 'Миша', 'Лена', 'Тимур', 'Соня', 'Артём', 'Вика', 'Глеб']; // server/src/demoBots.ts, BOTS
const botUuid = (i: number) => `00000000-0000-4000-8000-${(0x100 + i).toString(16).padStart(12, '0')}`;
export const SOLO_CLASS_ID = 'demo-class';
export const SOLO_JOURNAL: JournalData = {
  classes: [{
    id: SOLO_CLASS_ID, name: '8 «Б»', capacity: 8,
    students: SOLO_SEATING.map(([name, seat], i) => ({ id: `demo-${i}`, name, uuids: [botUuid(SOLO_BOTS.indexOf(name))], seat })),
  }],
};

export const STANDALONE = import.meta.env.VITE_STANDALONE === '1';
// from there, booking a lesson with one's own class is on the real site
const BOOK_URL = (import.meta.env.VITE_REAL_TEACHER_URL as string | undefined) ?? 'https://teacher.co-learn.ru/?demo';

/** After the lesson with the simulated class: what it was about, and where to go from here */
function SoloConclusion({ onBook }: { onBook: () => void }) {
  const p: CSSProperties = { margin: 0 };
  return (
    <div data-testid="demo-conclusion" style={{ fontSize: 14, lineHeight: 1.5, color: '#333', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={p}>Вы попробовали демо-урок в интернет-классе Co-Learn с приёмами кооперативного обучения.</p>
      <p style={p}>Теперь вы знаете, как реализованы основные этапы занятия: объяснение, индивидуальная работа и работа в группах. Сочетайте их так, как нужно именно вашему уроку.</p>
      <p style={p}>Смысл кооперативного обучения в том, чтобы каждый ученик был занят весь урок и мог обсудить новое с товарищами: сначала думает сам, потом объясняет соседу, потом договаривается в группе. Учитель задаёт ход урока и подходит туда, где нужна помощь.</p>
      <p style={p}>У онлайн-формата есть и свои преимущества. Пары и четвёрки собираются автоматически, и никто не путает, с кем он работает. На самостоятельной работе ученики не видят чужих тетрадей и не слышат подсказок, поэтому каждый думает сам. А если вам нужно сделать объявление, тишину в классе можно вернуть одной кнопкой.</p>
      <p style={p}>Урок для Co-Learn готовится в свободно доступном редакторе <a href={EDITOR_URL} target="_blank" rel="noreferrer">editor.co-learn.ru</a>: слайды, задания, листы учеников и этапы урока.</p>
      <p style={p}>Расскажите, что вам понравилось, а что было неудобно или непонятно. Если хотите провести такое занятие со своим классом, <a href={STANDALONE ? BOOK_URL : '#'} onClick={e => { if (STANDALONE) return; e.preventDefault(); onBook(); }}>забронируйте время</a>: ученики войдут по коду, без регистрации.</p>
    </div>
  );
}

// The point of the demo: what the teacher thought of it
export function DemoFinished({ end, onAgain }: { end: DemoEnd; onAgain: () => void }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const ready = rating > 0 || comment.trim() !== ''; // a mark, or some words

  async function send() {
    setSending(true);
    setError('');
    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/demo/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${end.token}` },
        body: JSON.stringify({ rating: rating || null, comment, email }),
      });
      if (res.ok) setSent(true);
      else setError('Не удалось отправить отзыв');
    } catch {
      setError('Нет связи с сервером');
    } finally {
      setSending(false);
    }
  }

  return (
    <div style={screen}>
      <div style={{ width: end.solo ? 600 : 400, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, textAlign: 'center' }}>Спасибо, что попробовали</h2>
        {/* after the simulated class, why it ended matters only if it wasn't the teacher's own «Завершить урок» */}
        {(!end.solo || end.reason === 'time is up' || end.reason === 'no teacher') &&
          <div data-testid="demo-end-text" style={{ color: '#666', fontSize: 14, lineHeight: 1.4 }}>{endText(end)}</div>}
        {end.solo && <SoloConclusion onBook={onAgain} />}
        {sent ? <div data-testid="demo-feedback-sent" style={{ color: '#27ae60' }}>Отзыв получен. Спасибо!</div> : <>
          <div style={{ fontSize: 14 }}>Как вам урок?</div>
          <div role="radiogroup" aria-label="Оценка" style={{ display: 'flex', gap: 6 }}>
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} role="radio" aria-checked={rating === n} onClick={() => setRating(n)} style={{
                flex: 1, padding: '8px 0', borderRadius: 6, cursor: 'pointer', fontSize: 15, color: '#222',
                border: rating === n ? '1px solid #4a90e2' : '1px solid #ccc', background: rating === n ? '#e7f1fc' : '#fff',
              }}>{n}</button>
            ))}
          </div>
          <textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={4000} rows={4}
            placeholder="Что понравилось, чего не хватило, что мешало?" style={input} />
          <input value={email} onChange={e => setEmail(e.target.value)} maxLength={200} autoCapitalize="none"
            placeholder="Почта, если хотите получить ответ" style={input} />
          {error && <div style={{ color: '#e74c3c', fontSize: 13 }}>{error}</div>}
          <button data-testid="demo-feedback-send" onClick={send} disabled={!ready || sending} style={{
            padding: '10px 0', borderRadius: 6, border: 'none', background: '#4a90e2', color: '#fff', fontSize: 15,
            cursor: ready && !sending ? 'pointer' : 'default', opacity: !ready || sending ? 0.5 : 1,
          }}>{sending ? 'Отправляем…' : 'Отправить отзыв'}</button>
        </>}
        <button onClick={onAgain} style={{ border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13 }}>
          К началу демо
        </button>
      </div>
    </div>
  );
}

const screen: CSSProperties = {
  minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'sans-serif', padding: 24, boxSizing: 'border-box',
};
const input: CSSProperties = {
  fontSize: 14, padding: 8, borderRadius: 6, border: '1px solid #ccc', boxSizing: 'border-box', width: '100%', fontFamily: 'inherit',
};

// ---------- how to try it: alone at once, or with a class on a booked time ----------

/** Who the visitor is to the class: how the children call the teacher, and the teacher's voice in the dialogues */
export type TeacherSex = 'f' | 'm';
const TEACHERS: { sex: TeacherSex; name: string }[] = [
  { sex: 'f', name: 'Татьяна Алексеевна' },
  { sex: 'm', name: 'Николай Иванович' },
];

export function DemoChoice({ onSolo, onBook, onBack }: { onSolo: (teacher: TeacherSex) => Promise<string | null>; onBook: () => void; onBack: () => void }) {
  const [intro, setIntro] = useState(false);
  // testing (?fast=…): straight into the lesson, no pages before it
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    if (!FAST_BLOCK || skipped) return;
    setSkipped(true);
    const t = new URLSearchParams(location.search).get('teacher');
    void onSolo(t === 'm' ? 'm' : 'f');
  }, [skipped, onSolo]);
  if (intro) return <SoloIntro onSolo={onSolo} onBack={() => setIntro(false)} />;
  return (
    <div style={screen}>
      <div style={{ width: 460, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ margin: 0, textAlign: 'center' }}>Попробовать Co-Learn</h2>
        <div style={card}>
          <b>Одному, прямо сейчас</b>
          <div style={cardText}>
            Проведите короткий урок с виртуальным классом: восемь учеников сядут на свои места, будут решать задачи и звать вас на помощь.
            Камера и микрофон не нужны, займёт 10–15 минут.
          </div>
          <button data-testid="solo-open" onClick={() => setIntro(true)} style={primary}>Начать урок с виртуальным классом</button>
        </div>
        <div style={card}>
          <b>Со своим классом</b>
          <div style={cardText}>
            Забронируйте время: код для учеников будет сразу, а место останется за вами. До 32 учеников, урок идёт час.
          </div>
          {STANDALONE
            ? <a data-testid="book-open" href={BOOK_URL} style={{ ...primary, background: 'transparent', color: '#4a90e2', border: '1px solid #4a90e2', textAlign: 'center', textDecoration: 'none' }}>
                Забронировать занятие
              </a>
            : <button data-testid="book-open" onClick={onBook} style={{ ...primary, background: 'transparent', color: '#4a90e2', border: '1px solid #4a90e2' }}>
                Забронировать занятие
              </button>}
        </div>
        {STANDALONE
          ? <a href="/" style={{ color: '#888', fontSize: 13, textAlign: 'center', textDecoration: 'none' }}>Назад</a>
          : <button onClick={onBack} style={{ border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13 }}>Назад</button>}
      </div>
    </div>
  );
}

/** Between the choice and the lesson: what awaits the visitor, what to look at, and who they are to the class */
function SoloIntro({ onSolo, onBack }: { onSolo: (teacher: TeacherSex) => Promise<string | null>; onBack: () => void }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');
  const [teacher, setTeacher] = useState<TeacherSex>('f');
  async function solo() {
    setStarting(true);
    setError((await onSolo(teacher)) ?? '');
    setStarting(false);
  }
  return (
    <div style={screen}>
      <div data-testid="solo-intro" style={{ width: 560, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <h2 style={{ margin: 0, textAlign: 'center' }}>Перед началом урока</h2>
        <div style={introText}>
          Сейчас вы побываете на уроке с виртуальным классом и попробуете себя в роли учителя: будете общаться с учениками, подходить к ним и познакомитесь с нашими инструментами.
        </div>
        <div style={introText}>
          Вы пройдёте весь урок, от рассадки до завершения: объяснение, самостоятельную работу, работу в парах и в четвёрках. На каждом этапе всплывающие подсказки покажут, что нажать.
        </div>
        <div style={introText}>
          Справа на экране у каждого этапа есть карточка «Подсказка»: в ней написано, что это за этап и что на нём происходит. Загляните в неё, когда начнётся новый этап.
        </div>
        <div style={introText}>
          Сосредоточьтесь не на содержании материала, а на самих инструментах и их возможностях. Подумайте, как вы могли бы использовать их на своих занятиях.
        </div>
        <div style={introText}>Желаем вам удачи и хорошего урока!</div>
        <div style={card}>
          <b>Кем вы будете на этом уроке?</b>
          <div role="radiogroup" aria-label="Учитель" style={{ display: 'flex', gap: 8 }}>
            {TEACHERS.map(t => (
              <button key={t.sex} role="radio" aria-checked={teacher === t.sex} data-testid={`teacher-${t.sex}`} onClick={() => setTeacher(t.sex)} style={{
                flex: 1, padding: '12px 4px', borderRadius: 6, cursor: 'pointer',
                fontSize: 14, color: '#222', border: `2px solid ${teacher === t.sex ? '#4a90e2' : '#ddd'}`, background: teacher === t.sex ? '#e7f1fc' : '#fff',
              }}>{t.name}</button>
            ))}
          </div>
          <button data-testid="solo-start" onClick={solo} disabled={starting} style={{ ...primary, opacity: starting ? 0.5 : 1 }}>
            {starting ? 'Собираем класс…' : 'Начать урок'}
          </button>
          {error && <div data-testid="solo-error" style={{ color: '#e74c3c', fontSize: 13 }}>{error}</div>}
        </div>
        <button data-testid="solo-back" onClick={onBack} disabled={starting} style={{ border: 'none', background: 'transparent', color: '#888', cursor: 'pointer', fontSize: 13 }}>Назад</button>
      </div>
    </div>
  );
}

/** Who teaches in this solo demo: «Повторить этап» starts it again with the same teacher */
let soloTeacher: TeacherSex = 'f';

/** «Повторить этап» (solo demo only): the demo starts anew right on this block, the class already seated */
export function repeatBlock(block: string) {
  location.assign(`${location.pathname}?${new URLSearchParams({ fast: block, teacher: soloTeacher })}`);
}

export async function startSolo(teacher: TeacherSex = 'f'): Promise<{ code: string; token: string } | { error: string }> {
  soloTeacher = teacher;
  try {
    // ?fast (testing): the class sits down at once, at two desks; ?fast=b9 also starts the lesson on that block
    const f = new URLSearchParams(location.search).get('fast');
    const q = new URLSearchParams({ teacher, ...(f === null ? {} : { fast: f || '1' }) });
    const res = await fetch(`${import.meta.env.VITE_API_URL}/demo/solo?${q}`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.token) return { code: body.code, token: body.token };
    if (body.error === 'slow down') return { error: 'Слишком много попыток, подождите немного' };
    if (body.error === 'barred') return { error: `С этого адреса был запуск без входа в урок. Попробуйте через ${Math.ceil((Number(body.retryAfterSeconds) || 60) / 60)} мин` };
    if (body.error === 'ip busy' || body.error === 'busy') return { error: 'Сейчас слишком много пробных уроков, попробуйте через минуту' };
    return { error: 'Не удалось начать, попробуйте ещё раз' };
  } catch {
    return { error: 'Нет связи с сервером' };
  }
}

/** short: the steps when the hints beside the buttons are on and say where to press */
const GUIDE: Record<string, { title: string; steps: string[]; short?: string[] }> = {
  setup: { title: 'Подготовка', steps: [
    'Откройте урок, который вы подготовили заранее, и журнал класса.',
    'В журнале записаны ученики и закреплённые за ними места. Когда вы его выберете, ученики начнут заходить.',
  ] },
  waiting: { title: 'Рассадка', steps: [
    'Рассадка класса хранится в журнале: ученики заходят и сами садятся на свои места. Ряд за партой — это пара, вся парта — четвёрка.',
    'Кто зашёл с нового устройства, садится за отдельную парту «Новые ученики». Поговорите с ним (💬) и отметьте в журнале, кто это — он сядет на своё место.',
    'Учеников можно и пересаживать: кликните по ученику, потом по свободному месту или по другому ученику.',
    'Отпустите ребят за столы: «Отпустить за столы» слева. Пока они готовятся, просмотрите план во вкладке «Просмотр урока» наверху.',
    'Когда все будут на местах, нажмите слева «Начать урок».',
  ], short: [
    'Ученики заходят и автоматически рассаживаются на закреплённые за ними места.',
    'Тот, кто зашёл с нового устройства, сидит отдельно, пока вы не свяжете его с записью в журнале.',
    'Ряд за партой — это пара, вся парта — четвёрка.',
  ] },
  group: { title: 'Объяснение', steps: [
    'Это этап, на котором вы объясняете материал сразу всему классу. Ученики слышат вас, видят слайды, которые вы показываете.',
    'Вы можете рисовать поверх них, и ученики увидят эти изменения в реальном времени.',
    'Сейчас ученики не изолированы по группам, а находятся в едином пространстве. Они могут задавать вопросы или отвечать, включив микрофон.',
    'Листайте слайды стрелками. Скрытый ответ откройте инструментом ☝, когда ученики подумают.',
    'После объяснения нажмите «Всем понятно?»: красные рамки покажут, кто не понял. Затем выберите следующий блок в плане слева.',
  ], short: [
    'Это этап, на котором вы объясняете материал сразу всему классу. Ученики слышат вас, видят слайды, которые вы показываете.',
    'Вы можете рисовать поверх них, и ученики увидят эти изменения в реальном времени.',
    'Сейчас ученики не изолированы по группам, а находятся в едином пространстве. Они могут задавать вопросы или отвечать, включив микрофон.',
    'После объяснения можете провести опрос, поняли ли ученики материал, и перейти к следующему этапу.',
  ] },
  individual: { title: 'Индивидуальная работа', steps: [
    'На этом этапе ученики работают самостоятельно, у каждого своя доска. Ученики не могут общаться друг с другом.',
    'Вы видите рабочие листы всех учеников в реальном времени: всё, что они пишут, сразу появляется у вас на экране.',
    'Если кто-то застрянет, то он позовёт вас: на его месте появится 🔔. Нажмите на колокольчик — вы подойдёте к нему индивидуально, не прерывая работу остальных.',
    'Не называйте ответ — задайте вопрос, который поможет дойти самому. Вернитесь кнопкой «← Назад».',
    'Когда ответите всем, кто звал, выберите слева следующий блок.',
  ], short: [
    'На этом этапе ученики работают самостоятельно, у каждого своя доска. Ученики не могут общаться друг с другом.',
    'Вы видите рабочие листы всех учеников в реальном времени: всё, что они пишут, сразу появляется у вас на экране.',
    'Если кто-то застрянет, то он позовёт вас. Вы сможете подойти к нему индивидуально, не прерывая работу остальных.',
  ] },
  pairs: { title: 'Пары', steps: [
    'Ученики автоматически разбиваются по парам. Они могут общаться друг с другом в паре, и у них есть общая доска, на которой они совместно могут делать записи.',
    'Каждая пара слышит только себя. Если возникнут трудности, она сможет позвать вас на помощь, не отвлекая остальных: на её месте появится 🔔.',
    'Нажав на доску пары, вы можете присоединиться к ней инкогнито и послушать, как ученики обсуждают задачу между собой.',
    'Нажмите на колокольчик, чтобы подойти к паре. После ответа вернитесь кнопкой «← Назад», а когда ответите всем, выберите слева следующий блок.',
  ], short: [
    'Ученики автоматически разбиваются по парам. Они могут общаться друг с другом в паре, и у них есть общая доска, на которой они совместно могут делать записи.',
    'Каждая пара слышит только себя. Если возникнут трудности, она сможет позвать вас на помощь, не отвлекая остальных.',
    'Нажав на доску пары, вы можете присоединиться к ней инкогнито и послушать, как ученики обсуждают задачу между собой.',
  ] },
  fours: { title: 'Четвёрки', steps: [
    'Пары автоматически объединяются в четвёрки. Общение идёт уже внутри четвёрки с использованием общей доски.',
    'Группа также может позвать учителя для помощи: на её месте появится 🔔. Нажмите на колокольчик, чтобы подойти.',
    'Нажав на доску четвёрки, вы можете присоединиться к ней инкогнито и послушать, как ученики обсуждают задачу между собой.',
    'Это весь цикл урока. Нажмите слева «Завершить урок» и расскажите, что думаете.',
  ], short: [
    'Пары автоматически объединяются в четвёрки. Общение идёт уже внутри четвёрки с использованием общей доски.',
    'Группа также может позвать учителя для помощи.',
    'Нажав на доску четвёрки, вы можете присоединиться к ней инкогнито и послушать, как ученики обсуждают задачу между собой.',
  ] },
};

/** The solo demo has nobody to explain it: this says what to do on each stage */
export function SoloGuide({ stage }: { stage: string }) {
  const part = GUIDE[stage] ?? GUIDE.waiting;
  // the hints beside the buttons are always on: the short version here, the rest is told by them
  const steps = part.short ?? part.steps;
  return (
    // framed, and it blinks for 15 seconds when a new stage begins, then stays framed:
    // without reading it the screen makes no sense
    <div key={stage} data-testid="solo-guide" style={{
      fontSize: 13, lineHeight: 1.45, color: '#333', display: 'flex', flexDirection: 'column', gap: 10, flexShrink: 0,
      padding: 12, borderRadius: 8, border: '2px solid #f5a623', background: '#fff', animation: 'soloGuideIn 1s ease-in-out 15',
    }}>
      {/* the glow is drawn inside the frame: the right panel's scroll box clips anything outside it */}
      <style>{'@keyframes soloGuideIn { 0%, 100% { box-shadow: inset 0 0 0 0 rgba(245,166,35,0) } 50% { box-shadow: inset 0 0 0 4px rgba(245,166,35,0.7) } }'}</style>
      <div style={{ fontSize: 11, color: '#a06a00', textTransform: 'uppercase', letterSpacing: 0.5 }}>Подсказка</div>
      <b style={{ fontSize: 15 }}>{part.title}</b>
      {steps.map(step => <div key={step}>{step}</div>)}
    </div>
  );
}

const card: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 8, padding: 16, borderRadius: 10, border: '1px solid #e2e2e2' };
const introText: CSSProperties = { color: '#333', fontSize: 16, lineHeight: 1.5 };
const cardText: CSSProperties = { color: '#666', fontSize: 14, lineHeight: 1.4 };
const primary: CSSProperties = { padding: '10px 12px', borderRadius: 6, border: 'none', background: '#4a90e2', color: '#fff', fontSize: 15, cursor: 'pointer' };

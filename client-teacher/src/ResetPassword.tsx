// A forgotten password: a code comes by mail, then a new password. The profile is kept only with
// the recovery code; without it the profile is dropped (the teacher says so explicitly).
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  JournalConflict, TooManyAttempts, WrongCode, WrongRecoveryCode, checkResetCode, requestPasswordReset, resetPassword,
} from './journal';
import type { ResetJournal } from './journal';
import { logIn, type Teacher } from './login';
import { MIN_PASSWORD_LENGTH, passwordProblem } from './passwordStrength';
import { PasswordInput } from './PasswordInput';

const RESEND_SECONDS = 60;
const hint: CSSProperties = { fontSize: 13, color: '#666', lineHeight: 1.4, textAlign: 'center' };
const errorText: CSSProperties = { color: '#e74c3c', fontSize: 13, textAlign: 'center' };
const link: CSSProperties = { border: 'none', background: 'transparent', color: '#4a90e2', cursor: 'pointer', fontSize: 14, padding: 0 };

function failure(e: unknown, fallback: string): string {
  if (e instanceof TooManyAttempts) return 'Слишком много попыток — подождите минуту и попробуйте снова';
  if (e instanceof WrongCode) return 'Неверный или устаревший код. Проверьте письмо или попросите новый код';
  return fallback;
}

export function ResetPassword({ initialEmail, inputStyle, buttonStyle, onBack, onLogin }: {
  initialEmail: string;
  inputStyle: CSSProperties;
  buttonStyle: CSSProperties;
  onBack: () => void;
  onLogin: (teacher: Teacher, token: string, wrapKey: CryptoKey) => void;
}) {
  const [step, setStep] = useState<'email' | 'code' | 'password'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [journal, setJournal] = useState<ResetJournal | null>(null);
  const [hasRecovery, setHasRecovery] = useState(false);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [recovery, setRecovery] = useState('');
  const [dropProfile, setDropProfile] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (step !== 'code') return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [step]);
  const resendIn = Math.max(0, Math.ceil((sentAt + RESEND_SECONDS * 1000 - now) / 1000));

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(failure(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  const send = () => run(async () => {
    await requestPasswordReset(email);
    setSentAt(Date.now());
    setNow(Date.now());
    setStep('code');
  }, 'Не получилось отправить письмо. Попробуйте позже');

  const check = () => run(async () => {
    const result = await checkResetCode(email, code.trim());
    setJournal(result.journal);
    setHasRecovery(result.hasRecovery);
    setStep('password');
  }, 'Не удалось проверить код');

  async function finish() {
    if (password !== repeat) { setError('Пароли не совпадают'); return; }
    if (journal && !recovery.trim() && !dropProfile) {
      setError(hasRecovery ? 'Введите код восстановления или отметьте, что профиль можно удалить' : 'Отметьте, что профиль можно удалить');
      return;
    }
    await run(async () => {
      const problem = await passwordProblem(password, email);
      if (problem) { setError(problem); return; }
      try {
        await resetPassword(email, code.trim(), password, journal && recovery.trim() ? recovery : null, journal);
      } catch (e) {
        if (e instanceof WrongRecoveryCode) { setError('Код восстановления не подходит. Проверьте его ещё раз'); return; }
        if (e instanceof JournalConflict) { setError('Профиль только что изменился. Начните заново'); setStep('email'); return; }
        throw e;
      }
      const result = await logIn(email, password);
      if (result.ok) onLogin(result.teacher, result.token, result.wrapKey);
      else onBack(); // the password is set; logging in just failed for now
    }, 'Не удалось сменить пароль');
  }

  return (
    <div data-testid="reset-password" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, width: 280, maxWidth: '100%' }}>
      <h2 style={{ margin: 0 }}>Смена пароля</h2>

      {step === 'email' && (<>
        <div style={hint}>Пришлём на почту код для смены пароля.</div>
        <input data-testid="reset-email" value={email} onChange={e => setEmail(e.target.value)} placeholder="Email" autoCapitalize="none"
          onKeyDown={e => { if (e.key === 'Enter' && email.trim()) send(); }} style={inputStyle} />
        {error && <div style={errorText}>{error}</div>}
        <button data-testid="reset-send" onClick={send} disabled={busy || !email.trim()} style={buttonStyle}>
          {busy ? 'Отправляем…' : 'Прислать код'}
        </button>
      </>)}

      {step === 'code' && (<>
        <div style={hint}>
          Если адрес <b>{email.trim()}</b> зарегистрирован, на него пришёл код из 6 цифр. Письмо может идти пару минут; загляните и в «Спам».
        </div>
        <input data-testid="reset-code" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          placeholder="Код из письма" inputMode="numeric" autoComplete="one-time-code"
          onKeyDown={e => { if (e.key === 'Enter' && code.length === 6) check(); }}
          style={{ ...inputStyle, textAlign: 'center', letterSpacing: 4 }} />
        {error && <div style={errorText}>{error}</div>}
        <button data-testid="reset-check" onClick={check} disabled={busy || code.length !== 6} style={buttonStyle}>
          {busy ? 'Проверяем…' : 'Дальше'}
        </button>
        <button onClick={send} disabled={busy || resendIn > 0} style={{ ...link, color: resendIn > 0 ? '#999' : '#4a90e2' }}>
          {resendIn > 0 ? `Прислать ещё раз через ${resendIn} с` : 'Прислать ещё раз'}
        </button>
      </>)}

      {step === 'password' && (<>
        <div style={hint}>Новый пароль: не меньше {MIN_PASSWORD_LENGTH} символов. Лучше всего — несколько случайных слов.</div>
        <PasswordInput data-testid="reset-new" value={password} onChange={e => setPassword(e.target.value)} placeholder="Новый пароль"
          autoComplete="new-password" style={inputStyle} />
        <PasswordInput data-testid="reset-repeat" value={repeat} onChange={e => setRepeat(e.target.value)} placeholder="Новый пароль ещё раз"
          autoComplete="new-password" style={inputStyle} />
        {journal && hasRecovery && (<>
          <div style={hint}>
            Профиль (журналы классов, имя и фото) зашифрован старым паролем. Чтобы его сохранить, введите код восстановления — его показывали при создании профиля.
          </div>
          <input data-testid="reset-recovery" value={recovery} onChange={e => { setRecovery(e.target.value); setDropProfile(false); }}
            placeholder="Код восстановления" autoCapitalize="characters" autoComplete="off" spellCheck={false}
            style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 14 }} />
        </>)}
        {journal && !hasRecovery && (
          <div style={{ ...hint, color: '#c0392b' }}>
            Профиль (журналы классов, имя и фото) зашифрован старым паролем, а кода восстановления у него не было. С новым паролем профиль не открыть — он будет удалён.
          </div>
        )}
        {journal && !recovery.trim() && (
          <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, color: '#333', textAlign: 'left' }}>
            <input data-testid="reset-drop" type="checkbox" checked={dropProfile} onChange={e => setDropProfile(e.target.checked)} />
            {hasRecovery ? 'Кода нет — удалить профиль и начать заново' : 'Понятно, удалить профиль'}
          </label>
        )}
        {error && <div style={errorText}>{error}</div>}
        <button data-testid="reset-finish" onClick={finish} disabled={busy || !password || !repeat} style={buttonStyle}>
          {busy ? 'Меняем…' : 'Сменить пароль и войти'}
        </button>
      </>)}

      <button onClick={onBack} style={link}>Назад ко входу</button>
    </div>
  );
}

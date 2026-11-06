// A password field with a button that shows what was typed.
import { useState } from 'react';
import type { CSSProperties, InputHTMLAttributes } from 'react';

const EyeOpen = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);
const EyeShut = (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
    <path d="M4 4l16 16" />
  </svg>
);

export function PasswordInput({ style, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { style?: CSSProperties }) {
  const [shown, setShown] = useState(false);
  return (
    <div style={{ position: 'relative', display: 'flex', width: style?.width }}>
      <input {...props} type={shown ? 'text' : 'password'} style={{ ...style, flex: 1, minWidth: 0, width: '100%', paddingRight: 38, boxSizing: 'border-box' }} />
      <button type="button" data-testid="password-toggle" onClick={() => setShown(s => !s)}
        title={shown ? 'Скрыть пароль' : 'Показать пароль'} aria-label={shown ? 'Скрыть пароль' : 'Показать пароль'} aria-pressed={shown}
        style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', width: 30, height: 30, padding: 0, border: 'none',
          background: 'transparent', color: '#777', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {shown ? EyeShut : EyeOpen}
      </button>
    </div>
  );
}

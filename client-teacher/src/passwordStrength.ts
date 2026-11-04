// zxcvbn is about 800 KB of dictionaries (400 KB gzipped), so it's loaded only when a password is being set.
export const MIN_PASSWORD_LENGTH = 12;

/** What's wrong with the password, or null if it will do */
export async function passwordProblem(password: string, email: string): Promise<string | null> {
  if (password.length < MIN_PASSWORD_LENGTH) return `Нужно не меньше ${MIN_PASSWORD_LENGTH} символов`;
  const { default: zxcvbn } = await import('zxcvbn');
  const { score } = zxcvbn(password, [email, ...email.split(/[@.]/), 'co-learn', 'colearn', 'teacher']);
  return score < 3 ? 'Такой пароль легко подобрать. Лучше несколько случайных слов подряд' : null;
}

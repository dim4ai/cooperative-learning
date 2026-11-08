// A lesson has two codes, nothing stored anywhere:
//   teacher code: 20 chars, a random secret — keep it to yourself       link: #t.<teacher code>
//   student code: 12 chars, a hash of the teacher code                  link: #<student code>
// The student code can't be turned back into the teacher code. The server checks
// the teacher code against the room (roomFromKey in server/server.mjs — keep them identical).
// Codes avoid look-alike characters (0/o, 1/l/i) so they can be dictated and typed.

export const ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz'
export const STUDENT_LEN = 12
export const TEACHER_LEN = 20

export type Entry = { room: string; key: string | null }

export function newKey() {
  const a = crypto.getRandomValues(new Uint8Array(TEACHER_LEN))
  return Array.from(a, (b) => ALPHABET[b % ALPHABET.length]).join('')
}

export async function roomFromKey(key: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`co-learn-pair:${key}`)))
  let code = ''
  for (let i = 0; i < STUDENT_LEN; i++) code += ALPHABET[h[i] % ALPHABET.length]
  return code
}

// Cyrillic letters that look like Latin ones, typed with the wrong keyboard layout
const LOOKALIKE: Record<string, string> = { а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', р: 'p', с: 'c', т: 't', у: 'y', х: 'x' }

/** Accepts a code typed by hand (any case, dashes, spaces) or a whole link. */
export async function parseCode(input: string): Promise<Entry | null> {
  let s = input.trim().toLowerCase()
  const hash = s.indexOf('#')
  if (hash >= 0) s = s.slice(hash + 1)
  s = s.replace(/^t\./, '')
  s = [...s].map((c) => LOOKALIKE[c] ?? c).join('')
  s = s.replace(/[^a-z0-9]/g, '')
  if ([...s].some((c) => !ALPHABET.includes(c))) return null
  if (s.length === TEACHER_LEN) return { room: await roomFromKey(s), key: s }
  if (s.length === STUDENT_LEN) return { room: s, key: null }
  return null
}

/** Reads the address bar: the teacher's link, the student's link, or nothing. */
export function entryFromHash() {
  if (location.hash.length <= 1) return Promise.resolve(null)
  let hash = location.hash
  try {
    hash = decodeURIComponent(hash) // a code typed in Cyrillic on the landing page arrives percent-encoded
  } catch {}
  return parseCode(hash)
}

/** k7m2x9pq4hnt → k7m2-x9pq-4hnt */
export function pretty(code: string) {
  return code.match(/.{1,4}/g)!.join('-')
}

export function studentLink(room: string) {
  return `${location.origin}${location.pathname}#${room}`
}

export function teacherLink(key: string) {
  return `${location.origin}${location.pathname}#t.${key}`
}

// Two links per lesson, nothing stored anywhere:
//   teacher: #t.<key>  — keep it to yourself
//   student: #<code>   — code = hash of the key, so it can't be turned into the teacher's link
// The server checks the key against the code (roomFromKey in server/server.mjs — keep them identical).

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz'

export type Entry = { room: string; key: string | null }

export function newKey() {
  const a = crypto.getRandomValues(new Uint8Array(20))
  return Array.from(a, (b) => ALPHABET[b % 36]).join('')
}

export async function roomFromKey(key: string) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`co-learn-pair:${key}`)))
  let code = ''
  for (let i = 0; i < 12; i++) code += ALPHABET[h[i] % 36]
  return code
}

/** Reads the address bar: the teacher's link, the student's link, or nothing. */
export async function entryFromHash(): Promise<Entry | null> {
  const h = location.hash.slice(1).toLowerCase()
  const teacher = /^t\.([a-z0-9]{16,40})$/.exec(h)
  if (teacher) return { room: await roomFromKey(teacher[1]), key: teacher[1] }
  return /^[a-z0-9]{6,32}$/.test(h) ? { room: h, key: null } : null
}

export function studentLink(room: string) {
  return `${location.origin}${location.pathname}#${room}`
}

// A lesson recording as the teacher's browser saves it (client-teacher/src/recStore.ts):
// урок.json, действия.jsonl, звук/… inside a .zip, the screen video beside it.
// All times are milliseconds by the server's clock.
import { readZip, entryText } from './zip'

export interface AudioTrack {
  file: string
  /** LiveKit identity: the student's nick, or 'Teacher' */
  who: string
  /** room without the lesson code: main-room, pair-1, fours-2, individual-<nick> */
  room: string
  start: number
  end: number
  mime: string
  url: string
}

export interface RecEvent {
  t: number
  ev: string
  data: unknown[]
  to?: string[]
  from?: string
  snap?: boolean
}

export interface Recording {
  title: string
  code: string
  recordStart: number
  recordEnd: number
  video: { file: string; start: number; mime: string } | null
  lessons: { start: number; end: number }[]
  /** nick → name from the teacher's journal */
  names: Record<string, string>
  /** students by nick, in order of first appearance */
  students: string[]
  audio: AudioTrack[]
  events: RecEvent[]
  /** the slides' pictures and videos by SHA-256 (картинки/ in the archive): slides:view names them by hash */
  pictures: Map<string, string>
}

export class NotARecordingError extends Error {}

export async function readRecording(file: File): Promise<Recording> {
  let zip
  try { zip = await readZip(file) } catch { throw new NotARecordingError('Это не архив записи урока (не zip)') }
  const metaEntry = zip.get('урок.json')
  if (!metaEntry) throw new NotARecordingError('В архиве нет урок.json — это не запись урока')
  let meta: Record<string, unknown>
  try { meta = JSON.parse(await entryText(metaEntry)) } catch { throw new NotARecordingError('урок.json повреждён') }
  if (typeof meta.format !== 'string' || !meta.format.startsWith('co-learn-recording/')) throw new NotARecordingError('Неизвестный формат записи')
  if (meta.format !== 'co-learn-recording/1') throw new NotARecordingError('Запись сделана более новой версией: обновите страницу')

  const events: RecEvent[] = []
  const evEntry = zip.get(typeof meta.events === 'string' ? meta.events : 'действия.jsonl')
  if (evEntry) {
    for (const line of (await entryText(evEntry)).split('\n')) {
      if (!line.trim()) continue
      try { events.push(JSON.parse(line)) } catch { /* a cut-off last line */ }
    }
  }
  events.sort((a, b) => a.t - b.t) // stable: same-time events keep their order

  const audio: AudioTrack[] = []
  for (const a of (meta.audio as Omit<AudioTrack, 'url'>[] | undefined) ?? []) {
    const e = zip.get(a.file)
    if (!e) continue
    audio.push({ ...a, url: URL.createObjectURL(await e.blob(a.mime.split(';')[0])) })
  }

  const pictures = new Map<string, string>()
  for (const [hash, file] of Object.entries((meta.pictures as Record<string, string> | undefined) ?? {})) {
    const e = zip.get(file)
    if (e) pictures.set(hash, URL.createObjectURL(await e.blob(MIME[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream')))
  }

  const names = (meta.names as Record<string, string> | undefined) ?? {}
  const seen = new Set<string>()
  const add = (n: string | undefined) => { if (n && n !== 'Teacher') seen.add(n) }
  for (const e of events) { e.to?.forEach(add); add(e.from) }
  for (const a of audio) add(a.who)
  for (const n of Object.keys(names)) add(n)

  return {
    title: String(meta.title ?? ''),
    code: String(meta.code ?? ''),
    recordStart: Number(meta.recordStart),
    recordEnd: Number(meta.recordEnd),
    video: (meta.video as Recording['video']) ?? null,
    lessons: (meta.lessons as Recording['lessons']) ?? [],
    names,
    students: [...seen],
    audio,
    events,
    pictures,
  }
}

export function releaseRecording(r: Recording | null) {
  for (const a of r?.audio ?? []) URL.revokeObjectURL(a.url)
  for (const u of r?.pictures.values() ?? []) URL.revokeObjectURL(u)
}

/** type of a picture by its file's extension */
const MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
}

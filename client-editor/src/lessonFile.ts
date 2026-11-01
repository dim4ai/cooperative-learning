// Lesson file format: a zip archive.
//   lesson.json      — LessonFile (meta + blocks), attachments reference media by name
//   media/<name>     — attachment bytes
import { unzip, zip, strFromU8, strToU8, type Unzipped, type Zippable } from 'fflate'
import type { LessonFile } from './types'

export const LESSON_EXT = '.lesson.zip'
export type Media = Record<string, Blob>

export interface LoadedLesson {
  lesson: LessonFile
  media: Media
  missing: string[] // attachments referenced in lesson.json but absent in the archive
}

export async function packLesson(lesson: LessonFile, media: Media): Promise<Blob> {
  const used = new Set(lesson.blocks.flatMap(b => b.attachments.map(a => a.name)))
  const files: Zippable = {
    'lesson.json': strToU8(JSON.stringify(lesson, null, 2)),
  }
  for (const name of used) {
    const blob = media[name]
    if (!blob) throw new Error(`Нет данных для файла «${name}»`)
    // images/video/pdf are already compressed — store as is
    files[`media/${name}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }]
  }
  const bytes = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, { level: 6 }, (err, data) => (err ? reject(err) : resolve(data))),
  )
  return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/zip' })
}

export async function unpackLesson(file: Blob): Promise<LoadedLesson> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const entries = await new Promise<Unzipped>((resolve, reject) =>
    unzip(bytes, (err, data) => (err ? reject(new Error('Файл не похож на урок (не zip-архив)')) : resolve(data))),
  )
  const json = entries['lesson.json']
  if (!json) throw new Error('В архиве нет lesson.json')

  let lesson: LessonFile
  try {
    lesson = JSON.parse(strFromU8(json))
  } catch {
    throw new Error('lesson.json повреждён')
  }
  if (lesson?.version !== 1 || !Array.isArray(lesson.blocks) || typeof lesson.meta !== 'object') {
    throw new Error('Неизвестная версия формата урока')
  }

  const media: Media = {}
  const missing: string[] = []
  for (const block of lesson.blocks) {
    block.attachments ??= []
    for (const a of block.attachments) {
      const data = entries[`media/${a.name}`]
      if (data) media[a.name] = new Blob([data as Uint8Array<ArrayBuffer>], { type: mimeFromName(a.name) })
      else missing.push(a.name)
    }
  }
  return { lesson, media, missing }
}

/** Name not yet used in media: "photo.jpg" → "photo (2).jpg" */
export function uniqueName(name: string, taken: Media): string {
  const clean = name.replace(/[\\/]/g, '_')
  if (!(clean in taken)) return clean
  const dot = clean.lastIndexOf('.')
  const stem = dot > 0 ? clean.slice(0, dot) : clean
  const ext = dot > 0 ? clean.slice(dot) : ''
  for (let i = 2; ; i++) {
    const candidate = `${stem} (${i})${ext}`
    if (!(candidate in taken)) return candidate
  }
}

export function suggestedFileName(title: string): string {
  const base = title.trim().replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'урок'
  return base + LESSON_EXT
}

function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return ({
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    svg: 'image/svg+xml', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', pdf: 'application/pdf',
  } as Record<string, string>)[ext] ?? 'application/octet-stream'
}

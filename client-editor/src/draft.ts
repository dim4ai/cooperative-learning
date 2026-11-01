// Autosaved draft in IndexedDB — protects against a crashed/closed tab.
// Not a replacement for saving the file: one draft per browser profile.
import type { LessonBlock, LessonMeta } from './types'
import type { Media } from './lessonFile'

export interface Draft {
  meta: LessonMeta
  blocks: LessonBlock[]
  media: Media
  fileName: string | null
  handle: FileSystemFileHandle | null
  dirty: boolean
  updatedAt: number
}

const DB = 'cooperative-editor'
const STORE = 'draft'
const KEY = 'current'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  } finally {
    db.close()
  }
}

export async function loadDraft(): Promise<Draft | null> {
  try {
    return (await tx<Draft | undefined>('readonly', s => s.get(KEY))) ?? null
  } catch (e) {
    console.warn('draft: load failed', e)
    return null
  }
}

export async function saveDraft(d: Draft): Promise<void> {
  try {
    await tx('readwrite', s => s.put(d, KEY))
  } catch (e) {
    // Handles are not cloneable in every browser — retry without it
    if (d.handle) await tx('readwrite', s => s.put({ ...d, handle: null }, KEY)).catch(() => {})
    else console.warn('draft: save failed', e)
  }
}

export async function clearDraft(): Promise<void> {
  await tx('readwrite', s => s.delete(KEY)).catch(() => {})
}

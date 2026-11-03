// Open/save the lesson file. Chromium: File System Access API (save back into the same file).
// Other browsers: <input type=file> + download.
import { LESSON_EXT, LESSON_MIME } from './lessonFile'

const PICKER_TYPES: FilePickerAcceptType[] = [{ description: 'Урок', accept: { [LESSON_MIME]: [LESSON_EXT] } }]

export const canSaveInPlace = typeof window.showSaveFilePicker === 'function'

export interface Opened {
  file: File
  handle: FileSystemFileHandle | null
}

/** null — user cancelled */
export async function pickLessonFile(): Promise<Opened | null> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({ types: PICKER_TYPES })
      return { file: await handle.getFile(), handle }
    } catch (e) {
      if (isAbort(e)) return null
      throw e
    }
  }
  const file = await pickViaInput(LESSON_EXT)
  return file ? { file, handle: null } : null
}

export async function pickMediaFiles(accept = 'image/*,video/*,application/pdf'): Promise<File[]> {
  return pickViaInput(accept, true)
}

/**
 * Save blob. With a handle — write into it (asks permission again after reload).
 * Returns the handle used (null for download fallback), or undefined if cancelled.
 */
export async function saveLessonFile(
  blob: Blob, handle: FileSystemFileHandle | null, suggestedName: string, saveAs: boolean,
): Promise<{ handle: FileSystemFileHandle | null; name: string } | undefined> {
  if (window.showSaveFilePicker) {
    try {
      let h = saveAs ? null : handle
      if (h && h.requestPermission && (await h.requestPermission({ mode: 'readwrite' })) !== 'granted') h = null
      if (!h) h = await window.showSaveFilePicker({ suggestedName, types: PICKER_TYPES })
      const w = await h.createWritable()
      await w.write(blob)
      await w.close()
      return { handle: h, name: h.name }
    } catch (e) {
      if (isAbort(e)) return undefined
      throw e
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = suggestedName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return { handle: null, name: suggestedName }
}

function pickViaInput(accept: string, multiple: true): Promise<File[]>
function pickViaInput(accept: string): Promise<File | null>
function pickViaInput(accept: string, multiple = false): Promise<File[] | File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      resolve(multiple ? files : files[0] ?? null)
    }
    input.oncancel = () => resolve(multiple ? [] : null)
    input.click()
  })
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError'
}

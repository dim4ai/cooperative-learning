// Text fonts: free (SIL OFL) fonts with Cyrillic, bundled from @fontsource and served
// from our own domain. A font file is fetched only when a text uses it.
import '@fontsource/rubik/400.css'
import '@fontsource/rubik/700.css'
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/700.css'
import '@fontsource/comfortaa/400.css'
import '@fontsource/comfortaa/700.css'
import '@fontsource/pt-serif/400.css'
import '@fontsource/pt-serif/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/bad-script/400.css'
import '@fontsource/caveat/400.css'
import '@fontsource/caveat/700.css'
import '@fontsource/neucha/400.css'
import '@fontsource/marck-script/400.css'
import '@fontsource/lobster/400.css'
import { cache, IText, type Canvas } from 'fabric'

export const FONTS = [
  { label: 'Обычный', value: 'Inter, system-ui, sans-serif' },
  { label: 'Рубик', value: "'Rubik', sans-serif" },
  { label: 'Монтсеррат', value: "'Montserrat', sans-serif" },
  { label: 'Комфорта', value: "'Comfortaa', sans-serif" },
  { label: 'С засечками', value: "'PT Serif', serif" },
  { label: 'Моноширинный', value: "'JetBrains Mono', monospace" },
  { label: 'Пропись', value: "'Bad Script', cursive" },
  { label: 'Рукописный', value: "'Caveat', cursive" },
  { label: 'Школьный', value: "'Neucha', cursive" },
  { label: 'Марк Скрипт', value: "'Marck Script', cursive" },
  { label: 'Каллиграфия', value: "'Lobster', cursive" },
]

const first = (family: string) => family.split(',')[0].trim()

/**
 * Canvas text doesn't wait for a web font: it draws with a fallback and measures with it.
 * So when a text uses one of our fonts, load it and then re-measure and redraw the texts.
 */
export function watchFonts(canvas: Canvas) {
  const loaded = new Set<string>()
  const pending = new Set<string>()
  const refresh = (family: string) => {
    cache.clearFontCache() // fabric keys its width cache by the whole font string, so clear it all
    for (const o of canvas.getObjects()) {
      for (const t of o instanceof IText ? [o] : 'getObjects' in o ? (o as unknown as { getObjects(): unknown[] }).getObjects() : []) {
        if (t instanceof IText && first(t.fontFamily) === family) {
          t.initDimensions()
          t.setCoords()
          t.dirty = true
        }
      }
    }
    canvas.requestRenderAll()
  }
  const need = (t: IText) => {
    const family = first(t.fontFamily)
    if (!family.startsWith("'") || loaded.has(family) || pending.has(family)) return
    pending.add(family)
    const sample = (t.text || '') + 'Aa Яя'
    Promise.all([
      document.fonts.load(`400 32px ${family}`, sample),
      document.fonts.load(`700 32px ${family}`, sample),
    ])
      .catch(() => {})
      .then(() => {
        pending.delete(family)
        loaded.add(family)
        refresh(family)
      })
  }
  const check = (o: unknown) => {
    if (o instanceof IText) need(o)
    else if (o && typeof o === 'object' && 'getObjects' in o) for (const k of (o as { getObjects(): unknown[] }).getObjects()) check(k)
  }
  canvas.on('object:added', ({ target }) => check(target))
  canvas.on('object:modified', ({ target }) => check(target))
  return (t: IText) => need(t)
}

// Small editor controls: color field with a pipette, drop-down tool menu.
import { useEffect, useRef, useState } from 'react'

/**
 * Picks a color: the browser's screen-wide pipette where there is one (Chrome, Edge),
 * otherwise a click on the slide. Resolves to #rrggbb, or null if cancelled.
 */
export type PickColor = () => Promise<string | null>

interface EyeDropperCtor { new (): { open: () => Promise<{ sRGBHex: string }> } }

/** The browser's own pipette (whole screen), if available */
export async function screenPipette(): Promise<string | null | undefined> {
  const ED = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper
  if (!ED) return undefined
  try {
    return (await new ED().open()).sRGBHex
  } catch {
    return null // Esc
  }
}

export function ColorField({ value, onChange, title, pick }: {
  value: string; onChange: (c: string) => void; title: string; pick: PickColor
}) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
      <input type="color" value={value} onChange={e => onChange(e.target.value)} title={title} />
      <button title="Пипетка: взять цвет с экрана" aria-label={`Пипетка: ${title}`} data-testid="pipette"
        onClick={async () => { const c = await pick(); if (c) onChange(c) }}
        style={{ border: '1px solid #d1d5db', background: '#fff', borderRadius: 4, padding: '1px 4px', fontSize: 12, cursor: 'pointer' }}>
        💧
      </button>
    </span>
  )
}

export interface MenuItem { key: string; icon: string; label: string; title?: string; on?: boolean; onClick: () => void }

/** Toolbar button with a drop-down list; `sections` are separated by a line */
export function ToolMenu({ label, title, on, sections, testId }: {
  label: React.ReactNode; title: string; on?: boolean; sections: { title?: string; items: MenuItem[] }[]; testId?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])
  return (
    <span ref={ref} style={{ position: 'relative' }}>
      <button title={title} aria-label={title} aria-expanded={open} data-testid={testId} onClick={() => setOpen(o => !o)} style={{
        padding: '4px 10px', borderRadius: 4, fontSize: 13, color: '#374151',
        border: `1px solid ${on ? '#4a90e2' : '#d1d5db'}`, background: on ? '#dbeafe' : '#fff',
      }}>{label} ▾</button>
      {open && (
        <div role="menu" style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 20, marginTop: 4, minWidth: 220, padding: 4,
          background: '#fff', border: '1px solid #d1d5db', borderRadius: 6, boxShadow: '0 6px 20px rgba(0,0,0,.12)',
        }}>
          {sections.map((s, i) => (
            <div key={i} style={{ borderTop: i ? '1px solid #f3f4f6' : undefined, paddingTop: i ? 4 : 0, marginTop: i ? 4 : 0 }}>
              {s.title && <div style={{ fontSize: 11, color: '#9ca3af', padding: '2px 8px' }}>{s.title}</div>}
              {s.items.map(it => (
                <button key={it.key} role="menuitem" title={it.title ?? it.label} onClick={() => { setOpen(false); it.onClick() }} style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%', textAlign: 'left', padding: '5px 8px', fontSize: 13,
                  border: 'none', borderRadius: 4, cursor: 'pointer', color: '#111827', background: it.on ? '#dbeafe' : 'transparent',
                }}>
                  <span style={{ width: 28, textAlign: 'center', color: '#1d4ed8' }}>{it.icon}</span>{it.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

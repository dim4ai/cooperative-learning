import { useEffect, useRef, useState } from 'react'
import type { LessonBlock, LessonFile, LessonMeta, BlockType } from './types'
import { BLOCK_LABELS, normalizeBlocks, usedMediaNames, isWorkBlock } from './types'
import { BlockCard } from './BlockCard'
import { MetaPanel } from './MetaPanel'
import { nanoid } from './nanoid'
import { packLesson, unpackLesson, suggestedFileName, type Media } from './lessonFile'
import { pickLessonFile, saveLessonFile, canSaveInPlace } from './fileAccess'
import { FeedbackDialog } from './Feedback'
import { loadDraft, saveDraft } from './draft'
function emptyBlock(type: BlockType): LessonBlock {
  const base = { id: nanoid(), type, duration: 10, title: BLOCK_LABELS[type], teacherNote: '', attachments: [] }
  if (type === 'group') return { ...base, type: 'group' }
  if (type === 'pairs') return { ...base, type: 'pairs', task: '', technique: '' }
  if (type === 'fours') return { ...base, type: 'fours', task: '', technique: '' }
  return { ...base, type: 'individual', task: '' }
}

function emptyMeta(): LessonMeta {
  return { title: '', subject: '', grade: '', author: '', createdAt: new Date().toISOString().slice(0, 10) }
}

export default function App() {
  const [loaded, setLoaded] = useState(false)
  const [meta, setMeta] = useState<LessonMeta>(emptyMeta())
  const [blocks, setBlocks] = useState<LessonBlock[]>([])
  const [media, setMedia] = useState<Media>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [handle, setHandle] = useState<FileSystemFileHandle | null>(null)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [dragOverId, setDragOverId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  // Restore draft once, before autosave may overwrite it
  useEffect(() => {
    loadDraft().then(d => {
      if (d) {
        setMeta(d.meta)
        setBlocks(normalizeBlocks(d.blocks))
        setMedia(d.media ?? {})
        setFileName(d.fileName)
        setHandle(d.handle)
        setDirty(d.dirty)
        if (d.dirty) flash('Восстановлен несохранённый черновик')
      }
      setLoaded(true)
    })
  }, [])

  // Autosave draft (debounced)
  const draftTimer = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (!loaded) return
    clearTimeout(draftTimer.current)
    const write = () => saveDraft({ meta, blocks, media, fileName, handle, dirty, updatedAt: Date.now() })
    // Just saved to file — record that at once, so a quick tab close doesn't resurrect "unsaved"
    if (!dirty) write()
    else draftTimer.current = window.setTimeout(write, 400)
  }, [loaded, meta, blocks, media, fileName, handle, dirty])

  const noticeTimer = useRef<number | undefined>(undefined)
  function flash(text: string, error = false) {
    setNotice({ text, error })
    clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), error ? 8000 : 3000)
  }

  function addBlock(type: BlockType) {
    const block = emptyBlock(type)
    setBlocks(prev => [...prev, block])
    setSelectedId(block.id)
    setDirty(true)
  }

  function updateBlock(updated: LessonBlock) {
    setBlocks(prev => prev.map(b => b.id === updated.id ? updated : b))
    setDirty(true)
  }

  function updateBlockWith(id: string, fn: (b: LessonBlock) => LessonBlock) {
    setBlocks(prev => prev.map(b => b.id === id ? fn(b) : b))
    setDirty(true)
  }

  function deleteBlock(id: string) {
    setBlocks(prev => prev.filter(b => b.id !== id))
    if (selectedId === id) setSelectedId(null)
    setDirty(true)
  }

  function addMedia(name: string, blob: Blob) {
    setMedia(prev => ({ ...prev, [name]: blob }))
  }

  function moveBlock(fromId: string, toId: string) {
    setBlocks(prev => {
      const arr = [...prev]
      const fromIdx = arr.findIndex(b => b.id === fromId)
      const toIdx = arr.findIndex(b => b.id === toId)
      if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev
      const [item] = arr.splice(fromIdx, 1)
      arr.splice(toIdx, 0, item)
      return arr
    })
    setDirty(true)
  }

  function confirmDiscard(): boolean {
    return !dirty || confirm('Есть несохранённые изменения. Продолжить без сохранения?')
  }

  function newLesson() {
    if (!confirmDiscard()) return
    setMeta(emptyMeta())
    setBlocks([])
    setMedia({})
    setSelectedId(null)
    setFileName(null)
    setHandle(null)
    setDirty(false)
  }

  async function openLesson() {
    if (!confirmDiscard()) return
    try {
      const picked = await pickLessonFile()
      if (!picked) return
      const { lesson, media: m, missing } = await unpackLesson(picked.file)
      setMeta({ ...emptyMeta(), ...lesson.meta })
      setBlocks(lesson.blocks)
      setMedia(m)
      setSelectedId(null)
      setFileName(picked.file.name)
      setHandle(picked.handle)
      setDirty(false)
      if (missing.length) flash(`В архиве не найдены файлы: ${missing.join(', ')}`, true)
      else flash(`Открыт «${picked.file.name}»`)
    } catch (e) {
      flash(`Не удалось открыть: ${(e as Error).message}`, true)
    }
  }

  async function saveLesson(saveAs = false) {
    try {
      const lesson: LessonFile = { version: 1, meta, blocks }
      const blob = await packLesson(lesson, media)
      const res = await saveLessonFile(blob, handle, fileName ?? suggestedFileName(meta.title), saveAs)
      if (!res) return
      // Drop media no longer referenced by any block
      const used = usedMediaNames(blocks)
      setMedia(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => used.has(k))))
      setHandle(res.handle)
      setFileName(res.name)
      setDirty(false)
      flash(res.handle ? `Сохранено в «${res.name}»` : `Файл «${res.name}» скачан`)
    } catch (e) {
      flash(`Не удалось сохранить: ${(e as Error).message}`, true)
    }
  }

  // Ctrl+S
  const saveRef = useRef(saveLesson)
  saveRef.current = saveLesson
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        saveRef.current(e.shiftKey)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!loaded) return null

  const selected = blocks.find(b => b.id === selectedId) ?? null

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* Left: block chain */}
      <div style={{
        width: 280, background: '#1e1e2e', display: 'flex', flexDirection: 'column',
        borderRight: '1px solid #2e2e3e', flexShrink: 0,
      }}>
        {/* Toolbar */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #2e2e3e', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={newLesson} style={btnStyle('#2e2e3e', '#aaa')}>Новый</button>
            <button onClick={openLesson} style={btnStyle('#2e2e3e', '#aaa')}>Открыть</button>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => saveLesson()} title="Ctrl+S" style={btnStyle(dirty ? '#4a90e2' : '#2e2e3e', dirty ? '#fff' : '#aaa')}>
              {dirty ? 'Сохранить*' : 'Сохранить'}
            </button>
            {canSaveInPlace && (
              <button onClick={() => saveLesson(true)} title="Ctrl+Shift+S" style={btnStyle('#2e2e3e', '#aaa')}>Сохранить как…</button>
            )}
          </div>
          <div style={{ fontSize: 11, color: '#777', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
               title={fileName ?? undefined}>
            {fileName ?? 'Файл ещё не сохранён'}{dirty ? ' · есть изменения (черновик в браузере)' : ''}
          </div>
        </div>

        {/* Lesson title + meta link */}
        <div
          onClick={() => setSelectedId(null)}
          style={{
            padding: '10px 12px', cursor: 'pointer',
            borderBottom: '1px solid #2e2e3e',
            background: selectedId === null ? '#2a2a4e' : 'transparent',
          }}
        >
          <div style={{ fontSize: 11, color: '#666', marginBottom: 2 }}>УРОК</div>
          <div style={{ fontSize: 13, color: meta.title ? '#ddd' : '#555', fontStyle: meta.title ? 'normal' : 'italic' }}>
            {meta.title || 'Без названия'}
          </div>
          {meta.subject && <div style={{ fontSize: 11, color: '#888' }}>{meta.subject}{meta.grade ? `, ${meta.grade} кл.` : ''}</div>}
        </div>

        {/* Block list */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {blocks.length === 0 && (
            <div style={{ color: '#555', fontSize: 12, textAlign: 'center', marginTop: 32 }}>
              Добавьте первый этап
            </div>
          )}
          {blocks.map(block => (
            <div
              key={block.id}
              draggable
              onDragStart={() => setDraggingId(block.id)}
              onDragEnd={() => { setDraggingId(null); setDragOverId(null) }}
              onDragOver={e => { e.preventDefault(); setDragOverId(block.id) }}
              onDrop={() => { if (draggingId && draggingId !== block.id) moveBlock(draggingId, block.id) }}
              onClick={() => setSelectedId(block.id)}
              style={{
                padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                background: selectedId === block.id ? '#3a3a5e' : dragOverId === block.id ? '#2e2e4e' : '#2a2a3e',
                border: `1px solid ${selectedId === block.id ? '#4a90e2' : 'transparent'}`,
                opacity: draggingId === block.id ? 0.4 : 1,
                display: 'flex', flexDirection: 'column', gap: 2,
              }}
            >
              <div style={{ fontSize: 10, color: '#888', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {BLOCK_LABELS[block.type]}
              </div>
              <div style={{ fontSize: 13, color: '#ddd', fontWeight: 500 }}>{block.title}</div>
              <div style={{ fontSize: 11, color: '#666' }}>{block.duration} мин</div>
            </div>
          ))}
        </div>

        {/* Add block */}
        <div style={{ padding: 10, borderTop: '1px solid #2e2e3e', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 10, color: '#666', marginBottom: 2 }}>ДОБАВИТЬ ЭТАП</div>
          {(['group', 'individual', 'pairs', 'fours'] as BlockType[]).map(type => (
            <button key={type} onClick={() => addBlock(type)} style={btnStyle('#2e2e3e', '#aaa')}>
              + {BLOCK_LABELS[type]}
            </button>
          ))}
          <button onClick={() => setFeedback(true)} data-testid="feedback-open" title="Ошибка, предложение или отзыв — письмом нам"
            style={{ ...btnStyle('transparent', '#888'), marginTop: 6, flex: 'none' }}>
            ✉ Написать нам
          </button>
        </div>
      </div>

      {/* Right: editor area */}
      <div style={{ flex: 1, overflow: 'auto', background: '#f6efe4' }}>
        {selected
          ? <BlockCard key={selected.id} block={selected} earlier={blocks.slice(0, blocks.indexOf(selected)).filter(isWorkBlock)} media={media} onAddMedia={addMedia} onChange={updateBlock} onUpdate={fn => updateBlockWith(selected.id, fn)} onDelete={() => deleteBlock(selected.id)} onError={t => flash(t, true)} />
          : <MetaPanel meta={meta} onChange={m => { setMeta(m); setDirty(true) }} />
        }
      </div>

      {feedback && (
        <FeedbackDialog onClose={() => setFeedback(false)}
          where={`редактор: ${selected ? `этап «${BLOCK_LABELS[selected.type]}»` : 'описание урока'}`} />
      )}

      {notice && (
        <div data-testid="notice" style={{
          position: 'fixed', bottom: 16, right: 16, maxWidth: 420, padding: '10px 14px', borderRadius: 6,
          background: notice.error ? '#b91c1c' : '#1e1e2e', color: '#fff', fontSize: 13,
          boxShadow: '0 4px 16px rgba(0,0,0,.25)',
        }}>{notice.text}</div>
      )}

    </div>
  )
}

function btnStyle(bg: string, color: string): React.CSSProperties {
  return {
    flex: 1, padding: '6px 8px', borderRadius: 5, border: 'none',
    background: bg, color, fontSize: 12, textAlign: 'left' as const,
  }
}

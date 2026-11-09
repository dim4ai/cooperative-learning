// Lesson recording player. Everything happens in this browser: the files are read from the disk,
// nothing is uploaded. A recording = the archive .zip (sound of every room, students' actions,
// урок.json, the slides' pictures) + the teacher's screen video beside it.
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Clock, fmt, useClockState, useClockTime } from './clock'
import { readRecording, releaseRecording, type Recording } from './recording'
import { STAGE_LABELS, StudentTrack, stageMarks, type Stage } from './replay'
import { RoomSound, useSpeaking } from './sound'
import { BoardFeed, ScaledScreen, StudentScreen } from './student/StudentScreen'

type Labels = 'journal' | 'nick' | 'anon'
const LABELS_KEY = 'player.labels'

function loadLabels(): Labels {
  try { const v = localStorage.getItem(LABELS_KEY); return v === 'nick' || v === 'anon' ? v : 'journal' } catch { return 'journal' }
}

const isVideo = (f: File) => /^video\//.test(f.type) || /\.(mp4|webm|mkv|mov)$/i.test(f.name)
const isArchive = (f: File) => /\.zip$/i.test(f.name) || f.type === 'application/zip'

export default function App() {
  const [rec, setRec] = useState<Recording | null>(null)
  const [video, setVideo] = useState<{ name: string; url: string } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const open = useCallback(async (files: File[]) => {
    setError('')
    const archive = files.find(isArchive)
    const vid = files.find(isVideo)
    const other = files.filter(f => f !== archive && f !== vid)
    if (other.length) setError(`Не подходит: ${other.map(f => f.name).join(', ')}. Нужны архив записи (.zip) и видео экрана`)
    setBusy(true)
    try {
      if (archive) {
        const r = await readRecording(archive)
        setRec(old => { releaseRecording(old); return r })
      }
      if (vid) setVideo(old => { if (old) URL.revokeObjectURL(old.url); return { name: vid.name, url: URL.createObjectURL(vid) } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  // files dropped anywhere on the page
  useEffect(() => {
    const over = (e: DragEvent) => { e.preventDefault() }
    const drop = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer?.files.length) void open([...e.dataTransfer.files]) }
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('drop', drop) }
  }, [open])

  if (!rec) return <OpenScreen onFiles={open} error={error} busy={busy} />
  return <Player key={rec.code + rec.recordStart} rec={rec} video={video} onFiles={open} error={error} busy={busy} />
}

function FilePick({ onFiles, accept, multiple = true, children, style, testid }: {
  onFiles: (f: File[]) => void; accept: string; multiple?: boolean; children: ReactNode; style?: CSSProperties; testid?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  return <>
    <button data-testid={testid} onClick={() => input.current?.click()} style={style}>{children}</button>
    <input ref={input} type="file" accept={accept} multiple={multiple} hidden
      onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) onFiles(f) }} />
  </>
}

const ACCEPT_ALL = '.zip,.mp4,.webm,video/*,application/zip'

function OpenScreen({ onFiles, error, busy }: { onFiles: (f: File[]) => void; error: string; busy: boolean }) {
  return (
    <div className="open-page">
      <div className="open-box">
        <h1>Записи уроков</h1>
        <p>Посмотреть урок глазами любого ученика: его экран и звук его комнаты, рядом с видео экрана учителя.</p>
        <div className="drop">
          <FilePick testid="open-files" onFiles={onFiles} accept={ACCEPT_ALL} style={{ ...btnPrimary, fontSize: 17, padding: '12px 28px' }}>
            {busy ? 'Открываем…' : 'Выбрать файлы записи'}
          </FilePick>
          <div className="hint">или перетащите их сюда</div>
        </div>
        <ul>
          <li><b>урок-…zip</b> — архив: звук всех комнат, действия учеников, картинки слайдов. Обязательно.</li>
          <li><b>урок-…-экран.mp4</b> (или .webm) — видео экрана учителя. Можно добавить позже.</li>
        </ul>
        <p className="hint">Файлы никуда не загружаются: запись открывается прямо в этом браузере.</p>
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}

const btn: CSSProperties = { fontSize: 14, padding: '6px 12px', borderRadius: 6, border: '1px solid #c9ccd3', background: '#fff', color: '#222', cursor: 'pointer' }
const btnPrimary: CSSProperties = { ...btn, background: '#4a90e2', borderColor: '#4a90e2', color: '#fff' }

function roomTitle(room: string | null): string {
  if (!room) return ''
  if (room === 'main-room') return 'класс'
  const m = /^(pair|fours)-(\d+)$/.exec(room)
  if (m) return `${m[1] === 'pair' ? 'пара' : 'четвёрка'} ${m[2]}`
  if (room.startsWith('individual-')) return 'отдельно'
  return room
}

const STAGE_COLORS: Record<Stage, string> = {
  waiting: '#c9ccd3', group: '#7fb3e8', individual: '#b8a3e0', pairs: '#8fd19e', fours: '#f2c27b',
}

function Player({ rec, video, onFiles, error, busy }: {
  rec: Recording; video: { name: string; url: string } | null
  onFiles: (f: File[]) => void; error: string; busy: boolean
}) {
  const clock = useMemo(() => new Clock(rec.recordStart, rec.recordEnd), [rec])
  useEffect(() => () => clock.dispose(), [clock])
  const [sound, setSound] = useState<RoomSound | null>(null)
  useEffect(() => {
    const s = new RoomSound(rec.audio, clock)
    setSound(s)
    return () => s.dispose()
  }, [rec, clock])
  const tracks = useMemo(() => new Map(rec.students.map(n => [n, new StudentTrack(n, rec.events)])), [rec])
  const marks = useMemo(() => stageMarks(rec), [rec])

  const [sel, setSel] = useState<string>(() => rec.students[0] ?? 'Teacher')
  const [beside, setBeside] = useState(false)
  const [labels, setLabelsState] = useState<Labels>(loadLabels)
  const setLabels = (l: Labels) => { setLabelsState(l); try { localStorage.setItem(LABELS_KEY, l) } catch { /* private mode */ } }
  const [soundFrom, setSoundFrom] = useState<'student' | 'teacher'>('student')
  const [volume, setVolume] = useState(1)

  const t = useClockTime(clock)
  const { playing, rate } = useClockState(clock)
  const speaking = useSpeaking(sound)

  const label = useCallback((id: string) => {
    if (id === 'Teacher') return 'Учитель'
    if (labels === 'nick') return id
    if (labels === 'anon') return `Ученик ${rec.students.indexOf(id) + 1}`
    return rec.names[id] || id
  }, [labels, rec])

  const student = sel === 'Teacher' ? null : sel
  const track = student ? tracks.get(student) ?? null : null
  const n = track ? track.countAt(t) : 0
  const state = track ? track.at(n) : null
  const showTeacher = !student || beside
  const showStudent = !!student
  const audibleFrom = !student ? 'teacher' : !beside ? 'student' : soundFrom

  // the room whose sound plays: where the shown student is now
  useEffect(() => { sound?.setRoom(state?.view.room ?? null) }, [sound, state?.view.room])
  useEffect(() => { sound?.setAudible(audibleFrom === 'student') }, [sound, audibleFrom])
  useEffect(() => { sound?.setVolume(volume) }, [sound, volume])

  const togglePlay = useCallback(() => { sound?.unlock(); clock.toggle() }, [sound, clock])

  // keys: space — play/pause, ←/→ — 5 s (Shift: 30 s)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'range') return
      if (e.code === 'Space') { e.preventDefault(); togglePlay() }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault()
        clock.seek(clock.now() + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 30000 : 5000))
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [clock, togglePlay])

  const origin = rec.video?.start ?? rec.recordStart
  // sound and actions are recorded only inside a lesson ("Начать урок" … its end)
  const firstLesson = rec.lessons[0]?.start ?? Infinity
  const outside = rec.lessons.some(l => t >= l.start && t <= l.end) ? null
    : t < firstLesson ? 'Урок ещё не начался. До «Начать урок» записано только видео экрана учителя'
    : t > rec.lessons.at(-1)!.end ? 'Урок завершён'
    : 'Перерыв между уроками: записано только видео экрана учителя'
  const when = new Date(rec.recordStart)
  const videoMissing = !!rec.video && !video

  return (
    <div className="player">
      <header>
        <strong>Запись урока</strong>
        <span className="muted">{rec.title || rec.code} · {when.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}, {when.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
        <span style={{ flex: 1 }} />
        <label className="muted" style={{ fontSize: 13 }}>Подписи:</label>
        <div className="seg" role="radiogroup" aria-label="Подписи учеников">
          {([['journal', 'Имена из журнала'], ['nick', 'Ники'], ['anon', 'Ученик 1, 2…']] as const).map(([k, title]) => (
            <button key={k} role="radio" aria-checked={labels === k} className={labels === k ? 'on' : ''} onClick={() => setLabels(k)}>{title}</button>
          ))}
        </div>
        <FilePick onFiles={onFiles} accept=".mp4,.webm,video/*" multiple={false} style={videoMissing ? btnPrimary : btn} testid="pick-video">
          {video ? 'Другое видео' : 'Видео экрана…'}
        </FilePick>
        <FilePick onFiles={onFiles} accept={ACCEPT_ALL} style={btn}>Другая запись</FilePick>
      </header>
      {(error || busy) && <div className={error ? 'error bar' : 'bar'}>{busy ? 'Открываем…' : error}</div>}

      <div className="main">
        <aside>
          <div className="list-title">Учитель</div>
          <button data-testid="who-Teacher" className={'who' + (sel === 'Teacher' ? ' on' : '')} onClick={() => setSel('Teacher')}>
            <span>🖥 Видео экрана</span>
            {!video && <span className="badge">нет файла</span>}
          </button>
          <div className="list-title">Ученики</div>
          {rec.students.length === 0 && <div className="muted" style={{ padding: '4px 10px', fontSize: 13 }}>в записи нет учеников</div>}
          {rec.students.map(nick => {
            const tr = tracks.get(nick)!
            const v = tr.at(tr.countAt(t)).view
            const here = v.present && !v.ended
            return (
              <button key={nick} data-testid={`who-${nick}`} className={'who' + (sel === nick ? ' on' : '') + (here ? '' : ' away')} onClick={() => setSel(nick)}>
                <span className="name">{label(nick)}</span>
                {here && v.room && <span className="badge">{roomTitle(v.room)}</span>}
              </button>
            )
          })}
          {student && <label className="beside">
            <input type="checkbox" checked={beside} onChange={e => setBeside(e.target.checked)} /> Рядом с видео учителя
          </label>}
          {student && beside && <div className="beside" role="radiogroup" aria-label="Чей звук">
            <span className="muted">Звук:</span>
            <label><input type="radio" checked={soundFrom === 'student'} onChange={() => setSoundFrom('student')} /> комнаты ученика</label>
            <label><input type="radio" checked={soundFrom === 'teacher'} onChange={() => setSoundFrom('teacher')} /> из видео учителя</label>
          </div>}
        </aside>

        <section className={'stage' + (showTeacher && showStudent ? ' two' : '')}>
          {showTeacher && (
            <div className="pane">
              {video
                ? <VideoPane url={video.url} start={rec.video?.start ?? rec.recordStart} clock={clock} audible={audibleFrom === 'teacher'} volume={volume} />
                : <div className="placeholder">
                    <div>Видео экрана учителя не открыто</div>
                    {rec.video && <div className="muted" style={{ fontSize: 13 }}>{rec.video.file}</div>}
                    <FilePick onFiles={onFiles} accept=".mp4,.webm,video/*" multiple={false} style={btnPrimary}>Выбрать видео</FilePick>
                  </div>}
            </div>
          )}
          {showStudent && track && state && (
            <div className="pane">
              {outside
                ? <div className="placeholder" data-testid="outside">{outside}</div>
                : <StudentPane key={track.nick} track={track} n={n} t={t} label={label} speaking={speaking} pictures={rec.pictures} />}
            </div>
          )}
        </section>
      </div>

      <footer>
        <button data-testid="play" onClick={togglePlay} style={{ ...btnPrimary, width: 44, fontSize: 18, padding: '4px 0' }} title="Пробел">
          {playing ? '❚❚' : '▶'}
        </button>
        <button style={btn} onClick={() => clock.seek(clock.now() - 10000)} title="Назад 10 с (←: 5 с)">−10 с</button>
        <button style={btn} onClick={() => clock.seek(clock.now() + 10000)} title="Вперёд 10 с (→: 5 с)">+10 с</button>
        <span data-testid="time" className="time">{fmt(t - origin)} / {fmt(rec.recordEnd - origin)}</span>
        <Timeline rec={rec} clock={clock} t={t} marks={marks} origin={origin} />
        <select value={rate} onChange={e => clock.setRate(Number(e.target.value))} style={btn} title="Скорость">
          {[0.5, 0.75, 1, 1.25, 1.5, 2, 3].map(r => <option key={r} value={r}>{r}×</option>)}
        </select>
        <input type="range" min={0} max={1} step={0.05} value={volume} onChange={e => setVolume(Number(e.target.value))} title="Громкость" style={{ width: 80 }} />
      </footer>
    </div>
  )
}

function StudentPane({ track, n, t, label, speaking, pictures }: {
  track: StudentTrack; n: number; t: number; label: (id: string) => string; speaking: ReadonlySet<string>
  /** the archive's pictures by SHA-256 */
  pictures: Map<string, string>
}) {
  const feed = useMemo(() => new BoardFeed(), [track])
  const { view, board } = track.at(n)
  const objects = useMemo(() => [...board.values()], [track, n])
  const shown = useRef<{ feed: BoardFeed; n: number } | null>(null)
  useEffect(() => {
    const last = shown.current
    const ops = last && last.feed === feed ? track.boardOps(last.n, n) : null
    if (ops) { if (ops.length) feed.ops(ops, objects) } else feed.state(objects)
    shown.current = { feed, n }
  }, [feed, track, n, objects])

  const media = view.slides.active ? view.slides.media : null
  const resolveMedia = useCallback((name: string) => {
    const h = media?.[name]?.hash
    return h ? pictures.get(h) : undefined
  }, [media, pictures])

  return (
    <ScaledScreen>
      <StudentScreen nick={track.nick} view={view} t={t} feed={feed} label={label} speaking={speaking}
        resolveMedia={resolveMedia} />
    </ScaledScreen>
  )
}

function VideoPane({ url, start, clock, audible, volume }: { url: string; start: number; clock: Clock; audible: boolean; volume: number }) {
  const ref = useRef<HTMLVideoElement>(null)
  const [outside, setOutside] = useState(false)
  useEffect(() => {
    const el = ref.current!
    return clock.onFrame((t, playing, rate) => {
      const at = (t - start) / 1000
      const out = at < 0 || (Number.isFinite(el.duration) && at > el.duration)
      setOutside(out)
      if (out) { if (!el.paused) el.pause(); return }
      if (el.playbackRate !== rate) el.playbackRate = rate
      if (playing) {
        if (el.paused) { el.currentTime = at; el.play().catch(() => {}) }
        else if (!el.seeking && Math.abs(el.currentTime - at) > 0.3) el.currentTime = at
      } else {
        if (!el.paused) el.pause()
        if (!el.seeking && Math.abs(el.currentTime - at) > 0.05) el.currentTime = at
      }
    })
  }, [clock, start, url])
  useEffect(() => { const el = ref.current!; el.muted = !audible; el.volume = volume }, [audible, volume])
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', background: '#111', borderRadius: 4 }}>
      <video ref={ref} src={url} preload="auto" playsInline data-testid="teacher-video" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
      {outside && <div className="placeholder" style={{ position: 'absolute', inset: 0, color: '#aaa' }}>Видео экрана в это время не писалось</div>}
    </div>
  )
}

function Timeline({ rec, clock, t, marks, origin }: { rec: Recording; clock: Clock; t: number; marks: { t: number; stage: Stage }[]; origin: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const span = rec.recordEnd - rec.recordStart || 1
  const x = (time: number) => `${((time - rec.recordStart) / span) * 100}%`
  const at = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect()
    return rec.recordStart + Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * span
  }
  function down(e: React.PointerEvent) {
    ref.current!.setPointerCapture(e.pointerId)
    clock.seek(at(e.clientX))
  }
  // stage bands: from each mark to the next one (or the lesson's end)
  const bands: { from: number; to: number; stage: Stage }[] = []
  for (const l of rec.lessons) {
    const inside = marks.filter(m => m.t < l.end && m.t >= l.start - 1)
    inside.forEach((m, i) => bands.push({ from: Math.max(m.t, l.start), to: inside[i + 1]?.t ?? l.end, stage: m.stage }))
  }
  const hoverStage = hover !== null ? bands.find(b => hover >= b.from && hover < b.to)?.stage : undefined
  return (
    <div ref={ref} className="timeline" data-testid="timeline"
      onPointerDown={down}
      onPointerMove={e => { const v = at(e.clientX); setHover(v); if (e.buttons & 1) clock.seek(v) }}
      onPointerLeave={() => setHover(null)}>
      <div className="rail" />
      {rec.lessons.map((l, i) => <div key={i} className="lesson" style={{ left: x(l.start), width: `${((l.end - l.start) / span) * 100}%` }} />)}
      {bands.map((b, i) => <div key={i} className="band" title={STAGE_LABELS[b.stage]}
        style={{ left: x(b.from), width: `${((b.to - b.from) / span) * 100}%`, background: STAGE_COLORS[b.stage] }} />)}
      <div className="played" style={{ width: x(t) }} />
      <div className="head" style={{ left: x(t) }} />
      {hover !== null && <div className="tip" style={{ left: x(hover) }}>{fmt(hover - origin)}{hoverStage ? ` · ${STAGE_LABELS[hoverStage]}` : ''}</div>}
    </div>
  )
}

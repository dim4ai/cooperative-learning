// A student's screen as it was, rebuilt from the recording. Same layouts as client-student
// (App.tsx, GroupView, IndividualLayout, DeskLayout, FoursLayout, SeatingMap) — keep them alike when
// those change. No LiveKit here: tiles show the avatar and the name (camera video isn't recorded),
// a green frame when that participant's sound is loud.
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Board, type BoardLink, type BoardObject, type BoardOp } from '../slides/Board'
import { SlidePlayer } from '../slides/SlidePlayer'
import { AvatarProvider, setTeacherLook, useAvatarUrl, useTeacherTitle } from '../avatars'
import { roomOf, STAGE_LABELS, type Seat, type StudentView } from '../replay'

/** Feeds a board the recorded state and operations; nothing goes back */
export class BoardFeed implements BoardLink {
  private subs = new Set<{ onOp: (op: BoardOp) => void; onState: (o: BoardObject[]) => void }>()
  private objects: BoardObject[] = []
  send() {}
  subscribe(onOp: (op: BoardOp) => void, onState: (o: BoardObject[]) => void) {
    if (import.meta.env.DEV) (window as unknown as { __feed: BoardFeed }).__feed = this // for e2e tests
    const s = { onOp, onState }
    this.subs.add(s)
    onState(this.objects)
    return () => { this.subs.delete(s) }
  }
  state(objects: BoardObject[]) { this.objects = objects; for (const s of this.subs) s.onState(objects) }
  ops(ops: BoardOp[], objects: BoardObject[]) { this.objects = objects; for (const op of ops) for (const s of this.subs) s.onOp(op) }
}

export interface ScreenProps {
  nick: string
  view: StudentView
  /** recording time, server ms */
  t: number
  feed: BoardFeed
  /** how to call a participant: by journal name, nick or "Ученик N" */
  label: (identity: string) => string
  speaking: ReadonlySet<string>
  /** the slides' pictures from the archive, by name in the current slide */
  resolveMedia: (name: string) => string | undefined
}

const NO_REVEALED: ReadonlySet<string> = new Set()
const NAME_CARD_BG = 'linear-gradient(#3498db55, #3498db55), #fff'
const PALETTE = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#e91e63']

/** The student's window: a fixed size, scaled into whatever space the player gives it */
export const SCREEN_W = 1280
export const SCREEN_H = 760

export function ScaledScreen({ children, width = SCREEN_W, height = SCREEN_H }: { children: ReactNode; width?: number; height?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0)
  useLayoutEffect(() => {
    const el = box.current!
    const fit = () => setScale(Math.min(el.clientWidth / width, el.clientHeight / height))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [width, height])
  return (
    <div ref={box} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      {scale > 0 && <div style={{
        position: 'absolute', left: '50%', top: '50%', width, height,
        transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: 'center',
        boxShadow: '0 2px 16px rgba(0,0,0,0.25)', borderRadius: 4, overflow: 'hidden',
      }}>{children}</div>}
    </div>
  )
}

export function StudentScreen(p: ScreenProps) {
  const { view, nick, t, label } = p
  useEffect(() => { setTeacherLook(view.teacherLook) }, [view.teacherLook])

  if (!view.present) return <Blank>{label(nick)} ещё не пришёл на урок</Blank>
  if (view.ended || !view.lesson) return <Blank>Урок завершён</Blank>

  const lesson = view.lesson
  const room = view.room
  const students = lesson.participants.filter(x => x.role === 'student')
  const secondsLeft = lesson.timerEndsAt ? Math.max(0, Math.round((lesson.timerEndsAt - t) / 1000)) : null
  const afterLeft = lesson.afterUntil ? Math.max(0, Math.round((lesson.afterUntil - t) / 1000)) : null
  const atDesk = !!room && !!lesson.atDesks && room.startsWith('fours-')
  const newcomer = !!room && view.seats.some(s => s.reserved) && !view.seats.some(s => s.occupant === nick && s.extra === undefined)
    && room.startsWith('individual-')
  const myGroup = view.seats.find(s => s.occupant === nick)?.groupIndex ?? -1
  const groupSeats = view.seats.filter(s => s.groupIndex === myGroup)
  // who is in this student's room right now, for the tiles
  const inRoom = lesson.participants.filter(x => roomOf(x.livekitRoom) === room).map(x => x.name)

  const c = { ...p, inRoom }
  let body: ReactNode
  if (!room) body = <Blank>Подключение к видео…</Blank>
  else if (newcomer) body = <Newcomer {...c} />
  else if (lesson.stage === 'waiting' && !atDesk) body = <SeatingMap seats={view.seats} nick={nick} label={label} speaking={p.speaking} />
  else if (lesson.stage !== 'group' && room === 'main-room' && !view.seats.some(s => s.occupant === nick))
    body = <Blank>Класс уже работает. Подождите: учитель посадит вас за стол</Blank>
  else if (lesson.stage === 'group') body = <GroupView {...c} />
  else if (lesson.stage === 'individual') body = <Individual {...c} />
  else if (lesson.stage === 'fours' || atDesk) body = <Fours {...c} groupSeats={groupSeats} noTeacher={afterLeft !== null} />
  else body = <Desk {...c} />

  return (
    <AvatarProvider participants={lesson.participants}>
      <div data-testid="student-screen" style={{ fontFamily: 'sans-serif', height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg)', color: 'var(--text)', fontSize: 18, pointerEvents: 'none' }}>
        <div style={{ padding: '8px 16px', background: '#ece2d2', display: 'flex', gap: 16, alignItems: 'center', color: '#222', minHeight: 36 }}>
          <span style={{ color: 'green', fontWeight: 'bold' }}>●</span>
          {afterLeft !== null
            ? <strong>Урок окончен. Учитель покинул занятие. Можно поболтать ещё {Math.floor(afterLeft / 60)}:{String(afterLeft % 60).padStart(2, '0')}</strong>
            : <strong data-testid="stage-label">{atDesk ? 'До начала урока: вы за своим столом' : STAGE_LABELS[lesson.stage]}</strong>}
          {secondsLeft !== null && <span style={{ fontSize: 20, fontWeight: 'bold', marginLeft: 'auto' }}>{secondsLeft}s</span>}
          {!newcomer && <span style={{ color: '#888', marginLeft: secondsLeft !== null ? 0 : 'auto' }}>{students.length} уч.</span>}
        </div>
        {view.poll && (
          <div style={{ padding: '12px 16px', background: '#fffbe6', borderBottom: '1px solid #ffe58f', color: '#222' }}>
            <strong>{view.poll.question}</strong>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {view.poll.options.map((opt, i) => (
                <span key={i} style={{
                  padding: '6px 14px', border: '1px solid #ccc', borderRadius: 4, fontSize: 15,
                  background: view.poll!.myVote === i ? '#4a90e2' : '#fff', color: view.poll!.myVote === i ? '#fff' : '#333',
                }}>{opt}</span>
              ))}
            </div>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>{body}</div>
      </div>
    </AvatarProvider>
  )
}

type Ctx = ScreenProps & { inRoom: string[] }

function Blank({ children }: { children: ReactNode }) {
  return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', color: '#888', fontSize: 18, background: 'var(--bg)' }}>{children}</div>
}

// ---------- tiles ----------

function NameCard({ name, identity }: { name: string; identity?: string | null }) {
  const avatar = useAvatarUrl(identity)
  return (
    <div style={{
      width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4,
      background: NAME_CARD_BG, color: '#444', fontSize: 16, fontWeight: 'bold', textAlign: 'center', padding: 6, boxSizing: 'border-box',
    }}>
      {avatar && <img src={avatar} alt="" style={{ height: '55%', maxWidth: '80%', objectFit: 'contain' }} />}
      <span style={avatar ? { fontSize: 12 } : undefined}>{name}</span>
    </div>
  )
}

function SpeakingRing({ on }: { on: boolean }) {
  if (!on) return null
  return <div data-testid="speaking" style={{ position: 'absolute', inset: 0, border: '3px solid #2ecc71', borderRadius: 'inherit', pointerEvents: 'none', zIndex: 2 }} />
}

function Tile({ identity, c, radius = 8 }: { identity: string | null; c: Ctx; radius?: number }) {
  return (
    <div style={{ width: '100%', aspectRatio: '4/3', flexShrink: 0, position: 'relative', borderRadius: radius, overflow: 'hidden', background: 'var(--board-margin, #e9ecef)' }}>
      {identity
        ? <NameCard name={c.label(identity)} identity={identity} />
        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a89878', fontSize: 12 }}>—</div>}
      <SpeakingRing on={!!identity && c.speaking.has(identity)} />
    </div>
  )
}

function Bell({ calling, size = 56 }: { calling: boolean; size?: number }) {
  return (
    <div title={calling ? 'Ученик зовёт учителя' : undefined} style={{
      width: size, height: size, borderRadius: '50%', fontSize: size * 0.46, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: calling ? '#f39c12' : '#f0f0f0', boxShadow: calling ? '0 0 0 6px #f39c1255' : 'none',
    }}>🔔</div>
  )
}

// ---------- boards and slides ----------

function SlideUnderlay({ c, width }: { c: Ctx; width: number }) {
  const v = c.view.slides
  if (!v.active) return null
  return (
    <div data-testid="student-slides" style={{ position: 'relative', width }}>
      <SlidePlayer key={v.scene.id} scene={v.scene} resolveMedia={c.resolveMedia} role="student"
        revealed={NO_REVEALED} positions={c.view.positions} canDrag={false} width={width} />
      {v.count > 1 && <div style={{ position: 'absolute', bottom: 6, right: 8, fontSize: 12, lineHeight: 1, color: '#999' }}>{v.index + 1} / {v.count}</div>}
    </div>
  )
}

function SharedBoard({ c, readOnly }: { c: Ctx; readOnly?: boolean }) {
  return <Board role="student" readOnly={readOnly} link={c.feed}
    underlay={c.view.slides.active ? width => <SlideUnderlay c={c} width={width} /> : undefined} />
}

function WorkBoard({ c }: { c: Ctx }) {
  const v = c.view.slides
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 6 }}>
      {v.task && <div style={{
        flexShrink: 0, maxHeight: '30%', overflowY: 'auto', padding: '8px 12px', whiteSpace: 'pre-wrap',
        fontSize: 15, lineHeight: 1.4, color: '#222', background: '#f1f5fb', borderRadius: 6,
      }}>{v.task}</div>}
      <div style={{ flex: 1, minHeight: 0 }}><SharedBoard c={c} readOnly={v.readOnly} /></div>
    </div>
  )
}

// ---------- stages ----------

function Ask({ c }: { c: Ctx }) {
  const { askUntil, thanksUntil } = c.view
  const box: CSSProperties = {
    position: 'absolute', left: '50%', bottom: 24, transform: 'translateX(-50%)', zIndex: 20,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '14px 20px',
    background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
  }
  if (thanksUntil && c.t < thanksUntil) return <div style={{ ...box, fontSize: 32 }}>👍</div>
  if (!askUntil || c.t >= askUntil) return null
  const btn: CSSProperties = { padding: '12px 22px', borderRadius: 8, color: '#fff', fontSize: 16, fontWeight: 'bold' }
  return (
    <div data-testid="understood-ask" style={box}>
      <div style={{ fontSize: 16, fontWeight: 'bold', color: '#222' }}>Всё понятно? <span style={{ color: '#999', fontWeight: 'normal' }}>{Math.ceil((askUntil - c.t) / 1000)}</span></div>
      <div style={{ display: 'flex', gap: 10 }}>
        <span style={{ ...btn, background: '#2ecc71' }}>Понятно</span>
        <span style={{ ...btn, background: '#e74c3c' }}>Не понятно</span>
      </div>
    </div>
  )
}

function GroupView({ ...c }: Ctx) {
  return (
    <div style={{ height: '100%', position: 'relative', background: 'var(--bg)' }}>
      <div style={{ position: 'absolute', inset: 0 }}><SharedBoard c={c} readOnly /></div>
      <Ask c={c} />
    </div>
  )
}

function Individual({ ...c }: Ctx) {
  const teacherHere = c.inRoom.includes('Teacher')
  return (
    <div data-testid="individual-work" style={{ height: '100%', display: 'flex', gap: 8, padding: 8, boxSizing: 'border-box' }}>
      <div style={{ width: 180, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Tile identity={c.nick} c={c} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Bell calling={c.view.calling} size={60} /></div>
        {teacherHere && <Tile identity="Teacher" c={c} />}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}><WorkBoard c={c} /></div>
    </div>
  )
}

function Newcomer({ ...c }: Ctx) {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ padding: 12, textAlign: 'center', borderBottom: '1px solid #e8decd', color: '#5c4a2e', fontSize: 15 }}>
        Вы пока не в классе: вас видит и слышит только учитель. Он подойдёт и определит ваше место
      </div>
      <div style={{ flex: 1, display: 'flex', gap: 16, padding: 24, alignItems: 'flex-start', justifyContent: 'center' }}>
        <div style={{ width: 200 }}><Tile identity={c.nick} c={c} /></div>
        <div style={{ width: 200 }}><Tile identity="Teacher" c={c} /></div>
      </div>
    </div>
  )
}

function Desk({ ...c }: Ctx) {
  const partners = c.inRoom.filter(n => n !== c.nick && n !== 'Teacher')
  const teacherHere = c.inRoom.includes('Teacher')
  return (
    <div style={{ height: '100%', display: 'flex', gap: 8, padding: 8, boxSizing: 'border-box' }}>
      <div style={{ width: 180, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Tile identity={c.nick} c={c} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Bell calling={c.view.calling} /></div>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}><WorkBoard c={c} /></div>
      <div style={{ width: 180, display: 'flex', flexDirection: 'column', height: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {partners.length === 0
            ? <div style={{ aspectRatio: '4/3', background: '#222', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 13 }}>Ожидаем...</div>
            : partners.map(n => <Tile key={n} identity={n} c={c} />)}
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center' }}>{teacherHere && <Tile identity="Teacher" c={c} />}</div>
      </div>
    </div>
  )
}

function Fours({ groupSeats, noTeacher, ...c }: Ctx & { groupSeats: Seat[]; noTeacher: boolean }) {
  const seat = (row: number, col: number) => groupSeats.find(s => s.row === row && s.col === col)?.occupant ?? null
  // in the lesson the teacher showed here only with a camera (or before the lesson); here — whenever they're at the desk
  const teacherHere = c.inRoom.includes('Teacher')
  return (
    <div style={{ height: '100%', display: 'flex', gap: 8, padding: 8, boxSizing: 'border-box' }}>
      <div style={{ width: 160, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Tile identity={seat(0, 0)} c={c} radius={6} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{!noTeacher && <Bell calling={c.view.calling} size={44} />}</div>
        <Tile identity={seat(1, 0)} c={c} radius={6} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}><WorkBoard c={c} /></div>
      <div style={{ width: 160, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Tile identity={seat(0, 1)} c={c} radius={6} />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', minHeight: 0 }}>{teacherHere && <Tile identity="Teacher" c={c} radius={6} />}</div>
        <Tile identity={seat(1, 1)} c={c} radius={6} />
      </div>
    </div>
  )
}

function SeatingMap({ seats, nick, label, speaking }: { seats: Seat[]; nick: string; label: (n: string) => string; speaking: ReadonlySet<string> }) {
  const teacherTitle = useTeacherTitle()
  const teacherAvatar = useAvatarUrl('Teacher')
  const teacher = (
    <div style={{
      position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)', width: 200, aspectRatio: '4/3', zIndex: 10,
      borderRadius: 8, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.25)', background: NAME_CARD_BG,
    }}>
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', paddingBottom: 14, boxSizing: 'border-box' }}>
        {teacherAvatar && <img src={teacherAvatar} alt="" style={{ height: '62%' }} />}
      </div>
      <div style={{ position: 'absolute', bottom: 4, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: '#444', fontWeight: 'bold' }}>{teacherTitle}</div>
      <SpeakingRing on={speaking.has('Teacher')} />
    </div>
  )
  if (seats.length === 0) return <div style={{ height: '100%', position: 'relative' }}>{teacher}
    <div style={{ color: '#aaa', fontSize: 16, padding: '200px 32px' }}>Учитель ещё не настроил рассадку</div></div>
  const groups = Math.max(...seats.map(s => s.groupIndex)) + 1
  const mine = seats.find(s => s.occupant === nick)
  const planned = seats.some(s => s.reserved)
  return (
    <div style={{ height: '100%', position: 'relative' }}>
      {teacher}
      <div style={{ height: '100%', overflow: 'hidden', padding: '200px 16px 16px', boxSizing: 'border-box' }}>
        <div style={{ marginBottom: 12, fontSize: 15, color: '#555' }}>
          {mine?.extra !== undefined ? 'Вы за дополнительным столом: учитель определит ваше место'
            : mine ? `Вы сидите в группе ${mine.groupIndex + 1}, место ${mine.row * 2 + mine.col + 1}`
            : planned ? 'Свободных мест пока нет. Подождите: учитель посадит вас' : 'Выберите место'}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
          {Array.from({ length: groups }, (_, g) => {
            const color = PALETTE[g % PALETTE.length]
            const gs = seats.filter(s => s.groupIndex === g)
            return (
              <div key={g} style={{ border: `2px solid ${color}`, borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {[0, 1].map(row => (
                  <div key={row} style={{ display: 'flex', gap: 8, border: `1px solid ${color}66`, borderRadius: 6, padding: 4 }}>
                    {[0, 1].map(col => {
                      const s = gs.find(x => x.row === row && x.col === col)
                      if (!s) return null
                      const isMe = s.occupant === nick
                      return (
                        <div key={s.id} style={{
                          width: 160, height: 120, borderRadius: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                          fontSize: 12, position: 'relative', overflow: 'hidden',
                          border: isMe ? `3px solid ${color}` : `1px solid ${s.occupant ? color : '#ddd'}`,
                          background: s.occupant && !isMe ? `${color}55` : isMe ? `${color}33` : '#f8f8f8',
                          color: isMe ? '#fff' : s.occupant ? '#555' : '#aaa',
                        }}>
                          {s.occupant ? <SeatOccupant identity={s.occupant} shown={isMe ? 'Вы' : label(s.occupant)} speaking={speaking.has(s.occupant)} />
                            : <div style={{ fontSize: 60, color: '#ccc', lineHeight: 1 }}>{row * 2 + col + 1}</div>}
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function SeatOccupant({ identity, shown, speaking }: { identity: string; shown: string; speaking: boolean }) {
  const avatar = useAvatarUrl(identity)
  return <>
    {avatar && <img src={avatar} alt="" style={{ position: 'relative', zIndex: 1, height: 52, marginBottom: 2 }} />}
    <div style={{ position: 'relative', zIndex: 1, fontSize: 11, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textShadow: '0 1px 3px rgba(0,0,0,0.5)' }}>{shown}</div>
    <SpeakingRing on={speaking} />
  </>
}

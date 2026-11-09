// What a student's screen showed at any moment: the recorded events this student got (`to`) folded
// up to that moment, plus their own board strokes (`from`) — the server never echoes those back, the
// student's browser drew them itself. Folding goes forward from a cursor; going back starts from the
// nearest checkpoint (one every CHECK events), so seeking anywhere stays instant on a long lesson.
import type { RecEvent, Recording } from './recording'
import type { BoardObject, BoardOp } from './slides/Board'
import type { Scene } from './slides/model'

export type Stage = 'waiting' | 'group' | 'individual' | 'pairs' | 'fours'

export interface Participant { id: string; name: string; role: string; avatar?: string | null; livekitRoom?: string }

export interface LessonState {
  stage: Stage
  atDesks?: boolean
  videoMode?: 'all' | 'teacherSees' | 'teacher' | 'none'
  timerEndsAt: number | null
  afterUntil?: number | null
  demo?: { endsAt: number } | null
  participants: Participant[]
}

export interface Seat {
  id: string
  groupIndex: number
  row: number
  col: number
  occupant: string | null
  reserved?: boolean
  extra?: number
}

export interface MediaInfo { hash: string; size: number; type: string }

export type SlidesView = (
  | { active: false }
  | { active: true; index: number; count: number; scene: Scene; next: Scene | null; media: Record<string, MediaInfo> }
) & { task?: string; readOnly?: boolean }

export interface Poll { question: string; options: string[]; myVote: number | null }

export interface StudentView {
  /** got anything at all yet: before that the student wasn't in the lesson */
  present: boolean
  lesson: LessonState | null
  seats: Seat[]
  slides: SlidesView
  positions: Readonly<Record<string, { left: number; top: number }>>
  /** LiveKit room without the lesson code: main-room, pair-1… */
  room: string | null
  poll: Poll | null
  teacherLook: { title: string; photo: string | null }
  /** "Всё понятно?" on screen until this time */
  askUntil: number | null
  askSeconds: number
  /** the student answered "понятно": 👍 until this time */
  thanksUntil: number | null
  calling: boolean
  ended: boolean
}

const EMPTY: StudentView = {
  present: false, lesson: null, seats: [], slides: { active: false }, positions: {}, room: null, poll: null,
  teacherLook: { title: '', photo: null }, askUntil: null, askSeconds: 0, thanksUntil: null, calling: false, ended: false,
}

const CHECK = 300

export const roomOf = (livekitRoom: string | undefined | null) => livekitRoom ? livekitRoom.slice(livekitRoom.indexOf(':') + 1) : null

interface Cursor { n: number; view: StudentView; board: Map<string, BoardObject> }

function applyBoard(board: Map<string, BoardObject>, op: BoardOp) {
  if (op.t === 'clear') board.clear()
  else if (op.t === 'del') board.delete(op.uid)
  else board.set(op.obj.uid, op.obj) // a mod keeps its place in the order, as on the canvas
}

export class StudentTrack {
  readonly events: RecEvent[]
  private readonly times: number[]
  private cur: Cursor = { n: 0, view: EMPTY, board: new Map() }
  private checks: Cursor[] = []

  constructor(readonly nick: string, all: RecEvent[]) {
    this.events = all.filter(e =>
      e.to?.includes(nick) || (e.from === nick && ['boardOp', 'understood:answer', 'callTeacher', 'dismissCall'].includes(e.ev)))
    this.times = this.events.map(e => e.t)
    this.checks[0] = { n: 0, view: EMPTY, board: new Map() }
  }

  /** how many of this student's events happened by time t */
  countAt(t: number): number {
    let lo = 0, hi = this.times.length
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.times[m] <= t) lo = m + 1; else hi = m }
    return lo
  }

  /** first event time, or null if the student never was in a recorded lesson */
  get firstTime(): number | null { return this.times[0] ?? null }

  private step(c: Cursor) {
    const e = this.events[c.n++]
    const d = e.data[0] as never
    let v = c.view
    if (e.from) {
      if (e.ev === 'boardOp') applyBoard(c.board, d)
      else if (e.ev === 'understood:answer') v = { ...v, askUntil: null, thanksUntil: d === 'yes' ? e.t + 1000 : null }
      else if (e.ev === 'callTeacher') v = { ...v, calling: true }
      else if (e.ev === 'dismissCall') v = { ...v, calling: false }
    } else switch (e.ev) {
      case 'state': v = { ...v, lesson: d, ended: false }; break
      case 'seats': v = { ...v, seats: d }; break
      case 'slides:view': {
        const s = d as SlidesView
        const id = s.active ? s.scene.id : null
        const was = v.slides.active ? v.slides.scene.id : null
        v = { ...v, slides: s, positions: id === was ? v.positions : {} }
        break
      }
      case 'slides:move': {
        const m = d as { sceneId: string; uid: string; left: number; top: number }
        if (v.slides.active && v.slides.scene.id === m.sceneId) v = { ...v, positions: { ...v.positions, [m.uid]: { left: m.left, top: m.top } } }
        break
      }
      case 'boardState': c.board = new Map((d as BoardObject[]).map(o => [o.uid, o])); break
      case 'boardOp': applyBoard(c.board, d); break
      case 'livekit': v = { ...v, room: roomOf((d as { room: string }).room) }; break
      case 'poll': v = { ...v, poll: d }; break
      case 'teacherLook': v = { ...v, teacherLook: d }; break
      case 'understood:ask': {
        const s = (d as { seconds: number }).seconds
        v = { ...v, askUntil: e.t + s * 1000, askSeconds: s, thanksUntil: null }
        break
      }
      case 'understood:closed': v = { ...v, askUntil: null }; break
      case 'teacherJoined': v = { ...v, calling: false }; break
      case 'lessonEnded': v = { ...v, ended: true, room: null, poll: null }; break
    }
    if (!v.present) v = { ...v, present: true }
    c.view = v
    if (c.n % CHECK === 0 && !this.checks[c.n / CHECK]) this.checks[c.n / CHECK] = { n: c.n, view: c.view, board: new Map(c.board) }
  }

  /** the screen after the first n events; the board map is live — read it, don't keep it */
  at(n: number): { view: StudentView; board: ReadonlyMap<string, BoardObject> } {
    if (n < this.cur.n) {
      let i = Math.floor(n / CHECK)
      while (!this.checks[i]) i-- // checks[0] is always there
      const from = this.checks[i]
      this.cur = { n: from.n, view: from.view, board: new Map(from.board) }
    }
    while (this.cur.n < n) this.step(this.cur)
    return { view: this.cur.view, board: this.cur.board }
  }

  /** board changes between two counts, if they can be played as operations (else: load the whole state) */
  boardOps(from: number, to: number): BoardOp[] | null {
    if (to < from || to - from > 2000) return null
    const ops: BoardOp[] = []
    for (let i = from; i < to; i++) {
      const e = this.events[i]
      if (e.ev === 'boardState') return null
      if (e.ev === 'boardOp') ops.push(e.data[0] as BoardOp)
    }
    return ops
  }
}

export interface StageMark { t: number; stage: Stage }

/** The lesson's stages over time, for the timeline: from the state the server sent */
export function stageMarks(rec: Recording): StageMark[] {
  const out: StageMark[] = []
  for (const e of rec.events) {
    if (e.ev !== 'state') continue
    const s = (e.data[0] as LessonState).stage
    if (out.at(-1)?.stage !== s) out.push({ t: e.t, stage: s })
  }
  return out
}

export const STAGE_LABELS: Record<Stage, string> = {
  waiting: 'Рассадка',
  group: 'Объяснение',
  individual: 'Индивидуальная работа',
  pairs: 'Работа в парах',
  fours: 'Работа в четвёрках',
}

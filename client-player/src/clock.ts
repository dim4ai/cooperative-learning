// The player's one clock, in server milliseconds (the recording's time). Media elements follow it,
// not the other way round: a stalled video doesn't hold up the students' screens.
import { useEffect, useState } from 'react'

type FrameFn = (t: number, playing: boolean, rate: number) => void

export class Clock {
  private t: number
  private t0 = 0
  private p0 = 0
  playing = false
  rate = 1
  private frames = new Set<FrameFn>()
  private changes = new Set<() => void>()
  private raf = 0

  constructor(readonly min: number, readonly max: number) {
    this.t = min
  }

  now(): number {
    if (!this.playing) return this.t
    return Math.min(this.max, this.t0 + (performance.now() - this.p0) * this.rate)
  }

  play() {
    if (this.playing) return
    if (this.t >= this.max - 50) this.t = this.min
    this.t0 = this.t; this.p0 = performance.now(); this.playing = true
    this.loop()
    this.emit()
  }

  pause() {
    if (!this.playing) return
    this.t = this.now(); this.playing = false
    cancelAnimationFrame(this.raf)
    this.frame()
    this.emit()
  }

  toggle() { if (this.playing) this.pause(); else this.play() }

  seek(t: number) {
    this.t = Math.max(this.min, Math.min(this.max, t))
    this.t0 = this.t; this.p0 = performance.now()
    this.frame()
    this.emit()
  }

  setRate(r: number) {
    this.t = this.now(); this.t0 = this.t; this.p0 = performance.now()
    this.rate = r
    this.frame()
    this.emit()
  }

  /** called every animation frame while playing, and on every seek/pause */
  onFrame(f: FrameFn) { this.frames.add(f); f(this.now(), this.playing, this.rate); return () => { this.frames.delete(f) } }
  /** play / pause / rate changed */
  onChange(f: () => void) { this.changes.add(f); return () => { this.changes.delete(f) } }

  private frame() { const t = this.now(); for (const f of this.frames) f(t, this.playing, this.rate) }
  private emit() { for (const f of this.changes) f() }

  private loop = () => {
    const t = this.now()
    this.frame()
    if (t >= this.max) { this.t = this.max; this.playing = false; this.frame(); this.emit(); return }
    this.raf = requestAnimationFrame(this.loop)
  }

  /** stops; listeners unsubscribe themselves */
  dispose() { cancelAnimationFrame(this.raf); this.playing = false }
}

/** the clock's time for React, a few times a second (screens change on events, not on every frame) */
export function useClockTime(clock: Clock, everyMs = 100): number {
  const [t, setT] = useState(() => clock.now())
  useEffect(() => {
    let last = -Infinity, lastT = NaN
    return clock.onFrame((now, playing) => {
      const p = performance.now()
      if (playing && p - last < everyMs) return
      if (now === lastT) return
      last = p; lastT = now
      setT(now)
    })
  }, [clock, everyMs])
  return t
}

export function useClockState(clock: Clock): { playing: boolean; rate: number } {
  const [s, setS] = useState({ playing: clock.playing, rate: clock.rate })
  useEffect(() => clock.onChange(() => setS({ playing: clock.playing, rate: clock.rate })), [clock])
  return s
}

/** 0:05:12 / 5:12 */
export function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`
}

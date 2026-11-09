// The sound of the room a student is in: every participant's track of that room, each an <audio>
// following the clock. Through Web Audio, to hear how loud each one is right now — the only
// "who is talking" there is, as no camera video is recorded.
import { useEffect, useState } from 'react'
import type { Clock } from './clock'
import type { AudioTrack } from './recording'

interface Playing { a: AudioTrack; el: HTMLAudioElement; gain?: GainNode; an?: AnalyserNode; buf?: Float32Array<ArrayBuffer>; loudAt: number }

const LOUD = 0.015 // RMS: a voice, not hiss
const HOLD = 350 // ms the frame stays after the voice stops

export class RoomSound {
  private ctx: AudioContext | null = null
  private tracks: Playing[]
  private room: string | null = null
  private audible = true
  private volume = 1
  private speaking = new Set<string>()
  private listeners = new Set<() => void>()
  private stop: () => void

  constructor(audio: AudioTrack[], clock: Clock) {
    this.tracks = audio.map(a => {
      const el = new Audio()
      el.preload = 'auto'
      el.src = a.url
      return { a, el, loudAt: 0 }
    })
    this.stop = clock.onFrame((t, playing, rate) => this.frame(t, playing, rate))
    if (import.meta.env.DEV) (window as unknown as { __sound: RoomSound }).__sound = this // for e2e tests
  }

  /** on a click (browsers start sound only after one): from here on, levels are measured */
  unlock() {
    if (this.ctx) { void this.ctx.resume(); return }
    try {
      const ctx = new AudioContext()
      for (const p of this.tracks) {
        const src = ctx.createMediaElementSource(p.el)
        p.gain = ctx.createGain()
        p.an = ctx.createAnalyser()
        p.an.fftSize = 512
        p.buf = new Float32Array(p.an.fftSize)
        src.connect(p.an)
        src.connect(p.gain).connect(ctx.destination)
      }
      this.ctx = ctx
      this.applyVolume()
    } catch { /* no Web Audio: sound still plays, without the "talking" frame */ }
  }

  setRoom(room: string | null) { this.room = room }
  /** the screen video's sound is on instead: the room still plays, silently, for the frames */
  setAudible(on: boolean) { this.audible = on; this.applyVolume() }
  setVolume(v: number) { this.volume = v; this.applyVolume() }

  private applyVolume() {
    const v = this.audible ? this.volume : 0
    for (const p of this.tracks) {
      if (p.gain) p.gain.gain.value = v
      else { p.el.volume = v; }
    }
  }

  private frame(t: number, playing: boolean, rate: number) {
    const now = performance.now()
    const before = this.speaking.size
    let changed = false
    for (const p of this.tracks) {
      const want = p.a.room === this.room && t >= p.a.start && t < p.a.end
      const at = (t - p.a.start) / 1000
      if (want && playing) {
        if (p.el.playbackRate !== rate) p.el.playbackRate = rate
        if (p.el.paused) { p.el.currentTime = at; p.el.play().catch(() => {}) }
        else if (!p.el.seeking && Math.abs(p.el.currentTime - at) > 0.3) p.el.currentTime = at
      } else if (!p.el.paused) p.el.pause()

      let loud = false
      if (want && playing && p.an && p.buf) {
        p.an.getFloatTimeDomainData(p.buf)
        let s = 0
        for (let i = 0; i < p.buf.length; i++) s += p.buf[i] * p.buf[i]
        if (Math.sqrt(s / p.buf.length) > LOUD) p.loudAt = now
        loud = now - p.loudAt < HOLD
      }
      const was = this.speaking.has(p.a.who)
      if (loud && !was) { this.speaking.add(p.a.who); changed = true }
    }
    // someone with several tracks (moved rooms): off only when none of theirs is loud
    for (const who of [...this.speaking]) {
      const still = this.tracks.some(p => p.a.who === who && p.a.room === this.room && playing && now - p.loudAt < HOLD && t >= p.a.start && t < p.a.end)
      if (!still) { this.speaking.delete(who); changed = true }
    }
    if (changed || before !== this.speaking.size) {
      this.speaking = new Set(this.speaking)
      for (const l of this.listeners) l()
    }
  }

  /** for e2e tests: what plays and how loud */
  debug() { return this.tracks.map(p => ({ who: p.a.who, room: p.a.room, paused: p.el.paused, time: p.el.currentTime, loudAgo: performance.now() - p.loudAt })) }

  getSpeaking(): ReadonlySet<string> { return this.speaking }
  onSpeaking(f: () => void) { this.listeners.add(f); return () => { this.listeners.delete(f) } }

  dispose() {
    this.stop()
    for (const p of this.tracks) { p.el.pause(); p.el.removeAttribute('src'); p.el.load() }
    void this.ctx?.close()
  }
}

export function useSpeaking(sound: RoomSound | null): ReadonlySet<string> {
  const [s, setS] = useState<ReadonlySet<string>>(() => sound?.getSpeaking() ?? new Set())
  useEffect(() => {
    if (!sound) return
    setS(sound.getSpeaking())
    return sound.onSpeaking(() => setS(sound.getSpeaking()))
  }, [sound])
  return s
}

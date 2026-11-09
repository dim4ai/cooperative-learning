// The teacher records the lesson as an ordinary video: their screen (the browser offers this very tab
// first), their own voice and the voice of whoever is on the other side. Nothing goes to the server:
// the pieces stay in this tab and download as one file on «Стоп».

const MIMES = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4;codecs=avc1,opus', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
const SLICE_MS = 2000

export class LessonRecorder {
  private rec: MediaRecorder | null = null
  private screen: MediaStream | null = null
  private ctx: AudioContext | null = null
  private mix: MediaStreamAudioDestinationNode | null = null
  private voices = new Map<string, MediaStreamAudioSourceNode>()
  private chunks: Blob[] = []
  private startedAt = 0
  /** after the file is ready: what it is called */
  onSaved: (name: string) => void = () => {}
  /** recording started or stopped (also by «Закрыть доступ» in the browser's own bar) */
  onChange: () => void = () => {}

  constructor(private streams: () => Map<string, MediaStream>) {}

  get recording() { return !!this.rec }
  get elapsed() { return this.rec ? Date.now() - this.startedAt : 0 }

  /** false: the teacher didn't share the screen, or the browser can't record */
  async start(): Promise<boolean> {
    if (this.rec) return true
    if (!navigator.mediaDevices?.getDisplayMedia || typeof MediaRecorder === 'undefined') return false
    try {
      this.screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false, // the voices are mixed in below, straight from the streams
        preferCurrentTab: true, selfBrowserSurface: 'include',
      } as DisplayMediaStreamOptions)
    } catch {
      return false
    }
    this.ctx = new AudioContext()
    this.mix = this.ctx.createMediaStreamDestination()
    for (const [id, s] of this.streams()) this.addVoice(id, s)
    const mime = MIMES.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
    const rec = new MediaRecorder(new MediaStream([...this.screen.getVideoTracks(), ...this.mix.stream.getAudioTracks()]), {
      ...(mime ? { mimeType: mime } : {}), videoBitsPerSecond: 1_500_000, audioBitsPerSecond: 96_000,
      videoKeyFrameIntervalDuration: SLICE_MS,
    } as MediaRecorderOptions)
    this.chunks = []
    rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    rec.start(SLICE_MS)
    this.rec = rec
    this.startedAt = Date.now()
    this.screen.getVideoTracks()[0]?.addEventListener('ended', () => void this.stop())
    this.onChange()
    return true
  }

  /** a voice to hear in the video: mine (id 'me') or someone's who joined; again with the same id replaces it */
  addVoice(id: string, stream: MediaStream) {
    if (!this.ctx || !this.mix) return
    this.voices.get(id)?.disconnect()
    this.voices.delete(id)
    if (!stream.getAudioTracks().length) return
    const src = this.ctx.createMediaStreamSource(stream)
    src.connect(this.mix)
    this.voices.set(id, src)
  }

  removeVoice(id: string) {
    this.voices.get(id)?.disconnect()
    this.voices.delete(id)
  }

  /** stops and downloads the file */
  async stop() {
    const rec = this.rec
    if (!rec) return
    this.rec = null
    if (rec.state !== 'inactive') await new Promise<void>((resolve) => { rec.onstop = () => resolve(); rec.stop() })
    this.screen?.getTracks().forEach((t) => t.stop())
    this.screen = null
    for (const v of this.voices.values()) v.disconnect()
    this.voices.clear()
    void this.ctx?.close()
    this.ctx = this.mix = null
    const type = (rec.mimeType || 'video/webm').split(';')[0]
    const blob = new Blob(this.chunks, { type })
    this.chunks = []
    const d = new Date(this.startedAt)
    const p = (n: number) => String(n).padStart(2, '0')
    const name = `занятие-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}.${type.includes('mp4') ? 'mp4' : 'webm'}`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000)
    this.onChange()
    this.onSaved(name)
  }
}

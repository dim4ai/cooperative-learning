// Signals of a block's time: one soft tone 15 s before its end, a three-note chime at the end.
// Made in the browser: no sound files to load.

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch { return null; }
}

// Browsers let a page make sound only after a click or a key: wake it up then, ready for the signal
if (typeof window !== 'undefined') {
  const wake = () => { audio(); window.removeEventListener('pointerdown', wake); window.removeEventListener('keydown', wake); };
  window.addEventListener('pointerdown', wake);
  window.addEventListener('keydown', wake);
}

function tone(ac: AudioContext, freq: number, at: number, length: number, volume: number) {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(volume, at + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(ac.destination);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

export function playStageBeep(kind: 'soon' | 'end') {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime + 0.05;
  if (kind === 'soon') tone(ac, 880, t, 0.5, 0.25);
  else [660, 830, 990].forEach((f, i) => tone(ac, f, t + i * 0.22, 0.9, 0.3));
}

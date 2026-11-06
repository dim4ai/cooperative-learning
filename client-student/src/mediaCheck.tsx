// Camera/mic check shared by the teacher and student clients — keep the copies identical
// (client-teacher/src/mediaCheck.tsx and client-student/src/mediaCheck.tsx).
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useLocalParticipant } from '@livekit/components-react';
import { VideoPresets } from 'livekit-client';

export interface MediaPrefs {
  camOn: boolean;
  micOn: boolean;
  camId: string;   // '' = browser default
  micId: string;
}

const PREFS_KEY = 'mediaPrefs';

export function loadMediaPrefs(): MediaPrefs {
  const def: MediaPrefs = { camOn: true, micOn: true, camId: '', micId: '' };
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? { ...def, ...JSON.parse(raw) } : def;
  } catch {
    return def;
  }
}

export function saveMediaPrefs(p: MediaPrefs) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* private mode etc. */ }
}

// `ideal`, not exact: a remembered device that's been unplugged falls back to the default one
export function deviceConstraint(id: string): ConstrainDOMString | undefined {
  return id ? { ideal: id } : undefined;
}

// LiveKitRoom `options` that make the chosen devices the default for publishing
export function captureOptions(p: MediaPrefs) {
  return {
    // send and receive only the quality somebody is actually looking at: video is the server's main load
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: { deviceId: deviceConstraint(p.camId), resolution: VideoPresets.h360.resolution },
    audioCaptureDefaults: { deviceId: deviceConstraint(p.micId) },
  };
}

// The second connection, for the teacher's small tile: one 180p stream
export function monitorOptions(p: MediaPrefs) {
  const options = captureOptions(p);
  return {
    ...options,
    videoCaptureDefaults: { ...options.videoCaptureDefaults, resolution: VideoPresets.h180.resolution },
    publishDefaults: { simulcast: false, videoEncoding: VideoPresets.h180.encoding },
  };
}

function useMicLevel(stream: MediaStream | null, enabled: boolean) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!stream || !enabled || stream.getAudioTracks().length === 0) { setLevel(0); return; }
    const audioCtx = new AudioContext();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      setLevel(Math.min(1, (avg / 255) * 2.5));
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { cancelAnimationFrame(raf); source.disconnect(); audioCtx.close(); };
  }, [stream, enabled]);
  return level;
}

const toggleStyle = (on: boolean): CSSProperties => ({
  flex: 1, fontSize: 14, padding: '8px 0', borderRadius: 6, cursor: 'pointer',
  border: 'none', color: '#fff', background: on ? '#27ae60' : '#e74c3c',
});
const selectStyle: CSSProperties = {
  width: '100%', fontSize: 13, padding: 6, borderRadius: 6, border: '1px solid #ccc', background: '#fff',
};

// Preview, mic level, on/off toggles and device selection. Holds the devices open only while
// mounted — LiveKit opens them again itself when joining.
export function MediaCheck({ prefs, onChange }: { prefs: MediaPrefs; onChange: (p: MediaPrefs) => void }) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState('');
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);
  const micLevel = useMicLevel(stream, prefs.micOn);

  // (Re)open the selected devices. Labels in enumerateDevices are only filled in after permission.
  useEffect(() => {
    let cancelled = false;
    let s: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({
      video: { deviceId: deviceConstraint(prefs.camId) },
      audio: { deviceId: deviceConstraint(prefs.micId) },
    })
      .then(async got => {
        if (cancelled) { got.getTracks().forEach(t => t.stop()); return; }
        s = got;
        setError('');
        setStream(got);
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) return;
        setCams(devices.filter(d => d.kind === 'videoinput'));
        setMics(devices.filter(d => d.kind === 'audioinput'));
      })
      .catch(() => { if (!cancelled) { setStream(null); setError('Нет доступа к камере или микрофону — разрешите доступ в браузере'); } });
    return () => { cancelled = true; s?.getTracks().forEach(t => t.stop()); };
  }, [prefs.camId, prefs.micId]);

  useEffect(() => { if (videoRef.current) videoRef.current.srcObject = stream; }, [stream]);
  useEffect(() => { stream?.getVideoTracks().forEach(t => { t.enabled = prefs.camOn; }); }, [prefs.camOn, stream]);
  useEffect(() => { stream?.getAudioTracks().forEach(t => { t.enabled = prefs.micOn; }); }, [prefs.micOn, stream]);

  // the actually opened device, so the select shows it even when the default was used
  const activeCamId = stream?.getVideoTracks()[0]?.getSettings().deviceId ?? prefs.camId;
  const activeMicId = stream?.getAudioTracks()[0]?.getSettings().deviceId ?? prefs.micId;

  return (
    <div style={{ width: 320, maxWidth: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{
        width: '100%', aspectRatio: '4/3', borderRadius: 8, overflow: 'hidden', background: '#222',
        position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {error
          ? <span style={{ color: '#e74c3c', fontSize: 13, padding: 12, textAlign: 'center' }}>{error}</span>
          : <video ref={videoRef} autoPlay playsInline muted
              style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', visibility: prefs.camOn ? 'visible' : 'hidden' }} />}
        {!error && !prefs.camOn && (
          <span style={{ position: 'absolute', color: '#aaa', fontSize: 13 }}>Камера выключена</span>
        )}
      </div>

      <div>
        <div style={{ fontSize: 11, color: 'var(--hint, #888)', marginBottom: 3 }}>
          {prefs.micOn ? 'Скажите что-нибудь — полоска должна двигаться' : 'Микрофон выключен'}
        </div>
        <div style={{ width: '100%', height: 8, borderRadius: 4, background: '#eee', overflow: 'hidden' }}>
          <div style={{
            width: `${micLevel * 100}%`, height: '100%', borderRadius: 4,
            background: micLevel > 0.1 ? '#2ecc71' : '#ccc', transition: 'width 60ms linear',
          }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button onClick={() => onChange({ ...prefs, camOn: !prefs.camOn })} style={toggleStyle(prefs.camOn)}>
          {prefs.camOn ? '📷 Камера вкл' : '📷 Камера выкл'}
        </button>
        <button onClick={() => onChange({ ...prefs, micOn: !prefs.micOn })} style={toggleStyle(prefs.micOn)}>
          {prefs.micOn ? '🎤 Микрофон вкл' : '🔇 Микрофон выкл'}
        </button>
      </div>

      {cams.length > 1 && (
        <label style={{ fontSize: 12, color: 'var(--text-h)' }}>
          Камера
          <select value={activeCamId} onChange={e => onChange({ ...prefs, camId: e.target.value })} style={selectStyle}>
            {cams.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Камера ${i + 1}`}</option>)}
          </select>
        </label>
      )}
      {mics.length > 1 && (
        <label style={{ fontSize: 12, color: 'var(--text-h)' }}>
          Микрофон
          <select value={activeMicId} onChange={e => onChange({ ...prefs, micId: e.target.value })} style={selectStyle}>
            {mics.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Микрофон ${i + 1}`}</option>)}
          </select>
        </label>
      )}
    </div>
  );
}

// Inside LiveKitRoom: applies on/off toggles made during the lesson.
// The initial state comes from LiveKitRoom's video/audio props (applied on connect),
// so the first run is skipped to avoid publishing twice. Pass `micOn` undefined to leave the mic alone.
export function LocalMediaSync({ camOn, micOn }: { camOn: boolean; micOn?: boolean }) {
  const { localParticipant } = useLocalParticipant();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    localParticipant.setCameraEnabled(camOn).catch(() => {});
    if (micOn !== undefined) localParticipant.setMicrophoneEnabled(micOn).catch(() => {});
  }, [camOn, micOn, localParticipant]);
  return null;
}

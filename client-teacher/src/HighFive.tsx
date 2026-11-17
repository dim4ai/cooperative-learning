import { useEffect, useState } from 'react';
import { socket } from './socket';

/** «Дай пять» in a group's room: someone there put a hand up on everyone's screen; each taps it, it grows a little
 *  with each tap, and once all of the group have tapped — boom. The teacher who came in openly may tap too.
 *  (server/src/index.ts, startFive) */
interface Five { room: string; off?: boolean; by?: string; tapped?: string[]; need?: string[]; done?: boolean }

export function HighFive({ room }: { room: string | null }) {
  const [five, setFive] = useState<Five | null>(null);
  useEffect(() => {
    const on = (f: Five) => setFive(f.off ? null : f);
    socket.on('five', on);
    return () => { socket.off('five', on); };
  }, []);
  if (!five || five.room !== room) return null;
  const tapped = five.tapped ?? [], need = five.need ?? [];
  const scale = 1 + 0.18 * tapped.length;
  return (
    <div data-testid="high-five" style={{ position: 'fixed', inset: 0, zIndex: 50, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <style>{`@keyframes five-boom { 0% { transform: scale(1); opacity: 1 } 100% { transform: scale(3.2); opacity: 0 } }
        @keyframes five-in { 0% { transform: scale(0.3) } 100% { transform: scale(1) } }`}</style>
      {five.done
        ? <div style={{ fontSize: 160, animation: 'five-boom 1.4s ease-out forwards' }}>💥</div>
        : <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, animation: 'five-in 0.3s ease-out' }}>
            <button onClick={() => socket.emit('five:tap')} title="Дай пять!" style={{
              pointerEvents: 'auto', fontSize: 110, lineHeight: 1, background: 'none', border: 'none', cursor: 'pointer',
              transform: `scale(${scale})`, transition: 'transform 0.25s cubic-bezier(.3,1.8,.5,1)',
            }}>🖐️</button>
            <div style={{ marginTop: 20 + 20 * tapped.length, background: 'rgba(43,58,85,.9)', color: '#fff', borderRadius: 10, padding: '6px 12px', fontSize: 15 }}>
              {five.by}: «Дай пять!» — {tapped.filter(n => need.includes(n)).length} из {need.length}
            </div>
          </div>}
    </div>
  );
}

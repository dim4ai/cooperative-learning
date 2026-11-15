// Raised hands in the explanation: who, in the order raised; a press gives one the word.
// The one given the word is told so on their screen; a bot of the solo demo says its line (shown here too).
import { useEffect, useState } from 'react';
import { socket } from './socket';

export interface Hands { up: string[]; floor: { name: string; text?: string; until: number } | null }

export function useHands(): Hands {
  const [hands, setHands] = useState<Hands>({ up: [], floor: null });
  useEffect(() => {
    socket.on('hands', setHands);
    return () => { socket.off('hands', setHands); };
  }, []);
  // the line is over: its words go
  const floor = hands.floor;
  useEffect(() => {
    if (!floor) return;
    const t = setTimeout(() => setHands(h => (h.floor === floor ? { ...h, floor: null } : h)), Math.max(0, floor.until - Date.now()) + 1500);
    return () => clearTimeout(t);
  }, [floor]);
  return hands;
}

export function HandsPanel({ hands }: { hands: Hands }) {
  const { up, floor } = hands;
  if (!up.length && !floor) return null;
  return (
    <div data-testid="hands" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 10, borderRadius: 8, background: '#fff6dd', border: '1px solid #f1d58a' }}>
      {floor && <div data-testid="hand-floor" style={{ fontSize: 13, color: '#333' }}>
        <b>{floor.name}:</b> {floor.text ? `«${floor.text}»` : 'вы дали слово'}
      </div>}
      {up.length > 0 && <div style={{ fontSize: 13, fontWeight: 'bold', color: '#7a5b00' }}>✋ Подняли руку</div>}
      {up.map(name => (
        <button key={name} data-testid="hand-give" data-name={name} onClick={() => socket.emit('hand:give', name)} style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '7px 10px',
          border: '1px solid #e0c36a', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 14, color: '#222',
        }}>
          <span>✋ {name}</span><span style={{ fontSize: 12, color: '#27ae60' }}>дать слово</span>
        </button>
      ))}
    </div>
  );
}

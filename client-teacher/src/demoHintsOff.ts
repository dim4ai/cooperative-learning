// Whether the solo demo shows its hints beside the buttons; the guide in the right panel asks too
import { useSyncExternalStore } from 'react';

const OFF_KEY = 'demoHintsOff';
let off = (() => { try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return false; } })();
const listeners = new Set<() => void>();
export function setHintsOff(v: boolean) {
  off = v;
  try { localStorage.setItem(OFF_KEY, v ? '1' : '0'); } catch { /* for this visit only */ }
  listeners.forEach(l => l());
}
export function useHintsOff(): boolean {
  return useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => off);
}


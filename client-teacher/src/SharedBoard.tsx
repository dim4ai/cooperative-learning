import { useEffect, useRef, useCallback } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, AppState } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import { socket } from './socket';

export function SharedBoard() {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const skipChanges = useRef(0);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSent = useRef<string>('');

  useEffect(() => {
    function onElements(incoming: readonly ExcalidrawElement[]) {
      const api = apiRef.current;
      if (!api || incoming.length === 0) return;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const localMap = new Map(api.getSceneElements().map((el: any) => [el.id, el]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const el of incoming as any[]) {
        const local = localMap.get(el.id);
        if (!local || el.version > local.version) localMap.set(el.id, el);
      }
      skipChanges.current++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api.updateScene({ elements: Array.from(localMap.values()) as any, captureUpdate: 'NEVER' });
    }
    socket.on('boardElements', onElements);
    return () => { socket.off('boardElements', onElements); };
  }, []);

  const handleChange = useCallback((elements: readonly ExcalidrawElement[], _appState: AppState) => {
    if (skipChanges.current > 0) { skipChanges.current--; return; }
    if (elements.length === 0) return;
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => {
      const serialized = JSON.stringify(elements.map(el => el.id + ':' + el.version));
      if (serialized === lastSent.current) return;
      lastSent.current = serialized;
      socket.emit('boardElements', elements);
    }, 80);
  }, []);

  return (
    <div
      style={{ width: '100%', height: '100%', overflow: 'hidden' }}
      onPointerDown={e => {
        const target = e.target as HTMLElement;
        const container = e.currentTarget as HTMLElement;
        if (target.closest('.App-toolbar, .selected-shape-actions')) {
          container.classList.remove('is-drawing');
        } else {
          container.classList.add('is-drawing');
        }
      }}
    >
      <style>{`
        .excalidraw button[data-testid="main-menu-trigger"] { display: none !important; }
        .is-drawing .excalidraw .selected-shape-actions { opacity: 0; pointer-events: none; transition: opacity 0.15s; }
        .excalidraw .selected-shape-actions { transition: opacity 0.15s; }
      `}</style>
      <Excalidraw
        excalidrawAPI={api => { apiRef.current = api; }}
        onChange={handleChange}
        UIOptions={{ canvasActions: { export: false, loadScene: false, saveToActiveFile: false } }}
      />
    </div>
  );
}

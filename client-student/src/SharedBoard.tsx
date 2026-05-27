import { useEffect, useRef, useCallback } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import type { ExcalidrawImperativeAPI, AppState } from '@excalidraw/excalidraw/types';
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import '@excalidraw/excalidraw/index.css';
import { socket, myName } from './socket';

export function SharedBoard({ room }: { room: string }) {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const skipChanges = useRef(0);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function onElements(incoming: readonly ExcalidrawElement[]) {
      const api = apiRef.current;
      if (!api || incoming.length === 0) return;

      // Merge: for each incoming element, take it if it has higher version or doesn't exist locally
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const localMap = new Map(api.getSceneElements().map((el: any) => [el.id, el]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const el of incoming as any[]) {
        const local = localMap.get(el.id);
        if (!local || el.version > local.version) {
          localMap.set(el.id, el);
        }
      }

      skipChanges.current++;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      api.updateScene({ elements: Array.from(localMap.values()) as any, captureUpdate: 'NEVER' });
    }

    socket.on('boardElements', onElements);
    return () => { socket.off('boardElements', onElements); };
  }, [room]);

  const lastSent = useRef<string>('');

  const handleChange = useCallback((elements: readonly ExcalidrawElement[], _appState: AppState) => {
    if (skipChanges.current > 0) {
      skipChanges.current--;
      return;
    }
    if (elements.length === 0) return;

    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => {
      const serialized = JSON.stringify(elements.map(el => el.id + ':' + el.version));
      if (serialized === lastSent.current) return;
      lastSent.current = serialized;
      const stamped = elements.map(el =>
        el.customData?.author ? el : { ...el, customData: { ...el.customData, author: myName } }
      );
      socket.emit('boardElements', stamped);
    }, 80);
  }, []);

  return (
    <div
      style={{ width: '100%', height: '100%', borderRadius: 4, overflow: 'hidden', border: '1px solid #ccc', boxSizing: 'border-box' }}
      onPointerDown={e => {
        const target = e.target as HTMLElement;
        const container = e.currentTarget as HTMLElement;
        if (target.closest('.App-toolbar, .App-menu__left')) {
          container.classList.remove('is-drawing');
        } else {
          container.classList.add('is-drawing');
        }
      }}
    >
      <Excalidraw
        excalidrawAPI={api => { apiRef.current = api; }}
        onChange={handleChange}
        UIOptions={{ canvasActions: { export: false, loadScene: false, saveToActiveFile: false } }}
      />
    </div>
  );
}

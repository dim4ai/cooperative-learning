// Sending a media file when the server asks for it (see server/src/mediaRelay.ts): piece by
// piece, each next piece only after the server says the receivers keep up.
// Same code in client-student (students pass on files they already have).
import type { Socket } from 'socket.io-client';

export function serveMedia(socket: Socket, find: (hash: string) => Blob | undefined): () => void {
  const onSend = async ({ tid, hash, chunk }: { tid: string; hash: string; chunk: number }) => {
    const blob = find(hash);
    if (!blob) return; // the server gives up on us and asks someone else
    for (let seq = 0, off = 0; off < blob.size; seq++, off += chunk) {
      const data = await blob.slice(off, off + chunk).arrayBuffer();
      let r: { go?: boolean } | undefined;
      try { r = await socket.timeout(60_000).emitWithAck('media:chunk', { tid, seq, data }); } catch { return; }
      if (!r?.go) return;
    }
  };
  socket.on('media:send', onSend);
  return () => { socket.off('media:send', onSend); };
}

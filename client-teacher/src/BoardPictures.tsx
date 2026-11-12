import { createRoot } from 'react-dom/client';
import type { BoardPicture, BoardPictures } from './slides/Board';
import { Cropper, Note, PageChooser, type Crop } from './PictureDialogs';

// Pictures on the teacher's board: a picture file or a page of a PDF, cropped before it goes on the board,
// and cropped again later. What goes to the board is a data URL small enough to travel as one board change.

const MAX_SIDE = 2000;          // px: the page is 1600×900, a picture rarely needs more
const MAX_DATA_URL = 360_000;   // chars: the server takes a picture of up to 400 000 (index.ts BOARD_MAX_PICTURE_BYTES)
const PDF_PAGE_WIDTH = 2000;


/** Opens a dialog of its own outside the app's tree; it ends with a value or null */
function dialog<T>(render: (done: (v: T | null) => void) => React.ReactNode): Promise<T | null> {
  return new Promise(resolve => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (v: T | null) => { root.unmount(); host.remove(); resolve(v); };
    root.render(render(done));
  });
}

function chooseFile(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,application/pdf,.pdf';
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Не удалось открыть картинку'));
    img.src = src;
  });
}

/** The kept part, made small enough for the board: PNG while it fits (keeps transparency), JPEG otherwise */
function encode(img: HTMLImageElement, c: Crop, keepPng: boolean): BoardPicture {
  let k = Math.min(1, MAX_SIDE / Math.max(c.w, c.h));
  for (;;) {
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(c.w * k));
    canvas.height = Math.max(1, Math.round(c.h * k));
    const ctx = canvas.getContext('2d')!;
    const out = (src: string) => ({ src, width: canvas.width, height: canvas.height });
    if (keepPng) {
      ctx.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL('image/png');
      if (png.length <= MAX_DATA_URL) return out(png);
    }
    ctx.globalCompositeOperation = 'destination-over'; // white under anything transparent
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    if (!keepPng) ctx.drawImage(img, c.x, c.y, c.w, c.h, 0, 0, canvas.width, canvas.height);
    for (const q of [0.85, 0.75, 0.65, 0.55]) {
      const jpeg = canvas.toDataURL('image/jpeg', q);
      if (jpeg.length <= MAX_DATA_URL) return out(jpeg);
    }
    k *= 0.8;
  }
}

async function pdfPages(file: File) {
  const pdf = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdf.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdf.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  async function render(n: number, width: number): Promise<string> {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    page.cleanup();
    return canvas.toDataURL('image/png');
  }
  return { count: doc.numPages, render, close: () => { task.destroy().catch(() => {}); } };
}

export const boardPictures: BoardPictures = {
  async pick() {
    const file = await chooseFile();
    if (!file) return null;
    let src: string;
    let png = file.type === 'image/png' || file.type === 'image/gif' || file.type === 'image/webp';
    if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
      const pages = await pdfPages(file).catch(() => null);
      if (!pages) { await dialog<true>(done => <Note text="Не удалось открыть PDF." onClose={() => done(true)} />); return null; }
      try {
        const n = pages.count === 1 ? 1 : await dialog<number>(done => <PageChooser pages={pages} onDone={done} />);
        if (!n) return null;
        src = await pages.render(n, PDF_PAGE_WIDTH);
        png = false;
      } finally { pages.close(); }
    } else if (file.type.startsWith('image/')) {
      src = URL.createObjectURL(file);
    } else {
      await dialog<true>(done => <Note text="Это не картинка и не PDF. Документ Word или презентацию сохраните как PDF и вставьте его." onClose={() => done(true)} />);
      return null;
    }
    try {
      const img = await loadImage(src);
      const crop = await dialog<Crop>(done => <Cropper img={img} action="Вставить" onDone={done} />);
      return crop ? encode(img, crop, png) : null;
    } finally {
      if (src.startsWith('blob:')) URL.revokeObjectURL(src);
    }
  },

  async crop(src) {
    const img = await loadImage(src);
    const crop = await dialog<Crop>(done => <Cropper img={img} action="Обрезать" onDone={done} />);
    if (!crop) return null;
    return { ...encode(img, crop, src.startsWith('data:image/png')), from: crop };
  },
};


import type { OcrLine } from './shopText';
import { preparePhoto } from './preparePhoto';

/**
 * Reads the text of a photo in the browser with Tesseract.js (free, nothing leaves the phone). The engine and its English data are
 * served by the app itself from /ocr (see scripts/copy-ocr-assets.mjs) and are loaded only when a photo is scanned for the first time.
 */
export type ScanStage = 'preparing' | 'loading' | 'reading';
export interface ScanProgress {
  stage: ScanStage;
  /** 0-100 within the stage (loading and reading), or 0 while preparing. */
  percent: number;
}

type TesseractWorker = import('tesseract.js').Worker;
let workerPromise: Promise<TesseractWorker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let listener: ((p: ScanProgress) => void) | null = null;

const base = () => `${import.meta.env.BASE_URL || '/'}ocr`.replace(/\/{2,}/g, '/');

async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, PSM } = await import('tesseract.js');
      const dir = base();
      const worker = await createWorker('eng', 1, {
        workerPath: `${dir}/worker.min.js`,
        corePath: dir,
        langPath: `${dir}/lang`,
        gzip: true,
        cacheMethod: 'readOnly',
        logger: m => {
          if (!listener) return;
          if (m.status === 'recognizing text') listener({ stage: 'reading', percent: Math.round((m.progress || 0) * 100) });
          else listener({ stage: 'loading', percent: Math.round((m.progress || 0) * 100) });
        }
      });
      // a signboard is scattered text, not a page: read it as sparse text
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT, preserve_interword_spaces: '1' });
      return worker;
    })().catch(err => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/** Frees the reader's memory (a phone has little) a while after the last scan. */
function scheduleRelease() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => releaseShopReader(), 120_000);
}
export async function releaseShopReader() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
  const p = workerPromise;
  workerPromise = null;
  if (p) await p.then(w => w.terminate()).catch(() => undefined);
}

export interface ShopPhotoRead {
  lines: OcrLine[];
  thumbnail: string;
}

export async function readShopPhoto(file: Blob, onProgress?: (p: ScanProgress) => void): Promise<ShopPhotoRead> {
  listener = onProgress ?? null;
  try {
    onProgress?.({ stage: 'preparing', percent: 0 });
    const photo = await preparePhoto(file);
    const worker = await getWorker();
    const result = await Promise.race([
      worker.recognize(photo.canvas),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Reading the photo took too long. Try a closer, brighter photo.')), 90_000))
    ]);
    const lines: OcrLine[] = (result.data.lines || []).map(l => ({
      text: l.text,
      confidence: l.confidence,
      height: Math.max(1, l.bbox.y1 - l.bbox.y0),
      top: l.bbox.y0
    }));
    return { lines, thumbnail: photo.thumbnail };
  } catch (err) {
    // a worker that failed half-way is not reused
    await releaseShopReader();
    throw err instanceof Error ? err : new Error('Could not read the photo.');
  } finally {
    listener = null;
    scheduleRelease();
  }
}

import { readShopPhoto } from '../../../src/lib/ocr/readShopPhoto';
import { parseShopText } from '../../../src/lib/ocr/shopText';

/** Draws a shop board like a phone photo of one (text on a coloured panel, optional tilt, dimness and noise) and reads it with the real engine. */
async function board(opts: { tilt?: number; dim?: number; noise?: number; seed?: number }): Promise<Blob> {
  const c = document.createElement('canvas');
  c.width = 1600;
  c.height = 1100;
  const g = c.getContext('2d')!;
  g.fillStyle = '#6b7280';
  g.fillRect(0, 0, c.width, c.height);
  g.translate(800, 550);
  g.rotate(((opts.tilt || 0) * Math.PI) / 180);
  g.translate(-800, -550);
  g.fillStyle = '#1e3a8a';
  g.fillRect(120, 120, 1360, 860);
  g.fillStyle = '#fef08a';
  g.textBaseline = 'top';
  g.font = 'bold 130px Arial, Helvetica, sans-serif';
  g.fillText('SHARMA MOBILE', 190, 170);
  g.fillText('& ELECTRONICS', 190, 320);
  g.fillStyle = '#ffffff';
  g.font = '56px Arial, Helvetica, sans-serif';
  g.fillText('Shop No. 12, Main Market, Sector 14', 190, 520);
  g.fillText('Gurgaon, Haryana 122001', 190, 600);
  g.fillText('Mob: 98112 00000, 99100 11111', 190, 720);
  g.font = '44px Arial, Helvetica, sans-serif';
  g.fillText('GSTIN 06ABCDE1234F1Z5', 190, 830);
  g.setTransform(1, 0, 0, 1, 0, 0);
  if (opts.dim) {
    g.fillStyle = `rgba(0,0,0,${opts.dim})`;
    g.fillRect(0, 0, c.width, c.height);
  }
  if (opts.noise) {
    // A repeatable image keeps OCR regressions attributable to code, not a new random fixture on every run.
    let seed = opts.seed ?? 42;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const img = g.getImageData(0, 0, c.width, c.height);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (random() - 0.5) * opts.noise;
      img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
  }
  return new Promise(res => c.toBlob(b => res(b!), 'image/jpeg', 0.85));
}

(window as any).__board = board;
(window as any).scanBoard = async (opts: { tilt?: number; dim?: number; noise?: number; seed?: number }) => {
  const t0 = performance.now();
  const stages: string[] = [];
  const read = await readShopPhoto(await board(opts), p => { if (!stages.includes(p.stage)) stages.push(p.stage); });
  return { scan: parseShopText(read.lines), ms: Math.round(performance.now() - t0), stages, lines: read.lines.length, thumb: read.thumbnail.startsWith('data:image') };
};

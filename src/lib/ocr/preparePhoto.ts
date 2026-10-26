/**
 * Gets a phone photo ready for the text reader: upright, no bigger than needed, grey, with the contrast stretched.
 * A 12-megapixel photo read as it is is slow and no more accurate; a dim or washed-out board reads better with its contrast stretched.
 */
export interface PreparedPhoto {
  canvas: HTMLCanvasElement;
  /** A small preview for the form. */
  thumbnail: string;
  width: number;
  height: number;
}

const MAX_SIDE = 1600;

export async function preparePhoto(file: Blob): Promise<PreparedPhoto> {
  let bitmap: ImageBitmap;
  try {
    // modern browsers turn the picture upright from its EXIF orientation by default
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await createImageBitmap(file);
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('This browser cannot read photos.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  // grey + contrast stretch between the 2nd and 98th percentile of the brightness
  const img = ctx.getImageData(0, 0, width, height);
  const px = img.data;
  const hist = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    const g = Math.round(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
    px[i] = px[i + 1] = px[i + 2] = g;
    hist[g]++;
  }
  const total = width * height;
  let lo = 0;
  let hi = 255;
  for (let acc = 0; lo < 255 && acc + hist[lo] < total * 0.02; lo++) acc += hist[lo];
  for (let acc = 0; hi > 0 && acc + hist[hi] < total * 0.02; hi--) acc += hist[hi];
  if (hi - lo > 20) {
    const k = 255 / (hi - lo);
    for (let i = 0; i < px.length; i += 4) {
      const v = Math.max(0, Math.min(255, Math.round((px[i] - lo) * k)));
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  }
  ctx.putImageData(img, 0, 0);

  const thumb = document.createElement('canvas');
  const ts = Math.min(1, 240 / Math.max(width, height));
  thumb.width = Math.round(width * ts);
  thumb.height = Math.round(height * ts);
  thumb.getContext('2d')?.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return { canvas, thumbnail: thumb.toDataURL('image/jpeg', 0.7), width, height };
}

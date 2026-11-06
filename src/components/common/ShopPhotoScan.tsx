import React, { useEffect, useRef, useState } from 'react';
import { Camera, Check, Loader2, RefreshCw, ScanText } from 'lucide-react';
import { readShopPhoto, releaseShopReader, type ScanProgress } from '../../lib/ocr/readShopPhoto';
import { parseShopText, type ShopScan } from '../../lib/ocr/shopText';

/**
 * "Scan shop board": the visitor takes (or picks) a photo of the shop and the text on it is read ON THE PHONE (Tesseract.js, free; the
 * photo is not uploaded anywhere). The form is filled from the result and every value stays editable: reading a sign is a good guess, not a fact.
 */
export const ShopPhotoScan: React.FC<{
  onScan: (scan: ShopScan) => void;
  /** Lets the person put another detected value into the form with one tap. */
  onPick: (field: 'name' | 'address' | 'phone', value: string) => void;
  scan: ShopScan | null;
  /** Where the details go: a trip (the default, its own words) or a new lead (Field Visit > Add Lead). */
  purpose?: 'visit' | 'lead';
}> = ({ onScan, onPick, scan, purpose = 'visit' }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ScanProgress | null>(null);
  const [thumb, setThumb] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // the reader holds a few tens of MB: give them back when the form closes
  useEffect(() => () => void releaseShopReader(), []);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!file.type.startsWith('image/')) {
      setError('Please choose a photo (an image file).');
      return;
    }
    setBusy(true);
    try {
      const read = await readShopPhoto(file, setProgress);
      setThumb(read.thumbnail);
      const parsed = parseShopText(read.lines);
      if (!parsed.shopName && parsed.phones.length === 0 && !parsed.address) {
        setError('No readable text found. Take the photo closer, straight on and in good light, then try again.');
      }
      onScan(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the photo.');
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const status =
    progress?.stage === 'loading'
      ? `Loading the text reader (first time only)… ${progress.percent}%`
      : progress?.stage === 'reading'
        ? `Reading the photo… ${progress.percent}%`
        : 'Preparing the photo…';

  return (
    <div className="p-3 rounded-2xl bg-indigo-50 border border-indigo-200 space-y-2 font-sans" data-testid="shop-scan">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl bg-white text-indigo-600 border border-indigo-200 flex items-center justify-center shrink-0">
          <ScanText className="w-5 h-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-indigo-900">{purpose === 'lead' ? 'Take or upload a photo of the shop board or visiting card' : 'Fill from a photo of the shop'}</p>
          <p className="text-[11px] text-indigo-800/80">
            {purpose === 'lead'
              ? 'The business name, phone, address and e-mail are read on this phone (the photo is not uploaded or kept) and filled in below. Check and correct them: you can change every field.'
              : 'Photograph the shop board. The name, phone and address are read on this phone and filled in below; check them before starting.'}
          </p>
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={e => void handleFile(e.target.files?.[0])}
        data-testid="shop-photo-input"
        aria-label="Photo of the shop"
      />
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-60 cursor-pointer"
          data-testid="shop-photo-button"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : scan ? <RefreshCw className="w-4 h-4" aria-hidden="true" /> : <Camera className="w-4 h-4" aria-hidden="true" />}
          {busy ? 'Reading…' : scan ? 'Scan another photo' : 'Take / choose photo'}
        </button>
        {thumb && <img src={thumb} alt="The shop photo that was read" className="h-12 w-auto rounded-lg border border-indigo-200" />}
      </div>
      {busy && (
        <p className="text-[11px] text-indigo-900" role="status" data-testid="shop-scan-status">
          {status}
        </p>
      )}
      {error && (
        <p className="text-[11px] text-rose-700" role="alert">
          {error}
        </p>
      )}
      {scan && !busy && (
        <div className="space-y-1.5 text-[11px] text-slate-700" data-testid="shop-scan-result">
          <p className="flex items-center gap-1 font-bold text-emerald-700">
            <Check className="w-3.5 h-3.5" aria-hidden="true" /> Read from the photo - please check the filled fields
          </p>
          {scan.nameAlternatives.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500">Other names:</span>
              {scan.nameAlternatives.map(n => (
                <button key={n} type="button" onClick={() => onPick('name', n)} className="px-2 py-0.5 rounded-full bg-white border border-slate-200 hover:bg-slate-50 cursor-pointer">
                  {n}
                </button>
              ))}
            </div>
          )}
          {scan.phones.length > 1 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500">Phone numbers:</span>
              {scan.phones.map(p => (
                <button key={p.value} type="button" onClick={() => onPick('phone', p.value)} className="px-2 py-0.5 rounded-full bg-white border border-slate-200 hover:bg-slate-50 cursor-pointer font-mono">
                  {p.value}
                </button>
              ))}
            </div>
          )}
          {(scan.email || scan.website || scan.gstin || scan.category) && (
            <p className="text-slate-500">
              {purpose === 'lead' ? 'Also read (added to the notes for you to check):' : 'Also read (saved with the visit):'}{' '}
              {[scan.category, scan.email?.value, scan.website?.value, scan.gstin ? `GSTIN ${scan.gstin.value}${scan.gstin.check ? ' (check)' : ''}` : null].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
};

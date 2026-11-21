import React, { useState } from 'react';
import { Download } from 'lucide-react';
import type { SampleFormat } from '../../lib/sampleSheetDownload';
import { tcBtn } from '../telecaller/ui';

/**
 * "Download a sample sheet" beside an upload: a short note on what the sample is, and a button per file type the upload accepts. The sample has
 * the headings the CRM expects and one row of dummy details (placeholders, never a real person); the upload skips that row.
 */
export const SampleSheetDownload: React.FC<{
  formats: SampleFormat[];
  onDownload: (format: SampleFormat) => Promise<void> | void;
  /** what the sheet is for, e.g. "contact sheet" */
  what?: string;
}> = ({ formats, onDownload, what = 'sheet' }) => {
  const [busy, setBusy] = useState<SampleFormat | null>(null);
  const [error, setError] = useState('');
  const go = async (f: SampleFormat) => {
    setBusy(f);
    setError('');
    try {
      await onDownload(f);
    } catch {
      setError('The sample could not be created. Please try again.');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 flex flex-wrap items-center justify-between gap-3" data-testid="sample-sheet">
      <div className="min-w-0 text-sm text-slate-700">
        <p className="font-bold text-slate-900">Not sure what goes in the {what}?</p>
        <p className="text-xs text-slate-600 mt-0.5">
          Download the sample: it has the columns the CRM expects, and a first row of dummy details (Contact_Name, Company_Name …) that only shows the format. It is skipped when you upload, so you can delete it or leave it.
        </p>
        {error && <p role="alert" className="text-xs text-rose-700 mt-1">{error}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {formats.map(f => (
          <button key={f} type="button" className={tcBtn.secondary} disabled={busy !== null} onClick={() => void go(f)}>
            <Download className="w-4 h-4" aria-hidden="true" /> {f === 'xlsx' ? 'Sample Excel sheet' : 'Sample CSV'}
          </button>
        ))}
      </div>
    </div>
  );
};

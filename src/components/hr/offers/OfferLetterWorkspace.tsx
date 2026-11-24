import React, { useCallback, useEffect, useState } from 'react';
import { FileText, Layers } from 'lucide-react';
import { fetchHrDirectory } from '../../../lib/hrDirectory';
import type { Employee } from '../../../types/amuwaHq';
import { ErrorBanner, Spinner } from '../../team-member/pipeline/shared';
import { OfferLetterGenerator } from './OfferLetterGenerator';
import { OfferTemplateManager } from './OfferTemplateManager';

/**
 * The one Offer Letter Generator of the HR dashboard (HR & Operations > Offer Letter Generation, and Employee Letters > Offer Letter):
 * "Generate & issue" (choose the designation, fill in, preview, generate) and "Templates by designation" (one template per designation).
 */
export const OfferLetterWorkspace: React.FC<{ employees?: Employee[]; onToast?: (m: string) => void }> = ({ employees: given, onToast }) => {
  const [view, setView] = useState<'generate' | 'templates'>('generate');
  const [loaded, setLoaded] = useState<Employee[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try { setLoaded((await fetchHrDirectory()).employees); } catch (e) { setError(e instanceof Error ? e.message.replace(/^[A-Z_]+:\s*/, '') : String(e)); }
  }, []);
  useEffect(() => { if (!given) void load(); }, [given, load]);
  const employees = given ?? loaded;
  return (
    <div className="space-y-4" data-testid="offer-letter-workspace">
      <div role="tablist" aria-label="Offer Letter Generation" className="flex gap-1 border-b border-slate-200 overflow-x-auto">
        {([['generate', 'Generate & issue', FileText], ['templates', 'Templates by designation', Layers]] as const).map(([id, label, Icon]) => (
          <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)}
            className={`px-2.5 sm:px-3.5 py-2.5 -mb-px border-b-2 flex items-center gap-2 text-sm whitespace-nowrap ${view === id ? 'border-blue-600 text-blue-700 font-semibold' : 'border-transparent text-slate-600 font-medium hover:text-slate-900'}`}>
            <Icon className="w-4 h-4" aria-hidden="true" /> {label}
          </button>
        ))}
      </div>
      {view === 'templates' ? <OfferTemplateManager onToast={onToast} />
        : error ? <ErrorBanner message={`The employee list could not be loaded: ${error}`} onRetry={() => void load()} />
        : !employees ? <Spinner label="Loading employees…" />
        : <OfferLetterGenerator employees={employees} onToast={onToast} />}
    </div>
  );
};

export default OfferLetterWorkspace;

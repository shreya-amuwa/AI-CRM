import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Award, FileText, Loader2, ShieldCheck } from 'lucide-react';
import type { Employee } from '../../../types/amuwaHq';
import type { HrDocType } from '../../../../shared/contracts';
import { fetchHrDirectory } from '../../../lib/hrDirectory';
import { HrDocumentStudio } from './HrDocumentStudio';
import { LetterTemplateManager } from './LetterTemplateManager';
import { HrPageHeader, hrCard } from '../../hr/hrUi';

/**
 * Employee Letters: the NDA, the Offer Letter and the Experience Letter, generated from the HR record, previewed, stored against the employee and
 * downloaded (HrDocumentStudio). The Offer and Experience Letters also have a versioned master template (LetterTemplateManager); the NDA is the
 * official agreement and only its date and the employee's name change.
 */
type View = 'generate' | 'template';
const LETTERS: { type: HrDocType; label: string; icon: typeof FileText; active: string }[] = [
  { type: 'NDA', label: 'NDA Letter', icon: ShieldCheck, active: 'text-emerald-700' },
  { type: 'OFFER', label: 'Offer Letter', icon: FileText, active: 'text-blue-700' },
  { type: 'EXPERIENCE', label: 'Experience Letter', icon: Award, active: 'text-purple-700' }
];

interface Props {
  initialType?: HrDocType;
  /** the HR dashboard already has the directory; the sidebar page loads it itself */
  employees?: Employee[];
  onSuccessToast?: (msg: string) => void;
}

export const HrLettersPage: React.FC<Props> = ({ initialType = 'OFFER', employees: given, onSuccessToast }) => {
  const [type, setType] = useState<HrDocType>(initialType);
  const [view, setView] = useState<View>('generate');
  const [loaded, setLoaded] = useState<Employee[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => { setType(initialType); setView('generate'); }, [initialType]);

  const loadDirectory = useCallback(async () => {
    setLoadError(null);
    try { setLoaded((await fetchHrDirectory()).employees); } catch (e) { setLoadError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { if (!given) void loadDirectory(); }, [given, loadDirectory]);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const notify = (m: string) => {
    if (onSuccessToast) { onSuccessToast(m); return; }
    setToast(m);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  const employees = given ?? loaded;
  const current = LETTERS.find(l => l.type === type)!;

  return (
    <div className="space-y-5 font-sans" data-testid="hr-letters-page">
      <div className={`${hrCard} p-4 sm:p-5`}>
        <HrPageHeader as="h2" icon={FileText} title="Employee Letters"
          subtitle="Generate the NDA, Offer Letter and Experience Letter from the employee's HR record. Every letter is stored on the employee's record."
          actions={
        <div role="group" aria-label="Letter" className="flex flex-wrap items-center gap-1 p-1 bg-slate-100 rounded-lg text-xs font-semibold shrink-0">
          {LETTERS.map(l => (
            <button key={l.type} type="button" aria-pressed={type === l.type} onClick={() => { setType(l.type); if (l.type === 'NDA') setView('generate'); }}
              className={`h-8 px-3 rounded-md flex items-center gap-2 ${type === l.type ? `bg-white ${l.active} font-bold shadow-xs` : 'text-slate-600 hover:text-slate-900'}`}>
              <l.icon className="w-4 h-4" /> <span>{l.label}</span>
            </button>
          ))}
        </div>} />
      </div>

      {type !== 'NDA' && (
        <div role="group" aria-label={`${current.label} view`} className="flex gap-1.5 text-xs font-semibold">
          {(['generate', 'template'] as View[]).map(v => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}
              className={`px-3.5 py-2 rounded-xl border ${view === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>
              {v === 'generate' ? 'Generate & issue' : 'Master template'}
            </button>
          ))}
        </div>
      )}
      {type === 'NDA' && (
        <p className="text-[11px] text-slate-600 bg-emerald-50 border border-emerald-100 rounded-2xl p-3">The NDA is the company's official agreement: its clauses are fixed. Only the date and the employee's name are filled in.</p>
      )}

      {toast && <div role="status" className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">{toast}</div>}

      {view === 'template' && type !== 'NDA'
        ? <LetterTemplateManager key={type} type={type} onSuccessToast={notify} />
        : loadError
        ? (
          <div role="alert" className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center justify-between gap-3">
            <span>The employee list could not be loaded: {loadError.replace(/^[A-Z_]+:\s*/, '')}</span>
            <button type="button" onClick={() => void loadDirectory()} className="px-3 py-1.5 rounded-xl bg-white border border-rose-200 font-bold">Try again</button>
          </div>
        )
        : !employees
        ? <div className="p-6 text-xs text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading employees…</div>
        : <HrDocumentStudio key={type} type={type} employees={employees} onSuccessToast={notify} />}
    </div>
  );
};

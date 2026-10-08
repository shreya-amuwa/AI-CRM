import React, { useState } from 'react';
import { CheckCircle2, Clock, DatabaseZap, LogOut, ShieldCheck, UserPlus } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { importSupportRecords, pendingSupportRecords, type ImportOutcome } from '../../lib/legacySupportImport';
import { PipelineWorkspace, type PipelineSection } from '../team-member/pipeline/PipelineWorkspace';
import { notifyPipelineChanged, usePipelineCounts } from '../team-member/pipeline/shared';
import { OnboardingVerificationWorkspace } from '../team-member/pipeline/VerificationViews';

interface TechnicalSupportDashboardProps {
  currentUserId?: string;
  userName?: string;
  onLogout?: () => void;
}

type Tab = 'verification' | PipelineSection;

/**
 * Technical Support / Technical Consultant workspace. Everything here is read
 * from and written to the database:
 *  - Onboarding verification: customers the sales team forwarded.
 *  - Leads / Contacts / Customers: the support member's own pipeline, on the
 *    same customer records and lifecycle as sales (Lead → Potential → Onboarding).
 */
export const TechnicalSupportDashboard: React.FC<TechnicalSupportDashboardProps> = ({ userName = 'Technical Support', onLogout }) => {
  const { logout, user } = useAuth();
  const [tab, setTab] = useState<Tab>('verification');
  const [navNonce, setNavNonce] = useState(0);
  const { counts } = usePipelineCounts();
  const [pendingLocal, setPendingLocal] = useState(() => pendingSupportRecords());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportOutcome | null>(null);

  const go = (t: Tab) => {
    setTab(t);
    setNavNonce(n => n + 1);
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const result = await importSupportRecords();
      setImportResult(result);
      setPendingLocal(pendingSupportRecords());
      notifyPipelineChanged();
    } finally {
      setImporting(false);
    }
  };

  const items: { id: Tab; label: string; icon: React.ElementType; count?: number }[] = [
    { id: 'verification', label: 'Onboarding verification', icon: ShieldCheck },
    { id: 'leads', label: '1. Leads', icon: UserPlus, count: counts?.leads.all },
    { id: 'potential', label: '2. Contacts (payment pending)', icon: Clock, count: counts?.potential.all },
    { id: 'onboarding', label: '3. Customers (paid)', icon: CheckCircle2, count: counts?.onboarding.all }
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans antialiased">
      <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs">
        <div className="flex items-center gap-3">
          <AmuwaLogo size="sm" />
          <div className="h-5 w-px bg-slate-200 hidden sm:block" />
          <div>
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-sm sm:text-base text-slate-900 tracking-tight">Technical Support</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                Technical Consultant
              </span>
            </div>
            <p className="text-[11px] text-slate-500 hidden sm:block">Verify onboarding documents and manage your support pipeline</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/90 text-xs">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-xs shrink-0" aria-hidden="true">
              {userName
                .split(' ')
                .map(n => n[0])
                .join('')
                .slice(0, 2)
                .toUpperCase()}
            </div>
            <div className="text-left hidden md:block">
              <p className="font-semibold text-slate-900 leading-tight">{userName}</p>
              {user?.email && <p className="text-[10px] text-slate-500">{user.email}</p>}
            </div>
          </div>
          <button
            type="button"
            onClick={() => (onLogout ? onLogout() : logout())}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold text-slate-600 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row">
        <aside className="w-full md:w-64 bg-white border-r border-slate-200 p-4 md:p-5 shrink-0">
          <nav className="space-y-1.5 text-xs font-bold" aria-label="Technical Support">
            {items.map(it => {
              const active = tab === it.id;
              const Icon = it.icon;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => go(it.id)}
                  aria-current={active ? 'page' : undefined}
                  className={`w-full flex items-center justify-between gap-2 px-3.5 py-3 rounded-2xl text-left transition-all ${
                    active ? 'bg-slate-900 text-white shadow-md' : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className={`w-4 h-4 ${active ? 'text-indigo-300' : 'text-slate-500'}`} aria-hidden="true" />
                    {it.label}
                  </span>
                  {it.count !== undefined && (
                    <span className={`px-2 py-0.5 rounded-full text-[10px] ${active ? 'bg-slate-700 text-white' : 'bg-slate-200 text-slate-700'}`}>
                      {it.count}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto max-w-7xl w-full mx-auto space-y-5">
          {(pendingLocal > 0 || importResult) && (
            <div role="status" className="p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-xs space-y-2">
              {pendingLocal > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <DatabaseZap className="w-4 h-4" aria-hidden="true" />
                    {pendingLocal} record{pendingLocal === 1 ? ' is' : 's are'} saved only in this browser from the old dashboard. Move them to the database so the team can see them.
                  </span>
                  <button
                    type="button"
                    onClick={runImport}
                    disabled={importing}
                    className="px-3 py-2 rounded-lg bg-amber-600 text-white font-bold hover:bg-amber-700 disabled:opacity-50"
                  >
                    {importing ? 'Moving…' : 'Move to database'}
                  </button>
                </div>
              )}
              {importResult && (
                <div>
                  Moved {importResult.imported} record{importResult.imported === 1 ? '' : 's'} into Leads.
                  {importResult.skipped.length > 0 && (
                    <ul className="mt-1 list-disc pl-5">
                      {importResult.skipped.map((s, i) => (
                        <li key={i}>
                          {s.name}: {s.reason} (kept in this browser)
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'verification' ? (
            <OnboardingVerificationWorkspace key={navNonce} />
          ) : (
            <PipelineWorkspace section={tab} counts={counts} resetKey={navNonce} ownOnly onNavigate={go} />
          )}
        </main>
      </div>
    </div>
  );
};

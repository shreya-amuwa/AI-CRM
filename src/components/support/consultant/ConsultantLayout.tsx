import React, { useEffect, useState } from 'react';
import { HelpCircle, LogOut, Menu, UserPlus, X } from 'lucide-react';

/** Shell of the Technical Consultant dashboard (sidebar + top bar), responsive. */
export const ConsultantLayout: React.FC<{
  userName: string;
  count?: number;
  onNavigateHome: () => void;
  onSignOut: () => void;
  children: React.ReactNode;
}> = ({ userName, count, onNavigateHome, onSignOut, children }) => {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex font-sans antialiased">
      {open && <div className="fixed inset-0 bg-slate-900/40 z-40 lg:hidden" onClick={() => setOpen(false)} aria-hidden="true" />}

      <aside
        className={`fixed lg:sticky top-0 left-0 h-screen w-60 bg-white border-r border-slate-200/80 z-50 flex flex-col justify-between p-4 transition-transform ${
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
        aria-label="Technical Consultant navigation"
      >
        <div className="space-y-6">
          <div className="flex items-center justify-between px-2 pt-1">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-cyan-500 flex items-center justify-center text-white shadow-xs" aria-hidden="true">
                <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                </svg>
              </div>
              <div className="leading-tight">
                <span className="block text-sm font-bold tracking-tight text-slate-900">Amuwa</span>
                <span className="block text-[11px] text-slate-500 font-medium -mt-0.5">Technical Consulting</span>
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="lg:hidden p-1.5 text-slate-400 hover:text-slate-600 rounded-lg" aria-label="Close menu">
              <X className="w-5 h-5" />
            </button>
          </div>
          <nav>
            <button
              type="button"
              onClick={() => {
                onNavigateHome();
                setOpen(false);
              }}
              aria-current="page"
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 text-left"
            >
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              <span className="flex-1 leading-tight">Onboarding Customers</span>
              {count !== undefined && <span className="px-1.5 py-0.5 rounded-md bg-blue-100 text-blue-700 text-[11px] font-bold">{count}</span>}
            </button>
          </nav>
        </div>
        <div className="space-y-2 pt-4 border-t border-slate-100">
          <a
            href="mailto:support@amuwa.com"
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs text-slate-500 hover:bg-slate-50 transition-colors"
          >
            <HelpCircle className="w-4 h-4 text-slate-400" aria-hidden="true" />
            <span>
              <span className="block text-sm font-semibold text-slate-700">Need help?</span>
              <span className="block text-[11px] text-slate-400">Contact support</span>
            </span>
          </a>
          <button type="button" onClick={onSignOut} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-semibold text-rose-600 hover:bg-rose-50">
            <LogOut className="w-4 h-4" aria-hidden="true" />
            Sign out
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white/90 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-8 flex items-center justify-between sticky top-0 z-30">
          <button type="button" onClick={() => setOpen(true)} className="lg:hidden p-2 rounded-xl text-slate-500 hover:bg-slate-100" aria-label="Open menu" aria-expanded={open}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="ml-auto pl-4 border-l border-slate-200 text-left">
            <div className="text-sm font-bold text-slate-900 leading-none">{userName}</div>
            <div className="text-xs text-slate-500 mt-1">Technical Consultant</div>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">{children}</main>
      </div>
    </div>
  );
};

import React, { useEffect } from 'react';
import { BookOpen } from 'lucide-react';
import { DOCUMENTATION_URL } from '../../lib/documentation';

/** /documentation: the user documentation. Public (no sign-in needed), so it opens from any dashboard, in a new tab, and forwards to the GitBook. */
export const DocumentationRedirect: React.FC = () => {
  useEffect(() => {
    window.location.replace(DOCUMENTATION_URL);
  }, []);
  return (
    <main className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-3">
        <div className="mx-auto w-12 h-12 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center">
          <BookOpen className="w-6 h-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-extrabold text-slate-900">Opening the user documentation…</h1>
        <p className="text-sm text-slate-600">
          If nothing happens, <a className="font-bold text-blue-700 underline" href={DOCUMENTATION_URL}>open it here</a>.
        </p>
      </div>
    </main>
  );
};

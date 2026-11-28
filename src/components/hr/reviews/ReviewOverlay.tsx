import React, { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { OPEN_REVIEW_EVENT } from './reviewUi';

const ReviewDetailPanel = lazy(() => import('./ReviewDetailPanel'));

/**
 * Opens one confirmation / internship review over any dashboard: from a notification, a dashboard row, or the link in a reminder e-mail
 * (/?review=<id>). Mounted once in the app shell. The database decides whether the viewer may open it (a stranger gets "not found").
 */
export const ReviewOverlay: React.FC = () => {
  const [id, setId] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const on = (e: Event) => setId((e as CustomEvent<string>).detail || null);
    window.addEventListener(OPEN_REVIEW_EVENT, on);
    const fromLink = new URLSearchParams(window.location.search).get('review');
    if (fromLink && /^[0-9a-f-]{36}$/i.test(fromLink)) {
      setId(fromLink);
      const u = new URL(window.location.href);
      u.searchParams.delete('review');
      window.history.replaceState(window.history.state, '', u.toString());
    }
    return () => window.removeEventListener(OPEN_REVIEW_EVENT, on);
  }, []);
  useEffect(() => {
    if (!id) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id]);
  if (!id) return null;
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/40 flex items-end sm:items-stretch sm:justify-end" role="dialog" aria-modal="true" aria-label="Employee review"
      onClick={e => { if (e.target === e.currentTarget) setId(null); }}>
      <div className="bg-slate-50 w-full sm:max-w-3xl max-h-[92vh] sm:max-h-none sm:h-full overflow-y-auto rounded-t-2xl sm:rounded-none p-4 space-y-3">
        <div className="flex justify-end sticky top-0 z-10">
          <button ref={closeRef} type="button" className="rounded-full bg-white border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100" onClick={() => setId(null)} aria-label="Close the review">
            <X className="w-4 h-4" aria-hidden /></button>
        </div>
        <Suspense fallback={<p className="text-sm text-slate-500">Loading…</p>}>
          <ReviewDetailPanel id={id} onChanged={() => window.dispatchEvent(new Event('crm:hr-review-changed'))} />
        </Suspense>
      </div>
    </div>
  );
};

export default ReviewOverlay;

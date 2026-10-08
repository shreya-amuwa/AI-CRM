import React, { useCallback, useEffect, useState } from 'react';
import { DatabaseZap } from 'lucide-react';
import type { ReviewCounts } from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi } from '../../lib/api/endpoints';
import { importSupportRecords, pendingSupportRecords, type ImportOutcome } from '../../lib/legacySupportImport';
import { usePipelineRealtime } from '../team-member/pipeline/shared';
import { ConsultantLayout } from './consultant/ConsultantLayout';
import { ConsultantCustomerDetail, ConsultantCustomerList } from './consultant/ConsultantViews';

interface TechnicalSupportDashboardProps {
  currentUserId?: string;
  userName?: string;
  onLogout?: () => void;
}

/**
 * Technical Consultant dashboard (support-team members). Every onboarding
 * customer of the department: review and authorize each document, then
 * trigger the onboarding automations. All data comes from the database.
 */
export const TechnicalSupportDashboard: React.FC<TechnicalSupportDashboardProps> = ({ userName = 'Technical Consultant', onLogout }) => {
  const { logout } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);
  const [counts, setCounts] = useState<ReviewCounts | null>(null);
  const [pendingLocal, setPendingLocal] = useState(() => pendingSupportRecords());
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportOutcome | null>(null);

  const loadCounts = useCallback(() => {
    pipelineApi.reviewCounts().then(setCounts, err => console.warn('[consultant] counts failed', errorMessage(err)));
  }, []);
  useEffect(loadCounts, [loadCounts]);
  usePipelineRealtime(loadCounts);

  const runImport = async () => {
    setImporting(true);
    try {
      setImportResult(await importSupportRecords());
      setPendingLocal(pendingSupportRecords());
    } finally {
      setImporting(false);
    }
  };

  return (
    <ConsultantLayout
      userName={userName}
      count={counts?.all}
      onNavigateHome={() => setOpenId(null)}
      onSignOut={() => (onLogout ? onLogout() : logout())}
    >
      {(pendingLocal > 0 || importResult) && (
        <div role="status" className="mb-5 max-w-6xl p-4 rounded-2xl border border-amber-200 bg-amber-50 text-amber-900 text-xs space-y-2">
          {pendingLocal > 0 && (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <DatabaseZap className="w-4 h-4 shrink-0" aria-hidden="true" />
                {pendingLocal} record{pendingLocal === 1 ? ' is' : 's are'} saved only in this browser from the old support dashboard. Move them to the
                database so they are not lost.
              </span>
              <button
                type="button"
                onClick={runImport}
                disabled={importing}
                className="px-3 py-2 rounded-lg bg-amber-600 text-white font-bold hover:bg-amber-700 disabled:opacity-50 shrink-0"
              >
                {importing ? 'Moving…' : 'Move to database'}
              </button>
            </div>
          )}
          {importResult && (
            <div>
              Moved {importResult.imported} record{importResult.imported === 1 ? '' : 's'} into the department's leads.
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
      {openId ? (
        <ConsultantCustomerDetail id={openId} onBack={() => setOpenId(null)} />
      ) : (
        <ConsultantCustomerList counts={counts} onOpen={setOpenId} />
      )}
    </ConsultantLayout>
  );
};

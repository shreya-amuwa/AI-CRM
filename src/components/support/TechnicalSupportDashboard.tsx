import React, { useCallback, useEffect, useState } from 'react';
import type { ReviewCounts } from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi } from '../../lib/api/endpoints';
import { usePipelineRealtime } from '../team-member/pipeline/shared';
import { ConsultantLayout } from './consultant/ConsultantLayout';
import { ConsultantCustomerDetail, ConsultantCustomerList } from './consultant/ConsultantViews';

interface TechnicalSupportDashboardProps {
  currentUserId?: string;
  userName?: string;
  onLogout?: () => void;
}

/**
 * Technical Consultant dashboard (support-team members). Customers the sales
 * team has sent for verification: review and authorize each document, then
 * trigger the onboarding automations. All data comes from the database.
 */
export const TechnicalSupportDashboard: React.FC<TechnicalSupportDashboardProps> = ({ userName = 'Technical Consultant', onLogout }) => {
  const { logout } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);
  const [counts, setCounts] = useState<ReviewCounts | null>(null);
  const loadCounts = useCallback(() => {
    pipelineApi.reviewCounts().then(setCounts, err => console.warn('[consultant] counts failed', errorMessage(err)));
  }, []);
  useEffect(loadCounts, [loadCounts]);
  usePipelineRealtime(loadCounts);

  return (
    <ConsultantLayout
      userName={userName}
      count={counts?.all}
      onNavigateHome={() => setOpenId(null)}
      onSignOut={() => (onLogout ? onLogout() : logout())}
    >
      {openId ? (
        <ConsultantCustomerDetail id={openId} onBack={() => setOpenId(null)} />
      ) : (
        <ConsultantCustomerList counts={counts} onOpen={setOpenId} />
      )}
    </ConsultantLayout>
  );
};

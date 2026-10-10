import React, { useCallback, useEffect, useState } from 'react';
import type { ReviewCounts } from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi } from '../../lib/api/endpoints';
import { usePipelineRealtime } from '../team-member/pipeline/shared';
import { ConsultantLayout, type ConsultantPage } from './consultant/ConsultantLayout';
import { ConsultantIntake } from './consultant/ConsultantIntake';
import { ConsultantCustomerDetail, ConsultantCustomerList } from './consultant/ConsultantViews';
import { ConsultantAddons } from './consultant/ConsultantAddons';
import { NotificationsPage } from '../notifications/NotificationsPage';

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
  const [page, setPage] = useState<ConsultantPage>('customers');
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
      newCount={counts?.newCustomers}
      addonsCount={counts?.addons}
      page={page}
      onSelectPage={p => {
        setPage(p);
        setOpenId(null);
      }}
      onSignOut={() => (onLogout ? onLogout() : logout())}
    >
      {page === 'customers' ? (
        <ConsultantIntake
          onSent={() => {
            loadCounts();
          }}
          onGoToOnboarding={() => setPage('onboarding')}
          onGoToAddons={() => setPage('addons')}
        />
      ) : page === 'addons' ? (
        <ConsultantAddons onCountsChanged={loadCounts} onGoToOnboarding={() => setPage('onboarding')} />
      ) : page === 'notifications' ? (
        <NotificationsPage />
      ) : openId ? (
        <ConsultantCustomerDetail id={openId} onBack={() => setOpenId(null)} />
      ) : (
        <ConsultantCustomerList counts={counts} onOpen={setOpenId} />
      )}
    </ConsultantLayout>
  );
};

import React, { useCallback, useEffect, useState } from 'react';
import type { ReviewCounts } from '../../../shared/contracts';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/api/client';
import { pipelineApi, workflowApi } from '../../lib/api/endpoints';
import { useRealtime } from '../../lib/support';
import { usePipelineRealtime } from '../team-member/pipeline/shared';
import { ChatRoute } from '../chat/ChatRoute';
import { IssuesRoute } from '../issues/IssuesRoute';
import { ReportsRoute } from '../reports/ReportsRoute';
import { useOpenReportsRequest } from '../reports/reportEvents';
import { useOpenIssuesRequest } from '../issues/issueEvents';
import { useOpenChatRequest } from '../chat/chatEvents';
import { ConsultantLayout, type ConsultantPage } from './consultant/ConsultantLayout';
import { ConsultantIntake } from './consultant/ConsultantIntake';
import { ConsultantCustomerDetail, ConsultantCustomerList } from './consultant/ConsultantViews';
import { TcFollowUps } from './consultant/TcFollowUps';
import { ConsultantAddons } from './consultant/ConsultantAddons';
import { NotificationsPage } from '../notifications/NotificationsPage';
import { ClientDocumentsReview } from '../client-portal/ClientDocumentsReview';
import { ClientActivityManager } from '../client-portal/ClientActivityManager';

interface TechnicalSupportDashboardProps {
  currentUserId?: string;
  userName?: string;
  onLogout?: () => void;
  /** `verifier`: the Meta Verifier's first verification; `consultant` (default): the Technical Consultant's work. */
  mode?: 'consultant' | 'verifier';
}

/**
 * Technical Consultant dashboard (support-team members). Customers the sales
 * team has sent for verification: review and authorize each document, then
 * trigger the onboarding automations. All data comes from the database.
 */
export const TechnicalSupportDashboard: React.FC<TechnicalSupportDashboardProps> = ({ userName, onLogout, mode = 'consultant' }) => {
  const verifier = mode === 'verifier';
  const name = userName ?? (verifier ? 'Meta Verifier' : 'Technical Consultant');
  const { logout } = useAuth();
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState<ConsultantPage>('customers');
  const [counts, setCounts] = useState<ReviewCounts | null>(null);
  const loadCounts = useCallback(() => {
    pipelineApi.reviewCounts().then(setCounts, err => console.warn('[consultant] counts failed', errorMessage(err)));
  }, []);
  useEffect(loadCounts, [loadCounts]);
  usePipelineRealtime(loadCounts);
  // follow-ups that are due: the badge follows the database (a follow-up falling due or being recorded), no timer
  const [followUps, setFollowUps] = useState(0);
  const loadFollowUps = useCallback(() => {
    if (verifier) return;
    workflowApi.followUps('OPEN').then(r => setFollowUps(r.filter(f => f.effectiveStatus === 'DUE').length), () => setFollowUps(0));
  }, [verifier]);
  useEffect(loadFollowUps, [loadFollowUps]);
  useRealtime('tc_followups', loadFollowUps);
  useOpenChatRequest(useCallback(() => { setPage('chat'); setOpenId(null); }, []));
  useOpenIssuesRequest(useCallback(() => { setPage('raise-issue'); setOpenId(null); }, []));
  useOpenReportsRequest(useCallback(() => { setPage('work-reports'); setOpenId(null); }, []));

  return (
    <ConsultantLayout
      userName={name}
      mode={mode}
      followUpsCount={followUps || undefined}
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
          mode={mode}
          onSent={() => {
            loadCounts();
          }}
          onGoToOnboarding={() => setPage('onboarding')}
          onGoToAddons={() => setPage('addons')}
        />
      ) : page === 'addons' && !verifier ? (
        <ConsultantAddons onCountsChanged={loadCounts} onGoToOnboarding={() => setPage('onboarding')} />
      ) : page === 'followups' && !verifier ? (
        <TcFollowUps onChanged={loadFollowUps} />
      ) : page === 'client-documents' ? (
        <ClientDocumentsReview />
      ) : page === 'client-calendar' ? (
        <ClientActivityManager />
      ) : page === 'chat' ? (
        <ChatRoute />
      ) : page === 'raise-issue' ? (
        <IssuesRoute />
      ) : page === 'work-reports' ? (
        <ReportsRoute />
      ) : page === 'notifications' ? (
        <NotificationsPage />
      ) : openId ? (
        <ConsultantCustomerDetail id={openId} mode={mode} onBack={() => setOpenId(null)} />
      ) : (
        <ConsultantCustomerList counts={counts} onOpen={setOpenId} mode={mode} />
      )}
    </ConsultantLayout>
  );
};

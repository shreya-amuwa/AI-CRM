import React, { useEffect, useState } from 'react';
import type { PipelineCounts } from '../../../../shared/contracts';
import { AddLeadView, EditLeadView } from './LeadForms';
import { LeadsView } from './LeadsView';
import { OnboardingCustomerView, OnboardingListView } from './OnboardingViews';
import { PotentialView } from './PotentialView';

export type PipelineSection = 'leads' | 'potential' | 'onboarding';

type Page =
  | { kind: 'list' }
  | { kind: 'add-lead' }
  | { kind: 'edit-lead'; id: string }
  | { kind: 'onboarding-customer'; id: string };

/**
 * My Leads → Leads / Potential / Onboarding. One customer record moves
 * through the three sections; every view reads from and writes to the API.
 */
export const PipelineWorkspace: React.FC<{
  section: PipelineSection;
  counts: PipelineCounts | null;
  /** Open the "Add lead" form directly (e.g. from the Home quick action). */
  startWithAdd?: boolean;
  /** Changes whenever the user re-selects a section in the sidebar. */
  resetKey?: number;
  /** Support staff: only their own records, no inbound enquiries strip. */
  ownOnly?: boolean;
  onNavigate: (section: PipelineSection) => void;
}> = ({ section, counts, startWithAdd, resetKey, ownOnly, onNavigate }) => {
  const [page, setPage] = useState<Page>(startWithAdd ? { kind: 'add-lead' } : { kind: 'list' });
  const [pendingOpen, setPendingOpen] = useState<string | null>(null);

  // Switching section resets to its list unless a cross-section open is pending.
  useEffect(() => {
    if (pendingOpen && section === 'onboarding') {
      setPage({ kind: 'onboarding-customer', id: pendingOpen });
      setPendingOpen(null);
    } else if (!(startWithAdd && section === 'leads')) {
      setPage({ kind: 'list' });
    }
    window.scrollTo?.({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, resetKey]);
  useEffect(() => {
    if (startWithAdd) setPage({ kind: 'add-lead' });
  }, [startWithAdd]);

  if (section === 'leads') {
    if (page.kind === 'add-lead')
      return <AddLeadView onCancel={() => setPage({ kind: 'list' })} onSaved={id => setPage({ kind: 'edit-lead', id })} />;
    if (page.kind === 'edit-lead')
      return <EditLeadView id={page.id} onBack={() => setPage({ kind: 'list' })} onMovedToPotential={() => onNavigate('potential')} />;
    return <LeadsView counts={counts} showInbound={!ownOnly} onAdd={() => setPage({ kind: 'add-lead' })} onEdit={id => setPage({ kind: 'edit-lead', id })} />;
  }
  if (section === 'potential') {
    return (
      <PotentialView
        counts={counts}
        ownOnly={ownOnly}
        onStarted={id => {
          setPendingOpen(id);
          onNavigate('onboarding');
        }}
      />
    );
  }
  if (page.kind === 'onboarding-customer') return <OnboardingCustomerView id={page.id} onBack={() => setPage({ kind: 'list' })} />;
  return <OnboardingListView counts={counts} ownOnly={ownOnly} onOpen={id => setPage({ kind: 'onboarding-customer', id })} />;
};

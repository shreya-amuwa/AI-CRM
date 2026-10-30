import React from 'react';
import { CalendarClock, Hourglass } from 'lucide-react';
import type { ClientSubscription, SubscriptionStatus } from '../../shared/contracts';
import { clientApi } from './api';
import { useClientLive, useLoad } from './hooks';
import { Badge, Card, EmptyState, PageHeader, Query, UsageMeter, fmtDate, type UsageBar } from './ui';

const STATUS: Record<SubscriptionStatus, { label: string; tone: 'success' | 'attention' | 'danger' | 'neutral' }> = {
  NOT_STARTED: { label: 'Subscription Not Started', tone: 'attention' },
  ACTIVE: { label: 'Subscription Active', tone: 'success' },
  EXPIRED: { label: 'Subscription Expired', tone: 'danger' },
  PAUSED: { label: 'Subscription Paused', tone: 'neutral' },
  CANCELLED: { label: 'Subscription Cancelled', tone: 'neutral' }
};

const NOT_STARTED_TEXT = 'Your subscription will begin once document verification is completed and your panel has been successfully created and activated.';

const nf = (n: number) => n.toLocaleString('en-IN');

/** Messages as the usage meter draws them (the figures come from the usage data the server holds, never from this page). */
function messageBar(m: NonNullable<ClientSubscription['messages']>): UsageBar {
  const pct = Math.min(100, Math.round(m.percent));
  return { label: 'Messages', unit: 'messages', total: m.total, used: m.used, left: m.remaining, pct, tone: pct >= 90 ? 'danger' : pct >= 75 ? 'attention' : 'success', asOf: m.asOf, validUntil: null };
}

const Subscription: React.FC<{ s: ClientSubscription }> = ({ s }) => {
  const st = STATUS[s.status];
  const active = s.status === 'ACTIVE' || s.status === 'EXPIRED';
  return (
    <Card>
      <div className="cd-between" style={{ alignItems: 'flex-start', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h3 style={{ fontSize: 18 }}>{s.serviceName}</h3>
          <p className="cd-small cd-muted">{s.plan || 'Plan not set yet'}</p>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>

      {s.status === 'NOT_STARTED' ? (
        <div className="cd-banner attention" role="note" style={{ marginTop: 14 }}>
          <Hourglass size={18} aria-hidden style={{ flexShrink: 0 }} />
          <span><b>Subscription Not Started.</b> {NOT_STARTED_TEXT}</span>
        </div>
      ) : s.status === 'ACTIVE' ? (
        <div className="cd-banner success" role="note" style={{ marginTop: 14 }}>
          <CalendarClock size={18} aria-hidden style={{ flexShrink: 0 }} />
          <span><b>Subscription Active.</b> It started on {fmtDate(s.startedOn)} and runs until {fmtDate(s.expiresOn)} ({s.daysLeft ?? 0} day{s.daysLeft === 1 ? '' : 's'} left).</span>
        </div>
      ) : null}

      <dl className="cd-kv" style={{ marginTop: 16 }}>
        <div><dt>Subscription plan</dt><dd>{s.plan || '-'}</dd></div>
        <div><dt>Subscription duration</dt><dd>{s.durationLabel || '-'}</dd></div>
        <div><dt>Subscription status</dt><dd>{st.label.replace('Subscription ', '')}</dd></div>
        <div><dt>Panel creation status</dt><dd>{s.panelCreated ? 'Panel created and active' : 'Pending'}</dd></div>
        <div><dt>Panel creation date</dt><dd>{s.panelCreated ? fmtDate(s.panelCreatedOn) : '-'}</dd></div>
        <div><dt>Subscription start date</dt><dd>{active ? fmtDate(s.startedOn) : 'Not started'}</dd></div>
        <div><dt>Subscription expiry date</dt><dd>{active ? fmtDate(s.expiresOn) : 'Calculated once it starts'}</dd></div>
        <div><dt>Remaining subscription days</dt><dd>{active && s.daysLeft !== null ? `${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'}` : '-'}</dd></div>
        <div><dt>Total message credits</dt><dd>{s.messages ? nf(s.messages.total) : s.messageCredits !== null ? nf(s.messageCredits) : '-'}</dd></div>
        <div><dt>Messages used</dt><dd>{s.messages ? nf(s.messages.used) : '-'}</dd></div>
        <div><dt>Remaining messages</dt><dd>{s.messages ? nf(s.messages.remaining) : '-'}</dd></div>
        <div><dt>Usage percentage</dt><dd>{s.messages ? `${s.messages.percent}%` : '-'}</dd></div>
      </dl>
      {s.messages ? <div style={{ marginTop: 14 }}><UsageMeter bar={messageBar(s.messages)} /></div> : null}
      {s.messages && !s.messages.reported && active ? <p className="cd-small cd-muted" style={{ marginTop: 8 }}>Usage has not been reported yet, so no messages are counted as used.</p> : null}
    </Card>
  );
};

/** The client's subscriptions, read only. The dates are the ones confirmed when the panel was activated; the expiry is calculated by the server. */
export const MySubscription: React.FC = () => {
  const q = useLoad(() => clientApi.subscriptions(), []);
  useClientLive(() => q.reload());
  return (
    <>
      <PageHeader title="My Subscription" subtitle="Your plan, how long it runs and how many messages you have used." />
      <Query
        q={q}
        errorTitle="We could not load your subscription"
        unavailableText="This is a problem on our side, not with your account. Please try again in a moment."
        empty={d => !Array.isArray(d) || d.length === 0 ? (
          <Card><EmptyState icon={<CalendarClock size={24} />} title="No subscription yet" text={NOT_STARTED_TEXT} /></Card>
        ) : null}
      >
        {rows => <div className="cd-stack" style={{ gap: 16 }}>{(rows as ClientSubscription[]).map(s => <Subscription key={s.service} s={s} />)}</div>}
      </Query>
    </>
  );
};
export default MySubscription;

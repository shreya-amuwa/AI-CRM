import React from 'react';
import { displayTicketNo } from '../lib/ticketFormat';
import { Bell, CalendarClock, CreditCard, FileText, LifeBuoy, Package, RefreshCw } from 'lucide-react';
import { clientApi } from './api';
import { useClientAuth } from './auth';
import { useLoad, type Loaded } from './hooks';
import { dashboardPath, notificationTarget, useShell } from './shell';
import { Badge, Button, Card, EmptyState, Skeleton, TICKET_LABEL, daysUntil, fmtDate, fmtDateTime, inr, tagOf } from './ui';

/** One block of the overview: its own loading, error (with the real reason and a retry) and empty state. */
function Section<T>({ title, q, onViewAll, children }: { title: string; q: Loaded<T>; onViewAll?: () => void; children: (d: T) => React.ReactNode }) {
  return (
    <Card>
      <div className="cd-between">
        <h2 className="cd-section-title" style={{ marginBottom: 0 }}>{title}</h2>
        {onViewAll && <button className="cd-link" onClick={onViewAll}>View all</button>}
      </div>
      {q.loading && !q.data ? (
        <div className="cd-stack" style={{ gap: 12, marginTop: 16 }} role="status" aria-label="Loading"><Skeleton h={16} w="60%" /><Skeleton h={16} w="80%" /><Skeleton h={16} w="45%" /></div>
      ) : q.error && !q.data ? (
        <div className="cd-empty" role="alert"><p className="cd-small">{q.error}</p><Button variant="outline" small onClick={q.reload}><RefreshCw size={14} /> Try again</Button></div>
      ) : q.data ? <div style={{ marginTop: 4 }}>{children(q.data)}</div> : null}
    </Card>
  );
}

const Stat: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; hint?: string; onClick: () => void }> = ({ icon, label, value, hint, onClick }) => (
  <Card onClick={onClick}>
    <div className="cd-stat">
      <span className="cd-stat-ic" aria-hidden>{icon}</span>
      <p className="cd-label">{label}</p>
      <p className="cd-big">{value}</p>
      {hint ? <p className="cd-small cd-muted">{hint}</p> : null}
    </div>
  </Card>
);

export const Overview: React.FC = () => {
  const { go } = useShell();
  const { me } = useClientAuth();
  const services = useLoad(() => clientApi.services());
  const plans = useLoad(() => clientApi.plans());
  const invoices = useLoad(() => clientApi.invoices());
  const tickets = useLoad(() => clientApi.tickets());
  const notes = useLoad(() => clientApi.notifications(3, 0));
  if (!me) return null;

  const live = services.data?.filter(s => s.status === 'LIVE').length ?? 0;
  const pending = invoices.data?.filter(i => i.status === 'Pending').length ?? 0;
  const open = tickets.data?.filter(t => t.status !== 'RESOLVED' && t.status !== 'CLOSED').length ?? 0;
  const current = plans.data?.current ?? null;
  const renewals = [
    ...(services.data ?? []).filter(s => s.renewsOn && daysUntil(s.renewsOn) >= 0).map(s => ({ kind: 'Service', name: s.name, renewsOn: s.renewsOn as string })),
    ...(current?.renewsOn && daysUntil(current.renewsOn) >= 0 ? [{ kind: 'Monthly plan', name: current.name, renewsOn: current.renewsOn }] : [])
  ].sort((a, b) => a.renewsOn.localeCompare(b.renewsOn)).slice(0, 2);
  const stat = (q: Loaded<unknown>, v: number | string) => (q.loading && !q.data ? '-' : q.error && !q.data ? '!' : v);

  return (
    <>
      <div className="cd-welcome">
        <p className="cd-label">Welcome back</p>
        <h1 className="cd-page-title">{me.name}</h1>
        <p className="cd-sub" style={{ display: 'flex', flexWrap: 'wrap', columnGap: 18, rowGap: 4 }}>
          {me.businessName && me.businessName !== me.name ? <span>{me.businessName}</span> : null}
          {me.phone ? <span>{me.phone}</span> : null}
          <span>{me.email || me.loginEmail}</span>
          {me.clientSince ? <span>Customer since {fmtDate(me.clientSince)}</span> : null}
        </p>
      </div>

      <div className="cd-stack" style={{ gap: 24 }}>
        <div className="cd-grid c4">
          <Stat icon={<Package size={18} />} label="Active services" value={stat(services, live)}
            hint={services.data && services.data.length > live ? `${services.data.length - live} being set up` : 'Running now'} onClick={() => go(dashboardPath('services'))} />
          <Stat icon={<CreditCard size={18} />} label="Current plan" value={<span style={{ fontSize: 22 }}>{plans.data ? (current ? current.name : 'No plan yet') : stat(plans, '')}</span>}
            hint={current ? `${inr(current.price)} / month` : 'Choose one in Monthly Plans'} onClick={() => go(dashboardPath('plans'))} />
          <Stat icon={<FileText size={18} />} label="Invoices to pay" value={stat(invoices, pending)}
            hint={invoices.data ? `${invoices.data.length} in total` : undefined} onClick={() => go(dashboardPath('invoices'))} />
          <Stat icon={<LifeBuoy size={18} />} label="Open tickets" value={stat(tickets, open)}
            hint={tickets.data ? `${tickets.data.length} in total` : undefined} onClick={() => go(dashboardPath('tickets'))} />
        </div>

        {renewals.length > 0 && (
          <div className="cd-banner info" role="note" style={{ alignItems: 'center' }}>
            <CalendarClock size={18} aria-hidden />
            <span>{renewals.map(r => `${r.name} renews ${fmtDate(r.renewsOn)}`).join(' · ')}</span>
          </div>
        )}

        <div className="cd-grid c2" style={{ alignItems: 'start' }}>
          <Section title="Your services" q={services} onViewAll={() => go(dashboardPath('services'))}>
            {list => list.length === 0 ? (
              <EmptyState icon={<Package size={22} />} title="No services yet" text="Services show up here once your consultant has set them up." />
            ) : (
              <div className="cd-list">
                {list.slice(0, 4).map(s => (
                  <div className="cd-li" key={s.code}>
                    <span className="cd-tag">{tagOf(s.name)}</span>
                    <div className="grow"><p style={{ fontWeight: 600 }} className="cd-ellipsis">{s.name}</p><p className="cd-small cd-muted cd-ellipsis">{s.category}</p></div>
                    <Badge tone={s.status === 'LIVE' ? 'success' : 'attention'}>{s.status === 'LIVE' ? 'Live' : 'Setting up'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Support tickets" q={tickets} onViewAll={() => go(dashboardPath('tickets'))}>
            {list => list.length === 0 ? (
              <EmptyState icon={<LifeBuoy size={22} />} title="No tickets" text="Having a problem? Raise a ticket and our team will help." />
            ) : (
              <div className="cd-list">
                {list.slice(0, 3).map(t => (
                  <div className="cd-li" key={t.id} style={{ cursor: 'pointer' }} onClick={() => go(dashboardPath('tickets', `/${t.id}`))}>
                    <div className="grow"><p style={{ fontWeight: 600 }} className="cd-ellipsis">{t.subject}</p><p className="cd-small cd-muted">{displayTicketNo(t.ticketNo)} · {fmtDate(t.updatedAt)}</p></div>
                    <Badge tone={TICKET_LABEL[t.status].tone}>{TICKET_LABEL[t.status].label}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Recent invoices" q={invoices} onViewAll={() => go(dashboardPath('invoices'))}>
            {list => list.length === 0 ? (
              <EmptyState icon={<FileText size={22} />} title="No invoices yet" text="Invoices from our Accounts team will appear here." />
            ) : (
              <div className="cd-list">
                {list.slice(0, 3).map(inv => (
                  <div className="cd-li" key={inv.id}>
                    <div className="grow"><p style={{ fontWeight: 600 }}>{inv.number}</p><p className="cd-small cd-muted cd-ellipsis">{inv.related} · {fmtDate(inv.issueDate ?? inv.issuedAt)}</p></div>
                    <div style={{ textAlign: 'right' }}><p style={{ fontWeight: 700 }}>{inr(inv.amount)}</p><Badge tone={inv.status === 'Paid' ? 'success' : inv.overdue ? 'danger' : 'attention'}>{inv.status === 'Paid' ? 'Paid' : inv.overdue ? 'Overdue' : 'Pending'}</Badge></div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={`Latest updates${notes.data?.unread ? ` (${notes.data.unread} new)` : ''}`} q={notes} onViewAll={() => go(dashboardPath('notifications'))}>
            {d => d.items.length === 0 ? (
              <EmptyState icon={<Bell size={22} />} title="Nothing new" text="We will let you know here when something changes." />
            ) : (
              <div className="cd-list">
                {d.items.map(n => (
                  <div className="cd-li" key={n.id} style={{ cursor: 'pointer' }} onClick={() => go(notificationTarget(n))}>
                    {!n.readAt && <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--dot)', flexShrink: 0 }} />}
                    <div className="grow"><p style={{ fontWeight: n.readAt ? 500 : 700 }} className="cd-ellipsis">{n.title}</p><p className="cd-small cd-muted">{fmtDateTime(n.createdAt)}</p></div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>
      </div>
    </>
  );
};

import React from 'react';
import { Bell, CalendarClock, CreditCard, FileText, LifeBuoy, Mail, Package, Phone, Receipt, RefreshCw, Sparkles } from 'lucide-react';
import { clientApi } from './api';
import { useClientAuth } from './auth';
import { useLoad, type Loaded } from './hooks';
import { dashboardPath, notificationTarget, useShell } from './shell';
import { Badge, Button, Card, EmptyState, PageHeader, Skeleton, TICKET_LABEL, daysUntil, fmtDate, fmtDateTime, hueOf, inr, tagOf } from './ui';

/** One card of the overview: its own loading, error (with the real reason and a retry) and empty state. */
function Section<T>({ title, q, onViewAll, children }: { title: string; q: Loaded<T>; onViewAll?: () => void; children: (d: T) => React.ReactNode }) {
  return (
    <Card>
      <div className="cd-between">
        <h2 className="cd-section-title" style={{ marginBottom: 0 }}>{title}</h2>
        {onViewAll && <button className="cd-link" onClick={onViewAll}>View all</button>}
      </div>
      {q.loading && !q.data ? (
        <div className="cd-stack" style={{ gap: 10, marginTop: 14 }} role="status" aria-label="Loading"><Skeleton h={16} w="60%" /><Skeleton h={16} w="80%" /><Skeleton h={16} w="45%" /></div>
      ) : q.error && !q.data ? (
        <div className="cd-empty" role="alert"><p className="cd-small">{q.error}</p><Button variant="outline" small onClick={q.reload}><RefreshCw size={14} /> Try again</Button></div>
      ) : q.data ? <div style={{ marginTop: 8 }}>{children(q.data)}</div> : null}
    </Card>
  );
}

export const Overview: React.FC = () => {
  const { go } = useShell();
  const { me } = useClientAuth();
  const services = useLoad(() => clientApi.services());
  const plans = useLoad(() => clientApi.plans());
  const invoices = useLoad(() => clientApi.invoices());
  const tickets = useLoad(() => clientApi.tickets());
  const notes = useLoad(() => clientApi.notifications(4, 0));
  if (!me) return null;

  const live = services.data?.filter(s => s.status === 'LIVE').length ?? 0;
  const pending = invoices.data?.filter(i => i.status === 'Pending').length ?? 0;
  const open = tickets.data?.filter(t => t.status !== 'RESOLVED' && t.status !== 'CLOSED').length ?? 0;
  const current = plans.data?.current ?? null;
  const renewals = [
    ...(services.data ?? []).filter(s => s.renewsOn && daysUntil(s.renewsOn) >= 0).map(s => ({ kind: 'Service', name: s.name, renewsOn: s.renewsOn as string })),
    ...(current?.renewsOn && daysUntil(current.renewsOn) >= 0 ? [{ kind: 'Monthly plan', name: current.name, renewsOn: current.renewsOn }] : [])
  ].sort((a, b) => a.renewsOn.localeCompare(b.renewsOn));
  const stat = (q: Loaded<unknown>, v: number | string) => (q.loading && !q.data ? '-' : q.error && !q.data ? '–' : v);
  const failed = (q: Loaded<unknown>) => !!q.error && !q.data;
  const hello = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader title="Overview" subtitle="A quick look at your services, plan, invoices and support." />
      <div className="cd-stack" style={{ gap: 18 }}>
        <section className="cd-hero2">
          <p className="eyebrow">{hello}</p>
          <h2>{me.name}</h2>
          <p style={{ marginTop: 6, color: 'var(--on-primary-subtle)' }}>
            {me.businessName && me.businessName !== me.name ? `${me.businessName} · ` : ''}Customer since {fmtDate(me.clientSince)}
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 16 }}>
            <span className="cd-chip2"><Phone size={14} />{me.phone || 'No phone on file'}</span>
            <span className="cd-chip2"><Mail size={14} />{me.email || me.loginEmail}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 20 }}>
            <button className="cd-hero-btn" onClick={() => go(dashboardPath('services'))}><Package size={16} /> My services</button>
            <button className="cd-hero-btn ghost" onClick={() => go(dashboardPath('explore'))}><Sparkles size={16} /> Explore more</button>
            <button className="cd-hero-btn ghost" onClick={() => go(dashboardPath('tickets'))}><LifeBuoy size={16} /> Get help</button>
          </div>
        </section>

        <div className="cd-grid c4">
          <Card small className="cd-stat cd-hue-1" onClick={() => go(dashboardPath('services'))}>
            <span className="ico"><Package size={22} /></span>
            <div>
              <p className="cd-label">Active services</p>
              <p className="cd-big">{stat(services, live)}</p>
              {failed(services) ? <span className="cd-stat-err">Could not load</span>
                : <p className="cd-small cd-muted">{services.data && services.data.length > live ? `${services.data.length - live} being set up` : services.data?.length === 0 ? 'None added yet' : 'Running now'}</p>}
            </div>
          </Card>
          <Card small className="cd-stat cd-hue-2" onClick={() => go(dashboardPath('plans'))}>
            <span className="ico"><CreditCard size={22} /></span>
            <div style={{ minWidth: 0 }}>
              <p className="cd-label">Current plan</p>
              <p className="cd-big" style={{ fontSize: 22, lineHeight: 1.3 }}>{plans.data ? (current ? current.name : 'No plan yet') : stat(plans, '')}</p>
              {failed(plans) ? <span className="cd-stat-err">Could not load</span>
                : <p className="cd-small cd-muted">{current ? `${inr(current.price)} / month` : 'Pick one in Monthly Plans'}</p>}
            </div>
          </Card>
          <Card small className="cd-stat cd-hue-3" onClick={() => go(dashboardPath('invoices'))}>
            <span className="ico"><Receipt size={22} /></span>
            <div>
              <p className="cd-label">Invoices to pay</p>
              <p className="cd-big">{stat(invoices, pending)}</p>
              {failed(invoices) ? <span className="cd-stat-err">Could not load</span> : <p className="cd-small cd-muted">{invoices.data ? `${invoices.data.length} in total` : ''}</p>}
            </div>
          </Card>
          <Card small className="cd-stat cd-hue-4" onClick={() => go(dashboardPath('tickets'))}>
            <span className="ico"><LifeBuoy size={22} /></span>
            <div>
              <p className="cd-label">Open tickets</p>
              <p className="cd-big">{stat(tickets, open)}</p>
              {failed(tickets) ? <span className="cd-stat-err">Could not load</span> : <p className="cd-small cd-muted">{tickets.data ? `${tickets.data.length} in total` : ''}</p>}
            </div>
          </Card>
        </div>

        {renewals.length > 0 && (
          <Card>
            <h2 className="cd-section-title">Upcoming renewals</h2>
            <div className="cd-list">
              {renewals.map((r, i) => {
                const left = daysUntil(r.renewsOn);
                return (
                  <div className="cd-li" key={`${r.name}-${i}`}>
                    <span className="cd-tag" style={{ background: 'var(--attention-bg)', color: 'var(--attention-text)' }}><CalendarClock size={20} /></span>
                    <div className="grow"><p style={{ fontWeight: 600 }}>{r.name}</p><p className="cd-small cd-muted">{r.kind} · renews {fmtDate(r.renewsOn)}</p></div>
                    <Badge tone={left <= 7 ? 'attention' : 'neutral'}>{left === 0 ? 'Today' : `${left} day${left === 1 ? '' : 's'} left`}</Badge>
                  </div>
                );
              })}
            </div>
          </Card>
        )}

        <div className="cd-grid c2">
          <Section title="Your services" q={services} onViewAll={() => go(dashboardPath('services'))}>
            {list => list.length === 0 ? (
              <EmptyState icon={<Package size={22} />} title="No services yet" text="Services show up here once your consultant has set them up." />
            ) : (
              <div className="cd-list">
                {list.slice(0, 6).map(s => (
                  <div className={`cd-li cd-hue-${hueOf(s.category)}`} key={s.code}>
                    <span className="cd-li-ico">{tagOf(s.name)}</span>
                    <div className="grow"><p style={{ fontWeight: 600 }} className="cd-ellipsis">{s.name}</p><p className="cd-small cd-muted">{s.category}</p></div>
                    <Badge tone={s.status === 'LIVE' ? 'success' : 'attention'}>{s.status === 'LIVE' ? 'Live' : 'Setting up'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Recent invoices" q={invoices} onViewAll={() => go(dashboardPath('invoices'))}>
            {list => list.length === 0 ? (
              <EmptyState icon={<FileText size={22} />} title="No invoices yet" text="Invoices issued by our Accounts team will appear here." />
            ) : (
              <div className="cd-list">
                {list.slice(0, 4).map(inv => (
                  <div className="cd-li" key={inv.id}>
                    <div className="grow"><p style={{ fontWeight: 600 }}>{inv.number}</p><p className="cd-small cd-muted cd-ellipsis">{inv.related} · {fmtDate(inv.issueDate ?? inv.issuedAt)}</p></div>
                    <div style={{ textAlign: 'right' }}><p style={{ fontWeight: 700 }}>{inr(inv.amount)}</p><Badge tone={inv.status === 'Paid' ? 'success' : inv.overdue ? 'danger' : 'attention'}>{inv.status === 'Paid' ? 'Paid' : inv.overdue ? 'Overdue' : 'Pending'}</Badge></div>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Tickets" q={tickets} onViewAll={() => go(dashboardPath('tickets'))}>
            {list => list.length === 0 ? (
              <EmptyState icon={<LifeBuoy size={22} />} title="No tickets" text="Having a problem? Raise a ticket and our team will help." />
            ) : (
              <div className="cd-list">
                {list.slice(0, 3).map(t => (
                  <div className="cd-li" key={t.id} style={{ cursor: 'pointer' }} onClick={() => go(dashboardPath('tickets', `/${t.id}`))}>
                    <div className="grow"><p style={{ fontWeight: 600 }} className="cd-ellipsis">{t.subject}</p><p className="cd-small cd-muted">{t.ticketNo} · {fmtDate(t.updatedAt)}</p></div>
                    <Badge tone={TICKET_LABEL[t.status].tone}>{TICKET_LABEL[t.status].label}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title={`Notifications${notes.data?.unread ? ` (${notes.data.unread} new)` : ''}`} q={notes} onViewAll={() => go(dashboardPath('notifications'))}>
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


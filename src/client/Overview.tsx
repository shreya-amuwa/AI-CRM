import React from 'react';
import { Bell, CalendarClock, FileText, LifeBuoy, Package, Sparkles } from 'lucide-react';
import { clientApi } from './api';
import { useLoad } from './hooks';
import { dashboardPath, notificationTarget, useShell } from './shell';
import { Badge, Card, EmptyState, PageHeader, Query, TICKET_LABEL, daysUntil, fmtDate, fmtDateTime, inr, tagOf } from './ui';

export const Overview: React.FC = () => {
  const { go } = useShell();
  const q = useLoad(() => clientApi.overview());
  return (
    <>
      <PageHeader title="Overview" subtitle="A quick look at your services, plan, invoices and support." />
      <Query q={q} rows={4}>
        {d => (
          <div className="cd-stack" style={{ gap: 18 }}>
            <Card>
              <div className="cd-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div>
                  <p className="cd-label">Your business</p>
                  <h2 style={{ fontSize: 22 }}>{d.profile.businessName}</h2>
                  <p className="cd-small cd-muted">{d.profile.name}{d.profile.email ? ` · ${d.profile.email}` : ''}{d.profile.phone ? ` · ${d.profile.phone}` : ''}</p>
                </div>
                <div className="cd-stack" style={{ gap: 2, textAlign: 'right' }}>
                  <p className="cd-label">Customer since</p>
                  <p style={{ fontWeight: 700 }}>{fmtDate(d.profile.clientSince)}</p>
                </div>
              </div>
            </Card>

            <div className="cd-grid c4">
              <Card small onClick={() => go(dashboardPath('services'))}>
                <p className="cd-label">Active services</p>
                <p className="cd-big">{d.services.live}</p>
                <p className="cd-small cd-muted">{d.services.total > d.services.live ? `${d.services.total - d.services.live} being set up` : 'All running'}</p>
              </Card>
              <Card small onClick={() => go(dashboardPath('plans'))}>
                <p className="cd-label">Current plan</p>
                <p className="cd-big" style={{ fontSize: 22, lineHeight: 1.3 }}>{d.plan ? d.plan.name : 'No plan yet'}</p>
                <p className="cd-small cd-muted">{d.plan ? `${inr(d.plan.price)} / month` : 'Pick one in Monthly Plans'}</p>
              </Card>
              <Card small onClick={() => go(dashboardPath('invoices'))}>
                <p className="cd-label">Invoices to pay</p>
                <p className="cd-big">{d.invoices.pending}</p>
                <p className="cd-small cd-muted">{d.invoices.total} in total</p>
              </Card>
              <Card small onClick={() => go(dashboardPath('tickets'))}>
                <p className="cd-label">Open tickets</p>
                <p className="cd-big">{d.tickets.open}</p>
                <p className="cd-small cd-muted">{d.tickets.total} in total</p>
              </Card>
            </div>

            {d.renewals.length > 0 && (
              <Card>
                <h2 className="cd-section-title">Upcoming renewals</h2>
                <div className="cd-list">
                  {d.renewals.map((r, i) => {
                    const left = daysUntil(r.renewsOn);
                    return (
                      <div className="cd-li" key={`${r.name}-${i}`}>
                        <span className="cd-tag" style={{ background: 'var(--attention-bg)', color: 'var(--attention-text)' }}><CalendarClock size={20} /></span>
                        <div className="grow"><p style={{ fontWeight: 600 }}>{r.name}</p><p className="cd-small cd-muted">{r.kind === 'PLAN' ? 'Monthly plan' : 'Service'} · renews {fmtDate(r.renewsOn)}</p></div>
                        <Badge tone={left <= 7 ? 'attention' : 'neutral'}>{left < 0 ? 'Overdue' : left === 0 ? 'Today' : `${left} day${left === 1 ? '' : 's'} left`}</Badge>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            <div className="cd-grid c2">
              <Card>
                <div className="cd-between"><h2 className="cd-section-title" style={{ marginBottom: 0 }}>Your services</h2><button className="cd-link" onClick={() => go(dashboardPath('services'))}>View all</button></div>
                {d.services.items.length === 0 ? (
                  <EmptyState icon={<Package size={22} />} title="No services yet" text="Services show up here once your consultant has set them up." />
                ) : (
                  <div className="cd-list" style={{ marginTop: 8 }}>
                    {d.services.items.slice(0, 5).map(s => (
                      <div className="cd-li" key={s.code}>
                        <span className="cd-tag">{tagOf(s.name)}</span>
                        <div className="grow"><p style={{ fontWeight: 600 }} className="cd-ellipsis">{s.name}</p><p className="cd-small cd-muted">{s.category}</p></div>
                        <Badge tone={s.status === 'LIVE' ? 'success' : 'attention'}>{s.status === 'LIVE' ? 'Live' : 'Setting up'}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <div className="cd-between"><h2 className="cd-section-title" style={{ marginBottom: 0 }}>Recent invoices</h2><button className="cd-link" onClick={() => go(dashboardPath('invoices'))}>View all</button></div>
                {d.invoices.recent.length === 0 ? (
                  <EmptyState icon={<FileText size={22} />} title="No invoices yet" text="Invoices issued by our Accounts team will appear here." />
                ) : (
                  <div className="cd-list" style={{ marginTop: 8 }}>
                    {d.invoices.recent.map(inv => (
                      <div className="cd-li" key={inv.id}>
                        <div className="grow"><p style={{ fontWeight: 600 }}>{inv.number}</p><p className="cd-small cd-muted cd-ellipsis">{inv.related} · {fmtDate(inv.issueDate ?? inv.issuedAt)}</p></div>
                        <div style={{ textAlign: 'right' }}><p style={{ fontWeight: 700 }}>{inr(inv.amount)}</p><Badge tone={inv.status === 'Paid' ? 'success' : inv.overdue ? 'danger' : 'attention'}>{inv.status === 'Paid' ? 'Paid' : inv.overdue ? 'Overdue' : 'Pending'}</Badge></div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <div className="cd-between"><h2 className="cd-section-title" style={{ marginBottom: 0 }}>Tickets</h2><button className="cd-link" onClick={() => go(dashboardPath('tickets'))}>View all</button></div>
                {d.tickets.recent.length === 0 ? (
                  <EmptyState icon={<LifeBuoy size={22} />} title="No tickets" text="Having a problem? Raise a ticket and our team will help." />
                ) : (
                  <div className="cd-list" style={{ marginTop: 8 }}>
                    {d.tickets.recent.map(t => (
                      <div className="cd-li" key={t.id} style={{ cursor: 'pointer' }} onClick={() => go(dashboardPath('tickets', `/${t.id}`))}>
                        <div className="grow"><p style={{ fontWeight: 600 }} className="cd-ellipsis">{t.subject}</p><p className="cd-small cd-muted">{t.ticketNo} · {fmtDate(t.updatedAt)}</p></div>
                        <Badge tone={TICKET_LABEL[t.status].tone}>{TICKET_LABEL[t.status].label}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              <Card>
                <div className="cd-between"><h2 className="cd-section-title" style={{ marginBottom: 0 }}>Notifications{d.notifications.unread ? ` (${d.notifications.unread} new)` : ''}</h2><button className="cd-link" onClick={() => go(dashboardPath('notifications'))}>View all</button></div>
                {d.notifications.recent.length === 0 ? (
                  <EmptyState icon={<Bell size={22} />} title="Nothing new" text="We will let you know here when something changes." />
                ) : (
                  <div className="cd-list" style={{ marginTop: 8 }}>
                    {d.notifications.recent.map(n => (
                      <div className="cd-li" key={n.id} style={{ cursor: 'pointer' }} onClick={() => go(notificationTarget(n))}>
                        {!n.readAt && <span aria-label="Unread" style={{ width: 8, height: 8, borderRadius: 99, background: 'var(--dot)', flexShrink: 0 }} />}
                        <div className="grow"><p style={{ fontWeight: n.readAt ? 500 : 700 }} className="cd-ellipsis">{n.title}</p><p className="cd-small cd-muted">{fmtDateTime(n.createdAt)}</p></div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>

            {!d.plan && (
              <div className="cd-hero cd-between" style={{ flexWrap: 'wrap' }}>
                <div><p className="muted cd-small">Monthly plans</p><h2 style={{ fontSize: 20 }}><Sparkles size={18} style={{ verticalAlign: -3 }} /> You have no monthly plan yet</h2></div>
                <button className="cd-btn ghost" onClick={() => go(dashboardPath('plans'))}>See plans</button>
              </div>
            )}
          </div>
        )}
      </Query>
    </>
  );
};

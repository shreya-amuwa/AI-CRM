import React from 'react';
import { displayTicketNo } from '../lib/ticketFormat';
import { AlertTriangle, Bell, Building2, CalendarClock, CreditCard, FileText, FolderUp, LifeBuoy, MessageCircle, Package, Phone, RefreshCw, Sparkles } from 'lucide-react';
import { clientApi } from './api';
import { useClientAuth } from './auth';
import { useLoad, type Loaded } from './hooks';
import { dashboardPath, notificationTarget, sectionState, useShell } from './shell';
import { JourneySummary } from './Journey';
import { Badge, Button, Card, EmptyState, Skeleton, TICKET_LABEL, daysUntil, fmtDate, fmtDateTime, fmtNum, inr, hueOf, serviceStatus, tagOf, usageBar } from './ui';

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

const Stat: React.FC<{ icon: React.ReactNode; hue: number; label: string; value: React.ReactNode; hint?: string; onClick: () => void }> = ({ icon, hue, label, value, hint, onClick }) => (
  <Card onClick={onClick}>
    <div className="cd-stat">
      <span className="cd-stat-ic" data-hue={hue} aria-hidden>{icon}</span>
      <p className="cd-label">{label}</p>
      <p className="cd-big">{value}</p>
      {hint ? <p className="cd-small cd-muted">{hint}</p> : null}
    </div>
  </Card>
);

function greetingWord(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export const Overview: React.FC = () => {
  const { go, journey } = useShell();
  const { me } = useClientAuth();
  // a section the server has not opened yet is not asked for (the server would refuse it); its card says when it opens
  const svcGate = sectionState(journey.data, 'services', journey.loading);
  const planGate = sectionState(journey.data, 'plans', journey.loading);
  const tkGate = sectionState(journey.data, 'tickets', journey.loading);
  const services = useLoad(() => (svcGate.enabled ? clientApi.services() : Promise.resolve([] as Awaited<ReturnType<typeof clientApi.services>>)), [svcGate.enabled]);
  const plans = useLoad(() => (planGate.enabled ? clientApi.plans() : Promise.resolve({ current: null, available: [] } as unknown as Awaited<ReturnType<typeof clientApi.plans>>)), [planGate.enabled]);
  const invoices = useLoad(() => clientApi.invoices());
  const tickets = useLoad(() => (tkGate.enabled ? clientApi.tickets() : Promise.resolve([] as Awaited<ReturnType<typeof clientApi.tickets>>)), [tkGate.enabled]);
  const notes = useLoad(() => clientApi.notifications(3, 0));
  const docs = useLoad(() => clientApi.documents());
  if (!me) return null;

  const docSummary = docs.data?.summary;
  const docPct = docSummary && docSummary.total > 0 ? Math.round((docSummary.provided / docSummary.total) * 100) : null;

  const live = services.data?.filter(s => s.status === 'LIVE').length ?? 0;
  const pending = invoices.data?.filter(i => i.status === 'Pending').length ?? 0;
  const open = tickets.data?.filter(t => t.status !== 'RESOLVED' && t.status !== 'CLOSED').length ?? 0;
  const current = plans.data?.current ?? null;
  const renewals = [
    ...(services.data ?? []).filter(s => s.renewsOn && daysUntil(s.renewsOn) >= 0).map(s => ({ kind: 'Service', name: s.name, renewsOn: s.renewsOn as string })),
    ...(current?.renewsOn && daysUntil(current.renewsOn) >= 0 ? [{ kind: 'Monthly plan', name: current.name, renewsOn: current.renewsOn }] : [])
  ].sort((a, b) => a.renewsOn.localeCompare(b.renewsOn)).slice(0, 2);
  // low balance: a package three-quarters used or more
  const low = (services.data ?? [])
    .map(s => ({ s, bar: usageBar(s) }))
    .filter((x): x is { s: (typeof x)['s']; bar: NonNullable<(typeof x)['bar']> } => !!x.bar && x.bar.tone !== 'success')
    .sort((a, b) => b.bar.pct - a.bar.pct);
  const stat = (q: Loaded<unknown>, v: number | string) => (q.loading && !q.data ? '-' : q.error && !q.data ? '!' : v);

  return (
    <>
      <section className="cd-hero" style={{ marginBottom: 24 }}>
        <div className="cd-hero-grid">
          <div>
            <span className="eyebrow">{greetingWord()}</span>
            <h1 className="cd-page-title">{me.name}</h1>
            <div className="cd-hero-pills">
              {me.businessName && me.businessName !== me.name ? <span className="cd-hero-pill"><Building2 size={14} aria-hidden /> {me.businessName}</span> : null}
              {me.phone ? <span className="cd-hero-pill"><Phone size={14} aria-hidden /> {me.phone}</span> : null}
              <span className="cd-hero-pill">{me.email || me.loginEmail}</span>
              {me.clientSince ? <span className="cd-hero-pill">Customer since {fmtDate(me.clientSince)}</span> : null}
            </div>
            <div className="cd-hero-actions">
              {tkGate.enabled
                ? <Button className="gold" onClick={() => go(dashboardPath('tickets'))}><LifeBuoy size={16} aria-hidden /> Raise a ticket</Button>
                : <Button className="gold" onClick={() => go(dashboardPath('chat'))}><MessageCircle size={16} aria-hidden /> Message our team</Button>}
              {sectionState(journey.data, 'explore', journey.loading).enabled ? <Button variant="outline" onClick={() => go(dashboardPath('explore'))}><Sparkles size={16} aria-hidden /> Explore services</Button> : null}
            </div>
          </div>
          {docSummary && docPct !== null ? (
            <button className="cd-docs-card" onClick={() => go(dashboardPath('documents'))} aria-label={`Documents: ${docSummary.provided} of ${docSummary.total} provided. Open documents`}>
              <span className="cd-ring" style={{ ['--pct' as string]: docPct }}>{docPct}%</span>
              <span>
                <b><FolderUp size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> Your documents</b>
                <small>{docSummary.provided} of {docSummary.total} provided{docSummary.needed > 0 ? ` · ${docSummary.needed} still needed` : ' · all done'}</small>
              </span>
            </button>
          ) : null}
        </div>
      </section>

      <div className="cd-stack" style={{ gap: 24 }}>
        {journey.data && !journey.data.completed ? <JourneySummary j={journey.data} go={go} /> : null}
        <div className="cd-grid c4">
          <Stat icon={<Package size={20} />} hue={1} label="Active services" value={svcGate.enabled ? stat(services, live) : '-'}
            hint={!svcGate.enabled ? svcGate.reason ?? undefined : services.data && services.data.some(s => s.status === 'SETTING_UP') ? `${services.data.filter(s => s.status === 'SETTING_UP').length} being set up` : 'Running now'} onClick={() => go(dashboardPath(svcGate.enabled ? 'services' : 'journey'))} />
          <Stat icon={<CreditCard size={20} />} hue={4} label="Current plan" value={<span style={{ fontSize: 22 }}>{!planGate.enabled ? '-' : plans.data ? (current ? current.name : 'No plan yet') : stat(plans, '')}</span>}
            hint={!planGate.enabled ? planGate.reason ?? undefined : current ? `${inr(current.price)} / month` : 'Choose one in Monthly Plans'} onClick={() => go(dashboardPath(planGate.enabled ? 'plans' : 'journey'))} />
          <Stat icon={<FileText size={20} />} hue={3} label="Invoices to pay" value={stat(invoices, pending)}
            hint={invoices.data ? `${invoices.data.length} in total` : undefined} onClick={() => go(dashboardPath('invoices'))} />
          <Stat icon={<LifeBuoy size={20} />} hue={2} label="Open tickets" value={tkGate.enabled ? stat(tickets, open) : '-'}
            hint={!tkGate.enabled ? tkGate.reason ?? undefined : tickets.data ? `${tickets.data.length} in total` : undefined} onClick={() => go(dashboardPath(tkGate.enabled ? 'tickets' : 'journey'))} />
        </div>

        {low.map(({ s, bar }) => (
          <div key={s.code} className={`cd-banner ${bar.tone === 'danger' ? 'danger' : 'attention'}`} role="alert" style={{ alignItems: 'center' }}>
            <AlertTriangle size={18} aria-hidden style={{ flexShrink: 0 }} />
            <span className="grow">
              <b>{s.name}:</b> {bar.left <= 0 ? `no ${bar.unit === '₹' ? 'credit' : bar.unit} left` : `only ${fmtNum(bar.left, bar.unit)} left`} ({bar.pct}% used). Top up so your campaigns and calls do not stop.
            </span>
            <Button small variant="outline" onClick={() => go(dashboardPath('tickets'))}>Ask to top up</Button>
          </div>
        ))}

        {renewals.length > 0 && (
          <div className="cd-banner info" role="note" style={{ alignItems: 'center' }}>
            <CalendarClock size={18} aria-hidden />
            <span>{renewals.map(r => `${r.name} renews ${fmtDate(r.renewsOn)}`).join(' · ')}</span>
          </div>
        )}

        <div className="cd-grid c2" style={{ alignItems: 'start' }}>
          <Section title="Your services" q={services} onViewAll={svcGate.enabled ? () => go(dashboardPath('services')) : undefined}>
            {list => !svcGate.enabled ? (
              <EmptyState icon={<Package size={22} />} title="Not open yet" text={`${svcGate.reason ?? ''} Follow each service's setup in your onboarding journey.`} />
            ) : list.length === 0 ? (
              <EmptyState icon={<Package size={22} />} title="No services yet" text="Services show up here once your consultant has set them up." />
            ) : (
              <div className="cd-list">
                {list.slice(0, 4).map(s => (
                  <div className="cd-li" key={s.code}>
                    <span className="cd-tag" data-hue={hueOf(s.category)}>{tagOf(s.name)}</span>
                    <div className="grow"><p style={{ fontWeight: 600 }} className="cd-ellipsis">{s.name}</p><p className="cd-small cd-muted cd-ellipsis">{s.category}</p></div>
                    <Badge tone={serviceStatus(s.status).tone}>{serviceStatus(s.status).label}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Support tickets" q={tickets} onViewAll={tkGate.enabled ? () => go(dashboardPath('tickets')) : undefined}>
            {list => !tkGate.enabled ? (
              <EmptyState icon={<LifeBuoy size={22} />} title="Not open yet" text={`${tkGate.reason ?? ''} Until then, message your contact in the chat.`} />
            ) : list.length === 0 ? (
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

import React, { useState } from 'react';
import { LifeBuoy, Megaphone, Package } from 'lucide-react';
import type { ClientService } from '../../shared/contracts';
import { clientApi } from './api';
import { useLoad } from './hooks';
import { dashboardPath, useShell } from './shell';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Query, UsageMeter, fmtDate, inr, serviceDetails, serviceStatus, tagOf, usageBar } from './ui';

const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
const n = (v: unknown) => (typeof v === 'number' ? v : null);

export const MyServices: React.FC = () => {
  const { go } = useShell();
  const q = useLoad(() => clientApi.services());
  const [open, setOpen] = useState<ClientService | null>(null);
  return (
    <>
      <PageHeader title="My Services" subtitle="The services Amuwa runs for you, your plan and how much of it you have used." />
      <Query
        q={q}
        errorTitle="We could not load your services"
        unavailableText="This is a problem on our side, not with your account or your services. Please try again in a moment. If it keeps happening, raise a ticket and our team will look into it."
        empty={d => !Array.isArray(d) || d.length === 0 ? (
          <Card><EmptyState icon={<Package size={24} />} title="No services yet" text="Once your consultant sets up your services, they will appear here. You can also look at what else Amuwa offers."
            action={<Button small onClick={() => go(dashboardPath('explore'))}>Explore services</Button>} /></Card>
        ) : null}
      >
        {services => (
          <div className="cd-grid auto">
            {services.map(s => {
              const st = serviceStatus(s.status);
              const bar = usageBar(s);
              return (
                <Card key={s.code}>
                  <div className="cd-row" style={{ alignItems: 'flex-start' }}>
                    <span className="cd-tag">{tagOf(s.name)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <h3 style={{ fontSize: 17 }}>{s.name}</h3>
                      <p className="cd-small cd-muted">{s.planName || s.category}</p>
                    </div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                  {bar ? <div style={{ marginTop: 14 }}><UsageMeter bar={bar} compact /></div>
                    : s.description ? <p className="cd-small cd-muted" style={{ marginTop: 14, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.description}</p> : null}
                  <p className="cd-small cd-muted" style={{ marginTop: 14 }}>
                    Since {fmtDate(s.purchasedAt)}{s.renewsOn ? ` · renews ${fmtDate(s.renewsOn)}` : ''}
                  </p>
                  <div className="cd-row" style={{ marginTop: 16 }}>
                    <Button variant="outline" small onClick={() => setOpen(s)}>View details</Button>
                    {s.campaignCount ? <Button variant="outline" small onClick={() => go(dashboardPath('campaigns'))}><Megaphone size={14} /> {s.campaignCount} campaign{s.campaignCount === 1 ? '' : 's'}</Button> : null}
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </Query>
      {open && <ServiceDetails s={open} onClose={() => setOpen(null)} onHelp={() => { setOpen(null); go(dashboardPath('tickets')); }} />}
    </>
  );
};

const ServiceDetails: React.FC<{ s: ClientService; onClose: () => void; onHelp: () => void }> = ({ s, onClose, onHelp }) => {
  const st = serviceStatus(s.status);
  const bar = usageBar(s);
  const m = s.usage?.metrics ?? {};
  const extra: [string, string | number | null][] = s.usage?.kind === 'WHATSAPP'
    ? [['WhatsApp number', m.apiNumber as string], ['Display name', m.displayName as string], ['Blue tick', m.blueTick as string], ['Quality rating', m.qualityRating as string],
       ['Messaging limit', m.messagingLimit as string], ['Delivered', n(m.delivered)], ['Read', n(m.read)], ['Replies', n(m.replied)], ['Failed', n(m.failed)], ['Campaigns sent', n(m.campaigns)]]
    : s.usage?.kind === 'AI_CALLING'
      ? [['Calling plan', m.plan as string], ['Calling number(s)', m.numbers as string], ['AI agent', m.agent as string], ['Total calls', n(m.totalCalls)],
         ['Connected calls', n(m.connectedCalls)], ['Not answered', n(m.notAnswered)], ['Interested / leads', n(m.interested)], ['AI campaigns', n(m.campaigns)], ['Contacts uploaded', n(m.contacts)]]
      : s.usage
        ? [['Sender ID / brand', m.senderId as string], ['Delivered', n(m.delivered)], [s.usage.kind === 'VOICE' ? 'Answered' : 'Read', n(m.read)], [s.usage.kind === 'VOICE' ? 'Replies (key press)' : 'Clicks', n(m.clicks)], ['Failed', n(m.failed)], ['Campaigns', n(m.campaigns)]]
        : [];
  return (
    <Modal title={s.name} onClose={onClose}>
      <div className="cd-stack" style={{ gap: 18 }}>
        <p className="cd-muted">{s.description || s.category}</p>
        {bar ? <UsageMeter bar={bar} /> : null}
        <dl className="cd-kv">
          <div><dt>Status</dt><dd>{s.status === 'LIVE' ? 'Live - running now' : s.status === 'SETTING_UP' ? 'Setting up - we will tell you when it goes live' : st.label}</dd></div>
          {s.planName ? <div><dt>Plan / package</dt><dd>{s.planName}</dd></div> : null}
          {s.price !== null && s.price !== undefined ? <div><dt>Price paid</dt><dd>{inr(s.price)}{s.billingCycle ? ` · ${s.billingCycle}` : ''}</dd></div> : null}
          <div><dt>Started</dt><dd>{fmtDate(s.purchasedAt)}</dd></div>
          <div><dt>Went live</dt><dd>{s.activatedAt ? fmtDate(s.activatedAt) : 'Not yet'}</dd></div>
          <div><dt>Valid until / renews</dt><dd>{s.renewsOn ? fmtDate(s.renewsOn) : 'Not set'}</dd></div>
          {s.platform ? <div><dt>Panel / platform</dt><dd>{s.platform}</dd></div> : null}
          {s.panelAccount ? <div><dt>Panel account</dt><dd>{s.panelAccount}</dd></div> : null}
          {s.plan ? <div><dt>Monthly plan</dt><dd>{s.plan}</dd></div> : null}
          {extra.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{typeof v === 'number' ? v.toLocaleString('en-IN') : v}</dd></div>
          ))}
          {!s.usage && serviceDetails(s.code, s.details).rows.map(r => <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}
        </dl>
        {s.monthly && s.monthly.length > 0 && (
          <div>
            <h3 className="cd-label" style={{ marginBottom: 8 }}>Work done each month</h3>
            <div className="cd-list">
              {s.monthly.map(mo => {
                const x = mo.metrics;
                const inc = n(x.included), del = n(x.delivered);
                return (
                  <div className="cd-li" key={mo.month} style={{ alignItems: 'flex-start' }}>
                    <div className="grow">
                      <p style={{ fontWeight: 600 }}>{monthLabel(mo.month)}</p>
                      <p className="cd-small cd-muted">
                        {[x.result1Name && `${x.result1Name}: ${x.result1Value ?? '-'}`, x.result2Name && `${x.result2Name}: ${x.result2Value ?? '-'}`].filter(Boolean).join(' · ') || (x.notes as string) || ''}
                      </p>
                      {typeof x.link === 'string' ? <a className="cd-link" href={x.link} target="_blank" rel="noreferrer noopener">Open</a> : null}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <p style={{ fontWeight: 700 }}>{del ?? '-'}{inc !== null ? ` / ${inc}` : ''}</p>
                      <p className="cd-small cd-muted">{(x.unit as string) || 'delivered'}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        <div className="cd-row" style={{ justifyContent: 'flex-end' }}>
          <Button variant="outline" onClick={onHelp}><LifeBuoy size={16} /> Need help with this?</Button>
          <Button onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
};

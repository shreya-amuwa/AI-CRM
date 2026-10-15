import React, { useState } from 'react';
import { LifeBuoy, Package } from 'lucide-react';
import type { ClientService } from '../../shared/contracts';
import { clientApi } from './api';
import { useLoad } from './hooks';
import { dashboardPath, useShell } from './shell';
import { Badge, Button, Card, EmptyState, Modal, PageHeader, Query, fmtDate, serviceDetails, tagOf } from './ui';

export const MyServices: React.FC = () => {
  const { go } = useShell();
  const q = useLoad(() => clientApi.services());
  const [open, setOpen] = useState<ClientService | null>(null);
  return (
    <>
      <PageHeader title="My Services" subtitle="The services Amuwa runs for you." />
      <Query
        q={q}
        empty={d => d.length === 0 ? (
          <Card><EmptyState icon={<Package size={24} />} title="No services yet" text="Once your consultant sets up your services, they will appear here. You can also look at what else Amuwa offers."
            action={<Button small onClick={() => go(dashboardPath('explore'))}>Explore services</Button>} /></Card>
        ) : null}
      >
        {services => (
          <div className="cd-grid auto">
            {services.map(s => (
              <Card key={s.code}>
                <div className="cd-row" style={{ alignItems: 'flex-start' }}>
                  <span className="cd-tag">{tagOf(s.name)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: 17 }}>{s.name}</h3>
                    <p className="cd-small cd-muted">{s.category}</p>
                  </div>
                  <Badge tone={s.status === 'LIVE' ? 'success' : 'attention'}>{s.status === 'LIVE' ? 'Live' : 'Setting up'}</Badge>
                </div>
                {s.description ? <p className="cd-small cd-muted" style={{ marginTop: 14, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.description}</p> : null}
                <p className="cd-small cd-muted" style={{ marginTop: 14 }}>
                  Since {fmtDate(s.purchasedAt)}{s.renewsOn ? ` · renews ${fmtDate(s.renewsOn)}` : ''}
                </p>
                <div className="cd-row" style={{ marginTop: 16 }}>
                  <Button variant="outline" small onClick={() => setOpen(s)}>View details</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Query>
      {open && (
        <Modal title={open.name} onClose={() => setOpen(null)}>
          <div className="cd-stack" style={{ gap: 18 }}>
            <p className="cd-muted">{open.description || open.category}</p>
            <dl className="cd-kv">
              <div><dt>Status</dt><dd>{open.status === 'LIVE' ? 'Live - running now' : 'Setting up - we will tell you when it goes live'}</dd></div>
              <div><dt>Category</dt><dd>{open.category}</dd></div>
              <div><dt>Started</dt><dd>{fmtDate(open.purchasedAt)}</dd></div>
              <div><dt>Went live</dt><dd>{open.activatedAt ? fmtDate(open.activatedAt) : 'Not yet'}</dd></div>
              <div><dt>Monthly plan</dt><dd>{open.plan ?? 'Not part of a plan'}</dd></div>
              <div><dt>Valid until / renews</dt><dd>{open.renewsOn ? fmtDate(open.renewsOn) : 'Not set'}</dd></div>
              {serviceDetails(open.code, open.details).rows.map(r => <div key={r.label}><dt>{r.label}</dt><dd>{r.value}</dd></div>)}
            </dl>
            {(() => {
              const { usage } = serviceDetails(open.code, open.details);
              return usage ? (
                <div style={{ border: '1px solid var(--divider)', background: 'var(--surface)', borderRadius: 14, padding: 14 }}>
                  <div className="cd-between"><span className="cd-label">Message usage</span><b>{usage.pct}% used</b></div>
                  <div role="progressbar" aria-valuenow={usage.pct} aria-valuemin={0} aria-valuemax={100} style={{ height: 9, borderRadius: 99, background: 'var(--segment)', overflow: 'hidden', margin: '10px 0' }}>
                    <i style={{ display: 'block', height: '100%', width: `${usage.pct}%`, background: 'var(--primary)', borderRadius: 99 }} />
                  </div>
                  <div className="cd-between cd-small cd-muted"><span>{usage.sent.toLocaleString('en-IN')} sent</span><span>{usage.remaining.toLocaleString('en-IN')} left of {usage.bought.toLocaleString('en-IN')}</span></div>
                </div>
              ) : null;
            })()}
            <div className="cd-row" style={{ justifyContent: 'flex-end' }}>
              <Button variant="outline" onClick={() => { setOpen(null); go(dashboardPath('tickets')); }}><LifeBuoy size={16} /> Need help with this?</Button>
              <Button onClick={() => setOpen(null)}>Close</Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
};

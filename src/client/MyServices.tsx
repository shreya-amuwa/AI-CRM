import React from 'react';
import { Package } from 'lucide-react';
import { clientApi } from './api';
import { useLoad } from './hooks';
import { dashboardPath, useShell } from './shell';
import { Badge, Button, Card, EmptyState, PageHeader, Query, fmtDate, tagOf } from './ui';

export const MyServices: React.FC = () => {
  const { go } = useShell();
  const q = useLoad(() => clientApi.services());
  return (
    <>
      <PageHeader title="My Services" subtitle="The services you have bought from Amuwa." />
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
                  <div className="grow" style={{ flex: 1, minWidth: 0 }}>
                    <h3 style={{ fontSize: 17 }}>{s.name}</h3>
                    <p className="cd-small cd-muted">{s.category}</p>
                  </div>
                  <Badge tone={s.status === 'LIVE' ? 'success' : 'attention'}>{s.status === 'LIVE' ? 'Live' : 'Setting up'}</Badge>
                </div>
                {s.description ? <p className="cd-small" style={{ marginTop: 12 }}>{s.description}</p> : null}
                <hr className="cd-divider" />
                <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 12px', margin: 0 }}>
                  <Detail label="Started" value={fmtDate(s.purchasedAt)} />
                  <Detail label="Activated" value={s.activatedAt ? fmtDate(s.activatedAt) : 'Not yet'} />
                  <Detail label="Plan" value={s.plan ?? 'Not set'} />
                  <Detail label="Valid until / renews" value={s.renewsOn ? fmtDate(s.renewsOn) : 'Not set'} />
                </dl>
                <div style={{ marginTop: 12 }} className={`cd-banner ${s.status === 'LIVE' ? 'success' : 'attention'}`}>
                  <span>{s.status === 'LIVE' ? 'Setup and verification are complete. This service is running.' : 'Your consultant is still setting this up and verifying it. We will tell you when it goes live.'}</span>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Query>
    </>
  );
};

const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div><dt className="cd-label">{label}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{value}</dd></div>
);

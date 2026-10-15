import React from 'react';
import { CalendarClock, CheckCircle2, Package, Clock3 } from 'lucide-react';
import { clientApi } from './api';
import { useLoad } from './hooks';
import { dashboardPath, useShell } from './shell';
import { Badge, Button, Card, EmptyState, PageHeader, Query, fmtDate, hueOf, serviceDetails, tagOf } from './ui';

export const MyServices: React.FC = () => {
  const { go } = useShell();
  const q = useLoad(() => clientApi.services());
  return (
    <>
      <PageHeader title="My Services" subtitle="Every service our team has set up for you, with its status and details." />
      <Query
        q={q}
        empty={d => d.length === 0 ? (
          <Card><EmptyState icon={<Package size={24} />} title="No services yet" text="Once your consultant sets up your services, they will appear here. You can also look at what else Amuwa offers."
            action={<Button small onClick={() => go(dashboardPath('explore'))}>Explore services</Button>} /></Card>
        ) : null}
      >
        {services => {
          const live = services.filter(s => s.status === 'LIVE').length;
          return (
            <>
              <div className="cd-summary">
                <span className="pill"><b>{services.length}</b> service{services.length === 1 ? '' : 's'}</span>
                <span className="pill"><CheckCircle2 size={15} color="var(--primary)" /><b>{live}</b> live</span>
                {services.length - live > 0 && <span className="pill"><Clock3 size={15} color="var(--attention-text)" /><b>{services.length - live}</b> being set up</span>}
              </div>
              <div className="cd-grid auto">
                {services.map(s => {
                  const { usage, rows } = serviceDetails(s.code, s.details);
                  return (
                    <Card key={s.code} className={`cd-svc cd-hue-${hueOf(s.category)}`}>
                      <div className="cd-svc-top">
                        <span className="cd-svc-ico">{tagOf(s.name)}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <h3 style={{ fontSize: 18 }}>{s.name}</h3>
                          <p className="cd-small" style={{ color: 'var(--h-fg)', fontWeight: 600 }}>{s.category}</p>
                        </div>
                        <Badge tone={s.status === 'LIVE' ? 'success' : 'attention'}>{s.status === 'LIVE' ? 'Live' : 'Setting up'}</Badge>
                      </div>
                      <div className="cd-svc-body">
                        {s.description ? <p className="cd-small">{s.description}</p> : null}
                        <dl className="cd-kv">
                          <Detail label="Started" value={fmtDate(s.purchasedAt)} />
                          <Detail label="Activated" value={s.activatedAt ? fmtDate(s.activatedAt) : 'Not yet'} />
                          <Detail label="Plan" value={s.plan ?? 'Not set'} />
                          <Detail label="Renews / valid until" value={s.renewsOn ? fmtDate(s.renewsOn) : 'Not set'} />
                          {rows.map(r => <Detail key={r.label} label={r.label} value={r.value} />)}
                        </dl>
                        {usage && (
                          <div className="cd-usage">
                            <div className="cd-between"><span className="cd-label" style={{ margin: 0 }}>Message usage</span><b>{usage.pct}% used</b></div>
                            <div className="cd-meter" style={{ margin: '10px 0' }} role="progressbar" aria-valuenow={usage.pct} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${usage.pct}%` }} /></div>
                            <div className="cd-between cd-small cd-muted"><span>{usage.sent.toLocaleString('en-IN')} sent</span><span>{usage.remaining.toLocaleString('en-IN')} left of {usage.bought.toLocaleString('en-IN')}</span></div>
                          </div>
                        )}
                        <div className={`cd-banner ${s.status === 'LIVE' ? 'success' : 'attention'}`}>
                          {s.status === 'LIVE' ? <CheckCircle2 size={16} /> : <CalendarClock size={16} />}
                          <span>{s.status === 'LIVE' ? 'Setup and verification are complete. This service is running.' : 'Your consultant is still setting this up. We will tell you when it goes live.'}</span>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </>
          );
        }}
      </Query>
    </>
  );
};

const Detail: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ minWidth: 0 }}><dt>{label}</dt><dd style={{ overflowWrap: 'anywhere' }}>{value}</dd></div>
);

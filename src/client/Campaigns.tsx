import React, { useMemo, useState } from 'react';
import { Megaphone } from 'lucide-react';
import type { ClientCampaign } from '../../shared/contracts';
import { clientApi } from './api';
import { useLoad } from './hooks';
import { Badge, Card, EmptyState, PageHeader, Query, fmtDate } from './ui';

const pct = (part: number | null, whole: number | null) => (part !== null && whole ? `${Math.round((part / whole) * 100)}%` : '-');
const num = (v: number | null) => (v === null ? '-' : v.toLocaleString('en-IN'));

/** The client's campaigns (WhatsApp and others): sent, delivered, read, replied, failed - like the panel's Quick Report. */
export const Campaigns: React.FC = () => {
  const q = useLoad(() => clientApi.campaigns());
  const [service, setService] = useState('');
  return (
    <>
      <PageHeader title="Campaigns" subtitle="Every campaign we sent for you and how it did." />
      <Query
        q={q}
        empty={d => d.length === 0 ? (
          <Card><EmptyState icon={<Megaphone size={24} />} title="No campaigns yet" text="Campaigns appear here once our team has sent them for you." /></Card>
        ) : null}
      >
        {list => <CampaignList list={list} service={service} setService={setService} />}
      </Query>
    </>
  );
};

const CampaignList: React.FC<{ list: ClientCampaign[]; service: string; setService: (s: string) => void }> = ({ list, service, setService }) => {
  const services = useMemo(() => Array.from(new Map(list.map(c => [c.serviceCode, c.serviceName])).entries()), [list]);
  const shown = service ? list.filter(c => c.serviceCode === service) : list;
  const total = shown.reduce((a, c) => ({ sent: a.sent + (c.sent ?? 0), delivered: a.delivered + (c.delivered ?? 0), read: a.read + (c.read ?? 0), replied: a.replied + (c.replied ?? 0), failed: a.failed + (c.failed ?? 0) }),
    { sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 });
  return (
    <div className="cd-stack" style={{ gap: 20 }}>
      {services.length > 1 && (
        <div className="cd-row" role="tablist" aria-label="Service">
          {[['', 'All'], ...services].map(([code, name]) => (
            <button key={code} role="tab" aria-selected={service === code} className={`cd-btn sm ${service === code ? '' : 'ghost'}`} onClick={() => setService(code)}>{name}</button>
          ))}
        </div>
      )}
      <div className="cd-grid c4">
        {([['Sent', total.sent, ''], ['Delivered', total.delivered, pct(total.delivered, total.sent)], ['Read', total.read, pct(total.read, total.sent)], ['Replied', total.replied, pct(total.replied, total.sent)]] as const).map(([label, v, p]) => (
          <Card key={label} small>
            <p className="cd-label">{label}</p>
            <p className="cd-big">{v.toLocaleString('en-IN')}</p>
            <p className="cd-small cd-muted">{p ? `${p} of sent` : `${shown.length} campaign${shown.length === 1 ? '' : 's'}`}</p>
          </Card>
        ))}
      </div>
      <Card>
        <div className="cd-list">
          {shown.map(c => (
            <div className="cd-li" key={c.id} style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div className="grow" style={{ minWidth: 200 }}>
                <p style={{ fontWeight: 600 }} className="cd-ellipsis">{c.name}</p>
                <p className="cd-small cd-muted">{fmtDate(c.sentOn)}{c.audienceSize !== null ? ` · ${num(c.audienceSize)} people` : ''}{c.audienceType ? ` (${c.audienceType})` : ''}{c.template ? ` · ${c.template}` : ''}</p>
              </div>
              <dl className="cd-row cd-small" style={{ gap: 16, flexWrap: 'wrap' }}>
                {([['Sent', c.sent, null], ['Delivered', c.delivered, c.sent], ['Read', c.read, c.sent], ['Replied', c.replied, c.sent], ['Failed', c.failed, c.sent]] as const).map(([k, v, of]) => (
                  <div key={k} style={{ textAlign: 'right' }}>
                    <dt className="cd-muted">{k}</dt>
                    <dd style={{ fontWeight: 700 }}>{num(v)}{of !== null ? <span className="cd-muted" style={{ fontWeight: 400 }}> · {pct(v, of)}</span> : null}</dd>
                  </div>
                ))}
              </dl>
              {c.status ? <Badge tone={/fail|stop|cancel/i.test(c.status) ? 'danger' : /complete|done|sent/i.test(c.status) ? 'success' : 'info'}>{c.status}</Badge> : null}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
};

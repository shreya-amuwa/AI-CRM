import React, { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, FileCheck2, FileText, LifeBuoy, Megaphone, Package, Sparkles } from 'lucide-react';
import type { ClientCalendarEvent } from '../../shared/contracts';
import { clientApi } from './api';
import { useClientLive, useLoad } from './hooks';
import { dashboardPath, useShell } from './shell';
import { Badge, Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from './ui';

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const KIND_LABEL: Record<string, string> = {
  CAMPAIGN: 'Campaign', CALL_CAMPAIGN: 'Call campaign', POST: 'Post', AD: 'Ad', SETUP: 'Setup', REPORT: 'Report', MEETING: 'Meeting', OTHER: 'Update',
  SERVICE_STARTED: 'Service', SERVICE_ACTIVATED: 'Service', SERVICE_RENEWAL: 'Renewal', INVOICE_ISSUED: 'Invoice', INVOICE_PAID: 'Payment',
  TICKET_RAISED: 'Ticket', TICKET_RESOLVED: 'Ticket', DOCUMENT_VERIFIED: 'Document'
};
type Group = 'ALL' | 'ACTIVITY' | 'SERVICE' | 'INVOICE' | 'TICKET' | 'DOCUMENT';
const GROUPS: { id: Group; label: string }[] = [
  { id: 'ALL', label: 'Everything' }, { id: 'ACTIVITY', label: 'Our work for you' }, { id: 'SERVICE', label: 'Services' },
  { id: 'INVOICE', label: 'Invoices' }, { id: 'TICKET', label: 'Tickets' }, { id: 'DOCUMENT', label: 'Documents' }
];
const SOURCE_ICON: Record<ClientCalendarEvent['source'], React.ReactNode> = {
  ACTIVITY: <Megaphone size={16} />, SERVICE: <Package size={16} />, INVOICE: <FileText size={16} />, TICKET: <LifeBuoy size={16} />, DOCUMENT: <FileCheck2 size={16} />
};

export const Calendar: React.FC = () => {
  const { go } = useShell();
  const todayStr = ymd(new Date());
  const [cursor, setCursor] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [selected, setSelected] = useState(todayStr);
  const [group, setGroup] = useState<Group>('ALL');

  // The six-week grid of this month (so the days around it are filled too).
  const days = useMemo(() => {
    const start = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - cursor.getDay());
    return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  }, [cursor]);
  const from = ymd(days[0]);
  const to = ymd(days[41]);
  const q = useLoad(() => clientApi.calendar(from, to), [from, to]);
  // The team logging something new reaches the bell, which reloads this page.
  useClientLive(q.reload);

  const events = useMemo(() => (q.data ?? []).filter(e => group === 'ALL' || e.source === group), [q.data, group]);
  const byDay = useMemo(() => {
    const m = new Map<string, ClientCalendarEvent[]>();
    for (const e of events) { const l = m.get(e.date) ?? []; l.push(e); m.set(e.date, l); }
    return m;
  }, [events]);
  const monthEvents = events.filter(e => e.date.slice(0, 7) === `${cursor.getFullYear()}-${pad(cursor.getMonth() + 1)}`);
  const work = monthEvents.filter(e => e.source === 'ACTIVITY').length;
  const dayEvents = byDay.get(selected) ?? [];
  const selDate = new Date(`${selected}T00:00:00`);

  const move = (delta: number) => {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
    setCursor(next);
    setSelected(ymd(delta === 0 ? new Date() : next));
  };
  const goToday = () => { const d = new Date(); setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); setSelected(todayStr); };

  return (
    <>
      <PageHeader title="Calendar" subtitle="What happened on each day: the work our team did for you, with its results, and what changed on your account." />
      <div className="cd-chips" style={{ marginBottom: 16 }} role="group" aria-label="Show">
        {GROUPS.map(g => <button key={g.id} className="cd-chip" aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>{g.label}</button>)}
      </div>
      <div className="cd-cal-layout">
        <Card className="cd-cal">
          <div className="cd-between" style={{ marginBottom: 14 }}>
            <div>
              <h2 className="cd-section-title" style={{ margin: 0 }}>{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</h2>
              <p className="cd-small cd-muted">{q.loading && !q.data ? 'Loading...' : work ? `${work} piece${work === 1 ? '' : 's'} of work by our team this month` : 'No work logged by our team this month yet'}</p>
            </div>
            <div className="cd-row" style={{ gap: 6 }}>
              <Button variant="outline" small onClick={goToday}>Today</Button>
              <button className="cd-bell" style={{ width: 38, height: 38 }} onClick={() => move(-1)} aria-label="Previous month"><ChevronLeft size={18} /></button>
              <button className="cd-bell" style={{ width: 38, height: 38 }} onClick={() => move(1)} aria-label="Next month"><ChevronRight size={18} /></button>
            </div>
          </div>
          {q.error && !q.data ? (
            <ErrorState title="We could not load your calendar" message={q.unavailable ? 'Please try again in a moment.' : q.error} forbidden={q.forbidden} onRetry={q.reload} />
          ) : (
            <div role="grid" aria-label={`${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`}>
              <div className="cd-cal-week" role="row">{WEEKDAYS.map(w => <span key={w} role="columnheader">{w}</span>)}</div>
              <div className="cd-cal-grid">
                {days.map(d => {
                  const key = ymd(d);
                  const list = byDay.get(key) ?? [];
                  const inMonth = d.getMonth() === cursor.getMonth();
                  const hasWork = list.some(e => e.source === 'ACTIVITY');
                  return (
                    <button
                      key={key} role="gridcell" type="button"
                      className={`cd-cal-day${inMonth ? '' : ' out'}${key === todayStr ? ' today' : ''}${key === selected ? ' sel' : ''}${hasWork ? ' work' : ''}`}
                      aria-label={`${d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}${list.length ? `, ${list.length} item${list.length === 1 ? '' : 's'}` : ''}`}
                      aria-pressed={key === selected}
                      onClick={() => { setSelected(key); if (!inMonth) setCursor(new Date(d.getFullYear(), d.getMonth(), 1)); }}
                    >
                      <span className="num">{d.getDate()}</span>
                      {list.length > 0 && (
                        <span className="dots" aria-hidden>
                          {list.slice(0, 4).map((e, i) => <i key={i} className={`dot ${e.source.toLowerCase()}`} />)}
                          {list.length > 4 && <b>+{list.length - 4}</b>}
                        </span>
                      )}
                      {list.find(e => e.source === 'ACTIVITY') && <span className="lbl">{list.find(e => e.source === 'ACTIVITY')!.title}</span>}
                    </button>
                  );
                })}
              </div>
              <div className="cd-cal-legend" aria-hidden>
                <span><i className="dot activity" /> Our work for you</span><span><i className="dot service" /> Services</span>
                <span><i className="dot invoice" /> Invoices</span><span><i className="dot ticket" /> Tickets</span><span><i className="dot document" /> Documents</span>
              </div>
            </div>
          )}
        </Card>

        <div className="cd-cal-side">
          <Card>
            <p className="cd-label">{selected === todayStr ? 'Today' : 'Selected day'}</p>
            <h2 style={{ fontSize: 22 }}>{selDate.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</h2>
          </Card>
          {q.loading && !q.data ? (
            <Card><div className="cd-stack" style={{ gap: 10 }}><Skeleton h={18} w="50%" /><Skeleton h={14} /><Skeleton h={14} w="70%" /></div></Card>
          ) : dayEvents.length === 0 ? (
            <Card><EmptyState icon={<CalendarDays size={24} />} title="Nothing on this day" text={group === 'ALL' ? 'When our team runs a campaign or posts for you, the details and results show up here.' : 'Nothing of this kind on this day. Try "Everything".'} /></Card>
          ) : dayEvents.map(e => <EventCard key={e.id} e={e} go={go} />)}
        </div>
      </div>
    </>
  );
};

const EventCard: React.FC<{ e: ClientCalendarEvent; go: (to: string) => void }> = ({ e, go }) => {
  const isWork = e.source === 'ACTIVITY';
  const target = e.source === 'INVOICE' ? dashboardPath('invoices') : e.source === 'TICKET' ? dashboardPath('tickets') : e.source === 'DOCUMENT' ? dashboardPath('documents') : e.source === 'SERVICE' ? dashboardPath('services') : null;
  return (
    <Card className={`cd-ev ${e.source.toLowerCase()}`}>
      <div className="cd-row" style={{ alignItems: 'flex-start', gap: 12 }}>
        <span className={`cd-ev-ic ${e.source.toLowerCase()}`}>{isWork ? <Sparkles size={16} /> : SOURCE_ICON[e.source]}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="cd-row" style={{ flexWrap: 'wrap', gap: 8, marginBottom: 4 }}>
            <Badge tone={isWork ? 'success' : 'neutral'}>{KIND_LABEL[e.kind] ?? 'Update'}</Badge>
            {e.serviceName && <span className="cd-small cd-muted">{e.serviceName}</span>}
          </div>
          <h3 style={{ fontSize: 16, lineHeight: 1.3 }}>{e.title}</h3>
          {e.summary && <p className="cd-small" style={{ marginTop: 6 }}>{e.summary}</p>}
          {e.metrics.length > 0 && (
            <div className="cd-insights" aria-label="Results">
              {e.metrics.map((m, i) => <div key={i}><b>{m.value}</b><span>{m.label}</span></div>)}
            </div>
          )}
          {isWork && e.createdBy && <p className="cd-small cd-muted" style={{ marginTop: 8 }}>By {e.createdBy}</p>}
          {target && <button className="cd-link" style={{ marginTop: 8 }} onClick={() => go(target)}>Open</button>}
        </div>
      </div>
    </Card>
  );
};

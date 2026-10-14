import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, LifeBuoy, Plus, Send } from 'lucide-react';
import { clientApi } from './api';
import { useLoad } from './hooks';
import { errorMessage } from '../lib/api/client';
import { dashboardPath, useShell } from './shell';
import { Badge, Button, Card, EmptyState, ErrorState, Field, LoadingBlock, Modal, PageHeader, Query, TICKET_CATEGORIES, TICKET_LABEL, categoryLabel, fmtDate, fmtDateTime } from './ui';

export const Tickets: React.FC = () => {
  const { sub } = useShell();
  return sub ? <TicketDetail id={sub.split('/')[0]} /> : <TicketList />;
};

const TicketList: React.FC = () => {
  const { go } = useShell();
  const q = useLoad(() => clientApi.tickets());
  const services = useLoad(() => clientApi.services());
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState<'ALL' | 'OPEN' | 'DONE'>('ALL');
  const list = useMemo(() => (q.data ?? []).filter(t => filter === 'ALL' || (filter === 'OPEN' ? !['RESOLVED', 'CLOSED'].includes(t.status) : ['RESOLVED', 'CLOSED'].includes(t.status))), [q.data, filter]);

  return (
    <>
      <PageHeader title="Tickets" subtitle="Ask our support team for help. You only see your own tickets."
        action={<Button onClick={() => setCreating(true)}><Plus size={18} /> New ticket</Button>} />
      <Query q={q} empty={d => d.length === 0 ? (
        <Card><EmptyState icon={<LifeBuoy size={24} />} title="No tickets yet" text="If something is not working or you have a question, raise a ticket and our support team will reply here."
          action={<Button small onClick={() => setCreating(true)}>Raise a ticket</Button>} /></Card>) : null}>
        {() => (
          <div className="cd-stack">
            <div className="cd-chips" role="group" aria-label="Filter tickets">
              {([['ALL', 'All'], ['OPEN', 'Open'], ['DONE', 'Resolved']] as const).map(([v, l]) => <button key={v} className="cd-chip" aria-pressed={filter === v} onClick={() => setFilter(v)}>{l}</button>)}
            </div>
            {list.length === 0 ? <Card><EmptyState title="No tickets here" text="Nothing matches this filter." /></Card> : list.map(t => (
              <Card key={t.id} small onClick={() => go(dashboardPath('tickets', `/${t.id}`))}>
                <div className="cd-between"><span className="cd-small cd-muted">{t.ticketNo}{t.serviceName ? ` · ${t.serviceName}` : ''}</span><Badge tone={TICKET_LABEL[t.status].tone}>{TICKET_LABEL[t.status].label}</Badge></div>
                <p style={{ fontWeight: 700, marginTop: 4 }}>{t.subject}</p>
                <p className="cd-small cd-muted">{categoryLabel(t.category)} · updated {fmtDate(t.updatedAt)}</p>
              </Card>
            ))}
          </div>
        )}
      </Query>
      {creating && <NewTicket services={services.data ?? []} onClose={() => setCreating(false)} onCreated={id => { setCreating(false); go(dashboardPath('tickets', `/${id}`)); }} />}
    </>
  );
};

const NewTicket: React.FC<{ services: { code: string; name: string }[]; onClose: () => void; onCreated: (id: string) => void }> = ({ services, onClose, onCreated }) => {
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('GENERAL');
  const [serviceCode, setServiceCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    if (subject.trim().length < 3) { setError('Enter a subject (at least 3 characters).'); return; }
    if (description.trim().length < 5) { setError('Describe the problem (at least 5 characters).'); return; }
    setBusy(true); setError('');
    try { const t = await clientApi.createTicket({ subject: subject.trim(), description: description.trim(), category, serviceCode: serviceCode || null }); onCreated(t.id); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  return (
    <Modal title="New ticket" onClose={onClose}>
      <div className="cd-stack">
        <Field label="Subject" htmlFor="cd-t-subject"><input id="cd-t-subject" className="cd-input" maxLength={200} value={subject} onChange={e => setSubject(e.target.value)} placeholder="What do you need help with?" /></Field>
        <div className="cd-grid c2">
          <Field label="Category" htmlFor="cd-t-cat"><select id="cd-t-cat" className="cd-select" value={category} onChange={e => setCategory(e.target.value)}>{TICKET_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}</select></Field>
          <Field label="Related service (optional)" htmlFor="cd-t-svc"><select id="cd-t-svc" className="cd-select" value={serviceCode} onChange={e => setServiceCode(e.target.value)}><option value="">Not about one service</option>{services.map(s => <option key={s.code} value={s.code}>{s.name}</option>)}</select></Field>
        </div>
        <Field label="Describe the problem" htmlFor="cd-t-desc"><textarea id="cd-t-desc" className="cd-textarea" maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} placeholder="Tell us what happened and what you expected." /></Field>
        {error && <div className="cd-banner danger" role="alert">{error}</div>}
        <div className="cd-row" style={{ justifyContent: 'flex-end' }}><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Submit ticket</Button></div>
      </div>
    </Modal>
  );
};

const TicketDetail: React.FC<{ id: string }> = ({ id }) => {
  const { go } = useShell();
  const q = useLoad(() => clientApi.ticket(id), [id]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [q.data?.updates.length]);

  const send = async () => {
    if (!message.trim()) return;
    setBusy(true); setError('');
    try { await clientApi.replyTicket(id, message.trim()); setMessage(''); q.reload(); }
    catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };
  const back = <button className="cd-link" onClick={() => go(dashboardPath('tickets'))} style={{ marginBottom: 14, display: 'inline-flex', alignItems: 'center', gap: 6 }}><ArrowLeft size={16} /> All tickets</button>;

  if (q.loading && !q.data) return <>{back}<LoadingBlock rows={2} /></>;
  if (q.error && !q.data) return <>{back}<Card><ErrorState message={q.forbidden ? 'This ticket was not found.' : q.error} forbidden={false} onRetry={q.forbidden ? undefined : q.reload} /></Card></>;
  const t = q.data!;
  const closed = t.status === 'CLOSED';
  return (
    <>
      {back}
      <Card>
        <div className="cd-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}><p className="cd-small cd-muted">{t.ticketNo} · {categoryLabel(t.category)}{t.serviceName ? ` · ${t.serviceName}` : ''}</p><h1 style={{ fontSize: 22, marginTop: 2 }}>{t.subject}</h1><p className="cd-small cd-muted">Opened {fmtDateTime(t.createdAt)}</p></div>
          <Badge tone={TICKET_LABEL[t.status].tone}>{TICKET_LABEL[t.status].label}</Badge>
        </div>
        {t.resolution && <div className="cd-banner success" style={{ marginTop: 12 }}><span><b>Resolution:</b> {t.resolution}</span></div>}
        <hr className="cd-divider" />
        <div className="cd-stack" style={{ gap: 10 }} aria-live="polite">
          {t.description && <div className="cd-bubble me">{t.description}<div className="cd-small" style={{ opacity: .7, marginTop: 4 }}>You · {fmtDateTime(t.createdAt)}</div></div>}
          {t.updates.map(u => u.type === 'STATUS'
            ? <div key={u.id} className="cd-bubble status">{u.message ?? `Status changed to ${u.status ? TICKET_LABEL[u.status].label : ''}`} · {fmtDateTime(u.at)}</div>
            : <div key={u.id} className={`cd-bubble ${u.type === 'CLIENT' ? 'me' : 'them'}`}>{u.message}<div className="cd-small" style={{ opacity: .7, marginTop: 4 }}>{u.type === 'CLIENT' ? 'You' : 'Amuwa Support'} · {fmtDateTime(u.at)}</div></div>)}
          {t.updates.length === 0 && <p className="cd-small cd-muted" style={{ textAlign: 'center' }}>Our support team will reply here.</p>}
          <div ref={end} />
        </div>
        <hr className="cd-divider" />
        {closed ? <div className="cd-banner attention">This ticket is closed. Please raise a new ticket if you need more help.</div> : (
          <div className="cd-stack" style={{ gap: 10 }}>
            <label className="cd-label" htmlFor="cd-reply">{t.status === 'RESOLVED' ? 'Not solved? Reply to reopen this ticket' : 'Your reply'}</label>
            <textarea id="cd-reply" className="cd-textarea" style={{ minHeight: 90 }} maxLength={4000} value={message} onChange={e => setMessage(e.target.value)} placeholder="Write your message" />
            {error && <div className="cd-banner danger" role="alert">{error}</div>}
            <div className="cd-row" style={{ justifyContent: 'flex-end' }}><Button loading={busy} disabled={!message.trim()} onClick={send}><Send size={16} /> Send reply</Button></div>
          </div>
        )}
      </Card>
    </>
  );
};

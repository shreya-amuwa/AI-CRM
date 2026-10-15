import React, { useEffect, useMemo, useState } from 'react';
import { Check, Info, Search } from 'lucide-react';
import type { ClientCatalogService } from '../../shared/contracts';
import { clientApi } from './api';
import { useLoad } from './hooks';
import { errorMessage } from '../lib/api/client';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Query, SERVICE_REQUEST_LABEL, inr, tagOf } from './ui';

export const ExploreServices: React.FC = () => {
  const q = useLoad(() => clientApi.catalog());
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<ClientCatalogService | null>(null);
  const [adding, setAdding] = useState<ClientCatalogService | null>(null);
  const [notice, setNotice] = useState('');

  // A new-service notice opens its service here: /client/dashboard/explore?service=CODE
  useEffect(() => {
    if (!q.data) return;
    const code = new URLSearchParams(window.location.search).get('service');
    if (!code) return;
    const found = q.data.find(s => s.code === code);
    if (found) { setCategory('All'); setSearch(''); setDetail(found); }
    window.history.replaceState({}, '', window.location.pathname);
  }, [q.data]);

  const categories = useMemo(() => ['All', ...Array.from(new Set((q.data ?? []).map(s => s.category))).sort()], [q.data]);
  const list = useMemo(() => (q.data ?? []).filter(s =>
    (category === 'All' || s.category === category) && (!search.trim() || `${s.name} ${s.description ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))), [q.data, category, search]);

  return (
    <>
      <PageHeader title="Explore Services" subtitle="Everything Amuwa offers. Ask for a service and our team will confirm the price and set it up with you." />
      {notice && <div className="cd-banner success" role="status" style={{ marginBottom: 14 }}><Check size={18} /><span>{notice}</span></div>}
      <Query q={q} empty={d => d.length === 0 ? <Card><EmptyState title="No services to show" text="Our service catalogue is being updated. Please check again soon." /></Card> : null}>
        {() => (
          <div className="cd-stack" style={{ gap: 16 }}>
            <div className="cd-row" style={{ flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: '1 1 260px', maxWidth: 380 }}>
                <Search size={18} aria-hidden style={{ position: 'absolute', left: 14, top: 15, color: 'var(--placeholder)' }} />
                <input className="cd-input" style={{ paddingLeft: 42 }} placeholder="Search services" aria-label="Search services" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              <div className="cd-chips" role="group" aria-label="Category">
                {categories.map(c => <button key={c} className="cd-chip" aria-pressed={category === c} onClick={() => setCategory(c)}>{c}</button>)}
              </div>
            </div>
            {list.length === 0 ? (
              <Card><EmptyState title="Nothing matches" text="Try a different search or category." /></Card>
            ) : (
              <div className="cd-grid auto">
                {list.map(s => (
                  <Card key={s.code}>
                    <div className="cd-row" style={{ alignItems: 'flex-start' }}>
                      <span className="cd-tag">{tagOf(s.name)}</span>
                      <div style={{ flex: 1, minWidth: 0 }}><h3 style={{ fontSize: 17 }}>{s.name}</h3><p className="cd-small cd-muted">{s.category}</p></div>
                      {s.owned ? <Badge tone="success">You have this</Badge> : s.request ? <Badge tone={SERVICE_REQUEST_LABEL[s.request.status].tone}>{SERVICE_REQUEST_LABEL[s.request.status].label}</Badge> : null}
                    </div>
                    {s.description ? <p className="cd-small cd-muted" style={{ marginTop: 10, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{s.description}</p> : null}
                    <p style={{ marginTop: 10, fontWeight: 700 }}>{s.startingPrice !== null ? <>From {inr(s.startingPrice)}</> : <span className="cd-muted" style={{ fontWeight: 500 }}>Price confirmed after review</span>}</p>
                    <div className="cd-row" style={{ marginTop: 12 }}>
                      <Button variant="outline" small onClick={() => setDetail(s)}>View details</Button>
                      {!s.owned && (!s.request || ['REJECTED', 'CANCELLED', 'ACTIVATED'].includes(s.request.status)) ? <Button small onClick={() => setAdding(s)}>Add service</Button> : null}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </Query>

      {detail && <Detail service={detail} onClose={() => setDetail(null)} onAdd={() => { setAdding(detail); setDetail(null); }} onChanged={() => { q.reload(); }} />}
      {adding && <AddService service={adding} onClose={() => setAdding(null)} onDone={msg => { setAdding(null); setNotice(msg); q.reload(); }} />}
    </>
  );
};

const Detail: React.FC<{ service: ClientCatalogService; onClose: () => void; onAdd: () => void; onChanged: () => void }> = ({ service: s, onClose, onAdd, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canAdd = !s.owned && (!s.request || ['REJECTED', 'CANCELLED', 'ACTIVATED'].includes(s.request.status));
  const cancel = async () => {
    if (!s.request) return;
    setBusy(true); setError('');
    try { await clientApi.cancelServiceRequest(s.request.id); onChanged(); onClose(); } catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  return (
    <Modal title={s.name} onClose={onClose}>
      <div className="cd-stack">
        <div className="cd-row"><Badge tone="info">{s.category}</Badge>{s.owned ? <Badge tone="success">You have this</Badge> : null}</div>
        <p>{s.description ?? 'Ask our team about this service and we will explain how it works for your business.'}</p>
        {s.features.length > 0 && (
          <div><p className="cd-label" style={{ marginBottom: 6 }}>What is included</p>
            <div className="cd-stack" style={{ gap: 8 }}>{s.features.map(f => <div className="cd-feature" key={f}><Check size={16} /><span>{f}</span></div>)}</div></div>
        )}
        <div className="cd-card sm" style={{ background: 'var(--surface)' }}>
          <p className="cd-label">Price</p>
          <p style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 22 }}>{s.startingPrice !== null ? `From ${inr(s.startingPrice)}` : 'Confirmed after review'}</p>
          <p className="cd-small cd-muted">{s.priceNote ?? 'The final price is confirmed by our team after they understand what you need. It cannot be changed from here.'}</p>
        </div>
        {s.request && !s.owned && (
          <div className={`cd-banner ${s.request.status === 'REJECTED' ? 'danger' : 'info'}`}>
            <Info size={18} style={{ flexShrink: 0 }} />
            <span><b>{SERVICE_REQUEST_LABEL[s.request.status].label}.</b> {s.request.decisionNote ?? (s.request.status === 'REQUESTED' ? 'Our team will review your request and contact you.' : s.request.status === 'IN_REVIEW' ? 'Our team is reviewing it with you.' : s.request.status === 'IN_ADDON_WORKFLOW' ? 'Accounts is preparing the price and invoice. The service starts after the payment is confirmed.' : '')}</span>
          </div>
        )}
        {error && <div className="cd-banner danger" role="alert">{error}</div>}
        <div className="cd-row" style={{ justifyContent: 'flex-end' }}>
          {s.request?.status === 'REQUESTED' && <Button variant="danger" loading={busy} onClick={cancel}>Cancel my request</Button>}
          {canAdd && <Button onClick={onAdd}>Add service</Button>}
        </div>
      </div>
    </Modal>
  );
};

const AddService: React.FC<{ service: ClientCatalogService; onClose: () => void; onDone: (msg: string) => void }> = ({ service, onClose, onDone }) => {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try { await clientApi.requestService(service.code, note.trim()); onDone(`We have received your request for ${service.name}. Our team will review it and Accounts will confirm the price. The service starts only after approval and payment.`); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  return (
    <Modal title={`Add ${service.name}`} onClose={onClose}>
      <div className="cd-stack">
        <div className="cd-banner info"><Info size={18} style={{ flexShrink: 0 }} /><span>This sends a request to our team. Nothing is bought or charged yet. Our team confirms the price with you, Accounts sends the invoice, and the service starts after the payment is confirmed.</span></div>
        <Field label="Anything we should know? (optional)" htmlFor="cd-note"><textarea id="cd-note" className="cd-textarea" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} placeholder="For example: when you want to start, or what you want to achieve." /></Field>
        {error && <div className="cd-banner danger" role="alert">{error}</div>}
        <div className="cd-row" style={{ justifyContent: 'flex-end' }}><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Send request</Button></div>
      </div>
    </Modal>
  );
};

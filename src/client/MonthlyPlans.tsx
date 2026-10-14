import React, { useState } from 'react';
import { Check, Info, Sparkles } from 'lucide-react';
import type { MonthlyPlan } from '../../shared/contracts';
import { clientApi } from './api';
import { useLoad } from './hooks';
import { errorMessage } from '../lib/api/client';
import { Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Query, fmtDate, inr } from './ui';

export const MonthlyPlans: React.FC = () => {
  const q = useLoad(() => clientApi.plans());
  const [choose, setChoose] = useState<MonthlyPlan | null>(null);
  const [notice, setNotice] = useState('');

  return (
    <>
      <PageHeader title="Monthly Plans" subtitle="Your current plan and the plans you can move to." />
      {notice && <div className="cd-banner success" role="status" style={{ marginBottom: 14 }}><Check size={18} /><span>{notice}</span></div>}
      <Query q={q}>
        {d => (
          <div className="cd-stack" style={{ gap: 18 }}>
            {d.current ? (
              <div className="cd-hero">
                <div className="cd-between" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div><p className="cd-small muted">Your current plan</p><h2 style={{ fontSize: 28 }}>{d.current.name}</h2>{d.current.description ? <p className="muted cd-small" style={{ marginTop: 4, maxWidth: 520 }}>{d.current.description}</p> : null}</div>
                  <div style={{ textAlign: 'right' }}><p className="cd-big" style={{ fontSize: 26 }}>{inr(d.current.price)}</p><p className="cd-small muted">per month</p></div>
                </div>
                <div className="cd-grid c4" style={{ marginTop: 16 }}>
                  <div className="cd-tile"><p className="cd-small muted">Started</p><p style={{ fontWeight: 700 }}>{fmtDate(d.current.startedAt)}</p></div>
                  <div className="cd-tile"><p className="cd-small muted">Next renewal</p><p style={{ fontWeight: 700 }}>{d.current.renewsOn ? fmtDate(d.current.renewsOn) : 'Not set'}</p></div>
                  <div className="cd-tile"><p className="cd-small muted">Status</p><p style={{ fontWeight: 700 }}>{d.current.status === 'ACTIVE' ? 'Active' : d.current.status}</p></div>
                  <div className="cd-tile"><p className="cd-small muted">Payment</p><p style={{ fontWeight: 700 }}>{d.current.paymentStatus === 'PAID' ? 'Paid' : 'Pending'}</p></div>
                </div>
                {d.current.features.length > 0 && (
                  <div className="cd-stack" style={{ gap: 6, marginTop: 16 }}>{d.current.features.map(f => <div className="cd-feature" key={f}><Check size={16} style={{ color: '#fff' }} /><span>{f}</span></div>)}</div>
                )}
              </div>
            ) : (
              <Card><EmptyState icon={<Sparkles size={24} />} title="You are not on a monthly plan" text={d.options.length ? 'Choose one of the plans below. It starts after our team verifies it and your payment is confirmed.' : 'There are no monthly plans available right now. Please check again later.'} /></Card>
            )}

            {d.request && (
              <div className="cd-banner info" role="status"><Info size={18} style={{ flexShrink: 0 }} />
                <span><b>Your request for {d.request.planName} is {d.request.status === 'APPROVED' ? 'approved' : 'with our team'}.</b>{' '}
                  {d.request.status === 'APPROVED' ? 'It starts as soon as Accounts confirms your payment.' : 'Accounts will verify it and confirm the payment before the plan starts.'}{d.request.decisionNote ? ` ${d.request.decisionNote}` : ''}</span>
              </div>
            )}

            {d.options.filter(p => p.id !== d.current?.id).length > 0 && (
              <div>
                <h2 className="cd-section-title">{d.current ? 'Other plans' : 'Available plans'}</h2>
                <div className="cd-grid auto">
                  {d.options.filter(p => p.id !== d.current?.id).map(p => {
                    const isCurrent = d.current?.id === p.id;
                    const higher = d.current ? p.monthlyPrice > d.current.price : false;
                    return (
                      <Card key={p.id}>
                        <div className="cd-between"><h3 style={{ fontSize: 19 }}>{p.name}</h3>{isCurrent ? <Badge tone="success">Current</Badge> : null}</div>
                        <p className="cd-big" style={{ fontSize: 26, marginTop: 8 }}>{inr(p.monthlyPrice)}<span className="cd-small cd-muted" style={{ fontFamily: 'var(--font-body)', fontWeight: 500 }}> / month</span></p>
                        {p.description ? <p className="cd-small cd-muted" style={{ marginTop: 6 }}>{p.description}</p> : null}
                        <div className="cd-stack" style={{ gap: 8, marginTop: 12 }}>{p.features.map(f => <div className="cd-feature" key={f}><Check size={16} /><span>{f}</span></div>)}
                          {p.services.map(s => <div className="cd-feature" key={s.code}><Check size={16} /><span>{s.name}</span></div>)}</div>
                        {!isCurrent && <Button style={{ marginTop: 14, width: '100%' }} variant={higher ? 'primary' : 'outline'} disabled={!!d.request} onClick={() => setChoose(p)}>
                          {!d.current ? 'Select plan' : higher ? 'Request upgrade' : 'Request switch'}</Button>}
                      </Card>
                    );
                  })}
                </div>
                {d.request && <p className="cd-small cd-muted" style={{ marginTop: 10 }}>You can send another request once the current one is finished.</p>}
              </div>
            )}

            <Card>
              <h2 className="cd-section-title">Plan history</h2>
              {d.history.length === 0 ? <EmptyState title="No plan history yet" text="Plans you have had will be listed here." /> : (
                <table className="cd-table stack">
                  <thead><tr><th>Plan</th><th>Started</th><th>Ended</th><th>Price</th><th>Status</th></tr></thead>
                  <tbody>{d.history.map((h, i) => (
                    <tr key={i}><td data-label="Plan" style={{ fontWeight: 600 }}>{h.name}</td><td data-label="Started">{fmtDate(h.startedAt)}</td><td data-label="Ended">{h.endedAt ? fmtDate(h.endedAt) : '-'}</td>
                      <td data-label="Price">{inr(h.price)} / month</td><td data-label="Status"><Badge tone={h.status === 'ACTIVE' ? 'success' : 'neutral'}>{h.status === 'ACTIVE' ? 'Active' : 'Ended'}</Badge></td></tr>))}</tbody>
                </table>
              )}
            </Card>
          </div>
        )}
      </Query>
      {choose && <RequestPlan plan={choose} hasCurrent={!!q.data?.current} onClose={() => setChoose(null)} onDone={m => { setChoose(null); setNotice(m); q.reload(); }} />}
    </>
  );
};

const RequestPlan: React.FC<{ plan: MonthlyPlan; hasCurrent: boolean; onClose: () => void; onDone: (m: string) => void }> = ({ plan, hasCurrent, onClose, onDone }) => {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async () => {
    setBusy(true); setError('');
    try { await clientApi.requestPlan(plan.id, note.trim()); onDone(`Your request for ${plan.name} has been sent. It becomes active after Accounts verifies it and your payment is confirmed.`); }
    catch (e) { setError(errorMessage(e)); setBusy(false); }
  };
  return (
    <Modal title={`${hasCurrent ? 'Change to' : 'Select'} ${plan.name}`} onClose={onClose}>
      <div className="cd-stack">
        <p><b>{inr(plan.monthlyPrice)}</b> per month</p>
        <div className="cd-banner info"><Info size={18} style={{ flexShrink: 0 }} /><span>Nothing changes right away and you are not charged by sending this request. Accounts verifies it and confirms your payment first. Your current plan stays active until then.</span></div>
        <Field label="Note for our team (optional)" htmlFor="cd-pnote"><textarea id="cd-pnote" className="cd-textarea" maxLength={1000} value={note} onChange={e => setNote(e.target.value)} /></Field>
        {error && <div className="cd-banner danger" role="alert">{error}</div>}
        <div className="cd-row" style={{ justifyContent: 'flex-end' }}><Button variant="outline" onClick={onClose}>Cancel</Button><Button loading={busy} onClick={submit}>Send request</Button></div>
      </div>
    </Modal>
  );
};

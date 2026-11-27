import React, { useCallback, useEffect, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import type { ClientNotification } from '../../shared/contracts';
import { clientApi } from './api';
import { errorMessage } from '../lib/api/client';
import { notificationTarget, useShell } from './shell';
import { Button, Card, ClientPaged, EmptyState, ErrorState, LoadingBlock, PageHeader, fmtDateTime } from './ui';

const PAGE = 20;

export const Notifications: React.FC = () => {
  const { go, refreshUnread } = useShell();
  const [items, setItems] = useState<ClientNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await clientApi.notifications(PAGE, 0); setItems(r.items); setUnread(r.unread); setTotal(r.total); }
    catch (e) { setError(errorMessage(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const loadMore = async () => {
    setMore(true);
    try { const r = await clientApi.notifications(PAGE, items.length); setItems(prev => [...prev, ...r.items.filter(n => !prev.some(p => p.id === n.id))]); setUnread(r.unread); setTotal(r.total); }
    catch (e) { setError(errorMessage(e)); }
    finally { setMore(false); }
  };

  const markRead = async (ids?: string[]) => {
    setBusy(true);
    try {
      await clientApi.markRead(ids);
      const now = new Date().toISOString();
      setItems(prev => prev.map(n => (!ids || ids.includes(n.id)) && !n.readAt ? { ...n, readAt: now } : n));
      setUnread(u => ids ? Math.max(0, u - items.filter(n => ids.includes(n.id) && !n.readAt).length) : 0);
      refreshUnread();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  };

  const open = async (n: ClientNotification) => {
    if (!n.readAt) await markRead([n.id]);
    go(notificationTarget(n));
  };

  return (
    <>
      <PageHeader title="Notification Center" subtitle="Updates about your invoices, services, plan and tickets."
        action={unread > 0 ? <Button variant="outline" small loading={busy} onClick={() => markRead()}><CheckCheck size={16} /> Mark all as read</Button> : undefined} />
      {loading && !items.length ? <LoadingBlock rows={4} /> : error && !items.length ? <Card><ErrorState message={error} onRetry={load} /></Card> : items.length === 0 ? (
        <Card><EmptyState icon={<Bell size={24} />} title="No notifications yet" text="When something happens with your account (a new invoice, a payment, a ticket reply), you will see it here." /></Card>
      ) : (
        <div className="cd-stack" style={{ gap: 10 }}>
          {error && <div className="cd-banner danger" role="alert">{error}</div>}
          <ClientPaged items={items}>{rows => rows.map(n => (
            <Card key={n.id} small className={n.readAt ? '' : 'cd-unread'} onClick={() => void open(n)}>
              <div className="cd-between" style={{ alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontWeight: n.readAt ? 600 : 800 }}>{n.title}</p>
                  {n.body ? <p className="cd-small cd-muted" style={{ marginTop: 2 }}>{n.body}</p> : null}
                  <p className="cd-small cd-muted" style={{ marginTop: 6 }}>{fmtDateTime(n.createdAt)}</p>
                </div>
                {!n.readAt && <button className="cd-link" onClick={e => { e.stopPropagation(); void markRead([n.id]); }} style={{ flexShrink: 0 }}>Mark read</button>}
              </div>
            </Card>
          ))}</ClientPaged>
          {items.length < total && <div style={{ textAlign: 'center' }}><Button variant="outline" loading={more} onClick={loadMore}>Show older notifications</Button></div>}
        </div>
      )}
    </>
  );
};

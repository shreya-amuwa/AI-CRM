import React, { useCallback, useEffect, useState } from 'react';
import { CalendarOff, Sparkles, X } from 'lucide-react';
import type { ClientAnnouncement } from '../../shared/contracts';
import { clientApi } from './api';
import { dashboardPath } from './shell';
import { Button, Modal } from './ui';

/**
 * Notices from the Amuwa team: "office closed" days (a banner at the top of every page) and new services
 * (a pop-up that opens the service in Explore Services). Loaded when the dashboard opens and when the tab
 * comes back into view - no timer. Dismissing is remembered for this client, per occurrence.
 */
export function useAnnouncements(enabled: boolean) {
  const [items, setItems] = useState<ClientAnnouncement[]>([]);
  const load = useCallback(() => {
    clientApi.announcements().then(setItems, () => { /* notices are a convenience; the pages show their own errors */ });
  }, []);
  useEffect(() => {
    if (!enabled) return;
    load();
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, load]);
  const dismiss = useCallback((a: ClientAnnouncement) => {
    setItems(cur => cur.filter(x => !(x.id === a.id && x.occurrence === a.occurrence)));
    void clientApi.dismissAnnouncement(a.id, a.occurrence).catch(() => load());
  }, [load]);
  return { items, dismiss };
}

const longDay = (v: string) => new Date(`${v}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

export const NoticeBanners: React.FC<{ items: ClientAnnouncement[]; onDismiss: (a: ClientAnnouncement) => void }> = ({ items, onDismiss }) => {
  const closures = items.filter(a => a.kind === 'OFFICE_CLOSED' && a.eventDate);
  if (closures.length === 0) return null;
  return (
    <div className="cd-notices" aria-label="Notices from Amuwa">
      {closures.map(a => {
        const today = a.daysAway === 0;
        const range = a.eventEnd && a.eventEnd !== a.eventDate ? `${longDay(a.eventDate!)} to ${longDay(a.eventEnd)}` : longDay(a.eventDate!);
        return (
          <div key={`${a.id}-${a.occurrence}`} className={`cd-notice ${today ? 'today' : ''}`} role="status">
            <span className="ic"><CalendarOff size={20} aria-hidden /></span>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontWeight: 700 }}>{a.title}</p>
              <p className="cd-small" style={{ marginTop: 2 }}>
                {today ? 'Our office is closed today.' : a.daysAway === 1 ? 'Our office is closed tomorrow.' : `Our office will be closed in ${a.daysAway} days.`} {range}
              </p>
              {a.body ? <p className="cd-small" style={{ marginTop: 4 }}>{a.body}</p> : null}
            </div>
            <button className="x" onClick={() => onDismiss(a)} aria-label={`Dismiss: ${a.title}`}><X size={16} /></button>
          </div>
        );
      })}
    </div>
  );
};

/** The first new service the client has not seen yet. "Know more" opens it in Explore Services. */
export const NewServicePopup: React.FC<{ items: ClientAnnouncement[]; onDismiss: (a: ClientAnnouncement) => void; go: (to: string) => void }> = ({ items, onDismiss, go }) => {
  const a = items.find(x => x.kind === 'NEW_SERVICE' && x.serviceCode);
  if (!a) return null;
  const open = () => { onDismiss(a); go(`${dashboardPath('explore')}?service=${encodeURIComponent(a.serviceCode!)}`); };
  return (
    <Modal title="Something new from Amuwa" onClose={() => onDismiss(a)}>
      <div className="cd-popup">
        <span className="art"><Sparkles size={34} aria-hidden /></span>
        <span className="badge-new">NEW SERVICE</span>
        <h3 style={{ fontSize: 22 }}>{a.serviceName ?? a.title}</h3>
        <p className="cd-muted" style={{ maxWidth: 420 }}>{a.body || a.serviceDescription || 'We have started a new service. Open it to see what it includes.'}</p>
        <div className="cd-row" style={{ marginTop: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <Button onClick={open}>Know more</Button>
          <Button variant="outline" onClick={() => onDismiss(a)}>Maybe later</Button>
        </div>
      </div>
    </Modal>
  );
};

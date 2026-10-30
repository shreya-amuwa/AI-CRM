import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMenu } from '../components/layout/menuState';
import { BookOpen, Bell, CalendarClock, CalendarDays, CreditCard, FileText, FolderUp, LayoutDashboard, LifeBuoy, Lock, LogOut, Megaphone, Menu, MessageCircle, Milestone, Package, Search, Sparkles, X } from 'lucide-react';
import { DOCUMENTATION_ROUTE } from '../lib/documentation';
import './client.css';
import { clientApi } from './api';
import { chatApi } from '../lib/chat/api';
import { useChatUnread } from '../lib/chat/useChatUnread';
import { ClientAuthProvider, useClientAuth } from './auth';
import { useClientLive, useLoad, usePath } from './hooks';
import { Login } from './Login';
import { SetPassword } from './SetPassword';
import { Campaigns } from './Campaigns';
import { NewServicePopup, NoticeBanners, useAnnouncements } from './Announcements';
import { Overview } from './Overview';
import { MyServices } from './MyServices';
import { ExploreServices } from './ExploreServices';
import { MonthlyPlans } from './MonthlyPlans';
import { Invoices } from './Invoices';
import { Calendar } from './Calendar';
import { Documents } from './Documents';
import { Tickets } from './Tickets';
import { Chat } from './Chat';
import { Journey } from './Journey';
import { MySubscription } from './MySubscription';
import { Notifications } from './Notifications';
import { Docs } from './Docs';
import { Button, Card, EmptyState, LoadingBlock, initials } from './ui';
import { ShellCtx, dashboardPath, sectionState, type SectionSlug } from './shell';

/** Sidebar, in the order the product owner asked for. */
export const SECTIONS = [
  { slug: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { slug: 'journey', label: 'Onboarding Journey', Icon: Milestone },
  { slug: 'services', label: 'My Services', Icon: Package },
  { slug: 'subscription', label: 'My Subscription', Icon: CalendarClock },
  { slug: 'campaigns', label: 'Campaigns', Icon: Megaphone },
  { slug: 'explore', label: 'Explore Services', Icon: Search },
  { slug: 'plans', label: 'Monthly Plans', Icon: Sparkles },
  { slug: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { slug: 'documents', label: 'Documents', Icon: FolderUp },
  { slug: 'invoices', label: 'Invoices', Icon: FileText },
  { slug: 'tickets', label: 'Tickets', Icon: LifeBuoy },
  { slug: 'chat', label: 'Chat', Icon: MessageCircle },
  { slug: 'notifications', label: 'Notification Center', Icon: Bell },
  { slug: 'docs', label: 'Client Manual', Icon: BookOpen }
] as const;

/** The sidebar groups from the Amuwa Connect design; every section appears exactly once. */
const NAV_GROUPS: { label?: string; slugs: SectionSlug[] }[] = [
  { slugs: ['overview', 'journey'] },
  { label: 'Your account', slugs: ['services', 'subscription', 'plans', 'invoices', 'documents'] },
  { label: 'Activity', slugs: ['campaigns', 'calendar', 'tickets', 'chat', 'notifications'] },
  { label: 'Discover & Help', slugs: ['explore', 'docs'] }
];
/** Phone bottom tab bar: the five places clients use most; while onboarding, the places that are open to them (the drawer lists everything). */
const TABS: SectionSlug[] = ['overview', 'services', 'tickets', 'campaigns', 'chat'];
const ONBOARDING_TABS: SectionSlug[] = ['overview', 'journey', 'documents', 'chat', 'notifications'];
const TAB_LABEL: Partial<Record<SectionSlug, string>> = { overview: 'Home', journey: 'Journey', documents: 'Documents', notifications: 'Updates', services: 'Services', tickets: 'Tickets', campaigns: 'Campaigns', chat: 'Live chat' };

const Inner: React.FC = () => {
  const { status, me, signOut, refreshMe } = useClientAuth();
  const [path, go] = usePath();
  const [menu, setMenu] = useState(false);
  const { open: nav, collapsed, toggle: toggleNav, close: closeNav } = useMenu();
  const [unread, setUnread] = useState(0);
  const [find, setFind] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [lockNote, setLockNote] = useState<string | null>(null);
  // while a temporary password is in force the server refuses everything but choosing a new one, so nothing else is asked
  const active = status === 'ready' && !me?.mustChangePassword;
  const notices = useAnnouncements(active);
  const chat = useChatUnread(chatApi.clientUnread, active);

  // The onboarding journey: the stage, and which sections are open. The server decides; this reloads when something changes
  // (a new notification, a return to the tab, a change of page) so a section opens as soon as it may.
  const journey = useLoad(() => (status === 'ready' ? clientApi.journey() : Promise.reject(new Error('Not signed in'))), [status]);
  const reloadJourney = journey.reload;
  useClientLive(reloadJourney, undefined, status === 'ready');
  const journeyRef = useRef(reloadJourney);
  journeyRef.current = reloadJourney;

  const refreshUnread = useCallback(() => {
    clientApi.notifications(1, 0).then(n => setUnread(n.unread), () => { /* the bell is a convenience; pages show their own errors */ });
  }, []);

  // /client, /client/login, and /client/docs lead to the right place.
  useEffect(() => {
    if (status === 'loading' || path === '/client/set-password') return;
    const onLogin = path === '/client/login' || path === '/client';
    const isDocs = path === '/client/docs' || path.startsWith('/client/docs/');
    if (status === 'signedOut' && path !== '/client/login') go('/client/login', true);
    else if (status === 'ready' && (onLogin || (!path.startsWith('/client/dashboard') && !isDocs))) go(dashboardPath('overview'), true);
  }, [status, path, go]);

  useEffect(() => {
    if (!active) return;
    // No timer: the bell is read when the dashboard opens and when the tab comes back into view.
    refreshUnread();
    const onVisible = () => document.visibilityState === 'visible' && refreshUnread();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [active, refreshUnread]);

  useEffect(() => { closeNav(); setMenu(false); setLockNote(null); }, [path]);
  useEffect(() => { if (status === 'ready') journeyRef.current(); }, [path, status]);
  useEffect(() => {
    if (!lockNote) return;
    const t = setTimeout(() => setLockNote(null), 6000);
    return () => clearTimeout(t);
  }, [lockNote]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  // opened from the set-password e-mail: works signed in (the link) or not (expired link)
  if (path === '/client/set-password') return <div className="cd"><SetPassword /></div>;
  if (status === 'loading') return <div className="cd" style={{ padding: 24 }}><LoadingBlock rows={2} /></div>;
  if (status === 'signedOut') return <div className="cd"><Login onDone={() => go(dashboardPath('overview'), true)} /></div>;
  if (!me) return null;
  if (me.mustChangePassword) return <div className="cd"><SetPassword forced onChanged={() => { void refreshMe(); }} /></div>;

  const isDirectDocs = path === '/client/docs' || path.startsWith('/client/docs/');
  const parts = isDirectDocs ? ['docs'] : path.replace('/client/dashboard/', '').split('/');
  const slug = (isDirectDocs ? 'docs' : (SECTIONS.find(s => s.slug === parts[0])?.slug ?? 'overview')) as SectionSlug;
  const sub = isDirectDocs ? path.replace('/client/docs', '').replace(/^\//, '') : parts.slice(1).join('/');
  const to = (p: string) => { closeNav(); go(p); };

  const sectionOf = (s: string) => SECTIONS.find(x => x.slug === s)!;
  const matches = find.trim() ? SECTIONS.filter(x => x.label.toLowerCase().includes(find.trim().toLowerCase())) : [];
  const badgeFor = (s: string) => (s === 'chat' ? chat.summary.total : s === 'notifications' ? unread : 0);

  const gate = sectionState(journey.data, slug, journey.loading);
  const page = (() => {
    // a closed section is never rendered, so it asks the server for nothing (the server would refuse it anyway)
    if (!gate.enabled) {
      return gate.pending
        ? <LoadingBlock rows={2} />
        : <LockedSection label={sectionOf(slug).label} reason={gate.reason} onJourney={() => to(dashboardPath('journey'))} />;
    }
    switch (slug) {
      case 'journey': return <Journey />;
      case 'services': return <MyServices />;
      case 'subscription': return <MySubscription />;
      case 'campaigns': return <Campaigns />;
      case 'explore': return <ExploreServices />;
      case 'plans': return <MonthlyPlans />;
      case 'calendar': return <Calendar />;
      case 'documents': return <Documents />;
      case 'invoices': return <Invoices />;
      case 'tickets': return <Tickets />;
      case 'chat': return <Chat />;
      case 'notifications': return <Notifications />;
      case 'docs': return <Docs />;
      default: return <Overview />;
    }
  })();
  const tabs = journey.data && !journey.data.completed ? ONBOARDING_TABS : TABS;

  return (
    <ShellCtx.Provider value={{ go: to, unread, refreshUnread, chatUnread: chat.summary.total, refreshChatUnread: chat.refresh, sub, journey }}>
      <div className="cd">
        <div className={`cd-shell ${collapsed ? 'cd-collapsed' : ''}`}>
          <div className={`cd-scrim ${nav ? 'open' : ''}`} onClick={closeNav} />
          <aside id="cd-sidebar" className={`cd-side ${nav ? 'open' : ''}`} aria-label="Main navigation">
            <div className="cd-brand"><span className="cd-brand-tile"><img src="/amuwa-logo.png" alt="" /></span><span><b>Amuwa</b><small>Client dashboard</small></span><button className="cd-side-toggle" onClick={toggleNav} aria-label="Collapse menu" aria-controls="cd-sidebar"><Menu size={20} className="cd-only-desktop" /><X size={18} className="cd-only-mobile" /></button></div>
            <nav className="cd-nav">
              {NAV_GROUPS.map((g, i) => (
                <div className="cd-nav-group" key={g.label ?? i}>
                  {g.label ? <p className="cd-nav-label">{g.label}</p> : null}
                  {g.slugs.map(s => {
                    const { label, Icon } = sectionOf(s);
                    const n = badgeFor(s);
                    const st = sectionState(journey.data, s, journey.loading);
                    if (!st.enabled && !st.pending) {
                      // visible but closed: it explains itself and goes nowhere (and a typed address shows the same explanation)
                      return (
                        <button key={s} className="cd-nav-item locked" aria-disabled="true" title={st.reason ?? undefined}
                          onClick={() => setLockNote(`${label}: ${st.reason ?? 'not available yet.'}`)}>
                          <Icon size={19} aria-hidden />
                          <span className="lbl">{label}<small>{st.reason}</small></span>
                          <Lock size={14} aria-hidden className="lk" />
                        </button>
                      );
                    }
                    return (
                      <button key={s} className="cd-nav-item" aria-current={slug === s ? 'page' : undefined} onClick={() => to(dashboardPath(s))}>
                        <Icon size={19} aria-hidden />
                        <span>{label}</span>
                        {n > 0 ? <span className="cd-nav-count" aria-label={`${n} unread`}>{n > 99 ? '99+' : n}</span> : null}
                      </button>
                    );
                  })}
                </div>
              ))}
            </nav>
            <div className="cd-help">
              <b>Need a hand?</b>
              <p>Our team replies on your tickets and in live chat.</p>
              <button className="cd-btn gold sm" onClick={() => to(dashboardPath('tickets'))}>Raise a ticket</button>
            </div>
            <div className="cd-side-foot">
              <button type="button" className="cd-nav-item cd-doc-link" onClick={() => to('/client/docs')} style={{ border: 'none', background: 'transparent', textAlign: 'left', width: '100%', cursor: 'pointer' }} aria-label="Open Client Manual">
                <BookOpen size={19} aria-hidden /> <span>Client Manual</span>
              </button>
            </div>
          </aside>

          <div className="cd-main">
            <header className="cd-top">
              <button className="cd-bell cd-burger" onClick={toggleNav} aria-label="Toggle menu" aria-expanded={nav || !collapsed}><Menu size={20} /></button>
              <div className="cd-search">
                <label>
                  <Search size={17} aria-hidden />
                  <input value={find} placeholder="Jump to a page - services, invoices, tickets" aria-label="Jump to a page"
                    onChange={e => { setFind(e.target.value); setFindOpen(true); }} onFocus={() => setFindOpen(true)}
                    onBlur={() => setTimeout(() => setFindOpen(false), 120)}
                    onKeyDown={e => { if (e.key === 'Enter' && matches[0]) { setFind(''); const st = sectionState(journey.data, matches[0].slug, journey.loading); if (st.enabled) to(dashboardPath(matches[0].slug)); else setLockNote(`${matches[0].label}: ${st.reason ?? 'not available yet.'}`); } if (e.key === 'Escape') { setFind(''); setFindOpen(false); } }} />
                </label>
                {findOpen && find.trim() ? (
                  <ul role="listbox" aria-label="Pages">
                    {matches.length === 0 ? <li><button disabled>No page matches "{find.trim()}"</button></li> : matches.map(m => {
                      const st = sectionState(journey.data, m.slug, journey.loading);
                      const closed = !st.enabled && !st.pending;
                      return (
                        <li key={m.slug}>
                          <button role="option" aria-selected="false" aria-disabled={closed || undefined} title={closed ? st.reason ?? undefined : undefined} onMouseDown={e => e.preventDefault()}
                            onClick={() => { setFind(''); if (closed) setLockNote(`${m.label}: ${st.reason ?? 'not available yet.'}`); else to(dashboardPath(m.slug)); }}>
                            <m.Icon size={16} aria-hidden /> {m.label}{closed ? <small><Lock size={12} aria-hidden /> locked</small> : null}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
              <div className="grow" />
              <button className="cd-bell" onClick={() => to(dashboardPath('notifications'))} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
                <Bell size={20} />{unread > 0 ? <span className="count">{unread > 99 ? '99+' : unread}</span> : null}
              </button>
              <div ref={menuRef}>
                <button className="cd-account" onClick={() => setMenu(m => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Account menu">
                  <span className="cd-avatar">{initials(me.name)}</span>
                  <span className="who"><b>{me.name}</b><small>{me.businessName && me.businessName !== me.name ? me.businessName : greeting()}</small></span>
                </button>
                {menu && (
                  <div className="cd-menu" role="menu">
                    <div style={{ padding: '8px 12px 10px' }}>
                      <p style={{ fontWeight: 700 }}>{me.name}</p>
                      <p className="cd-small cd-muted cd-ellipsis">{me.loginEmail}</p>
                    </div>
                    <hr className="cd-divider" style={{ margin: '4px 0' }} />
                    <button role="menuitem" onClick={() => to(dashboardPath('tickets'))}><CreditCard size={16} /> Support</button>
                    <button role="menuitem" style={{ color: 'var(--danger)' }} onClick={() => { void signOut(); go('/client/login', true); }}><LogOut size={16} /> Log out</button>
                  </div>
                )}
              </div>
            </header>
            <main className={`cd-content ${slug === 'chat' ? 'cd-content-flush' : ''}`} id="cd-main">
              {lockNote ? <div className="cd-banner attention cd-lock-note" role="status" style={{ marginBottom: 16 }}><Lock size={18} aria-hidden style={{ flexShrink: 0 }} /><span>{lockNote}</span></div> : null}
              <NoticeBanners items={notices.items} onDismiss={notices.dismiss} />
              {page}
            </main>
            <NewServicePopup items={notices.items} onDismiss={notices.dismiss} go={to} />
          </div>
          <nav className="cd-tabbar" aria-label="Quick navigation" data-tabs={tabs.length}>
            {tabs.map(s => {
              const { Icon } = sectionOf(s);
              const n = badgeFor(s);
              return (
                <button key={s} aria-current={slug === s ? 'page' : undefined} onClick={() => to(dashboardPath(s))}>
                  <Icon size={20} aria-hidden />{TAB_LABEL[s]}
                  {n > 0 ? <span className="count" aria-label={`${n} unread`}>{n > 99 ? '99+' : n}</span> : null}
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </ShellCtx.Provider>
  );
};

/** What a closed section shows (also when its address is typed in): why it is closed, and where to look instead. No data is requested. */
const LockedSection: React.FC<{ label: string; reason: string | null; onJourney: () => void }> = ({ label, reason, onJourney }) => (
  <Card className="cd-locked-page">
    <EmptyState
      icon={<Lock size={24} />}
      title={`${label} is not open yet`}
      text={reason ?? 'It opens as your onboarding moves forward.'}
      action={<Button onClick={onJourney}><Milestone size={16} aria-hidden /> See your onboarding journey</Button>}
    />
  </Card>
);

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap';

export const ClientApp: React.FC = () => {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Amuwa';
    let link = document.getElementById('cd-fonts') as HTMLLinkElement | null;
    if (!link) { link = document.createElement('link'); link.id = 'cd-fonts'; link.rel = 'stylesheet'; link.href = FONTS; document.head.appendChild(link); }
    // the staff shell sets Tailwind colours on <body>; the client app paints its own page
    const prevBg = document.body.style.background;
    document.body.style.background = 'var(--cd-body-bg, #f3f6f4)';
    return () => { document.title = prevTitle; document.body.style.background = prevBg; };
  }, []);
  return <ClientAuthProvider><Inner /></ClientAuthProvider>;
};
export default ClientApp;

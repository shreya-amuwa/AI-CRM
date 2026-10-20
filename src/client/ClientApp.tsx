import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMenu } from '../components/layout/menuState';
import { Bell, CalendarDays, CreditCard, FileText, FolderUp, LayoutDashboard, LifeBuoy, LogOut, Megaphone, Menu, MessageCircle, Package, Search, Sparkles, X } from 'lucide-react';
import './client.css';
import { clientApi } from './api';
import { chatApi } from '../lib/chat/api';
import { useChatUnread } from '../lib/chat/useChatUnread';
import { ClientAuthProvider, useClientAuth } from './auth';
import { usePath } from './hooks';
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
import { Notifications } from './Notifications';
import { LoadingBlock, initials } from './ui';
import { ShellCtx, dashboardPath, type SectionSlug } from './shell';

/** Sidebar, in the order the product owner asked for. */
export const SECTIONS = [
  { slug: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { slug: 'services', label: 'My Services', Icon: Package },
  { slug: 'campaigns', label: 'Campaigns', Icon: Megaphone },
  { slug: 'explore', label: 'Explore Services', Icon: Search },
  { slug: 'plans', label: 'Monthly Plans', Icon: Sparkles },
  { slug: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { slug: 'documents', label: 'Documents', Icon: FolderUp },
  { slug: 'invoices', label: 'Invoices', Icon: FileText },
  { slug: 'tickets', label: 'Tickets', Icon: LifeBuoy },
  { slug: 'chat', label: 'Chat', Icon: MessageCircle },
  { slug: 'notifications', label: 'Notification Center', Icon: Bell }
] as const;

const Inner: React.FC = () => {
  const { status, me, signOut } = useClientAuth();
  const [path, go] = usePath();
  const [menu, setMenu] = useState(false);
  const { open: nav, collapsed, toggle: toggleNav, close: closeNav } = useMenu();
  const [unread, setUnread] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const notices = useAnnouncements(status === 'ready');
  const chat = useChatUnread(chatApi.clientUnread, status === 'ready');

  const refreshUnread = useCallback(() => {
    clientApi.notifications(1, 0).then(n => setUnread(n.unread), () => { /* the bell is a convenience; pages show their own errors */ });
  }, []);

  // /client and /client/login both lead to the right place.
  useEffect(() => {
    if (status === 'loading' || path === '/client/set-password') return;
    const onLogin = path === '/client/login' || path === '/client';
    if (status === 'signedOut' && path !== '/client/login') go('/client/login', true);
    else if (status === 'ready' && (onLogin || !path.startsWith('/client/dashboard'))) go(dashboardPath('overview'), true);
  }, [status, path, go]);

  useEffect(() => {
    if (status !== 'ready') return;
    // No timer: the bell is read when the dashboard opens and when the tab comes back into view.
    refreshUnread();
    const onVisible = () => document.visibilityState === 'visible' && refreshUnread();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [status, refreshUnread]);

  useEffect(() => { closeNav(); setMenu(false); }, [path]);
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

  const parts = path.replace('/client/dashboard/', '').split('/');
  const slug = (SECTIONS.find(s => s.slug === parts[0])?.slug ?? 'overview') as SectionSlug;
  const sub = parts.slice(1).join('/');
  const to = (p: string) => { closeNav(); go(p); };

  const page = (() => {
    switch (slug) {
      case 'services': return <MyServices />;
      case 'campaigns': return <Campaigns />;
      case 'explore': return <ExploreServices />;
      case 'plans': return <MonthlyPlans />;
      case 'calendar': return <Calendar />;
      case 'documents': return <Documents />;
      case 'invoices': return <Invoices />;
      case 'tickets': return <Tickets />;
      case 'chat': return <Chat />;
      case 'notifications': return <Notifications />;
      default: return <Overview />;
    }
  })();

  return (
    <ShellCtx.Provider value={{ go: to, unread, refreshUnread, chatUnread: chat.summary.total, refreshChatUnread: chat.refresh, sub }}>
      <div className="cd">
        <div className={`cd-shell ${collapsed ? 'cd-collapsed' : ''}`}>
          <div className={`cd-scrim ${nav ? 'open' : ''}`} onClick={closeNav} />
          <aside id="cd-sidebar" className={`cd-side ${nav ? 'open' : ''}`} aria-label="Main navigation">
            <div className="cd-brand"><span className="cd-brand-tile"><img src="/amuwa-logo.png" alt="" /></span><span><b>Amuwa</b><small>Client dashboard</small></span><button className="cd-side-toggle" onClick={toggleNav} aria-label="Collapse menu" aria-controls="cd-sidebar"><Menu size={20} className="cd-only-desktop" /><X size={18} className="cd-only-mobile" /></button></div>
            <nav className="cd-stack" style={{ gap: 2 }}>
              {SECTIONS.map(({ slug: s, label, Icon }) => (
                <button key={s} className="cd-nav-item" aria-current={slug === s ? 'page' : undefined} onClick={() => to(dashboardPath(s))}>
                  <Icon size={20} aria-hidden />
                  <span>{label}</span>
                  {s === 'chat' && chat.summary.total > 0 ? <span className="cd-nav-count" aria-label={`${chat.summary.total} unread messages`}>{chat.summary.total > 99 ? '99+' : chat.summary.total}</span> : null}
                  {s === 'notifications' && unread > 0 ? <span className="cd-nav-count" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span> : null}
                </button>
              ))}
            </nav>
          </aside>

          <div className="cd-main">
            <header className="cd-top">
              <button className="cd-bell cd-burger" onClick={toggleNav} aria-label="Toggle menu" aria-expanded={nav || !collapsed}><Menu size={20} /></button>
              <div className="grow">
                <p className="cd-small cd-muted cd-ellipsis">{greeting()}, <b style={{ color: 'var(--text)' }}>{me.name}</b></p>
              </div>
              <button className="cd-bell" onClick={() => to(dashboardPath('notifications'))} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
                <Bell size={20} />{unread > 0 ? <span className="dot" /> : null}
              </button>
              <div ref={menuRef}>
                <button className="cd-account" onClick={() => setMenu(m => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Account menu">
                  <span className="cd-avatar">{initials(me.name)}</span>
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
            <main className="cd-content" id="cd-main">
              <NoticeBanners items={notices.items} onDismiss={notices.dismiss} />
              {page}
            </main>
            <NewServicePopup items={notices.items} onDismiss={notices.dismiss} go={to} />
          </div>
        </div>
      </div>
    </ShellCtx.Provider>
  );
};

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

const FONTS = 'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap';

export const ClientApp: React.FC = () => {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Amuwa';
    let link = document.getElementById('cd-fonts') as HTMLLinkElement | null;
    if (!link) { link = document.createElement('link'); link.id = 'cd-fonts'; link.rel = 'stylesheet'; link.href = FONTS; document.head.appendChild(link); }
    // the staff shell sets Tailwind colours on <body>; the client app paints its own page
    const prevBg = document.body.style.background;
    document.body.style.background = 'var(--cd-body-bg, #f2f0eb)';
    return () => { document.title = prevTitle; document.body.style.background = prevBg; };
  }, []);
  return <ClientAuthProvider><Inner /></ClientAuthProvider>;
};
export default ClientApp;

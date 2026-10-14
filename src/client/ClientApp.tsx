import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CreditCard, FileText, LayoutDashboard, LifeBuoy, LogOut, Menu, Package, Search, Sparkles } from 'lucide-react';
import './client.css';
import { clientApi } from './api';
import { ClientAuthProvider, useClientAuth } from './auth';
import { usePath } from './hooks';
import { Login } from './Login';
import { Overview } from './Overview';
import { MyServices } from './MyServices';
import { ExploreServices } from './ExploreServices';
import { MonthlyPlans } from './MonthlyPlans';
import { Invoices } from './Invoices';
import { Tickets } from './Tickets';
import { Notifications } from './Notifications';
import { LoadingBlock, initials } from './ui';
import { ShellCtx, dashboardPath, type SectionSlug } from './shell';

/** Sidebar, in the order the product owner asked for. */
export const SECTIONS = [
  { slug: 'overview', label: 'Overview', Icon: LayoutDashboard },
  { slug: 'services', label: 'My Services', Icon: Package },
  { slug: 'explore', label: 'Explore Services', Icon: Search },
  { slug: 'plans', label: 'Monthly Plans', Icon: Sparkles },
  { slug: 'invoices', label: 'Invoices', Icon: FileText },
  { slug: 'tickets', label: 'Tickets', Icon: LifeBuoy },
  { slug: 'notifications', label: 'Notification Center', Icon: Bell }
] as const;

const Inner: React.FC = () => {
  const { status, me, signOut } = useClientAuth();
  const [path, go] = usePath();
  const [menu, setMenu] = useState(false);
  const [nav, setNav] = useState(false);
  const [unread, setUnread] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);

  const refreshUnread = useCallback(() => {
    clientApi.notifications(1, 0).then(n => setUnread(n.unread), () => { /* the bell is a convenience; pages show their own errors */ });
  }, []);

  // /client and /client/login both lead to the right place.
  useEffect(() => {
    if (status === 'loading') return;
    const onLogin = path === '/client/login' || path === '/client';
    if (status === 'signedOut' && path !== '/client/login') go('/client/login', true);
    else if (status === 'ready' && (onLogin || !path.startsWith('/client/dashboard'))) go(dashboardPath('overview'), true);
  }, [status, path, go]);

  useEffect(() => {
    if (status !== 'ready') return;
    refreshUnread();
    const t = window.setInterval(refreshUnread, 60_000);
    return () => window.clearInterval(t);
  }, [status, refreshUnread]);

  useEffect(() => { setNav(false); setMenu(false); }, [path]);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  if (status === 'loading') return <div className="cd" style={{ padding: 24 }}><LoadingBlock rows={2} /></div>;
  if (status === 'signedOut') return <div className="cd"><Login onDone={() => go(dashboardPath('overview'), true)} /></div>;
  if (!me) return null;

  const parts = path.replace('/client/dashboard/', '').split('/');
  const slug = (SECTIONS.find(s => s.slug === parts[0])?.slug ?? 'overview') as SectionSlug;
  const sub = parts.slice(1).join('/');
  const to = (p: string) => go(p);

  const page = (() => {
    switch (slug) {
      case 'services': return <MyServices />;
      case 'explore': return <ExploreServices />;
      case 'plans': return <MonthlyPlans />;
      case 'invoices': return <Invoices />;
      case 'tickets': return <Tickets />;
      case 'notifications': return <Notifications />;
      default: return <Overview />;
    }
  })();

  return (
    <ShellCtx.Provider value={{ go: to, unread, refreshUnread, sub }}>
      <div className="cd">
        <div className="cd-shell">
          <div className={`cd-scrim ${nav ? 'open' : ''}`} onClick={() => setNav(false)} />
          <aside className={`cd-side ${nav ? 'open' : ''}`} aria-label="Main navigation">
            <div className="cd-brand"><img src="/amuwa-logo.png" alt="Amuwa" /><div><b>My Amuwa</b><small>Customer dashboard</small></div></div>
            <nav className="cd-stack" style={{ gap: 2 }}>
              {SECTIONS.map(({ slug: s, label, Icon }) => (
                <button key={s} className="cd-nav-item" aria-current={slug === s ? 'page' : undefined} onClick={() => to(dashboardPath(s))}>
                  <Icon size={20} aria-hidden />
                  <span>{label}</span>
                  {s === 'notifications' && unread > 0 ? <span className="cd-nav-count" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span> : null}
                </button>
              ))}
            </nav>
            <div style={{ marginTop: 'auto', padding: '14px 10px 0' }} className="cd-small cd-muted">Need help? Raise a ticket and our team will reply here.</div>
          </aside>

          <div className="cd-main">
            <header className="cd-top">
              <button className="cd-bell cd-burger" onClick={() => setNav(true)} aria-label="Open menu"><Menu size={20} /></button>
              <div className="grow">
                <p className="cd-small cd-muted">{greeting()}</p>
                <p className="cd-ellipsis" style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 18 }}>{me.businessName}</p>
              </div>
              <button className="cd-bell" onClick={() => to(dashboardPath('notifications'))} aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
                <Bell size={20} />{unread > 0 ? <span className="dot" /> : null}
              </button>
              <div ref={menuRef}>
                <button className="cd-account" onClick={() => setMenu(m => !m)} aria-haspopup="menu" aria-expanded={menu} aria-label="Account menu">
                  <span className="cd-avatar">{initials(me.businessName)}</span>
                </button>
                {menu && (
                  <div className="cd-menu" role="menu">
                    <div style={{ padding: '8px 12px 10px' }}>
                      <p style={{ fontWeight: 700 }}>{me.businessName}</p>
                      <p className="cd-small cd-muted cd-ellipsis">{me.loginEmail}</p>
                    </div>
                    <hr className="cd-divider" style={{ margin: '4px 0' }} />
                    <button role="menuitem" onClick={() => to(dashboardPath('tickets'))}><CreditCard size={16} /> Support</button>
                    <button role="menuitem" style={{ color: 'var(--danger)' }} onClick={() => { void signOut(); go('/client/login', true); }}><LogOut size={16} /> Log out</button>
                  </div>
                )}
              </div>
            </header>
            <main className="cd-content" id="cd-main">{page}</main>
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

const FONTS = 'https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@500;700&family=DM+Sans:wght@400;500;600;700;800&display=swap';

export const ClientApp: React.FC = () => {
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'My Amuwa';
    let link = document.getElementById('cd-fonts') as HTMLLinkElement | null;
    if (!link) { link = document.createElement('link'); link.id = 'cd-fonts'; link.rel = 'stylesheet'; link.href = FONTS; document.head.appendChild(link); }
    // the staff shell sets Tailwind colours on <body>; the client app paints its own page
    const prevBg = document.body.style.background;
    document.body.style.background = 'var(--cd-body-bg, #f5f3ee)';
    return () => { document.title = prevTitle; document.body.style.background = prevBg; };
  }, []);
  return <ClientAuthProvider><Inner /></ClientAuthProvider>;
};
export default ClientApp;

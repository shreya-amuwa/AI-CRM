import React from 'react';
import { HelpCircle, LogOut, Menu, X } from 'lucide-react';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { closeMenu, useMenu } from './menuState';

/**
 * The shared dashboard shell (the Department Head design handoff): a white sidebar with an Amuwa brand block,
 * grouped navigation with a tinted active item, a top bar with a menu button, search, actions and the signed-in
 * person, and a calm light page. Every dashboard builds its chrome from these pieces, so they all look alike,
 * while each keeps its own navigation items, labels and pages.
 *
 * Simple dashboards use <DashboardShell>. Dashboards with custom navigation (a pipeline sub-tree, department
 * sub-menus) use the smaller pieces: <SidebarFrame>, <SidebarBrand>, <NavButton>, <NavGroupLabel>, <TopBar>.
 */

export interface ShellNavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  /** A count of things waiting (a small amber pill, hidden when 0). */
  badge?: number;
  /** A plain count that is always shown, even when 0 (neutral pill). */
  count?: number;
}
export interface ShellNavGroup {
  label?: string;
  items: ShellNavItem[];
}

export const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase())
    .join('') || '?';

/** One navigation entry. */
export const NavButton: React.FC<{
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
  badge?: number;
  count?: number;
  children?: React.ReactNode;
}> = ({ label, icon: Icon, active, onClick, badge, count, children }) => (
  <button
    type="button"
    onClick={onClick}
    aria-current={active ? 'page' : undefined}
    className={`w-full flex items-center gap-[11px] px-2.5 py-2.5 rounded-[9px] text-sm text-left transition-colors ${
      active ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 font-medium hover:bg-slate-50 hover:text-slate-900'
    }`}
  >
    <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? '' : 'text-slate-500'}`} strokeWidth={1.9} aria-hidden="true" />
    <span className="flex-1 min-w-0 truncate">{label}</span>
    {count !== undefined && (
      <span className={`shrink-0 text-[11px] font-bold rounded-full px-2 py-0.5 ${active ? 'bg-white text-blue-700' : 'bg-slate-100 text-slate-600'}`}>{count}</span>
    )}
    {badge ? <span className="shrink-0 text-[11px] font-bold bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">{badge > 99 ? '99+' : badge}</span> : null}
    {children}
  </button>
);

export const NavGroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{children}</div>
);

export const SidebarBrand: React.FC<{ title: string; subtitle?: string; onClose?: () => void }> = ({ title, subtitle, onClose = closeMenu }) => (
  <div className="flex items-center gap-2.5 pl-2 pr-1">
    <AmuwaLogo size="sm" />
    <div className="flex-1 min-w-0 leading-tight">
      <span className="block text-base font-extrabold text-slate-900 truncate">{title}</span>
      {subtitle && <span className="block text-xs text-slate-500 truncate">{subtitle}</span>}
    </div>
    <button type="button" onClick={onClose} className="lg:hidden w-10 h-10 rounded-[9px] text-slate-600 hover:bg-slate-50 flex items-center justify-center" aria-label="Close menu">
      <X className="w-[18px] h-[18px]" aria-hidden="true" />
    </button>
  </div>
);

/** The sidebar: a drawer on small screens (opened by the hamburger), a sticky column from lg up that the hamburger can collapse. */
export const SidebarFrame: React.FC<{
  ariaLabel: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** Legacy props: the open state now lives in the shared menu store. */
  open?: boolean;
  onClose?: () => void;
}> = ({ ariaLabel, children, footer }) => {
  const { open, collapsed } = useMenu();
  return (
    <>
      {open && <div className="fixed inset-0 bg-slate-900/35 z-40 lg:hidden" onClick={closeMenu} aria-hidden="true" />}
      <aside
        id="app-sidebar"
        className={`fixed lg:sticky top-0 left-0 h-screen w-[264px] max-w-[85vw] bg-white border-r border-slate-200 z-50 flex flex-col p-3.5 pb-5 gap-5 overflow-y-auto overscroll-contain transition-transform ${
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full'
        } ${collapsed ? 'lg:hidden' : 'lg:translate-x-0'}`}
        aria-label={ariaLabel}
      >
        {children}
        {footer && <div className="mt-auto pt-3 border-t border-slate-100 flex flex-col gap-0.5">{footer}</div>}
      </aside>
    </>
  );
};

export const SignOutButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button type="button" onClick={onClick} className="flex items-center gap-[11px] px-2.5 py-2.5 rounded-[9px] text-sm font-semibold text-rose-700 hover:bg-rose-50 text-left">
    <LogOut className="w-[18px] h-[18px]" strokeWidth={1.9} aria-hidden="true" /> Sign out
  </button>
);

export const HelpLink: React.FC = () => (
  <a href="mailto:support@amuwa.com" className="flex items-center gap-[11px] px-2.5 py-2.5 rounded-[9px] text-sm text-slate-700 hover:bg-slate-50">
    <HelpCircle className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.9} aria-hidden="true" /> Need help?
  </a>
);

/** The signed-in person: initials, name and role. */
export const UserChip: React.FC<{ name: string; role: string }> = ({ name, role }) => (
  <div className="flex items-center gap-2.5 pl-2.5 ml-1">
    <div className="w-[38px] h-[38px] rounded-full bg-blue-50 text-blue-700 font-extrabold text-[13px] flex items-center justify-center shrink-0" aria-hidden="true">
      {initialsOf(name)}
    </div>
    <div className="hidden sm:block leading-tight min-w-0">
      <div className="text-sm font-bold text-slate-900 truncate max-w-[10rem]">{name}</div>
      <div className="text-xs text-slate-500 truncate max-w-[10rem]">{role}</div>
    </div>
  </div>
);

/** The hamburger: opens the drawer on small screens, collapses / expands the sidebar on desktop. */
export const MenuButton: React.FC = () => {
  const { open, collapsed, toggle } = useMenu();
  return (
    <button
      type="button"
      onClick={toggle}
      className="shrink-0 w-11 h-11 rounded-xl border border-slate-200 bg-white text-slate-900 flex items-center justify-center hover:bg-slate-50"
      aria-label="Toggle menu"
      aria-controls="app-sidebar"
      aria-expanded={open || !collapsed}
    >
      <Menu className="w-5 h-5" aria-hidden="true" />
    </button>
  );
};

/** The top bar: hamburger, a left slot (search or a context line), actions and the person. */
export const TopBar: React.FC<{
  /** Legacy prop: the hamburger now toggles the shared menu itself. */
  onMenu?: () => void;
  left?: React.ReactNode;
  actions?: React.ReactNode;
  user?: { name: string; role: string };
}> = ({ left, actions, user }) => (
  <header className="bg-white border-b border-slate-200 px-3 sm:px-6 lg:px-8 py-3 flex items-center gap-2 sm:gap-3 sticky top-0 z-30">
    <MenuButton />
    {left && <div className="flex-1 min-w-0 flex items-center">{left}</div>}
    <div className={`${left ? '' : 'ml-auto'} flex items-center gap-1 sm:gap-2 shrink-0`}>
      {actions}
      {user && <UserChip name={user.name} role={user.role} />}
    </div>
  </header>
);

/** Page title block used at the top of every page: 26px title, one calm line below, actions on the right. */
export const PageTitle: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode }> = ({ title, subtitle, actions }) => (
  <div className="flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      <h1 className="text-[26px] leading-tight font-extrabold tracking-tight text-slate-900">{title}</h1>
      {subtitle && <p className="mt-1.5 text-[15px] text-slate-600 max-w-2xl">{subtitle}</p>}
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </div>
);

interface DashboardShellProps {
  /** Brand block: "Amuwa" + the department or role. */
  title: string;
  subtitle?: string;
  ariaLabel: string;
  groups: ShellNavGroup[];
  active: string;
  onSelect: (id: string) => void;
  user: { name: string; role: string };
  onSignOut: () => void;
  /** Top bar: left slot (search / context) and actions (leave, notifications). */
  topLeft?: React.ReactNode;
  topActions?: React.ReactNode;
  /** Extra sidebar footer rows (above Sign out). */
  footerExtra?: React.ReactNode;
  showHelp?: boolean;
  /** Let the page use the full width (wide tables); default keeps the calm 1240px column. */
  wide?: boolean;
  children: React.ReactNode;
}

export const DashboardShell: React.FC<DashboardShellProps> = ({
  title,
  subtitle,
  ariaLabel,
  groups,
  active,
  onSelect,
  user,
  onSignOut,
  topLeft,
  topActions,
  footerExtra,
  showHelp = false,
  wide = false,
  children
}) => {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex antialiased">
      <SidebarFrame
        ariaLabel={ariaLabel}
        footer={
          <>
            {footerExtra}
            {showHelp && <HelpLink />}
            <SignOutButton onClick={onSignOut} />
          </>
        }
      >
        <SidebarBrand title={title} subtitle={subtitle} />
        <nav className="flex flex-col gap-5" aria-label={`${ariaLabel} pages`}>
          {groups.map((g, i) => (
            <div key={g.label || i} className="flex flex-col gap-0.5">
              {g.label && <NavGroupLabel>{g.label}</NavGroupLabel>}
              {g.items.map(it => (
                <NavButton
                  key={it.id}
                  label={it.label}
                  icon={it.icon}
                  badge={it.badge}
                  count={it.count}
                  active={active === it.id}
                  onClick={() => {
                    onSelect(it.id);
                    closeMenu();
                  }}
                />
              ))}
            </div>
          ))}
        </nav>
      </SidebarFrame>
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar left={topLeft} actions={topActions} user={user} />
        <main className={`flex-1 min-w-0 w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-7 ${wide ? '' : 'max-w-[1304px]'}`}>{children}</main>
      </div>
    </div>
  );
};

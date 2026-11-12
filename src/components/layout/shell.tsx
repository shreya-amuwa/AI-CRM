import { ScopeBar } from '../scope/ScopeBar';
import React, { useEffect, useRef, useState } from 'react';
import { BookOpen, ChevronDown, Clock3, LogOut, Menu, X } from 'lucide-react';
import { DOCUMENTATION_ROUTE } from '../../lib/documentation';
import { AmuwaLogo } from '../common/AmuwaLogo';
import { closeMenu, toggleMenu, useMenu } from './menuState';

// The Attendance section (20261230000400) is part of every dashboard's side panel; loaded only when opened.
const AttendancePage = React.lazy(() => import('../attendance/AttendancePage'));
export const ATTENDANCE_NAV_ID = '__attendance';

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
  /** Sub-pages: the entry opens and closes a nested list (Leads → Lead List, Lead Assign). It is not a page itself. */
  children?: { id: string; label: string; badge?: number }[];
}
export interface ShellNavGroup {
  label?: string;
  items: ShellNavItem[];
  /** The section heading opens and closes the section (open by default; it stays open while one of its pages is open). Off unless set. */
  collapsible?: boolean;
}

/**
 * Sorts a flat list of menu entries into labelled sections (the way the Department Head's menu reads: Overview on top, then
 * Work / Customers / Team ...). `spec` names each section's entries by id, in the order to show them; an entry that no
 * section names goes into the last section, so a new page is never lost.
 */
export function groupNavItems<T extends { id: string }>(items: T[], spec: { label?: string; ids: string[]; collapsible?: boolean }[]): { label?: string; items: T[]; collapsible?: boolean }[] {
  const byId = new Map(items.map(i => [i.id, i]));
  const named = new Set(spec.flatMap(s => s.ids));
  const groups = spec.map(s => ({ label: s.label, collapsible: s.collapsible, items: s.ids.map(id => byId.get(id)).filter((i): i is T => Boolean(i)) }));
  const rest = items.filter(i => !named.has(i.id));
  if (rest.length && groups.length) groups[groups.length - 1].items.push(...rest);
  return groups.filter(g => g.items.length > 0);
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

/** A menu entry with a nested list of pages. Open while one of its pages is the active one; the button opens and closes it. */
export const NavParent: React.FC<{
  item: ShellNavItem;
  active: string;
  onSelect: (id: string) => void;
}> = ({ item, active, onSelect }) => {
  const kids = item.children ?? [];
  const hasActive = kids.some(k => k.id === active);
  const [open, setOpen] = useState(hasActive);
  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);
  const Icon = item.icon;
  const listId = `nav-sub-${item.id}`;
  return (
    <div className="flex flex-col gap-0.5">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={listId}
        className={`w-full flex items-center gap-[11px] px-2.5 py-2.5 rounded-[9px] text-sm text-left transition-colors ${
          hasActive ? 'text-blue-700 font-bold' : 'text-slate-700 font-medium hover:bg-slate-50 hover:text-slate-900'
        }`}
      >
        <Icon className={`w-[18px] h-[18px] shrink-0 ${hasActive ? '' : 'text-slate-500'}`} strokeWidth={1.9} aria-hidden="true" />
        <span className="flex-1 min-w-0 truncate">{item.label}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div id={listId} className="flex flex-col gap-0.5 pl-[29px]">
          {kids.map(k => {
            const on = active === k.id;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => onSelect(k.id)}
                aria-current={on ? 'page' : undefined}
                className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-[9px] text-[13.5px] text-left transition-colors ${
                  on ? 'bg-blue-50 text-blue-700 font-bold' : 'text-slate-700 font-medium hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="flex-1 min-w-0 leading-snug" title={k.label}>{k.label}</span>
                {k.badge ? <span className="shrink-0 text-[11px] font-bold bg-amber-50 text-amber-700 rounded-full px-2 py-0.5">{k.badge > 99 ? '99+' : k.badge}</span> : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const NavGroupLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500">{children}</div>
);

/** A section heading that opens and closes its section (same look as NavGroupLabel, plus a chevron). */
export const CollapsibleGroupLabel: React.FC<{ label: string; open: boolean; onToggle: () => void; controls: string }> = ({ label, open, onToggle, controls }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-expanded={open}
    aria-controls={controls}
    className="flex items-center justify-between px-2.5 pb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-500 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 rounded"
  >
    {label}
    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden="true" />
  </button>
);

/** The hamburger that lives in the sidebar, to the right of the brand: collapses the sidebar on desktop, closes the drawer on small screens. */
export const SidebarToggle: React.FC = () => (
  <button
    type="button"
    onClick={toggleMenu}
    className="shrink-0 w-10 h-10 rounded-[9px] text-slate-600 hover:bg-slate-100 flex items-center justify-center"
    aria-label="Collapse menu"
    aria-controls="app-sidebar"
  >
    <Menu className="w-5 h-5 hidden lg:block" aria-hidden="true" />
    <X className="w-[18px] h-[18px] lg:hidden" aria-hidden="true" />
  </button>
);

export const SidebarBrand: React.FC<{ title: string; subtitle?: string; onClose?: () => void }> = ({ title, subtitle }) => (
  <div className="flex items-center gap-2.5 pl-2 pr-1">
    <AmuwaLogo size="sm" />
    <div className="flex-1 min-w-0 leading-tight">
      <span className="block text-base font-extrabold text-slate-900 truncate">{title}</span>
      {subtitle && <span className="block text-xs text-slate-500 truncate">{subtitle}</span>}
    </div>
    <SidebarToggle />
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
  const ref = useRef<HTMLElement>(null);
  // an opened drawer takes keyboard focus, so Tab walks its links instead of the page behind the backdrop
  useEffect(() => {
    if (open) ref.current?.focus({ preventScroll: true });
  }, [open]);
  return (
    <>
      {open && <div className="fixed inset-0 bg-slate-900/35 z-40 lg:hidden" onClick={closeMenu} aria-hidden="true" />}
      <aside
        ref={ref}
        id="app-sidebar"
        tabIndex={-1}
        // closed on a phone or tablet it is off screen and out of the tab order; from lg up it is a sticky column (or hidden when collapsed)
        className={`fixed lg:sticky top-0 left-0 h-screen w-[264px] max-w-[85vw] shrink-0 bg-white border-r border-slate-200 z-50 flex flex-col p-3.5 pb-5 gap-5 overflow-y-auto overscroll-contain outline-none transition-[transform,visibility] ${
          open ? 'translate-x-0 shadow-xl' : '-translate-x-full max-lg:invisible'
        } ${collapsed ? 'lg:hidden' : 'lg:translate-x-0'}`}
        aria-label={ariaLabel}
      >
        {children}
        <div className="mt-auto pt-3 border-t border-slate-100 flex flex-col gap-0.5">
          <DocumentationLink />
          {footer}
        </div>
      </aside>
    </>
  );
};

/** "User Documentation": opens /documentation (the help pages) in a new tab, from every dashboard. */
export const DocumentationLink: React.FC = () => (
  <a
    href={DOCUMENTATION_ROUTE}
    target="_blank"
    rel="noopener noreferrer"
    className="flex items-center gap-[11px] px-2.5 py-2.5 rounded-[9px] text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900"
  >
    <BookOpen className="w-[18px] h-[18px] text-slate-500" strokeWidth={1.9} aria-hidden="true" /> User Documentation
  </a>
);

/**
 * Sign out: a compact icon button that sits in the top bar, right beside the profile avatar (every dashboard uses this one component;
 * the sidebar no longer has a Sign out row). It only calls the sign-out the dashboard passes in: the logout, the cleanup and the
 * redirect are unchanged.
 */
export const SignOutButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    type="button"
    onClick={onClick}
    title="Sign out"
    aria-label="Sign out"
    className="shrink-0 w-10 h-10 rounded-xl text-slate-500 hover:text-rose-700 hover:bg-rose-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 flex items-center justify-center transition-colors"
  >
    <LogOut className="w-[18px] h-[18px]" strokeWidth={1.9} aria-hidden="true" />
  </button>
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

/**
 * The top-bar hamburger: it appears only while the sidebar is out of sight (a phone or tablet, or a collapsed sidebar on
 * desktop) and brings it back. While the sidebar is open, its own hamburger (next to the brand) is the one to use.
 */
export const MenuButton: React.FC = () => {
  const { open, collapsed, toggle } = useMenu();
  return (
    <button
      type="button"
      onClick={toggle}
      className={`shrink-0 w-11 h-11 rounded-xl border border-slate-200 bg-white text-slate-900 flex items-center justify-center hover:bg-slate-50 ${collapsed ? '' : 'lg:hidden'}`}
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
  /** Shows the Sign out button beside the avatar. */
  onSignOut?: () => void;
}> = ({ left, actions, user, onSignOut }) => (
  <header className="bg-white border-b border-slate-200 px-3 sm:px-6 lg:px-8 py-3 flex items-center gap-2 sm:gap-3 sticky top-0 z-30">
    <MenuButton />
    {left && <div className="flex-1 min-w-0 flex items-center">{left}</div>}
    <div className={`${left ? '' : 'ml-auto'} flex items-center gap-1 sm:gap-2 shrink-0`}>
      {actions}
      {user && <UserChip name={user.name} role={user.role} />}
      {onSignOut && <SignOutButton onClick={onSignOut} />}
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
  /** Extra sidebar footer rows. */
  footerExtra?: React.ReactNode;
  /** Let the page use the full width (wide tables); default keeps the calm 1240px column. */
  wide?: boolean;
  /** No padding or width limit: for a page that fills the whole content area (the Chat page). */
  flush?: boolean;
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
  wide = false,
  flush = false,
  children
}) => {
  // only sections marked collapsible use this; the others are always open as before
  const [closedGroups, setClosedGroups] = useState<Set<string>>(() => new Set());
  // Attendance (Punch In / Out, lunch) is added to every dashboard here; choosing any other page hands the content back to the dashboard
  const [attendanceOpen, setAttendanceOpen] = useState(false);
  const shownActive = attendanceOpen ? ATTENDANCE_NAV_ID : active;
  // the dashboard opened a page by itself (a notification, a link): it takes the content area back
  useEffect(() => { setAttendanceOpen(false); }, [active]);
  const select = (id: string) => {
    if (id === ATTENDANCE_NAV_ID) { setAttendanceOpen(true); return; }
    setAttendanceOpen(false);
    onSelect(id);
  };
  // Attendance is the first entry of every dashboard's menu (marking the day is the first thing an employee does): it joins the
  // unlabelled top section (the dashboard entry), or sits in its own section above a menu that starts with a labelled one
  const attendanceItem: ShellNavItem = { id: ATTENDANCE_NAV_ID, label: 'Attendance', icon: Clock3 };
  const navGroups: ShellNavGroup[] = groups[0] && !groups[0].label
    ? [{ ...groups[0], items: [attendanceItem, ...groups[0].items] }, ...groups.slice(1)]
    : [{ items: [attendanceItem] }, ...groups];
  const toggleGroup = (label: string) => setClosedGroups(prev => {
    const next = new Set(prev);
    if (next.has(label)) next.delete(label); else next.add(label);
    return next;
  });
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex antialiased">
      <SidebarFrame
        ariaLabel={ariaLabel}
        footer={
          <>
            {footerExtra}
          </>
        }
      >
        <SidebarBrand title={title} subtitle={subtitle} />
        <nav className="flex flex-col gap-5" aria-label={`${ariaLabel} pages`}>
          {navGroups.map((g, i) => (
            <div key={g.label || i} className="flex flex-col gap-0.5">
              {g.label && (g.collapsible
                ? <CollapsibleGroupLabel label={g.label} open={!closedGroups.has(g.label) || g.items.some(it => it.id === shownActive)} onToggle={() => toggleGroup(g.label as string)} controls={`nav-group-${i}`} />
                : <NavGroupLabel>{g.label}</NavGroupLabel>)}
              {/* a closed section renders nothing (a CSS display class would override the hidden attribute) */}
              {!(g.collapsible && g.label && closedGroups.has(g.label) && !g.items.some(it => it.id === shownActive)) && (
              <div id={`nav-group-${i}`} className="flex flex-col gap-0.5">
              {g.items.map(it =>
                it.children?.length ? (
                  <NavParent
                    key={it.id}
                    item={it}
                    active={shownActive}
                    onSelect={id => {
                      select(id);
                      closeMenu();
                    }}
                  />
                ) : (
                <NavButton
                  key={it.id}
                  label={it.label}
                  icon={it.icon}
                  badge={it.badge}
                  count={it.count}
                  active={shownActive === it.id}
                  onClick={() => {
                    select(it.id);
                    closeMenu();
                  }}
                />
                )
              )}
              </div>
              )}
            </div>
          ))}
        </nav>
      </SidebarFrame>
      <div className="flex-1 min-w-0 flex flex-col">
        <TopBar left={topLeft} actions={topActions} user={user} onSignOut={onSignOut} />
        <ScopeBar />
        <main className={`flex-1 min-w-0 w-full ${flush ? '' : `px-4 sm:px-6 lg:px-8 py-5 sm:py-7 ${wide ? '' : 'max-w-[1304px]'}`}`}>{attendanceOpen ? <React.Suspense fallback={<div role="status" className="p-8 text-sm text-slate-500">Loading</div>}><AttendancePage /></React.Suspense> : children}</main>
      </div>
    </div>
  );
};

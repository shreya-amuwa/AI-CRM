import React, { useState } from 'react';
import { 
  Bell, Edit3, Send, CheckCheck, Trash2, Filter, Search, 
  AlertCircle, Megaphone, CheckCircle2, Building2, Users, 
  Headphones, TrendingUp, Sparkles, X, Clock, Lock, ShieldCheck
} from 'lucide-react';
import { useNotifications, AppNotification } from '../../context/NotificationContext';
import { useAuth } from '../../context/AuthContext';
import { Pager } from '../support-member/SupportParts';

const PAGE_SIZE = 10;

interface NotificationCenterPanelProps {
  subDept?: 'sales' | 'support' | 'education_training' | 'product_training' | null;
}

export const NotificationCenterPanel: React.FC<NotificationCenterPanelProps> = ({ subDept = null }) => {
  const { 
    notifications, 
    getNotificationsForUser, 
    sendNotification, 
    markAsRead, 
    markAllAsRead, 
    deleteNotification 
  } = useNotifications();

  const { user, activeDepartment, activeDepartmentId } = useAuth();

  // Never fall back to another department's key/name - if no department is
  // actually active, use safe, department-neutral placeholders instead.
  const currentDeptKey = subDept && activeDepartmentId
    ? `${activeDepartmentId}_${subDept}`
    : (activeDepartmentId || '__no_department__');

  const userDeptTitle = activeDepartment?.name
    ? (subDept ? `${activeDepartment.name} (${subDept.toUpperCase()})` : activeDepartment.name)
    : 'Department';

  // Get strictly private + broadcast notifications for current user
  const userNotifications = getNotificationsForUser(currentDeptKey, subDept || null);

  const [showComposeModal, setShowComposeModal] = useState(false);
  const [filterTarget, setFilterTarget] = useState<string>('all_filter');
  const [searchQuery, setSearchQuery] = useState('');

  // Compose Form state
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [targetKey, setTargetKey] = useState<AppNotification['targetKey']>('all');
  const [targetLabel, setTargetLabel] = useState('All Departments & Sub-Departments');
  const [priority, setPriority] = useState<AppNotification['priority']>('normal');

  const handleTargetChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value as AppNotification['targetKey'];
    setTargetKey(val);
    const selectedText = e.target.options[e.target.selectedIndex].text;
    setTargetLabel(selectedText);
  };

  const handleSendSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !message) return;

    const result = await sendNotification({
      title,
      message,
      senderName: user?.name || 'Administrator',
      senderDept: userDeptTitle,
      senderDeptKey: currentDeptKey,
      targetKey,
      targetLabel,
      priority
    });

    if (!result.ok) {
      alert(result.message);
      return;
    }
    setShowComposeModal(false);
    setTitle('');
    setMessage('');
    alert(result.message);
  };

  const filteredNotifications = userNotifications.filter(n => {
    const matchesTarget = 
      filterTarget === 'all_filter' ? true :
      filterTarget === 'sales' ? n.targetKey === 'sales' || n.targetKey.endsWith('_sales') :
      filterTarget === 'support' ? n.targetKey === 'support' || n.targetKey.endsWith('_support') :
      n.targetKey === filterTarget;

    const matchesSearch = 
      n.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      n.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      n.senderName.toLowerCase().includes(searchQuery.toLowerCase());

    return matchesTarget && matchesSearch;
  });

  const unreadCount = userNotifications.filter(n => !n.isRead).length;

  // Ten per page; searching or filtering starts again from the first page.
  const [page, setPage] = useState(1);
  React.useEffect(() => setPage(1), [filterTarget, searchQuery]);
  const lastPage = Math.max(1, Math.ceil(filteredNotifications.length / PAGE_SIZE));
  const shownPage = Math.min(page, lastPage);
  const pageItems = filteredNotifications.slice((shownPage - 1) * PAGE_SIZE, shownPage * PAGE_SIZE);

  return (
    <div className="space-y-6 animate-fade-in">
      
      {/* Top Banner & Action Header */}
      <div className="bg-white rounded-3xl p-6 sm:p-8 border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="p-4 rounded-2xl bg-amber-100 text-amber-800 border border-amber-200">
            <Bell className="w-7 h-7" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold font-heading text-slate-900">Notification Center</h2>
              <span className="px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-xs font-mono font-bold">
                {unreadCount} Unread
              </span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-mono font-bold flex items-center gap-1">
                <Lock className="w-3 h-3 text-emerald-600" />
                <span>Strict End-to-End Privacy Active</span>
              </span>
            </div>
            <p className="text-xs font-mono text-slate-500 mt-0.5">
              Current Session: <strong>{userDeptTitle}</strong> &bull; Only authorized dispatches are visible
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => markAllAsRead(currentDeptKey, subDept || null)}
            className="px-3.5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono text-xs font-bold flex items-center gap-1.5 border border-slate-200"
          >
            <CheckCheck className="w-4 h-4 text-emerald-600" />
            <span>Mark All Read</span>
          </button>

          {/* PENCIL CREATE MESSAGE BUTTON */}
          <button
            onClick={() => setShowComposeModal(true)}
            className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-mono text-xs font-bold flex items-center gap-2 shadow-md active:scale-95 transition-transform"
          >
            <Edit3 className="w-4 h-4" />
            <span>Create Message</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-4 rounded-2xl bg-slate-100 border border-slate-200">
        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto">
          <span className="text-xs font-mono font-bold text-slate-500 flex items-center gap-1 shrink-0">
            <Filter className="w-3.5 h-3.5" /> Filter:
          </span>
          {[
            { id: 'all_filter', label: 'All Authorized Messages' },
            { id: 'sales', label: 'Sales Dispatches' },
            { id: 'support', label: 'Support Dispatches' }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setFilterTarget(f.id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-bold transition-all shrink-0 ${
                filterTarget === f.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white text-slate-700 hover:bg-slate-200 border border-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
          <input
            type="text"
            placeholder="Search messages..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-white border border-slate-200 text-xs text-slate-900 focus:outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Messages List */}
      <div className="space-y-3">
        {filteredNotifications.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-3xl border border-slate-200 text-slate-400 space-y-2">
            <Lock className="w-10 h-10 mx-auto text-slate-300" />
            <p className="font-mono text-xs">No notifications dispatch for {userDeptTitle}.</p>
          </div>
        ) : (
          pageItems.map(n => (
            <div
              key={n.id}
              onClick={() => markAsRead(n.id)}
              className={`p-5 rounded-3xl border transition-all cursor-pointer space-y-3 ${
                !n.isRead
                  ? 'bg-white border-amber-300 shadow-md ring-2 ring-amber-400/20'
                  : 'bg-slate-50/70 border-slate-200 opacity-90'
              }`}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {!n.isRead && (
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                  )}
                  <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${
                    n.priority === 'urgent'
                      ? 'bg-rose-100 text-rose-800 border-rose-300'
                      : n.priority === 'announcement'
                      ? 'bg-purple-100 text-purple-800 border-purple-300'
                      : 'bg-blue-100 text-blue-800 border-blue-300'
                  }`}>
                    {n.priority}
                  </span>

                  <span className="px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-800 border border-slate-200 text-[10px] font-mono font-bold flex items-center gap-1">
                    <Lock className="w-3 h-3 text-slate-500" />
                    Target: {n.targetLabel}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-slate-400 text-xs font-mono">
                  <span className="flex items-center gap-1 text-[11px]">
                    <Clock className="w-3.5 h-3.5" />
                    {n.timestamp}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteNotification(n.id); }}
                    className="p-1 hover:text-rose-600 transition-colors"
                    title="Delete Notification"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div>
                <h4 className="text-base font-bold text-slate-900 font-heading">{n.title}</h4>
                <p className="text-xs text-slate-700 mt-1 leading-relaxed">{n.message}</p>
              </div>

              <div className="flex items-center justify-between pt-1 text-[11px] font-mono text-slate-500">
                <span>Sender: <strong className="text-slate-900">{n.senderName}</strong> ({n.senderDept})</span>
                {n.isRead && <span className="text-emerald-600 font-bold flex items-center gap-1"><CheckCheck className="w-3.5 h-3.5" /> Read</span>}
              </div>
            </div>
          ))
        )}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden empty:hidden">
          <Pager page={shownPage} pageSize={PAGE_SIZE} total={filteredNotifications.length} onPage={setPage} />
        </div>
      </div>

      {/* CREATE & BROADCAST MESSAGE MODAL WITH SPECIFIC SUB-DEPARTMENT TARGETS */}
      {showComposeModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-white rounded-3xl p-6 border border-slate-200 shadow-2xl animate-scale-up space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-blue-50 text-blue-600">
                  <Edit3 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold font-heading text-slate-900">Create &amp; Dispatch Private Message</h3>
                  <p className="text-[11px] font-mono text-slate-500">Only authorized target departments/sub-departments will receive this message.</p>
                </div>
              </div>
              <button onClick={() => setShowComposeModal(false)} className="p-1 text-slate-400 hover:text-slate-900">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSendSubmit} className="space-y-4 text-xs font-sans">
              <div>
                <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">
                  TARGET RECIPIENT DEPARTMENT / SUB-DEPARTMENT *
                </label>
                <select
                  value={targetKey}
                  onChange={handleTargetChange}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-900 font-bold"
                >
                  <optgroup label="🌐 Global & Group-Wide Targets">
                    <option value="all">🌐 All Departments &amp; All Sub-Departments (Broadcast)</option>
                    <option value="sales">💼 All Sales Sub-Departments (Sales Across All Units)</option>
                    <option value="support">🎧 All Support Sub-Departments (Support Across All Units)</option>
                    <option value="amuwa">🏢 Amuwa Corporate HQ</option>
                  </optgroup>

                  <optgroup label="📱 Whatsbox Unit">
                    <option value="whatsbox_sales">📱 Whatsbox - Sales Sub-Department</option>
                    <option value="whatsbox_support">📱 Whatsbox - Support Sub-Department</option>
                  </optgroup>

                  <optgroup label="🏬 Wabastore Unit">
                    <option value="wabastore_sales">🏬 Wabastore - Sales Sub-Department</option>
                    <option value="wabastore_support">🏬 Wabastore - Support Sub-Department</option>
                  </optgroup>

                  <optgroup label="📞 D Talk Corporation Unit">
                    <option value="dtalk_sales">📞 D Talk - Sales Sub-Department</option>
                    <option value="dtalk_support">📞 D Talk - Support Sub-Department</option>
                  </optgroup>

                  <optgroup label="🌳 Digitree Infotech Unit">
                    <option value="digitree_sales">🌳 Digitree - Sales Sub-Department</option>
                    <option value="digitree_support">🌳 Digitree - Support Sub-Department</option>
                  </optgroup>

                  <optgroup label="🏛️ M Pillar Corporation Unit">
                    <option value="mpillar_sales">🏛️ M Pillar - Sales Sub-Department</option>
                    <option value="mpillar_support">🏛️ M Pillar - Support Sub-Department</option>
                  </optgroup>
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">
                    PRIORITY LEVEL
                  </label>
                  <select
                    value={priority}
                    onChange={e => setPriority(e.target.value as AppNotification['priority'])}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs text-slate-900 font-bold"
                  >
                    <option value="normal">Normal</option>
                    <option value="urgent">Urgent / High Priority</option>
                    <option value="announcement">Announcement</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">
                    SENDER DEPT
                  </label>
                  <input
                    type="text"
                    disabled
                    value={userDeptTitle}
                    className="w-full p-2.5 bg-slate-200 border border-slate-300 rounded-xl font-mono text-slate-700 font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">
                  MESSAGE SUBJECT / TITLE *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Confidential Lead Allocation Update"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-900"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-700 font-mono uppercase mb-1">
                  MESSAGE CONTENT / INSTRUCTIONS *
                </label>
                <textarea
                  rows={4}
                  required
                  placeholder="Type your private message content to dispatch..."
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-2xl text-xs text-slate-900 focus:outline-none focus:bg-white"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowComposeModal(false)}
                  className="w-1/2 py-2.5 rounded-xl bg-slate-100 text-slate-700 font-mono font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="w-1/2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-mono font-bold flex items-center justify-center gap-1.5 shadow-md"
                >
                  <Send className="w-4 h-4" />
                  <span>Send Notification</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
};

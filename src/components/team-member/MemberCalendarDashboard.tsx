import React, { useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  Video,
  Phone,
  Plus,
  ChevronLeft,
  ChevronRight,
  Users,
  Trash2,
  X
} from 'lucide-react';
import { CalendarEvent } from '../../types/crm';
import { useTeamMemberStore } from '../../hooks/useTeamMemberStore';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** YYYY-MM-DD in the viewer's local time zone. */
function toDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatLongDate(key: string): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

/** "14:30" → "2:30 PM" */
function formatTime(value: string): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return value;
  const h = Number(match[1]);
  return `${h % 12 || 12}:${match[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

const STATUS_STYLES: Record<CalendarEvent['status'], string> = {
  confirmed: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-amber-50 text-amber-700',
  completed: 'bg-slate-100 text-slate-600'
};

export const MemberCalendarDashboard: React.FC = () => {
  const teamMemberStore = useTeamMemberStore();
  const events = teamMemberStore.getCalendarEvents();

  const todayKey = toDateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const emptyForm = (date: string) => ({
    title: '',
    customer: '',
    company: '',
    type: 'call' as CalendarEvent['type'],
    date,
    time: '11:00'
  });
  const [form, setForm] = useState(() => emptyForm(todayKey));

  const year = visibleMonth.getFullYear();
  const month = visibleMonth.getMonth();
  const leadingBlanks = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = visibleMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    events.forEach(ev => map.set(ev.date, [...(map.get(ev.date) || []), ev]));
    map.forEach(list => list.sort((a, b) => a.time.localeCompare(b.time)));
    return map;
  }, [events]);
  const agenda = eventsByDate.get(selectedDate) || [];

  const shiftMonth = (delta: number) => setVisibleMonth(new Date(year, month + delta, 1));

  const goToToday = () => {
    const now = new Date();
    setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(todayKey);
  };

  const openAdd = () => {
    setSaveError(null);
    setForm(emptyForm(selectedDate));
    setIsAddOpen(true);
  };

  const handleAddEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.customer.trim() || !form.date) return;
    setSaveError(null);
    try {
      await teamMemberStore.addCalendarEvent({
        title: form.title.trim(),
        customer: form.customer.trim(),
        company: form.company.trim() || undefined,
        type: form.type,
        date: form.date,
        time: form.time,
        status: 'confirmed'
      });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the event.');
      return;
    }
    const [y, m] = form.date.split('-').map(Number);
    setVisibleMonth(new Date(y, m - 1, 1));
    setSelectedDate(form.date);
    setIsAddOpen(false);
  };

  const handleDelete = async (id: string) => {
    setSaveError(null);
    try {
      await teamMemberStore.deleteCalendarEvent(id);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not delete the event.');
    }
  };

  const getEventIcon = (type: CalendarEvent['type']) => {
    switch (type) {
      case 'call':
        return <Phone className="w-3.5 h-3.5 text-blue-600" />;
      case 'demo':
        return <Video className="w-3.5 h-3.5 text-purple-600" />;
      case 'meeting':
        return <Users className="w-3.5 h-3.5 text-amber-600" />;
      case 'review':
      default:
        return <Clock className="w-3.5 h-3.5 text-emerald-600" />;
    }
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">
            Sales Calendar & Schedule
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Manage your daily agendas, product demonstrations, and customer consultation calls.
          </p>
        </div>

        <button
          type="button"
          onClick={openAdd}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Schedule Event</span>
        </button>
      </div>

      {saveError && !isAddOpen && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs">{saveError}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* MONTHLY CALENDAR GRID (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <h3 className="font-bold text-sm text-slate-900">{monthLabel}</h3>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={goToToday}
                className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 cursor-pointer"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => shiftMonth(-1)}
                aria-label="Previous month"
                className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => shiftMonth(1)}
                aria-label="Next month"
                className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-center text-xs pt-4 font-semibold text-slate-400 mb-2">
            {WEEKDAYS.map(d => (
              <div key={d}>{d}</div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-xs">
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <div key={`blank-${i}`} className="h-11" />
            ))}

            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
              const dateKey = toDateKey(new Date(year, month, day));
              const isSelected = selectedDate === dateKey;
              const isToday = todayKey === dateKey;
              const count = eventsByDate.get(dateKey)?.length || 0;
              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => setSelectedDate(dateKey)}
                  className={`h-11 rounded-xl flex flex-col items-center justify-center relative transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white font-bold shadow-xs'
                      : isToday
                        ? 'bg-blue-50 text-blue-700 font-bold ring-1 ring-blue-200'
                        : 'hover:bg-slate-100 text-slate-700 font-medium'
                  }`}
                >
                  <span>{day}</span>
                  {count > 0 && (
                    <span className={`w-1.5 h-1.5 rounded-full mt-0.5 ${isSelected ? 'bg-white' : 'bg-blue-500'}`} />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* AGENDA LIST (5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="font-bold text-xs font-heading text-slate-900">{formatLongDate(selectedDate)}</h3>
            {selectedDate === todayKey && <span className="text-[11px] text-blue-600 font-semibold">Today</span>}
          </div>

          <div className="space-y-3">
            {agenda.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No scheduled events for this date.</p>
            ) : (
              agenda.map(ev => (
                <div
                  key={ev.id}
                  className="p-3.5 rounded-xl border border-slate-200/70 hover:border-blue-400 bg-slate-50/50 hover:bg-white transition-all space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                        {getEventIcon(ev.type)}
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-bold text-xs text-slate-900 leading-tight truncate">{ev.title}</h4>
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                          {ev.customer}
                          {ev.company ? ` • ${ev.company}` : ''}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDelete(ev.id)}
                      aria-label="Delete event"
                      className="p-1 rounded-lg text-slate-300 hover:text-rose-600 hover:bg-rose-50 cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100 font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {formatTime(ev.time)}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold capitalize ${STATUS_STYLES[ev.status]}`}>
                      {ev.status}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* SCHEDULE EVENT MODAL */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-slate-100 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                  <CalendarIcon className="w-4 h-4" />
                </div>
                <h3 className="font-bold text-slate-900">Schedule Sales Event</h3>
              </div>
              <button onClick={() => setIsAddOpen(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddEvent} className="space-y-3.5 mt-4 text-xs">
              {saveError && (
                <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-700">{saveError}</div>
              )}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Event Title *</label>
                <input
                  type="text"
                  required
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Customer Name *</label>
                  <input
                    type="text"
                    required
                    value={form.customer}
                    onChange={e => setForm({ ...form, customer: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Company</label>
                  <input
                    type="text"
                    value={form.company}
                    onChange={e => setForm({ ...form, company: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-semibold mb-1">Type</label>
                <select
                  value={form.type}
                  onChange={e => setForm({ ...form, type: e.target.value as CalendarEvent['type'] })}
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                >
                  <option value="call">Call</option>
                  <option value="demo">Demo</option>
                  <option value="meeting">Meeting</option>
                  <option value="review">Review</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Date *</label>
                  <input
                    type="date"
                    required
                    value={form.date}
                    onChange={e => setForm({ ...form, date: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Time *</label>
                  <input
                    type="time"
                    required
                    value={form.time}
                    onChange={e => setForm({ ...form, time: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddOpen(false)}
                  className="px-4 py-2 border border-slate-200 rounded-xl text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow-xs"
                >
                  Save Schedule
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

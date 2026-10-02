import React, { useState } from 'react';
import {
  Calendar as CalendarIcon,
  Clock,
  Video,
  Phone,
  Plus,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Users,
  Building2,
  X
} from 'lucide-react';
import { CalendarEvent } from '../../types/crm';
import { teamMemberStore } from '../../services/teamMemberStore';

interface MemberCalendarDashboardProps {
  currentUserId: string;
}

export const MemberCalendarDashboard: React.FC<MemberCalendarDashboardProps> = ({ currentUserId }) => {
  const [events, setEvents] = useState<CalendarEvent[]>(() =>
    teamMemberStore.getCalendarEvents(currentUserId)
  );
  const [selectedDate, setSelectedDate] = useState('2026-09-30');
  const [isAddOpen, setIsAddOpen] = useState(false);

  const [form, setForm] = useState({
    title: '',
    customer: '',
    company: '',
    type: 'call' as CalendarEvent['type'],
    date: '2026-09-30',
    time: '11:00 AM'
  });

  const handleAddEvent = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title || !form.customer) return;

    teamMemberStore.addCalendarEvent({
      userId: currentUserId,
      title: form.title,
      customer: form.customer,
      company: form.company,
      type: form.type,
      date: form.date,
      time: form.time,
      status: 'confirmed'
    });

    setEvents(teamMemberStore.getCalendarEvents(currentUserId));
    setIsAddOpen(false);
    setForm({
      title: '',
      customer: '',
      company: '',
      type: 'call',
      date: '2026-09-30',
      time: '11:00 AM'
    });
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

  // Calendar dates for Sep 2026
  const daysInMonth = Array.from({ length: 30 }, (_, i) => i + 1);

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
          onClick={() => setIsAddOpen(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-xs font-bold hover:bg-blue-700 shadow-xs transition-colors cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Schedule Event</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* MONTHLY CALENDAR GRID (7 cols) */}
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs">
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <h3 className="font-bold text-sm text-slate-900">September 2026</h3>
            <div className="flex items-center gap-1">
              <button className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-center text-xs pt-4 font-semibold text-slate-400 mb-2">
            <div>Sun</div>
            <div>Mon</div>
            <div>Tue</div>
            <div>Wed</div>
            <div>Thu</div>
            <div>Fri</div>
            <div>Sat</div>
          </div>

          <div className="grid grid-cols-7 gap-1.5 text-xs">
            {/* Offset for Sep 1 2026 (Tuesday = 2 empty cells) */}
            <div className="h-10" />
            <div className="h-10" />

            {daysInMonth.map(day => {
              const dateStr = `2026-09-${day < 10 ? '0' + day : day}`;
              const isSelected = selectedDate === dateStr;
              const hasEvents = events.some(e => e.date === dateStr);
              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => setSelectedDate(dateStr)}
                  className={`h-11 rounded-xl flex flex-col items-center justify-center relative transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-blue-600 text-white font-bold shadow-xs'
                      : 'hover:bg-slate-100 text-slate-700 font-medium'
                  }`}
                >
                  <span>{day}</span>
                  {hasEvents && (
                    <span
                      className={`w-1.5 h-1.5 rounded-full mt-0.5 ${
                        isSelected ? 'bg-white' : 'bg-blue-500'
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* AGENDA LIST (5 cols) */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200/80 p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <h3 className="font-bold text-xs font-heading text-slate-900">Agenda for {selectedDate}</h3>
            <span className="text-[11px] text-blue-600 font-semibold">Today</span>
          </div>

          <div className="space-y-3">
            {events.length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No scheduled events for this date.</p>
            ) : (
              events.map(ev => (
                <div
                  key={ev.id}
                  className="p-3.5 rounded-xl border border-slate-200/70 hover:border-blue-400 bg-slate-50/50 hover:bg-white transition-all space-y-2"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                        {getEventIcon(ev.type)}
                      </div>
                      <div>
                        <h4 className="font-bold text-xs text-slate-900 leading-tight">{ev.title}</h4>
                        <p className="text-[11px] text-slate-500 mt-0.5">{ev.customer} • {ev.company || 'Client'}</p>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1 border-t border-slate-100 font-mono">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {ev.time}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700">
                      Confirmed
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
              <div>
                <label className="block text-slate-700 font-semibold mb-1">Event Title *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Catalog Automation Demo"
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
                    placeholder="Rohan Mehta"
                    value={form.customer}
                    onChange={e => setForm({ ...form, customer: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Company</label>
                  <input
                    type="text"
                    placeholder="Mehta Traders"
                    value={form.company}
                    onChange={e => setForm({ ...form, company: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Date</label>
                  <input
                    type="date"
                    value={form.date}
                    onChange={e => setForm({ ...form, date: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">Time</label>
                  <input
                    type="text"
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

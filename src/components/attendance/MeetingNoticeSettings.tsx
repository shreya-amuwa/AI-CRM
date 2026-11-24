import React, { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { attendanceApi, MEETING_REMINDER_CHOICES, type MeetingNoticeSettings as Settings } from '../../lib/attendance';

const MAX_REMINDERS = 4;
const message = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Please try again.');

/**
 * Attendance → Reminders, Managing Director only: notices about internal team meetings (scheduled, moved, cancelled) and reminders
 * before they start, in the CRM and on their devices. The database refuses everyone else, so the card hides itself on FORBIDDEN and
 * also before the migration is run.
 */
export const MeetingNoticeSettings: React.FC = () => {
  const [saved, setSaved] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    attendanceApi.meetingNotices().then(s => { setSaved(s); setDraft(s); }).catch(() => setHidden(true));
  }, []);
  if (hidden) return null;
  if (!draft || !saved) return <p role="status" className="text-sm text-slate-500">Loading meeting notifications…</p>;

  const toggleMinute = (m: number) => setDraft(d => d && ({
    ...d, remindMinutes: d.remindMinutes.includes(m) ? d.remindMinutes.filter(x => x !== m) : [...d.remindMinutes, m].sort((a, b) => b - a)
  }));
  const changed = draft.enabled !== saved.enabled || draft.pushEnabled !== saved.pushEnabled
    || draft.remindMinutes.join(',') !== saved.remindMinutes.join(',');
  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      const s = await attendanceApi.saveMeetingNotices(draft);
      setSaved(s);
      setDraft(s);
      setNote({ ok: true, text: 'Meeting notifications saved.' });
    } catch (e) {
      setNote({ ok: false, text: message(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4" aria-labelledby="mtg-notices-h" data-testid="meeting-notice-settings">
      <div className="flex items-start gap-3">
        <CalendarClock className="h-5 w-5 text-blue-700 shrink-0 mt-0.5" aria-hidden />
        <div className="min-w-0">
          <h2 id="mtg-notices-h" className="text-base font-bold">Meeting notifications</h2>
          <p className="text-sm text-slate-600">
            Be told when a team meeting is scheduled, moved or cancelled, even when you are not invited, and be reminded before meetings start.
            Phone and lock-screen alerts never show the meeting title.
          </p>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-4 w-4" checked={draft.enabled} onChange={e => setDraft(d => d && ({ ...d, enabled: e.target.checked }))} />
        Meeting notifications are on
      </label>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input type="checkbox" className="h-4 w-4" checked={draft.pushEnabled} disabled={!draft.enabled}
          onChange={e => setDraft(d => d && ({ ...d, pushEnabled: e.target.checked }))} />
        Also send them to my phone and computer
      </label>
      <fieldset disabled={!draft.enabled}>
        <legend className="text-sm font-semibold mb-2">Reminders (up to {MAX_REMINDERS})</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {MEETING_REMINDER_CHOICES.map(c => {
            const on = draft.remindMinutes.includes(c.minutes);
            return (
              <label key={c.minutes} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="h-4 w-4" checked={on} disabled={!on && draft.remindMinutes.length >= MAX_REMINDERS}
                  onChange={() => toggleMinute(c.minutes)} /> {c.label}
              </label>
            );
          })}
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="inline-flex items-center justify-center h-10 px-4 rounded-xl text-sm font-bold bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={busy || !changed} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save meeting notifications'}
        </button>
        {note && <p role={note.ok ? 'status' : 'alert'} className={`text-sm ${note.ok ? 'text-emerald-700' : 'text-red-700'}`}>{note.text}</p>}
      </div>
    </section>
  );
};

export default MeetingNoticeSettings;

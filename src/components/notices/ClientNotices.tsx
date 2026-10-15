import React, { useCallback, useEffect, useState } from 'react';
import { CalendarOff, Check, Sparkles } from 'lucide-react';
import { getSupabase } from '../../services/supabaseClient';
import { useAuth } from '../../context/AuthContext';
import { cleanDbError, fmtDay } from '../../lib/support';
import { btn, Card, ErrorBanner, inputCls, Pill, Spinner, useServiceCatalog } from '../team-member/pipeline/shared';

/**
 * Department Head / Super Admin: tell the clients something.
 *   Office closed - a day (or a run of days, or the same day every month) the office is closed.
 *   New service   - announce a service; clients get a pop-up that opens it in Explore Services.
 * Clients see the notice on their dashboard and in their Notification Center. A Department Head reaches their own
 * department's clients; the Super Admin can pick a department or everyone. Adding a service to the catalogue
 * announces it to every client automatically.
 */
interface Notice {
  id: string;
  kind: 'OFFICE_CLOSED' | 'NEW_SERVICE';
  title: string;
  body: string | null;
  serviceName: string | null;
  eventDate: string | null;
  eventEnd: string | null;
  recurrence: 'NONE' | 'MONTHLY';
  noticeDays: number;
  audience: string;
  active: boolean;
  live: boolean;
  nextDate: string | null;
  createdAt: string;
  createdBy: string | null;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const supabase = getSupabase();
  if (!supabase) throw new Error('The CRM is not connected to its database.');
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(cleanDbError(error.message));
  return data as T;
}

const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

export const ClientNotices: React.FC = () => {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.role === 'SUPER_ADMIN';
  const { items: services } = useServiceCatalog();
  const [list, setList] = useState<Notice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);

  const [kind, setKind] = useState<'OFFICE_CLOSED' | 'NEW_SERVICE'>('OFFICE_CLOSED');
  const [title, setTitle] = useState('Office closed');
  const [body, setBody] = useState('');
  const [day, setDay] = useState(todayIso());
  const [lastDay, setLastDay] = useState('');
  const [monthly, setMonthly] = useState(false);
  const [noticeDays, setNoticeDays] = useState(7);
  const [service, setService] = useState('');
  const [department, setDepartment] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    rpc<Notice[]>('client_announcements_overview').then(
      l => {
        setList(l);
        setError(null);
      },
      e => setError(e instanceof Error ? e.message : 'Could not load the notices.')
    );
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    if (!isSuperAdmin) return;
    getSupabase()
      ?.from('departments')
      .select('id, name')
      .order('name')
      .then(({ data }) => setDepartments((data || []) as { id: string; name: string }[]));
  }, [isSuperAdmin]);

  const pickKind = (k: typeof kind) => {
    setKind(k);
    setTitle(k === 'OFFICE_CLOSED' ? 'Office closed' : service ? `New service: ${services.find(s => s.code === service)?.name ?? ''}` : '');
    setDone(null);
  };
  const pickService = (code: string) => {
    setService(code);
    const name = services.find(s => s.code === code)?.name;
    if (name) setTitle(`New service: ${name}`);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      await rpc('publish_client_announcement', {
        p_kind: kind,
        p_title: title,
        p_body: body.trim() || null,
        p_event_date: kind === 'OFFICE_CLOSED' ? day : null,
        p_event_end: kind === 'OFFICE_CLOSED' && !monthly && lastDay ? lastDay : null,
        p_recurrence: kind === 'OFFICE_CLOSED' && monthly ? 'MONTHLY' : 'NONE',
        p_notice_days: noticeDays,
        p_service: kind === 'NEW_SERVICE' ? service || null : null,
        p_department: isSuperAdmin && department ? department : null
      });
      setDone(kind === 'OFFICE_CLOSED' ? 'Published. Your clients will see it on their dashboard.' : 'Published. Your clients will get a pop-up about the new service.');
      setBody('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not publish the notice.');
    } finally {
      setBusy(false);
    }
  };

  const end = async (n: Notice) => {
    setError(null);
    try {
      await rpc('end_client_announcement', { p_id: n.id });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not end the notice.');
    }
  };

  const when = (n: Notice) =>
    n.kind === 'NEW_SERVICE'
      ? n.serviceName || ''
      : n.recurrence === 'MONTHLY'
        ? `Every month on the ${new Date(`${n.eventDate}T00:00:00`).getDate()}${n.nextDate ? ` · next ${fmtDay(n.nextDate)}` : ''}`
        : n.eventEnd && n.eventEnd !== n.eventDate
          ? `${fmtDay(n.eventDate)} to ${fmtDay(n.eventEnd)}`
          : fmtDay(n.eventDate);

  const label = 'block text-xs font-medium text-slate-500 mb-1';
  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold font-heading text-slate-900">Client notices</h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-0.5 max-w-2xl">
          Tell your clients when the office is closed or when a new service starts. They see it on their dashboard and in their Notification Center.
        </p>
      </div>
      {error && <ErrorBanner message={error} />}
      {done && (
        <div role="status" className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs">
          <Check className="w-4 h-4" aria-hidden="true" /> {done}
        </div>
      )}

      <Card className="p-5">
        <form onSubmit={submit} className="space-y-4" noValidate aria-label="Publish a notice for clients">
          <div role="radiogroup" aria-label="Type of notice" className="flex gap-2">
            {(
              [
                ['OFFICE_CLOSED', 'Office closed', CalendarOff],
                ['NEW_SERVICE', 'New service', Sparkles]
              ] as const
            ).map(([k, text, Icon]) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => pickKind(k)}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold ${kind === k ? 'border-indigo-300 bg-indigo-50 text-indigo-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
              >
                <Icon className="w-4 h-4" aria-hidden="true" /> {text}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {kind === 'NEW_SERVICE' && (
              <div>
                <label className={label} htmlFor="cn-service">Service</label>
                <select id="cn-service" className={inputCls} value={service} onChange={e => pickService(e.target.value)}>
                  <option value="">Choose a service…</option>
                  {services.map(s => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className={label} htmlFor="cn-title">Title</label>
              <input id="cn-title" className={inputCls} value={title} maxLength={120} onChange={e => setTitle(e.target.value)} />
            </div>
            {kind === 'OFFICE_CLOSED' && (
              <>
                <div>
                  <label className={label} htmlFor="cn-day">{monthly ? 'First closed day (the same date repeats every month)' : 'Closed on'}</label>
                  <input id="cn-day" type="date" className={inputCls} value={day} onChange={e => setDay(e.target.value)} />
                </div>
                {!monthly && (
                  <div>
                    <label className={label} htmlFor="cn-last">Last closed day (if more than one day)</label>
                    <input id="cn-last" type="date" className={inputCls} value={lastDay} min={day} onChange={e => setLastDay(e.target.value)} />
                  </div>
                )}
                <div>
                  <label className={label} htmlFor="cn-ahead">Start showing it</label>
                  <select id="cn-ahead" className={inputCls} value={noticeDays} onChange={e => setNoticeDays(Number(e.target.value))}>
                    {[1, 3, 7, 14, 30].map(n => (
                      <option key={n} value={n}>
                        {n} day{n === 1 ? '' : 's'} before
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 md:col-span-2">
                  <input type="checkbox" className="w-4 h-4 accent-indigo-600" checked={monthly} onChange={e => setMonthly(e.target.checked)} />
                  Repeat on the same date every month (for example the monthly performance review)
                </label>
              </>
            )}
            {isSuperAdmin && (
              <div>
                <label className={label} htmlFor="cn-dept">Clients of</label>
                <select id="cn-dept" className={inputCls} value={department} onChange={e => setDepartment(e.target.value)}>
                  <option value="">All clients</option>
                  {departments.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div>
            <label className={label} htmlFor="cn-body">Message for clients (optional)</label>
            <textarea id="cn-body" className={`${inputCls} min-h-[80px]`} value={body} maxLength={1000} onChange={e => setBody(e.target.value)} placeholder={kind === 'OFFICE_CLOSED' ? 'For example: our team is in the monthly performance review. Tickets are answered on the next working day.' : 'A line about what the service does.'} />
          </div>
          <div className="flex justify-end">
            <button type="submit" className={btn.primary} disabled={busy || title.trim().length < 3 || (kind === 'NEW_SERVICE' && !service)}>
              {busy ? 'Publishing…' : 'Publish to clients'}
            </button>
          </div>
        </form>
      </Card>

      <Card>
        <div className="px-5 pt-4 pb-2 text-sm font-bold text-slate-900">Published notices</div>
        {!list ? (
          <div className="p-5">
            <Spinner label="Loading notices…" />
          </div>
        ) : list.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-500">Nothing published yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {list.map(n => (
              <li key={n.id} className="px-5 py-3 flex flex-col md:flex-row md:items-center gap-2">
                <span className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0" aria-hidden="true">
                  {n.kind === 'OFFICE_CLOSED' ? <CalendarOff className="w-4 h-4" /> : <Sparkles className="w-4 h-4" />}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-900 truncate">{n.title}</div>
                  <div className="text-[11px] text-slate-500">
                    {when(n)} · {n.audience}
                    {n.createdBy ? ` · by ${n.createdBy}` : ' · added to the catalogue'}
                  </div>
                </div>
                <Pill tone={!n.active ? 'slate' : n.live ? 'green' : 'orange'}>{!n.active ? 'Ended' : n.live ? 'Showing to clients' : 'Not showing yet'}</Pill>
                {n.active && (
                  <button type="button" className={btn.secondary} onClick={() => end(n)} aria-label={`End notice: ${n.title}`}>
                    End
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};

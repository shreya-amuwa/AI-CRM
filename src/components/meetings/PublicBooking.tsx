import React, { useEffect, useMemo, useState } from 'react';
import { CalendarCheck2, CalendarDays, Check, Clock3, Loader2, MapPin, Phone, Video } from 'lucide-react';
import type { PublicBookingPage, PublicBookingResult, PublicBookingView } from '../../../shared/contracts';
import { publicBookingApi } from '../../lib/api/meetings';
import { AmuwaLogo } from '../common/AmuwaLogo';

/**
 * The public booking pages (no login):
 *   /book/<link>            a customer, lead or candidate picks one of the host's free slots and books it (or requests it, for the CEO)
 *   /book/manage/<token>    the guest's private link from their e-mail: see the booking, cancel it, answer a proposed time
 * Times are shown in the guest's own time zone.
 */

const GUEST_TZ = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata';
  } catch {
    return 'Asia/Kolkata';
  }
})();
const pad = (n: number) => String(n).padStart(2, '0');
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const longWhen = (s: string, e: string) =>
  `${new Date(s).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}, ${timeOf(s)} – ${timeOf(e)}`;
const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500';
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50';
const btnGhost = 'inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2.5 text-sm font-semibold border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50';
const MODE: Record<string, { label: string; icon: React.ReactNode }> = {
  GOOGLE_MEET: { label: 'Google Meet video call', icon: <Video className="w-4 h-4" /> },
  ONLINE_LINK: { label: 'Online meeting', icon: <Video className="w-4 h-4" /> },
  IN_PERSON: { label: 'In person', icon: <MapPin className="w-4 h-4" /> },
  PHONE: { label: 'Phone call', icon: <Phone className="w-4 h-4" /> }
};

const Frame: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="min-h-screen bg-slate-50 text-slate-900 antialiased">
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2"><AmuwaLogo /></div>
    </header>
    <main className="max-w-3xl mx-auto px-4 py-6 sm:py-10">{children}</main>
  </div>
);

const Problem: React.FC<{ text: string }> = ({ text }) => (
  <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-sm">{text}</div>
);

// ---------------------------------------------------------------------------
// Booking a slot
// ---------------------------------------------------------------------------
const BookingPage: React.FC<{ slug: string }> = ({ slug }) => {
  const [page, setPage] = useState<PublicBookingPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', notes: '', website: '' });
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<PublicBookingResult | null>(null);

  const load = () => publicBookingApi.page(slug).then(p => {
    setPage(p);
    setDay(d => d ?? (p.slots[0] ? dayKey(p.slots[0]) : null));
  }).catch(e => setError((e as Error).message));
  useEffect(() => {
    document.title = 'Book a meeting';
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const byDay = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const s of page?.slots ?? []) map.set(dayKey(s), [...(map.get(dayKey(s)) ?? []), s]);
    return map;
  }, [page]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slot) return;
    setSending(true);
    setError(null);
    try {
      setDone(await publicBookingApi.book(slug, { startsAt: slot, name: form.name, email: form.email, phone: form.phone || undefined, notes: form.notes || undefined, website: form.website || undefined }));
    } catch (err) {
      setError((err as Error).message);
      setSlot(null);
      load();
    } finally {
      setSending(false);
    }
  };

  if (done && page) {
    const requested = done.status === 'REQUESTED';
    return (
      <Frame>
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3 text-center">
          <CalendarCheck2 className={`w-10 h-10 mx-auto ${requested ? 'text-amber-500' : 'text-emerald-600'}`} />
          <h1 className="text-xl font-bold">{requested ? 'Request sent' : 'You are booked'}</h1>
          <p className="text-slate-600">{page.title} with {page.hostName}</p>
          <p className="font-semibold">{longWhen(done.startsAt, done.endsAt)}</p>
          <p className="text-sm text-slate-600">
            {requested ? 'This time is not confirmed yet. You will receive an e-mail as soon as it is approved.' : 'A confirmation with a calendar invitation is on its way to your e-mail.'}
          </p>
          <p className="text-xs text-slate-500">Reference {done.reference}</p>
          {done.manageUrl && <p className="text-sm"><a className="text-indigo-700 underline" href={done.manageUrl}>Change or cancel this booking</a></p>}
        </div>
      </Frame>
    );
  }

  return (
    <Frame>
      {!page && !error && <p className="text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
      {!page && error && <Problem text={error} />}
      {page && (
        <div className="grid gap-6 md:grid-cols-[260px_1fr]">
          <aside className="space-y-2">
            <p className="text-sm text-slate-500">{page.hostName}{page.hostPosition ? ` · ${page.hostPosition}` : ''}</p>
            <h1 className="text-2xl font-bold leading-tight">{page.title}</h1>
            <p className="text-sm text-slate-600 flex items-center gap-1.5"><Clock3 className="w-4 h-4" /> {page.durationMinutes} minutes</p>
            <p className="text-sm text-slate-600 flex items-center gap-1.5">{MODE[page.mode]?.icon} {MODE[page.mode]?.label}{page.location ? ` — ${page.location}` : ''}</p>
            {page.requiresApproval && <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 px-2 py-1.5">Each request is approved before it is confirmed.</p>}
            {page.description && <p className="text-sm text-slate-600 whitespace-pre-wrap pt-2">{page.description}</p>}
            <p className="text-xs text-slate-400 pt-2">Times are shown in your time zone ({GUEST_TZ}).</p>
          </aside>
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
            {error && <Problem text={error} />}
            {!page.slots.length ? (
              <p className="text-slate-600">There are no free times at the moment. Please try again later.</p>
            ) : !slot ? (
              <>
                <h2 className="font-semibold flex items-center gap-2"><CalendarDays className="w-4 h-4 text-indigo-600" /> Pick a day</h2>
                <div className="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Days">
                  {[...byDay.keys()].map(k => {
                    const d = new Date(`${k}T12:00`);
                    return (
                      <button key={k} type="button" role="option" aria-selected={day === k} onClick={() => setDay(k)}
                        className={`shrink-0 rounded-xl border px-3 py-2 text-center min-w-[72px] ${day === k ? 'border-indigo-600 bg-indigo-50 text-indigo-800' : 'border-slate-200 hover:border-indigo-300'}`}>
                        <span className="block text-[11px] uppercase text-slate-500">{d.toLocaleDateString([], { weekday: 'short' })}</span>
                        <span className="block text-lg font-bold">{d.getDate()}</span>
                        <span className="block text-[11px] text-slate-500">{d.toLocaleDateString([], { month: 'short' })}</span>
                      </button>
                    );
                  })}
                </div>
                {day && (
                  <>
                    <h2 className="font-semibold">Pick a time</h2>
                    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                      {(byDay.get(day) ?? []).map(s => (
                        <button key={s} type="button" onClick={() => setSlot(s)} className="rounded-lg border border-indigo-200 text-indigo-800 font-semibold py-2 text-sm hover:bg-indigo-50">{timeOf(s)}</button>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <form onSubmit={submit} className="space-y-3 text-sm">
                <p className="rounded-lg bg-indigo-50 text-indigo-900 px-3 py-2 font-semibold">
                  {longWhen(slot, new Date(new Date(slot).getTime() + page.durationMinutes * 60_000).toISOString())}
                  <button type="button" className="ml-2 text-xs font-normal underline" onClick={() => setSlot(null)}>change</button>
                </p>
                <div><label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="pb-name">Your name</label>
                  <input id="pb-name" required minLength={2} maxLength={200} autoComplete="name" className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></div>
                <div><label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="pb-email">E-mail</label>
                  <input id="pb-email" type="email" required maxLength={254} autoComplete="email" className={inputCls} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></div>
                <div><label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="pb-phone">Phone (optional)</label>
                  <input id="pb-phone" type="tel" maxLength={25} autoComplete="tel" className={inputCls} value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></div>
                <div><label className="block text-xs font-semibold text-slate-600 mb-1" htmlFor="pb-notes">Anything we should know? (optional)</label>
                  <textarea id="pb-notes" rows={3} maxLength={2000} className={inputCls} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></div>
                {/* people never see or fill this; automated form fillers do */}
                <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
                  <label htmlFor="pb-website">Website</label>
                  <input id="pb-website" tabIndex={-1} autoComplete="off" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <button type="submit" disabled={sending} className={btnPrimary}>{sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {page.requiresApproval ? 'Request this time' : 'Confirm booking'}</button>
                  <button type="button" className={btnGhost} onClick={() => setSlot(null)}>Back</button>
                </div>
                <p className="text-xs text-slate-500">Your details are used only to arrange this meeting.</p>
              </form>
            )}
          </section>
        </div>
      )}
    </Frame>
  );
};

// ---------------------------------------------------------------------------
// The guest's own booking (private link)
// ---------------------------------------------------------------------------
const STATUS_TEXT: Record<string, string> = {
  REQUESTED: 'Waiting for approval', PROPOSED: 'Another time was proposed', SCHEDULED: 'Confirmed', DECLINED: 'Not possible at that time',
  CANCELLED: 'Cancelled', COMPLETED: 'Done'
};

const ManagePage: React.FC<{ token: string }> = ({ token }) => {
  const [b, setB] = useState<PublicBookingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    document.title = 'Your booking';
    publicBookingApi.view(token).then(setB).catch(e => setError((e as Error).message));
  }, [token]);
  const act = async (fn: () => Promise<PublicBookingView>, text: string) => {
    setBusy(true);
    setError(null);
    try {
      setB(await fn());
      setMsg(text);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Frame>
      {error && <Problem text={error} />}
      {!b && !error && <p className="text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>}
      {b && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-3">
          {msg && <p role="status" className="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 px-3 py-2 text-sm">{msg}</p>}
          <p className="text-sm text-slate-500">Reference {b.reference}</p>
          <h1 className="text-xl font-bold">{b.title}</h1>
          <p className="text-slate-700">With {b.hostName}</p>
          <p className="font-semibold">{longWhen(b.startsAt, b.endsAt)}</p>
          <p className="text-sm flex items-center gap-1.5 text-slate-600">{MODE[b.mode]?.icon} {MODE[b.mode]?.label}{b.location ? ` — ${b.location}` : ''}</p>
          <p className="text-sm"><span className="font-semibold">Status:</span> {STATUS_TEXT[b.status] ?? b.status}</p>
          {b.decisionNote && <p className="text-sm text-slate-600">Note: {b.decisionNote}</p>}
          {b.meetLink && b.status === 'SCHEDULED' && <a href={b.meetLink} target="_blank" rel="noopener noreferrer" className={btnPrimary}><Video className="w-4 h-4" /> Join the video call</a>}
          {b.status === 'PROPOSED' && b.proposedStartsAt && b.proposedEndsAt && (
            <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 space-y-2">
              <p className="text-sm">{b.hostName} proposes <b>{longWhen(b.proposedStartsAt, b.proposedEndsAt)}</b> instead.</p>
              <div className="flex gap-2">
                <button type="button" disabled={busy} className={btnPrimary} onClick={() => act(() => publicBookingApi.answerProposal(token, true), 'The new time is confirmed. A confirmation is on its way.')}>Accept the new time</button>
                <button type="button" disabled={busy} className={btnGhost} onClick={() => act(() => publicBookingApi.answerProposal(token, false), 'You declined the proposed time.')}>Decline</button>
              </div>
            </div>
          )}
          {['REQUESTED', 'PROPOSED', 'SCHEDULED'].includes(b.status) && (
            <button type="button" disabled={busy} className={btnGhost} onClick={() => {
              const reason = window.prompt('Cancel this booking? You may give a reason (optional):');
              if (reason !== null) act(() => publicBookingApi.cancel(token, reason || undefined), 'Your booking is cancelled.');
            }}>Cancel this booking</button>
          )}
          {b.slug && ['CANCELLED', 'DECLINED'].includes(b.status) && <p className="text-sm"><a className="text-indigo-700 underline" href={`/book/${b.slug}`}>Book another time</a></p>}
        </div>
      )}
    </Frame>
  );
};

/** /book/<link> or /book/manage/<token> */
const PublicBooking: React.FC = () => {
  const parts = window.location.pathname.replace(/\/+$/, '').split('/').filter(Boolean); // ['book', ...]
  if (parts[1] === 'manage' && parts[2]) return <ManagePage token={decodeURIComponent(parts[2])} />;
  if (parts[1]) return <BookingPage slug={decodeURIComponent(parts[1]).toLowerCase()} />;
  return <Frame><Problem text="This booking link is incomplete." /></Frame>;
};
export default PublicBooking;

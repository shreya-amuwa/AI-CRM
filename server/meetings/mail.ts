import { createHmac, timingSafeEqual } from 'node:crypto';
import { COMPANY } from '../automations/config.js';
import { toText, type RenderedEmail } from '../automations/templates.js';

/**
 * What people outside the company receive about a meeting: confirmation (with a calendar file), request received, another time
 * proposed, declined, moved, cancelled, and the reminders. Guests who booked through a link also get a private link to cancel or answer
 * a proposed time; that link is signed (HMAC) with MEETING_LINK_SECRET, so it cannot be guessed from the meeting's id.
 */

export type MeetingMailKind = 'REQUEST_RECEIVED' | 'CONFIRMED' | 'RESCHEDULED' | 'CANCELLED' | 'DECLINED' | 'PROPOSED' | 'REMINDER_24H' | 'REMINDER_1H' | 'QUEUE_CONFIRMED';

export interface MailMeeting {
  id: string;
  reference: string;
  title: string;
  description: string | null;
  hostName: string;
  hostEmail: string | null;
  startsAt: string;
  endsAt: string;
  timezone: string;
  mode: string;
  location: string | null;
  meetLink: string | null;
  status: string;
  decisionNote: string | null;
  cancelReason: string | null;
  proposedStartsAt: string | null;
  proposedEndsAt: string | null;
  bookedVia: string;
  version: number;
  /** CLIENT_MEETING (20270122000200): the invitation to the client carries the agenda, the company and the host's details. */
  kind?: string;
  clientCompany?: string | null;
}

// ---------------------------------------------------------------------------
// The guest's private link
// ---------------------------------------------------------------------------
export function linkSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const s = (env.MEETING_LINK_SECRET || env.GOOGLE_TOKEN_KEY || '').trim();
  return s.length >= 32 ? s : null;
}

export function manageToken(meetingId: string, secret: string): string {
  const sig = createHmac('sha256', `meeting-manage:${secret}`).update(meetingId).digest('base64url').slice(0, 32);
  return `${meetingId}.${sig}`;
}

/** The meeting a private link opens, or null when the link was altered. */
export function verifyManageToken(token: string | null | undefined, secret: string): string | null {
  if (!token || token.length > 120) return null;
  const [id, sig] = token.split('.');
  if (!id || !sig || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const want = Buffer.from(manageToken(id, secret).split('.')[1]);
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

// ---------------------------------------------------------------------------
// The calendar file (RFC 5545), so a guest can add the meeting to any calendar even without Google
// ---------------------------------------------------------------------------
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsText = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => `\\${m}`);
/** Lines of at most 75 octets (continuation lines start with a space). */
function fold(line: string): string {
  const out: string[] = [];
  let rest = line;
  while (Buffer.byteLength(rest, 'utf8') > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut), 'utf8') > 75) cut--;
    out.push(rest.slice(0, cut));
    rest = ' ' + rest.slice(cut);
  }
  out.push(rest);
  return out.join('\r\n');
}

export function meetingIcs(m: MailMeeting, cancelled = false): string {
  const where = m.meetLink || m.location || '';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Amuwa CRM//Meetings//EN', `METHOD:${cancelled ? 'CANCEL' : 'PUBLISH'}`, 'BEGIN:VEVENT',
    `UID:${m.id}@crm.amuwacorporation.com`, `SEQUENCE:${m.version}`, `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(m.startsAt)}`, `DTEND:${icsDate(m.endsAt)}`, `SUMMARY:${icsText(m.title)}`,
    ...(where ? [`LOCATION:${icsText(where)}`] : []),
    `DESCRIPTION:${icsText([m.description, `With ${m.hostName}`, m.meetLink ? `Join: ${m.meetLink}` : null, `Reference ${m.reference}`].filter(Boolean).join('\n'))}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR'
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}

// ---------------------------------------------------------------------------
// The e-mails
// ---------------------------------------------------------------------------
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const wrap = (inner: string) => '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222">' + inner + '</div>';

/** "Tuesday 18 November 2025, 11:30 – 12:00 (IST, Asia/Kolkata)" in the meeting's zone. */
export function whenText(startIso: string, endIso: string, tz: string): string {
  const zone = (() => {
    try {
      new Intl.DateTimeFormat('en-IN', { timeZone: tz });
      return tz;
    } catch {
      return 'Asia/Kolkata';
    }
  })();
  const day = new Intl.DateTimeFormat('en-IN', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(startIso));
  const t = (iso: string) => new Intl.DateTimeFormat('en-IN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));
  const short = new Intl.DateTimeFormat('en-IN', { timeZone: zone, timeZoneName: 'short' }).formatToParts(new Date(startIso)).find(p => p.type === 'timeZoneName')?.value;
  return `${day}, ${t(startIso)} – ${t(endIso)} (${short ? `${short}, ` : ''}${zone})`;
}

function whereHtml(m: MailMeeting): string {
  if (m.meetLink) return `<a href="${esc(m.meetLink)}">${esc(m.meetLink)}</a>`;
  if (m.mode === 'GOOGLE_MEET') return 'Google Meet (the joining link follows in the calendar invitation)';
  if (m.mode === 'PHONE') return 'Phone call' + (m.location ? ` — ${esc(m.location)}` : '');
  return esc(m.location || 'To be confirmed');
}

/** `signedBy`: the organiser, for the e-mail a colleague receives (it is sent in their name); the host otherwise. */
export function renderMeetingEmail(kind: MeetingMailKind, m: MailMeeting, guestName: string | null, manageUrl: string | null, signedBy?: string | null): RenderedEmail {
  const hi = `<p>Dear ${esc(guestName || 'Sir/Madam')},</p>`;
  const when = esc(whenText(m.startsAt, m.endsAt, m.timezone));
  const client = m.kind === 'CLIENT_MEETING';
  const row = (k: string, v: string) => `<tr><td style="padding:2px 12px 2px 0;color:#666;vertical-align:top">${k}</td><td>${v}</td></tr>`;
  const facts = `<table style="border-collapse:collapse;margin:8px 0 16px">
${row('What', `<b>${esc(m.title)}</b>`)}
${client && m.clientCompany ? row('Company', esc(m.clientCompany)) : ''}
${row('When', when)}
${client ? row('Mode', m.mode === 'IN_PERSON' ? 'In person (offline)' : 'Online') : ''}
${row(client && m.mode === 'IN_PERSON' ? 'Location' : client ? 'Meeting link' : 'Where', whereHtml(m))}
${client && m.description ? row('Agenda', esc(m.description).replace(/\n/g, '<br>')) : ''}
${row(client ? 'Host' : 'With', esc(m.hostName) + (client && m.hostEmail ? ` &lt;<a href="mailto:${esc(m.hostEmail)}">${esc(m.hostEmail)}</a>&gt;` : ''))}
${row('Reference', esc(m.reference))}</table>`;
  const manage = manageUrl ? `<p>To cancel${kind === 'PROPOSED' ? ' or answer the proposed time' : ''}, use your private link: <a href="${esc(manageUrl)}">${esc(manageUrl)}</a></p>` : '';
  const sign = `<p>Regards,<br>${esc(signedBy?.trim() || m.hostName)}<br>${esc(COMPANY.senderName)} · ${esc(COMPANY.companyPhone)}</p>`;
  const proposed = m.proposedStartsAt && m.proposedEndsAt ? esc(whenText(m.proposedStartsAt, m.proposedEndsAt, m.timezone)) : null;
  let subject: string;
  let body: string;
  switch (kind) {
    case 'REQUEST_RECEIVED':
      subject = `Request received: ${m.title}`;
      body = `<p>Thank you. Your request for the time below has reached ${esc(m.hostName)}. It is <b>not confirmed yet</b>: you will receive an e-mail once it is approved.</p>${facts}${manage}`;
      break;
    case 'CONFIRMED':
      if (client && !signedBy) {
        subject = `Meeting invitation: ${m.title} — ${whenText(m.startsAt, m.endsAt, m.timezone)}`;
        body = `<p>Thank you for your time. We are pleased to invite you to the meeting below${m.clientCompany ? ` for ${esc(m.clientCompany)}` : ''}.`
          + ` The calendar file attached adds it to your calendar. If the time does not suit you, simply reply to this e-mail.</p>${facts}`;
        break;
      }
      subject = `Confirmed: ${m.title} — ${whenText(m.startsAt, m.endsAt, m.timezone)}`;
      body = `<p>Your meeting is confirmed. The calendar file attached adds it to your calendar.</p>${facts}${manage}`;
      break;
    case 'RESCHEDULED':
      subject = `New time: ${m.title} — ${whenText(m.startsAt, m.endsAt, m.timezone)}`;
      body = `<p>The meeting has moved to a new time. The calendar file attached replaces the old entry.</p>${facts}${manage}`;
      break;
    case 'CANCELLED':
      subject = `Cancelled: ${m.title}`;
      body = `<p>The meeting below is <b>cancelled</b>.${m.cancelReason ? ` Reason: ${esc(m.cancelReason)}.` : ''}</p>${facts}`;
      break;
    case 'DECLINED':
      subject = `Not possible: ${m.title}`;
      body = `<p>Unfortunately ${esc(m.hostName)} cannot meet at the requested time.${m.decisionNote ? ` Note: ${esc(m.decisionNote)}.` : ''} You are welcome to request another time.</p>${facts}`;
      break;
    case 'PROPOSED':
      subject = `Another time proposed: ${m.title}`;
      body = `<p>${esc(m.hostName)} cannot meet at the requested time and proposes <b>${proposed ?? 'another time'}</b> instead.${m.decisionNote ? ` Note: ${esc(m.decisionNote)}.` : ''}</p>${manage || '<p>Please reply to this e-mail to accept or decline.</p>'}`;
      break;
    case 'QUEUE_CONFIRMED': {
      // a request that waited in the Super Admin's queue, confirmed when they exited their meeting (20270127000100): it starts now
      const join = m.meetLink
        ? `<p style="margin:16px 0"><a href="${esc(m.meetLink)}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Join the meeting room</a></p>`
        : '<p>The meeting room link follows in the calendar invitation, or from Meetings in the CRM.</p>';
      subject = `Your meeting is scheduled now: ${m.title}`;
      body = `<p>Your meeting is scheduled and starts <b>now</b>. You can join the meeting room.</p>${facts}${join}`
        + '<p>Please join on time; if you can no longer attend, cancel it from Meetings in the CRM so the next request in the queue can be confirmed.</p>';
      break;
    }
    case 'REMINDER_24H':
    case 'REMINDER_1H':
      subject = `Reminder: ${m.title} ${kind === 'REMINDER_1H' ? 'starts within the hour' : 'is tomorrow'}`;
      body = `<p>A reminder of your meeting:</p>${facts}${manage}`;
      break;
  }
  const html = wrap(hi + body + sign);
  return { subject: subject.slice(0, 200), html, text: toText(html) };
}

/** Kinds that carry the calendar file. */
export const ICS_KINDS: MeetingMailKind[] = ['CONFIRMED', 'RESCHEDULED', 'CANCELLED', 'REMINDER_24H', 'QUEUE_CONFIRMED'];
/** Kinds Google already sends itself when the meeting is on the host's Google Calendar (the invitation, its change and cancellation). */
export const GOOGLE_SENDS: MeetingMailKind[] = ['CONFIRMED', 'RESCHEDULED', 'CANCELLED'];

import { toText, type RenderedEmail } from '../automations/templates.js';

/**
 * The two e-mails a candidate receives when a recruiter's final decision is recorded (selected / rejected). They live only on the server: there is
 * no template editor and nothing in the browser can change or preview-send them. Every value comes from the candidate's real application record
 * (the database function that claims the e-mail reads them), never from anything typed in by a person.
 *
 * The subjects and the wording are fixed by the recruitment process; only the {{variables}} change.
 */
export type DecisionEmailType = 'SELECTION' | 'REJECTION';

export interface DecisionMailPayload {
  candidateName: string;
  positionName: string;
  departmentName?: string | null;
  /** The date the decision was recorded, already formatted for reading, for example "03 November 2026". */
  selectionDate?: string | null;
  logoUrl: string;
  supportEmail: string;
}

export const SELECTION_SUBJECT = 'Congratulations! You Have Been Selected – Amuwa Corporation';
export const REJECTION_SUBJECT = 'Update on Your Job Application – Amuwa Corporation';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** "2026-11-03" (or a Date) -> "03 November 2026" in English, in the office's time zone. */
export function formatDecisionDate(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = typeof value === 'string' ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00+05:30` : value) : value;
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(d);
}

function shell(p: DecisionMailPayload, inner: string, footerNote: string): string {
  return `<div style="background:#eef2f9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2a44">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe3f1">
<div style="background:#0f1d3a;padding:20px 24px"><img src="${esc(p.logoUrl)}" alt="Amuwa Corporation" height="44" style="height:44px;vertical-align:middle;border-radius:8px;background:#ffffff;padding:4px"><span style="color:#ffffff;font-size:18px;font-weight:700;margin-left:12px;vertical-align:middle">Amuwa Corporation</span></div>
<div style="padding:24px">${inner}</div>
<div style="background:#f5f8fd;padding:12px 24px;font-size:11px;color:#7b88a3">${footerNote} Questions? Write to <a href="mailto:${esc(p.supportEmail)}" style="color:#2f5fd0">${esc(p.supportEmail)}</a>.</div>
</div></div>`;
}

export function renderSelectionEmail(p: DecisionMailPayload): RenderedEmail {
  const rows: [string, string][] = [
    ['Candidate Name', p.candidateName],
    ['Selected Position', p.positionName],
    ['Department', p.departmentName || 'To be confirmed'],
    ['Selection Date', p.selectionDate || '']
  ];
  const table = rows
    .map(([k, v], i) => `<tr style="background:${i % 2 ? '#ffffff' : '#f5f8fd'}"><td style="padding:8px 12px;color:#52607a;font-weight:600;width:38%">${esc(k)}</td><td style="padding:8px 12px;color:#0f1d3a">${esc(v)}</td></tr>`)
    .join('');
  const html = shell(
    p,
    `<p style="margin:0 0 12px">Dear ${esc(p.candidateName)},</p>
<h1 style="font-size:20px;margin:0 0 12px;color:#0f1d3a">Congratulations!</h1>
<p>We are pleased to inform you that you have been selected for the position of <b>${esc(p.positionName)}</b> at Amuwa Corporation.</p>
<p>After reviewing your application, assessment performance, and interview evaluation, we are happy to move forward with your candidature.</p>
<h2 style="font-size:15px;margin:20px 0 6px;color:#0f1d3a">Selection Details</h2>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #dbe3f1;border-radius:8px;margin:0 0 16px">${table}</table>
<p>Our HR team will share the next steps regarding documentation, verification, and onboarding.</p>
<p>Please check your registered email for further communication.</p>
<p>We congratulate you on your selection and look forward to the possibility of welcoming you to Amuwa Corporation.</p>
<p style="margin-bottom:0">Regards,<br>HR Recruitment Team<br>Amuwa Corporation</p>`,
    'This e-mail was sent automatically about your job application with Amuwa Corporation.'
  );
  return { subject: SELECTION_SUBJECT, html, text: toText(html.replace(/<\/tr>/g, '<br>').replace(/<\/td><td/g, ': <td').replace(/<\/p>/g, '<br><br>')) };
}

export function renderRejectionEmail(p: DecisionMailPayload): RenderedEmail {
  const html = shell(
    p,
    `<p style="margin:0 0 12px">Dear ${esc(p.candidateName)},</p>
<p>Thank you for applying for the position of <b>${esc(p.positionName)}</b> at Amuwa Corporation.</p>
<p>We sincerely appreciate the time and effort you invested in our recruitment process, including the application, assessment, and interview stages.</p>
<p>After careful consideration, we regret to inform you that we will not be moving forward with your candidature for this particular position.</p>
<p>This decision does not diminish the value of your skills, experience, or potential.</p>
<p>We appreciate your interest in Amuwa Corporation and encourage you to explore other suitable opportunities with us in the future.</p>
<p>We wish you success in your career.</p>
<p style="margin-bottom:0">Regards,<br>HR Recruitment Team<br>Amuwa Corporation</p>`,
    'This e-mail was sent automatically about your job application with Amuwa Corporation.'
  );
  return { subject: REJECTION_SUBJECT, html, text: toText(html.replace(/<\/p>/g, '<br><br>')) };
}

export function renderDecisionEmail(type: DecisionEmailType, p: DecisionMailPayload): RenderedEmail {
  return type === 'SELECTION' ? renderSelectionEmail(p) : renderRejectionEmail(p);
}

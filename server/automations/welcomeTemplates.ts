import { toText, type RenderedEmail } from './templates.js';

/**
 * The welcome e-mail a new employee receives once their account is active. Every value comes from the database (the employee's own record) and
 * the server's settings; the one-time set-password link is made by the server at send time and exists only in this message. It is never stored.
 */
export interface WelcomeMailPayload {
  name: string;
  /** The login ID: the work e-mail address the employee signs in with. */
  loginId: string;
  employeeCode?: string | null;
  department?: string | null;
  designation?: string | null;
  /** The CRM's sign-in page. */
  loginUrl: string;
  /** The one-time link that opens the "choose your password" page. */
  setupUrl: string;
  logoUrl: string;
  supportEmail: string;
  supportPhone?: string | null;
}

export const WELCOME_SUBJECT = 'Welcome to Amuwa Corporation – Your CRM Login Credentials';

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderWelcomeEmail(p: WelcomeMailPayload): RenderedEmail {
  const rows: [string, string][] = [
    ['Employee name', p.name],
    ...(p.employeeCode ? [['Employee ID', p.employeeCode] as [string, string]] : []),
    ['Department', p.department || 'Not assigned yet'],
    ['Designation', p.designation || 'Not recorded'],
    ['Login ID (username)', p.loginId],
    ['CRM login page', p.loginUrl]
  ];
  const table = rows
    .map(([k, v], i) => `<tr style="background:${i % 2 ? '#ffffff' : '#f5f8fd'}"><td style="padding:8px 12px;color:#52607a;font-weight:600;width:38%">${esc(k)}</td><td style="padding:8px 12px;color:#0f1d3a">${esc(v)}</td></tr>`)
    .join('');
  const html = `<div style="background:#eef2f9;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2a44">
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dbe3f1">
<div style="background:#0f1d3a;padding:20px 24px"><img src="${esc(p.logoUrl)}" alt="Amuwa Corporation" height="44" style="height:44px;vertical-align:middle;border-radius:8px;background:#ffffff;padding:4px"><span style="color:#ffffff;font-size:18px;font-weight:700;margin-left:12px;vertical-align:middle">Amuwa Corporation</span></div>
<div style="padding:24px">
<h1 style="font-size:20px;margin:0 0 12px;color:#0f1d3a">Welcome, ${esc(p.name)}!</h1>
<p>We are delighted to welcome you to Amuwa Corporation. Your account on the Amuwa CRM has been created and is now active. You will see only the dashboard that belongs to your role.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;border:1px solid #dbe3f1;border-radius:8px;margin:16px 0">${table}</table>
<h2 style="font-size:15px;margin:20px 0 6px;color:#0f1d3a">Your first sign-in</h2>
<ol style="padding-left:20px;margin:0 0 12px">
<li>Open the secure link below and choose your own password (at least 10 characters).</li>
<li>Go to the CRM login page and sign in with your Login ID and the password you just chose.</li>
<li>Your role-specific dashboard opens automatically.</li>
</ol>
<p style="margin:18px 0"><a href="${esc(p.setupUrl)}" style="background:#2f5fd0;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:10px;display:inline-block">Set your password</a></p>
<p style="font-size:12px;color:#52607a;margin:0 0 4px">If the button does not work, copy this address into your browser:<br><span style="word-break:break-all">${esc(p.setupUrl)}</span></p>
<div style="background:#fff7e6;border:1px solid #f3d9a4;border-radius:8px;padding:12px 14px;margin:18px 0">
<b>Important - your password</b><br>
No password is sent in this e-mail. You must choose your own password before you can sign in, and only you will know it. The link works once and only for a limited time; if it has expired or stopped working, ask HR to send you a new welcome e-mail. Never share the link or your password with anyone: Amuwa staff will never ask you for your password.
</div>
<p>If you need help signing in, write to <a href="mailto:${esc(p.supportEmail)}" style="color:#2f5fd0">${esc(p.supportEmail)}</a>${p.supportPhone ? ` or call ${esc(p.supportPhone)}` : ''}.</p>
<p style="margin-bottom:0">Warm regards,<br>HR Team<br>Amuwa Corporation</p>
</div>
<div style="background:#f5f8fd;padding:12px 24px;font-size:11px;color:#7b88a3">This e-mail was sent automatically because an account was created for you on the Amuwa CRM. If you were not expecting it, please tell ${esc(p.supportEmail)}.</div>
</div></div>`;
  return { subject: WELCOME_SUBJECT, html, text: toText(html.replace(/<\/tr>/g, '<br>').replace(/<\/td><td/g, ': <td').replace(/<\/li>/g, '<br>').replace(/<li>/g, '- ')) };
}

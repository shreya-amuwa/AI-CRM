import { COMPANY } from './config.js';
import type { ClientStage } from './rules.js';

/**
 * The onboarding emails, ported word for word from the Google Apps Script
 * (mailNoWebsite_, mailUnderReview_, mailInProgress_, mailCompleted_), with the
 * same subjects, HTML wrapper and plain-text version. The Meta Verification email
 * also says the process takes about 2-3 weeks, and when our team built the
 * customer's website it says so instead of "your website is already available".
 */
export interface TemplateData {
  name: string;
  email: string;
  department: string;
  panelUrl: string;
  /** The client's panel login (user ID) - the login e-mail. */
  userId: string;
  /** Plain text, only for the completion email, never stored. */
  password: string | null;
  /** The customer started at Website Pending: our team created the website. */
  websiteCreated: boolean;
  /** The customer's website address (the mini website, in the "website ready" email). */
  website: string;
}

/** The email to the Accounts person who handles a payment request (not a customer email). */
export interface AccountsMailData {
  toName: string;
  kind: string;
  title: string;
  body: string;
  customer: string;
  contact: string;
  phone?: string;
  customerEmail?: string;
  from?: string;
  fromDepartment?: string;
  /** A link to the request in the CRM (empty when the CRM's address is not configured). */
  link: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const wrap = (inner: string) => '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222">' + inner + '</div>';

export function toText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const signature = (team: 'Support Team' | 'Technical Team') => `
  <p>
    Best Regards,<br>
    <b>Amuwa Corporation</b><br>
    ${team}<br>
    ${esc(COMPANY.companyPhone)}<br>
    ${esc(COMPANY.companyEmail)}
  </p>`;

const teamContact = () => `
  <p>
    <b>Team Contact:</b> ${esc(COMPANY.teamPhone)}<br>
    <b>Email:</b> ${esc(COMPANY.teamEmail)}
  </p>`;

// status "Under Review"
function mailUnderReview(d: TemplateData) {
  return `
  <p>Dear ${esc(d.name)},</p>
  <p>Thank you for submitting your details. We would like to inform you that we have <b>received all your documents</b>, and our team is currently <b>checking them</b> to confirm that everything is correct.</p>
  <p>Once the review is complete, we will proceed with <b>applying for Meta Verification</b> on your behalf. We will email you as soon as the application has been successfully submitted.</p>
  <p>If any detail or document needs to be corrected, or if anything additional is required, our team will contact you.</p>
  <p>If you have any questions, please feel free to contact our team.</p>
  ${teamContact()}
  <p>Thank you for your cooperation and patience.</p>
  ${signature('Support Team')}`;
}

// status "Website Pending"
function mailNoWebsite(d: TemplateData) {
  return `
  <p>Dear ${esc(d.name)},</p>
  <p>We would like to inform you that your business currently does not have an existing website.</p>
  <p>To establish your online presence, we recommend creating a <b>Mini Website</b> for your business. Our team will assist you with the required information and guide you through the website creation process.</p>
  <p>If you have any enquiry or requirements related to the website, please contact our <b>Technical Team</b>.</p>
  <p><b>Technical Team Contact:</b> ${esc(COMPANY.techPhone)}</p>
  <p>Our technical team will be happy to assist you and coordinate the next steps.</p>
  <p>Thank you for your cooperation.</p>
  ${signature('Technical Team')}`;
}

// status "Website Ready": the mini website our team built has been authorized by the Technical Consultant
function mailWebsiteReady(d: TemplateData) {
  const link = esc(d.website);
  return `
  <p>Dear ${esc(d.name)},</p>
  <p>We are pleased to inform you that your <b>Mini Website is now ready</b>.</p>
  <p><b>Your Website:</b> <a href="${link}">${link}</a></p>
  <p>Please open the link and check your website. If you would like any change or have any enquiry related to the website, please contact our <b>Technical Team</b>.</p>
  <p><b>Technical Team Contact:</b> ${esc(COMPANY.techPhone)}</p>
  <p>Our team is now continuing with the remaining steps of your onboarding and will keep you updated.</p>
  <p>Thank you for your cooperation.</p>
  ${signature('Technical Team')}`;
}

// status "Meta Verification" (+ "about 2-3 weeks"; website-created wording when we built the website)
function mailInProgress(d: TemplateData) {
  const opening = d.websiteCreated
    ? `<p>We are pleased to inform you that <b>your website has been created</b> and <b>all your documents have been collected and verified</b>. Your <b>application for Meta Verification has been successfully submitted</b>, and your <b>Meta Verification process is currently in progress</b>.</p>`
    : `<p>We would like to inform you that your website is already available, your <b>application for Meta Verification has been successfully submitted</b>, and your <b>Meta Verification process is currently in progress</b>.</p>`;
  return `
  <p>Dear ${esc(d.name)},</p>
  ${opening}
  <p>The Meta Verification process usually takes <b>around 2-3 weeks</b> to complete.</p>
  <p>Our team is working on the required process and will keep you updated regarding the next steps or any further requirements.</p>
  <p>If you have any questions, concerns, or require assistance regarding the Meta Verification process, please feel free to contact our team.</p>
  ${teamContact()}
  <p>Thank you for your cooperation and patience.</p>
  ${signature('Support Team')}`;
}

// status "Status Completed"
function mailCompleted(d: TemplateData) {
  const password = d.password
    ? esc(d.password)
    : 'the password shared with you by our Technical Consultant';
  return `
  <p>Dear ${esc(d.name)},</p>
  <p>We are pleased to inform you that your <b>Meta Verification process has been successfully completed</b>.</p>
  <p>Your panel access details are provided below:</p>
  <p>
    <b>Department:</b> ${esc(d.department)}<br>
    <b>Panel Website:</b> <a href="${esc(d.panelUrl)}">${esc(d.panelUrl)}</a><br>
    <b>User ID:</b> ${esc(d.userId)}<br>
    <b>Password:</b> ${password}
  </p>
  <p>You can use the above credentials to log in to your panel.</p>
  <p>If you have any questions regarding the panel, login process, or Meta verification, please contact our team. We will be happy to assist you.</p>
  ${teamContact()}
  <p>Thank you for choosing <b>Amuwa Corporation</b>.</p>
  ${signature('Support Team')}`;
}

/** The stages with a customer email (the Accounts payment email has its own template). */
type CustomerStage = Exclude<ClientStage, 'ACCOUNTS_PAYMENT'>;

const TEMPLATES: Record<CustomerStage, { subject: string; html: (d: TemplateData) => string }> = {
  WEBSITE_PENDING: { subject: 'Mini Website for Your Business | Amuwa Corporation', html: mailNoWebsite },
  UNDER_REVIEW: { subject: 'Documents Received – Under Review | Amuwa Corporation', html: mailUnderReview },
  META_VERIFICATION: { subject: 'Meta Verification In Progress | Amuwa Corporation', html: mailInProgress },
  COMPLETED: { subject: 'Meta Verification Completed – Panel Access Details | Amuwa Corporation', html: mailCompleted },
  WEBSITE_READY: { subject: 'Your Mini Website is Ready | Amuwa Corporation', html: mailWebsiteReady }
};

export function renderEmail(stage: CustomerStage, data: TemplateData): RenderedEmail {
  const t = TEMPLATES[stage];
  const html = wrap(t.html(data));
  return { subject: t.subject, html, text: toText(html) };
}

const ACCOUNTS_HEADING: Record<string, string> = {
  PAYMENT_CONFIRMATION_REQUESTED: 'New payment confirmation request',
  PAYMENT_TO_VERIFY: 'A payment is waiting for verification',
  ADDON_SUBMITTED: 'Add-on services are waiting for verification'
};

/** Sent to the one Accounts person who handles the request, so they can resolve it. */
export function renderAccountsEmail(d: AccountsMailData): RenderedEmail {
  const heading = ACCOUNTS_HEADING[d.kind] ?? 'A request is waiting for Accounts';
  const row = (label: string, value?: string) => (value ? `<b>${label}:</b> ${esc(value)}<br>` : '');
  const html = wrap(`
  <p>Hello ${esc(d.toName || 'team')},</p>
  <p><b>${esc(heading)}.</b></p>
  <p>${esc(d.body)}</p>
  <p>
    ${row('Customer', d.customer)}
    ${row('Contact person', d.contact !== d.customer ? d.contact : undefined)}
    ${row('Phone', d.phone)}
    ${row('E-mail', d.customerEmail)}
    ${row('Sent by', d.from ? `${d.from}${d.fromDepartment ? ` (${d.fromDepartment})` : ''}` : undefined)}
  </p>
  ${d.link ? `<p><a href="${esc(d.link)}">Open it in the CRM</a></p>` : ''}
  <p>You are receiving this because you handle payment requests for Accounts. Please verify it in the CRM so the team can continue.</p>
  <p>Best Regards,<br><b>Amuwa CRM</b></p>`);
  return { subject: `${heading}: ${d.customer} | Amuwa CRM`, html, text: toText(html) };
}

export interface ClientPasswordMailData {
  name: string;
  businessName?: string | null;
  loginEmail: string;
  link: string;
  /** WELCOME: a new login (from the Excel import); RESET: "Forgot password?" or sent again by the team. */
  kind: 'WELCOME' | 'RESET';
}

/** The client sets their own password from this link; nobody types or sends a password. */
export function renderClientPasswordEmail(d: ClientPasswordMailData): RenderedEmail {
  const welcome = d.kind === 'WELCOME';
  const html = wrap(`
  <p>Dear ${esc(d.name)},</p>
  ${welcome
    ? `<p>Your <b>Amuwa client dashboard</b>${d.businessName && d.businessName !== d.name ? ` for <b>${esc(d.businessName)}</b>` : ''} is ready. There you can see your services, plans, message and calling usage, campaigns, invoices and support tickets.</p>`
    : `<p>We received a request to set a new password for your Amuwa client dashboard.</p>`}
  <p><b>Your login e-mail:</b> ${esc(d.loginEmail)}</p>
  <p><a href="${esc(d.link)}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold">Set your password</a></p>
  <p>Choose your own password on that page; after that you sign in with your login e-mail and that password. The link works once and expires soon. If it has expired, use "Forgot password?" on the sign-in page.</p>
  ${welcome ? '' : '<p>If you did not ask for this, you can ignore this e-mail - your password stays the same.</p>'}
  ${teamContact()}
  ${signature('Support Team')}`);
  return { subject: welcome ? 'Your Amuwa client dashboard - set your password' : 'Set a new password for your Amuwa client dashboard', html, text: toText(html) };
}

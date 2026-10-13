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

const TEMPLATES: Record<ClientStage, { subject: string; html: (d: TemplateData) => string }> = {
  WEBSITE_PENDING: { subject: 'Mini Website for Your Business | Amuwa Corporation', html: mailNoWebsite },
  UNDER_REVIEW: { subject: 'Documents Received – Under Review | Amuwa Corporation', html: mailUnderReview },
  META_VERIFICATION: { subject: 'Meta Verification In Progress | Amuwa Corporation', html: mailInProgress },
  COMPLETED: { subject: 'Meta Verification Completed – Panel Access Details | Amuwa Corporation', html: mailCompleted },
  WEBSITE_READY: { subject: 'Your Mini Website is Ready | Amuwa Corporation', html: mailWebsiteReady }
};

export function renderEmail(stage: ClientStage, data: TemplateData): RenderedEmail {
  const t = TEMPLATES[stage];
  const html = wrap(t.html(data));
  return { subject: t.subject, html, text: toText(html) };
}

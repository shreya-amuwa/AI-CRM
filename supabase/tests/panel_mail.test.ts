/** The panel e-mails carry Amuwa's panel LINK, never the free-text "panel" note (which can hold anything the team typed, even a price). */
import { renderPanelCredentialsEmail, renderPanelLinkEmail, renderSubscriptionActivatedEmail } from '../../server/automations/templates.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++;
  console.log(`ok - ${label}`);
}

const cred = renderPanelCredentialsEmail({ name: 'Renuka', businessName: 'whatsAPI', serviceName: 'WhatsApp API + Blue Tick', panel: '10000', panelUrl: 'https://chat.wabastore.shop/login', account: 'renuka@example.com', password: 'Temp#12345' });
check(!/10000/.test(cred.html) && !/10000/.test(cred.text), 'the panel note (here a price) is never in the credentials e-mail', cred.text);
check(/Panel website:/.test(cred.html) && /href="https:\/\/chat\.wabastore\.shop\/login"/.test(cred.html), 'the panel link is');
check(/Account \/ user ID:<\/b> renuka@example\.com/.test(cred.html) && /Password:/.test(cred.html), 'with the account and the password the Meta Verifier set');
const noLink = renderPanelCredentialsEmail({ name: 'R', serviceName: 'WhatsApp API', panel: '10000', panelUrl: null, account: 'a@b.co', password: 'x' });
check(!/Panel website/.test(noLink.html) && !/10000/.test(noLink.html), 'without a saved link there is no empty line and still no note');

const link = renderPanelLinkEmail({ name: 'R', serviceName: 'WhatsApp API', panel: '10000', panelUrl: 'https://chat.example.com/login', account: 'a@b.co' });
check(!/10000/.test(link.html) && /Panel website/.test(link.html), 'the panel link e-mail has the link and not the note');

const sub = renderSubscriptionActivatedEmail({ name: 'R', serviceName: 'WhatsApp API', startedOn: '2026-11-01', expiresOn: '2027-11-01', panel: '10000', panelUrl: 'https://chat.example.com/login', loginUrl: 'https://crm.example.com/client/login' });
check(!/10000/.test(sub.html) && /Panel website/.test(sub.html), 'and so does the subscription e-mail');
console.log(`\n${passed} checks passed`);

/**
 * The Client Panel URL: where a customer signs in to the panel of one service. The page, the API and the database (private.clean_panel_url)
 * apply the same rules: HTTPS only, a real public host name, no user name / password in the address, no spaces, 500 characters at most, and
 * nothing that looks like a password, key or token. Returns the cleaned address (lower-case host) or the reason it was refused.
 */
export type PanelUrlResult = { ok: true; url: string | null } | { ok: false; message: string };

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:[0-9]{1,5})?$/;
const SECRET_WORDS = /(passw|pwd|secret|token|api[_-]?key|[?&;]key=|auth|session|otp|signature|[?&]sig=|credential|jwt|bearer)/i;

export function checkPanelUrl(input: string | null | undefined): PanelUrlResult {
  const v = (input ?? '').trim();
  if (!v) return { ok: true, url: null };
  if (v.length > 500) return { ok: false, message: 'The panel URL is too long (500 characters at most).' };
  if (/[\s\u0000-\u001f\u007f]/.test(v)) return { ok: false, message: 'The panel URL cannot contain spaces.' };
  if (!/^https:\/\//i.test(v)) return { ok: false, message: 'The panel URL must start with https:// (a secure link).' };
  const rest = v.slice(8);
  const auth = (rest.match(/^[^/?#]*/)?.[0] ?? '').toLowerCase();
  const tail = rest.slice(auth.length);
  if (auth.includes('@')) return { ok: false, message: 'The panel URL cannot contain a user name or password.' };
  const host = auth.replace(/:[0-9]+$/, '');
  if (!HOST.test(auth) || /^[0-9.]+$/.test(host) || /\.(local|localhost|internal|lan|home|test|invalid|example)$/.test(host)) {
    return { ok: false, message: 'Enter a public web address such as https://panel.example.com/login.' };
  }
  if (SECRET_WORDS.test(tail)) return { ok: false, message: 'The panel URL must not carry a password, key or token. Enter the plain sign-in address.' };
  return { ok: true, url: `https://${auth}${tail}` };
}

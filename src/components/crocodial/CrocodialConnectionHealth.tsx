import React, { useCallback, useEffect, useState } from 'react';
import { Activity, CheckCircle2, XCircle } from 'lucide-react';
import type { CrocodialConnectionHealth as Health, CrocodialHealthReport, CrocodialRuntimeReport } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { crocodialApi } from '../../lib/api/endpoints';

/**
 * Super Admin -> Crocodial Integration -> Connection health (croc_connection_health + this server's live check).
 *
 * Answers "why is the token not detected?" without ever showing it: which server answered this page (Cloudflare / Vercel, environment,
 * deployment, address), whether THAT server has the setting the connection names and whether its value is shaped like a token, and what
 * every other server reported. A current problem is never hidden by old data, and an old error recorded by another server is labelled as
 * such instead of being shown as the current configuration.
 */
const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const PLATFORM: Record<string, string> = { cloudflare: 'Cloudflare', vercel: 'Vercel', node: 'Node.js' };
const serverName = (r: { platform: string; environment: string | null }) => `${PLATFORM[r.platform] ?? r.platform}${r.environment ? ` (${r.environment})` : ''}`;

export type HealthCategory = { label: string; tone: 'ok' | 'warn' | 'bad'; detail?: string };

/** The current state of a connection, worst first: what THIS server sees, then what Crocodial last answered. */
export function healthCategory(h: Pick<Health, 'current' | 'connection' | 'lastSyncAt'>): HealthCategory {
  const c = h.connection;
  if (!h.current.nameValid) return { label: 'Setting name is not valid', tone: 'bad' };
  if (!h.current.credentialDetected) return { label: 'Secret missing from this server’s runtime', tone: 'bad' };
  if (!h.current.credentialFormatValid) return { label: 'Secret exists but its format is invalid', tone: 'bad', detail: 'It must not contain spaces, quotes or the word "Bearer".' };
  switch (c.health) {
    case 'OK': return { label: 'Successful connection', tone: 'ok' };
    case 'AUTH_FAILED': return { label: 'Crocodial returned 401 (token refused)', tone: 'bad', detail: 'Create a new token in Crocodial (Setup, Outbound API) and replace the secret.' };
    case 'DISABLED_AT_SOURCE': return { label: 'Crocodial returned 403 (API access turned off)', tone: 'bad', detail: 'Turn the token on again in Crocodial (Setup, Outbound API).' };
    case 'RATE_LIMITED': return { label: 'Crocodial rate-limited the account', tone: 'warn', detail: 'The next run continues automatically.' };
    case 'NO_CREDENTIAL':
      // this server HAS a valid token: the stored status was written earlier, or by another server that has none
      return { label: 'Old status: recorded by a server without the token', tone: 'warn', detail: 'This server has a valid token now. Press Test connection to check and clear the old status.' };
    case 'ERROR':
      return /could not be reached|abort|timed? ?out|network/i.test(c.lastError ?? '')
        ? { label: 'Network timeout or error reaching Crocodial', tone: 'warn', detail: 'Retried automatically on the next run.' }
        : { label: 'Error', tone: 'bad' };
    default: return { label: 'Not tested yet', tone: 'warn', detail: 'Press Test connection.' };
  }
}

/** Two servers answering with different settings: the most common reason for "not set on the server" while the secret is set. */
export function serverMismatch(runtimes: CrocodialRuntimeReport[], now = Date.now()): { withToken: CrocodialRuntimeReport[]; without: CrocodialRuntimeReport[] } {
  const recent = runtimes.filter(r => now - new Date(r.reportedAt).getTime() < 7 * 86_400_000);
  return { withToken: recent.filter(r => r.credentialDetected && r.credentialFormatValid), without: recent.filter(r => !(r.credentialDetected && r.credentialFormatValid)) };
}

const TONE = { ok: 'border-emerald-200 bg-emerald-50 text-emerald-800', warn: 'border-amber-200 bg-amber-50 text-amber-800', bad: 'border-rose-200 bg-rose-50 text-rose-800' };
const YesNo: React.FC<{ v: boolean }> = ({ v }) => (v
  ? <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold"><CheckCircle2 className="w-3.5 h-3.5" aria-hidden />Yes</span>
  : <span className="inline-flex items-center gap-1 text-rose-700 font-semibold"><XCircle className="w-3.5 h-3.5" aria-hidden />No</span>);

const Row: React.FC<{ k: string; children: React.ReactNode }> = ({ k, children }) => (
  <div className="flex flex-wrap gap-x-2 py-1 border-b border-slate-100 last:border-0"><dt className="w-56 shrink-0 text-slate-500">{k}</dt><dd className="min-w-0 text-slate-800">{children}</dd></div>
);

export const CrocodialConnectionHealth: React.FC<{ reloadKey?: number }> = ({ reloadKey }) => {
  const [report, setReport] = useState<CrocodialHealthReport | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    crocodialApi.connectionHealth().then(r => { setReport(r); setError(''); })
      .catch(e => setError(e instanceof ApiError || e instanceof Error ? e.message : 'Connection health could not be loaded.'));
  }, []);
  useEffect(load, [load, reloadKey]);

  if (error) return <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800" role="alert">{error}</p>;
  if (!report) return <p className="text-xs text-slate-500" role="status">Checking connection health…</p>;
  const s = report.server;
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3" aria-label="Connection health" data-testid="croc-health">
      <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Activity className="w-4 h-4" aria-hidden /> Connection health</h2>
      <p className="text-xs text-slate-500">
        This page was answered by <b className="text-slate-800" data-testid="croc-health-server">{serverName(s)}</b>
        {s.deployment ? <> · deployment <span className="font-mono">{s.deployment}</span></> : null}{s.host ? <> · {s.host}</> : null}.
        {' '}Each server that runs the CRM reads its own secrets; the token is never shown.
      </p>
      {!report.connections.length ? <p className="text-xs text-slate-500">No connection yet.</p> : null}
      {report.connections.map(h => {
        const cat = healthCategory(h);
        const mix = serverMismatch(h.runtimes);
        return (
          <div key={h.connection.id} className="rounded-xl border border-slate-200 p-3 space-y-2 text-xs" data-testid="croc-health-connection">
            <div className={`rounded-lg border px-3 py-2 ${TONE[cat.tone]}`} role="status" data-testid="croc-health-category">
              <b>{h.connection.name}: {cat.label}.</b>{cat.detail ? ` ${cat.detail}` : ''}
            </div>
            {h.lastSyncAt && cat.tone !== 'ok' ? (
              <p className="text-slate-600" data-testid="croc-health-historical">Data read on {when(h.lastSyncAt)} is still shown on the dashboards, but the connection is not working now.</p>
            ) : null}
            {mix.withToken.length && mix.without.length ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-900" data-testid="croc-health-mismatch">
                More than one server runs the CRM. <b>{mix.withToken.map(serverName).join(', ')}</b> {mix.withToken.length === 1 ? 'has' : 'have'} the token;{' '}
                <b>{mix.without.map(serverName).join(', ')}</b> {mix.without.length === 1 ? 'does' : 'do'} not. A server without the token no longer overwrites the
                status, but it should either get the same secret or stop receiving the scheduled calls (on Vercel: set VERCEL_CRON_PAUSED=true).
              </p>
            ) : null}
            <dl>
              <Row k="Connection">{h.connection.name}{h.connection.enabled ? '' : ' (switched off)'}</Row>
              <Row k="Expected credential setting"><span className="font-mono">{h.connection.credentialRef}</span></Row>
              <Row k="Running backend">{PLATFORM[s.platform] ?? s.platform}</Row>
              <Row k="Environment">{s.environment ?? '—'}</Row>
              <Row k="Deployment">{s.deployment ? <span className="font-mono">{s.deployment}</span> : '—'}</Row>
              <Row k="Credential detected (this server)"><YesNo v={h.current.credentialDetected} /></Row>
              <Row k="Credential format valid"><YesNo v={h.current.credentialFormatValid} /></Row>
              <Row k="Last connection test / sync">{when(h.connection.lastAttemptAt)}</Row>
              <Row k="Last successful API response">{when(h.connection.lastSuccessAt)}</Row>
              <Row k="Last complete sync">{when(h.lastSyncAt)}{h.syncRunning ? ' · running now' : h.syncInProgress ? ' · a large read continues on the next run' : ''}</Row>
              <Row k="Latest recorded error">{h.connection.lastError ?? h.lastSyncError ?? 'None'}</Row>
              <Row k="Connected people / refreshes (24 h)">{h.connectedPeople} / {h.refreshesToday}</Row>
            </dl>
            <div className="overflow-x-auto">
              <table className="w-full text-left" data-testid="croc-health-runtimes">
                <thead className="text-[11px] uppercase text-slate-500"><tr>{['Server', 'Deployment', 'Address', 'Token detected', 'Format valid', 'Reported'].map(x => <th key={x} className="py-1 pr-3 font-semibold">{x}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {h.runtimes.map(r => (
                    <tr key={r.runtime}>
                      <td className="py-1 pr-3">{serverName(r)}{r.runtime === s.runtime ? ' (this page)' : ''}</td>
                      <td className="py-1 pr-3 font-mono">{r.deployment ?? '—'}</td>
                      <td className="py-1 pr-3">{r.host ?? '—'}</td>
                      <td className="py-1 pr-3"><YesNo v={r.credentialDetected} /></td>
                      <td className="py-1 pr-3"><YesNo v={r.credentialFormatValid} /></td>
                      <td className="py-1 pr-3 whitespace-nowrap">{when(r.reportedAt)} · {r.context.toLowerCase()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </section>
  );
};

export default CrocodialConnectionHealth;

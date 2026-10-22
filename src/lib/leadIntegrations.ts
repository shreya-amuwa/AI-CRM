// Lead-integration addresses and keys are typed in by the team and kept in this browser only. They are never written
// into the code: the app's JavaScript is downloadable by anyone (docs/security/FINDINGS.md, SEC-2026-004).
const LEAD_INTEGRATIONS_KEY = 'amuwa.leadIntegrations';
interface LeadIntegrationSettings { webhookUrl: string; aiCallingUrl: string; apiToken: string; remoteApiUrl: string }
export function readLeadIntegrations(): LeadIntegrationSettings {
  const empty = { webhookUrl: '', aiCallingUrl: '', apiToken: '', remoteApiUrl: '' };
  try {
    const saved = JSON.parse(localStorage.getItem(LEAD_INTEGRATIONS_KEY) || '{}');
    return { ...empty, ...Object.fromEntries(Object.entries(saved).filter(([k, v]) => k in empty && typeof v === 'string')) };
  } catch {
    return empty;
  }
}
export function saveLeadIntegrations(patch: Partial<LeadIntegrationSettings>) {
  try {
    localStorage.setItem(LEAD_INTEGRATIONS_KEY, JSON.stringify({ ...readLeadIntegrations(), ...patch }));
  } catch {
    /* private window or storage blocked: the values simply are not remembered */
  }
}

import React, { useEffect, useRef, useState } from 'react';
import { ExternalLink, Globe, RefreshCw } from 'lucide-react';
import { PROFILE_FIELDS, type ProfileKey } from '../../../shared/baContent';
import type { BaClientResearch } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { businessAssociateApi } from '../../lib/api/endpoints';
import { confirmAction } from '../feedback/AppFeedback';
import { ErrorBanner } from '../team-member/pipeline/shared';
import { dateText, tcBtn } from '../telecaller/ui';

const safeUrl = (u: string) => { try { const x = new URL(u); return x.protocol === 'https:' || x.protocol === 'http:' ? x.toString() : null; } catch { return null; } };
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

/** "Tavily · 2 credits" / "Claude web search · 3 searches" and an estimate, so the cost of each research is visible. */
export function researchCostText(r: BaClientResearch): string {
  const u = r.usage || {};
  const parts: string[] = [];
  if (r.provider === 'TAVILY') parts.push(`Tavily · ${u.tavilyCredits ?? 0} credit${u.tavilyCredits === 1 ? '' : 's'}`);
  else parts.push(`Claude web search · ${u.claudeWebSearches ?? 0} search${u.claudeWebSearches === 1 ? '' : 'es'}`);
  if (typeof u.estimatedUsd === 'number') parts.push(`about $${u.estimatedUsd.toFixed(3)}`);
  if (r.provider === 'CLAUDE' && u.fallbackReason === 'TAVILY_CREDITS_USED_UP') parts.push('Tavily credits were used up');
  return parts.join(' · ');
}

/**
 * In the Scope of Project editor: researches the client on the web and suggests the profile fields. Nothing changes until the Business
 * Associate clicks "Use" (or "Fill empty fields") and then saves the draft. Each suggestion shows its sources and whether it is Verified or an
 * Assumption.
 */
export const ClientResearchPanel: React.FC<{
  contactId: string;
  inputs: Record<string, string>;
  disabled: boolean;
  onApply: (values: Partial<Record<ProfileKey, string>>) => void;
}> = ({ contactId, inputs, disabled, onApply }) => {
  const [res, setRes] = useState<BaClientResearch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    let live = true;
    businessAssociateApi.research(contactId).then(r => { if (live) setRes(r); }, () => undefined);
    return () => { live = false; };
  }, [contactId]);

  const run = async (force: boolean) => {
    if (lock.current) return;
    if (force && !(await confirmAction({
      title: 'Search the web again for this client?',
      description: 'The saved result is replaced by a new search. This uses research credits (about 2 Tavily credits).',
      confirmLabel: 'Search again', cancelLabel: 'Keep the saved result'
    }))) return;
    lock.current = true; setBusy(true); setError(null); setDone(null);
    try {
      const r = await businessAssociateApi.runResearch(contactId, force);
      setRes(r);
      setDone(r.cached ? 'This client was researched recently: the saved result is shown (no credits used).' : 'Research finished. Check each suggestion before using it.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      lock.current = false; setBusy(false);
    }
  };

  const fields = res ? PROFILE_FIELDS.filter(f => res.suggestions.fields?.[f.key]) : [];
  const emptyOnes = fields.filter(f => !(inputs[f.key] || '').trim());
  const fillEmpty = () => {
    if (!res) return;
    onApply(Object.fromEntries(emptyOnes.map(f => [f.key, res.suggestions.fields[f.key]!.value])));
    setDone(`${emptyOnes.length} empty field${emptyOnes.length === 1 ? '' : 's'} filled. Read them and save the draft to keep them.`);
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3" data-testid="client-research">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Globe className="w-4 h-4 text-blue-600" aria-hidden="true" /> Research the client online</p>
          <p className="text-xs text-slate-600">Searches the web for the business name, city and website (never phone numbers or e-mails) and suggests the fields below. A result is kept for 30 days, so opening it again costs nothing.</p>
        </div>
        {!disabled && (
          <button type="button" className={`${res ? tcBtn.secondary : tcBtn.primary} shrink-0`} disabled={busy} onClick={() => void run(!!res)}>
            {busy ? <><RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" /> Researching…</> : res ? <><RefreshCw className="w-4 h-4" aria-hidden="true" /> Search again</> : <><Globe className="w-4 h-4" aria-hidden="true" /> Research client</>}
          </button>
        )}
      </div>
      {error && <ErrorBanner message={error} />}
      {done && <p role="status" className="text-xs font-medium text-emerald-800">{done}</p>}

      {res && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">{dateText(res.createdAt)} · {researchCostText(res)}</p>
          {res.suggestions.uncertainMatch && (
            <p className="text-xs rounded-lg bg-amber-50 border border-amber-200 text-amber-900 p-2">Some results may be about a different business with a similar name. Check the sources before using a suggestion.</p>
          )}
          {res.suggestions.summary && <p className="text-sm text-slate-800">{res.suggestions.summary}</p>}
          {fields.length === 0 ? (
            <p className="text-sm text-slate-600">The web had nothing usable for the profile. Ask the client, or check the company name and city.</p>
          ) : (
            <>
              {!disabled && emptyOnes.length > 0 && (
                <button type="button" className={tcBtn.row} onClick={fillEmpty}>Fill {emptyOnes.length} empty field{emptyOnes.length === 1 ? '' : 's'}</button>
              )}
              <ul className="space-y-2">
                {fields.map(f => {
                  const s = res.suggestions.fields[f.key]!;
                  const has = !!(inputs[f.key] || '').trim();
                  const same = (inputs[f.key] || '').trim() === s.value;
                  return (
                    <li key={f.key} className="rounded-lg bg-white border border-slate-200 p-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-bold text-slate-700">{f.label}</span>
                        <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${s.basis === 'VERIFIED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{s.basis === 'VERIFIED' ? 'Verified' : 'Assumption'}</span>
                        {s.sources.map(n => {
                          const src = res.sources[n - 1];
                          const url = src && safeUrl(src.url);
                          return url ? <a key={n} href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-[11px] text-blue-700 hover:underline" title={src.title || url}>[{n}]</a> : null;
                        })}
                        {!disabled && !same && (
                          <button type="button" className="ml-auto text-xs font-bold text-blue-700 hover:underline" aria-label={`${has ? 'Replace' : 'Use'} ${f.label}`}
                            onClick={() => { onApply({ [f.key]: s.value }); setDone(`${f.label} filled. Save the draft to keep it.`); }}>{has ? 'Replace' : 'Use'}</button>
                        )}
                        {same && <span className="ml-auto text-xs text-emerald-700">In use</span>}
                      </div>
                      <p className="text-sm text-slate-800 mt-1 whitespace-pre-wrap break-words">{s.value}</p>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {res.suggestions.missingInformation.length > 0 && (
            <div className="text-xs text-slate-700"><p className="font-bold">Ask the client</p><ul className="list-disc pl-5">{res.suggestions.missingInformation.map(m => <li key={m}>{m}</li>)}</ul></div>
          )}
          {res.sources.length > 0 && (
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer font-medium">Sources ({res.sources.length})</summary>
              <ol className="list-decimal pl-5 mt-1 space-y-0.5">
                {res.sources.map((s, i) => {
                  const url = safeUrl(s.url);
                  return <li key={i} className="break-all">{url ? <a href={url} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-700 hover:underline inline-flex items-center gap-1">{s.title || hostOf(url)} <ExternalLink className="w-3 h-3" aria-hidden="true" /></a> : s.title}</li>;
                })}
              </ol>
            </details>
          )}
        </div>
      )}
    </div>
  );
};

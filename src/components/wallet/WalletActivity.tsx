import React, { useEffect, useState } from 'react';
import type { CrocodialActivity } from '../../../shared/contracts';
import { crocodialApi } from '../../lib/api/endpoints';
import { incomeApi, rupees, units, type IncomeSummary } from '../../lib/income';
import { Section, Tile } from './walletParts';

/**
 * What "My Income" showed besides the money (it moved into the Wallet, 20270221000100): today's incentives, the incentive targets and this month's
 * activity (business on the person's customers, demos and field visits completed, and calls for someone connected to Crocodial). Read from
 * income_summary, which needs the Wallet PIN like the rest of the wallet. Shown only when there is something to show: a person who earns no
 * incentives sees nothing here.
 */
const ymd = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const duration = (s: number) => { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };

export const WalletActivity: React.FC = () => {
  const [s, setS] = useState<IncomeSummary | null>(null);
  const [calls, setCalls] = useState<CrocodialActivity['calls'] | null>(null);
  useEffect(() => {
    let alive = true;
    incomeApi.summary().then(x => { if (alive) setS(x); }, () => undefined);
    const now = new Date();
    crocodialApi.me()
      .then(c => (c.enabled ? crocodialApi.activity({ from: `${ymd(now).slice(0, 8)}01`, to: ymd(now) }) : null))
      .then(a => { if (alive) setCalls(a && a.enabled && a.calls ? a.calls : null); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);
  if (!s) return null;
  const a = s.activity;
  const any = s.today > 0 || s.targets.length > 0 || a.businessThisMonth > 0 || a.demosCompletedThisMonth > 0 || a.visitsCompletedThisMonth > 0 || !!calls;
  if (!any) return null;
  return (
    <Section title="Incentives and activity" hint="Earned today, your targets, and what you did this month." label="Incentives and activity">
      <div className="p-4 space-y-4" data-testid="wallet-activity">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Tile label="Earned today" value={rupees(s.today)} testId="wallet-today" />
          <Tile label="Business this month" value={rupees(a.businessThisMonth)} hint="Verified payments on your customers" />
          <Tile label="Demos completed" value={a.demosCompletedThisMonth} hint="This month" />
          <Tile label="Field visits completed" value={a.visitsCompletedThisMonth} hint="This month" />
          {calls && <Tile label="Calls this month" value={calls.made} hint={`${calls.connected} connected · ${duration(calls.talkSeconds)} talk time`} />}
        </div>
        {s.targets.length > 0 && (
          <div className="space-y-3" aria-label="Targets">
            {s.targets.map(t => {
              const pct = Math.min(100, t.targetUnits ? (t.unitsDone / t.targetUnits) * 100 : 0);
              return (
                <div key={t.ruleId}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                    <span className="font-semibold text-slate-800">{t.serviceName || t.name}</span>
                    <span className="tabular-nums text-slate-600" data-testid="target-progress">{units(t.unitsDone)} of {units(t.targetUnits)}</span>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-label={`${t.serviceName || t.name} target`}
                    aria-valuemin={0} aria-valuemax={t.targetUnits} aria-valuenow={t.unitsDone}>
                    <div className="h-full rounded-full bg-blue-600" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
            <p className="text-xs text-slate-500">A target is a goal: every sale earns from the first one.</p>
          </div>
        )}
      </div>
    </Section>
  );
};

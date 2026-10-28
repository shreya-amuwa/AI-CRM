import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Home, Loader2, ShieldCheck } from 'lucide-react';
import type { DepartmentAccessInfo, OperationsHeadReviewItem, Profile } from '../../../shared/contracts';
import { usersApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { DIVISIONS, SEVERAL_DEPARTMENTS_REASON, cellAvailable, cellKey, cellReason, isDirty, isOtherDepartment, lockedCell, pairsToSave, savedSet, summary } from '../../lib/scope/accessMatrix';

/**
 * Access Control (Super Admin): pick an existing employee, then tick the departments and functions (Sales / Support) they work in.
 * Nothing is sent until Save; the database validates every pair and applies all of them or none. The employee keeps ONE account: only
 * their assignments change. The department list comes from the database (no list of names is kept here).
 */
export const AccessControlTab: React.FC<{
  initialProfileId?: string | null;
  /** Called after a successful save so the Team Members tab refreshes its lists. */
  onSaved: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}> = ({ initialProfileId, onSaved, onDirtyChange }) => {
  const [heads, setHeads] = useState<Profile[]>([]);
  const [headsError, setHeadsError] = useState<string | null>(null);
  const [profileId, setProfileId] = useState<string>(initialProfileId || '');
  const [info, setInfo] = useState<DepartmentAccessInfo | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const dirty = !!info && isDirty(draft, saved);
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);
  // A reload or closing the tab while changes are unsaved asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const [review, setReview] = useState<OperationsHeadReviewItem[]>([]);
  const [roleBusy, setRoleBusy] = useState(false);
  const loadHeads = useCallback(() => {
    usersApi.list({ role: 'DEPARTMENT_HEAD', status: 'ACTIVE', pageSize: 100 }).then(
      r => setHeads(r.items),
      err => setHeadsError(errorMessage(err))
    );
    usersApi.operationsHeadReview().then(setReview, () => setReview([]));
  }, []);
  useEffect(loadHeads, [loadHeads]);

  const load = useCallback(async (id: string) => {
    if (!id) {
      setInfo(null);
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      const next = await usersApi.departmentAccess(id);
      setInfo(next);
      const s = savedSet(next);
      setSaved(s);
      setDraft(new Set(s));
    } catch (err) {
      setInfo(null);
      setMessage({ text: errorMessage(err), ok: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialProfileId && initialProfileId !== profileId) setProfileId(initialProfileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialProfileId]);
  useEffect(() => {
    void load(profileId);
  }, [profileId, load]);

  const choose = (id: string) => {
    if (id !== profileId && dirty && !window.confirm('You have unsaved access changes. Switch employee anyway? They will be lost.')) return;
    setProfileId(id);
  };

  const locked = info ? lockedCell(info) : null;
  const toggle = (key: string) =>
    setDraft(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  /** Make the selected Department Head an Operations Head (or take it back). Only the Super Admin; the database audits it and tells the person. */
  const changeRole = async (value: boolean) => {
    if (!selected) return;
    const text = value
      ? `Make ${selected.fullName} an Operations Head? They will be able to oversee the departments you tick below.`
      : `Remove ${selected.fullName} as Operations Head? The departments other than their own are withdrawn (their own department stays).`;
    if (!window.confirm(text)) return;
    setRoleBusy(true);
    setMessage(null);
    try {
      await usersApi.setOperationsHead(selected.id, value);
      loadHeads();
      await load(selected.id);
      setMessage({ text: value ? `${selected.fullName} is now an Operations Head.` : `${selected.fullName} is a Department Head again.`, ok: true });
      onSaved();
    } catch (err) {
      setMessage({ text: errorMessage(err), ok: false });
    } finally {
      setRoleBusy(false);
    }
  };

  const save = async () => {
    if (!info) return;
    setSaving(true);
    setMessage(null);
    try {
      const next = await usersApi.applyDepartmentAccess(info.profileId, pairsToSave(draft, info));
      setInfo(next);
      const s = savedSet(next);
      setSaved(s);
      setDraft(new Set(s));
      setMessage({ text: `Saved. ${next.added ?? 0} added, ${next.removed ?? 0} removed. The employee's lists and dashboards are updated.`, ok: true });
      onSaved();
    } catch (err) {
      setMessage({ text: errorMessage(err), ok: false });
    } finally {
      setSaving(false);
    }
  };

  const current = useMemo(() => (info ? summary(saved, info) : []), [info, saved]);
  const selected = heads.find(h => h.id === profileId) || null;

  return (
    <section className="space-y-4" aria-label="Access Control" data-testid="access-control-tab">
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-3">
        <label className="block text-xs font-semibold text-slate-700">
          Employee
          <select
            className="mt-1 w-full sm:max-w-xl px-3 py-2.5 rounded-xl border border-slate-200 bg-white text-sm cursor-pointer"
            value={profileId}
            onChange={e => choose(e.target.value)}
            data-testid="access-employee"
          >
            <option value="">Select a Department Head…</option>
            {heads.map(h => (
              <option key={h.id} value={h.id}>
                {h.fullName} · {h.email}
                {h.isOperationsHead ? ' · Operations Head' : ''}
                {h.department ? ` · home: ${h.department.name}` : ''}
              </option>
            ))}
            {profileId && !selected && <option value={profileId}>(selected employee)</option>}
          </select>
          <span className="block mt-1 font-normal text-slate-500">
            Only an Operations Head works in several departments. A Department Head works in one department (and may handle both Sales and Support of it); other roles keep the one department they were created in.
          </span>
        </label>
        {headsError && <p role="alert" className="text-xs text-rose-600">{headsError}</p>}
      </div>

      {review.some(r => r.needsDecision) && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900 space-y-2" role="status" data-testid="operations-head-review">
          <p className="font-bold">Decision needed: Department Heads who work in several departments</p>
          <p>
            These heads were given other departments before the Operations Head role existed. Nothing was taken away: they keep their access until you decide. Make each one an
            Operations Head, or untick the extra departments.
          </p>
          <ul className="flex flex-wrap gap-2">
            {review.filter(r => r.needsDecision).map(r => (
              <li key={r.profileId}>
                <button type="button" className="rounded-full border border-amber-300 bg-white px-3 py-1 font-semibold hover:bg-amber-100" onClick={() => choose(r.profileId)}>
                  {r.name} ({r.homeDepartment ?? '-'} + {r.extraDepartments.map(x => x.department).join(', ')})
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {selected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs" data-testid="operations-head-box">
          <p className="text-slate-700">
            <strong>{selected.fullName}</strong> is {selected.isOperationsHead ? 'an Operations Head: oversees the departments ticked below.' : 'a Department Head: works in one department.'}
          </p>
          <button
            type="button"
            disabled={roleBusy}
            onClick={() => void changeRole(!selected.isOperationsHead)}
            className="rounded-xl border border-slate-200 px-3 py-1.5 font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            data-testid="operations-head-toggle"
          >
            {selected.isOperationsHead ? 'Remove Operations Head' : 'Make Operations Head'}
          </button>
        </div>
      )}
      {!profileId && <p className="text-sm text-slate-500 px-1">Choose an employee to see and change their departments and functions.</p>}
      {loading && (
        <p className="flex items-center gap-2 text-sm text-slate-600 px-1" role="status">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading access…
        </p>
      )}

      {info && !loading && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-blue-600" aria-hidden="true" /> {info.name}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                One account. Tick every department and function this person works in; untick to withdraw access. The home department
                <Home className="inline w-3 h-3 mx-1 text-blue-600" aria-label="home" />
                is where they were created{info.headDivision ? `, and its ${info.headDivision === 'SALES' ? 'Sales' : 'Support'} side always stays` : ''}.
              </p>
            </div>
            {dirty && (
              <span className="shrink-0 text-[11px] font-bold text-amber-800 bg-amber-100 border border-amber-200 rounded-full px-2.5 py-1" role="status" data-testid="unsaved-badge">
                Unsaved changes
              </span>
            )}
          </div>

          <div className="overflow-x-auto -mx-1 px-1">
            <table className="w-full min-w-[420px] text-sm" data-testid="access-matrix">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-3 font-semibold">Department</th>
                  {DIVISIONS.map(d => (
                    <th key={d} className="py-2 px-3 font-semibold text-center w-28">{d === 'SALES' ? 'Sales' : 'Support'}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {info.departments.map(dep => (
                  <tr key={dep.id} className="border-b border-slate-50">
                    <th scope="row" className="py-2.5 pr-3 text-left font-semibold text-slate-800">
                      {dep.name}
                      {dep.id === info.homeDepartmentId && (
                        <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-100 rounded-full px-1.5 py-0.5">
                          <Home className="w-3 h-3" aria-hidden="true" /> HOME
                        </span>
                      )}
                    </th>
                    {DIVISIONS.map(d => {
                      const key = cellKey(dep.id, d);
                      // another department is for an Operations Head; one already given (kept from before) can still be taken back
                      const reason = cellReason(dep, d) || (!selected?.isOperationsHead && isOtherDepartment(info, dep) && !saved.has(key) ? SEVERAL_DEPARTMENTS_REASON : null);
                      const isLocked = key === locked;
                      return (
                        <td key={d} className="py-2.5 px-3 text-center">
                          <input
                            type="checkbox"
                            className="h-5 w-5 cursor-pointer disabled:cursor-not-allowed"
                            checked={draft.has(key)}
                            disabled={!!reason || isLocked || saving}
                            title={isLocked ? 'The head’s own department and side always stay' : reason || undefined}
                            aria-label={`${d === 'SALES' ? 'Sales' : 'Support'} access to ${dep.name}`}
                            onChange={() => toggle(key)}
                            data-testid={`cell-${dep.slug}-${d.toLowerCase()}`}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {current.length > 0 && (
            <p className="text-xs text-slate-600" data-testid="access-summary">
              <span className="font-semibold text-slate-700">Currently works in:</span> {current.join(', ')}
            </p>
          )}

          {message && (
            <div role={message.ok ? 'status' : 'alert'} className={`p-2.5 rounded-xl text-xs border flex items-start gap-2 ${message.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
              {message.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />}
              <span>{message.text}</span>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setDraft(new Set(saved));
                setMessage(null);
              }}
              disabled={!dirty || saving}
              className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              data-testid="access-cancel"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!dirty || saving}
              className="px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              data-testid="access-save"
            >
              {saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />} {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

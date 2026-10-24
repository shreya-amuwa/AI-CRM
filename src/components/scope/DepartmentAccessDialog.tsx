import React, { useCallback, useEffect, useState } from 'react';
import { HEAD_DIVISION_LABELS, type DepartmentAccessInfo, type HeadDivision, type Profile } from '../../../shared/contracts';
import { usersApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { Dialog } from '../team-member/pipeline/shared';

/**
 * Super Admin only: decides which departments a Department Head covers and in which function (Sales / Support).
 * One tick is one (department, function) pair. The database refuses a pair when the department has no team
 * of that function, so those boxes are disabled here and the server enforces the same rule independently.
 */
const DIVISIONS: HeadDivision[] = ['SALES', 'SUPPORT'];

export const DepartmentAccessDialog: React.FC<{ member: Pick<Profile, 'id' | 'fullName'>; onClose: () => void }> = ({ member, onClose }) => {
  const [info, setInfo] = useState<DepartmentAccessInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setInfo(await usersApi.departmentAccess(member.id));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [member.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const granted = (departmentId: string, division: HeadDivision) =>
    !!info?.grants.some(g => g.departmentId === departmentId && g.division === division);

  const toggle = async (departmentId: string, division: HeadDivision, value: boolean) => {
    const key = `${departmentId}:${division}`;
    setBusyKey(key);
    setError(null);
    try {
      await usersApi.setDepartmentAccess(member.id, { departmentId, division, granted: value });
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <Dialog
      title={`Departments & functions · ${member.fullName}`}
      description="Tick the departments this Department Head also manages and in which function. The home department always stays available."
      onClose={onClose}
      wide
    >
      <div className="space-y-3" data-testid="department-access-dialog">
        {error && <p role="alert" className="text-xs font-semibold text-rose-600">{error}</p>}
        {!info && !error && <p className="text-xs text-slate-500">Loading…</p>}
        {info && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="py-2 pr-3 font-semibold">Department</th>
                  {DIVISIONS.map(d => <th key={d} className="py-2 px-3 font-semibold text-center">{HEAD_DIVISION_LABELS[d]}</th>)}
                </tr>
              </thead>
              <tbody>
                {info.departments.map(dep => (
                  <tr key={dep.id} className="border-b border-slate-50">
                    <td className="py-2 pr-3 font-semibold text-slate-800">
                      {dep.name}
                      {dep.id === info.homeDepartmentId && <span className="ml-2 text-[10px] font-bold text-blue-600">HOME</span>}
                    </td>
                    {DIVISIONS.map(d => {
                      const available = d === 'SALES' ? dep.hasSales : dep.hasSupport;
                      const key = `${dep.id}:${d}`;
                      return (
                        <td key={d} className="py-2 px-3 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
                            checked={granted(dep.id, d)}
                            disabled={!available || busyKey !== null}
                            title={available ? undefined : `${dep.name} has no ${HEAD_DIVISION_LABELS[d]} team yet`}
                            aria-label={`${HEAD_DIVISION_LABELS[d]} access to ${dep.name}`}
                            onChange={e => void toggle(dep.id, d, e.target.checked)}
                            data-testid={`access-${dep.slug}-${d.toLowerCase()}`}
                          />
                          {busyKey === key && <span className="sr-only">Saving</span>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end pt-1">
          <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Close
          </button>
        </div>
      </div>
    </Dialog>
  );
};

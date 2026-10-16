import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LeaveMonthEmployee } from '../../shared/contracts';
import type { Employee } from '../types/amuwaHq';
import { hrApi } from '../lib/api/endpoints';
import { errorMessage } from '../lib/api/client';
import { officeMonth } from '../lib/officeTime';

export interface MonthlyCounts {
  halfDays: number;
  leaveDays: number;
}

/**
 * Half days and leave days of the chosen month (YYYY-MM).
 *  - Employees with a CRM account: approved leave requests from the database (a leave that spans months counts the
 *    days that fall in each month; Sundays, the weekly off, are not counted; a half day counts once).
 *  - Leave noted by HR on an employee record (one record per date): the records dated in that month.
 */
export function useMonthlyLeave(options: { database?: boolean } = {}) {
  const database = options.database !== false;
  const [month, setMonth] = useState(officeMonth());
  const [byProfile, setByProfile] = useState<Map<string, LeaveMonthEmployee>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!database) { setLoading(false); return; }
    setLoading(true);
    try {
      const summary = await hrApi.monthlySummary(month);
      setByProfile(new Map(summary.employees.map(e => [e.profileId, e])));
      setError('');
    } catch (err) {
      setByProfile(new Map());
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [month, database]);

  useEffect(() => { void load(); }, [load]);

  const countsFor = useCallback((emp: Employee): MonthlyCounts => {
    const db = emp.profileId ? byProfile.get(emp.profileId) : undefined;
    let halfDays = db?.halfDays ?? 0;
    let leaveDays = db?.leaveDays ?? 0;
    for (const rec of emp.leaveHistory ?? []) {
      if (rec.status !== 'Active' || !rec.date?.startsWith(month)) continue;
      if (rec.leaveType === 'Half-Day') halfDays += 1;
      else leaveDays += 1;
    }
    return { halfDays, leaveDays };
  }, [byProfile, month]);

  return useMemo(() => ({ month, setMonth, loading, error, reload: load, countsFor }), [month, loading, error, load, countsFor]);
}

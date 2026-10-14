import { useCallback, useEffect, useState } from 'react';
import type { DivisionSupportOverview } from '../../../../../shared/contracts';
import { errorMessage } from '../../../../lib/api/client';
import { organizationApi, pipelineApi } from '../../../../lib/api/endpoints';
import { useRealtime } from '../../../../lib/support';
import { usePipelineRealtime } from '../../../team-member/pipeline/shared';

/**
 * The teams of the Support division of a department (the Wabastore Support sub-department):
 * department id + team division SUPPORT, never matched by name. `undefined` while loading.
 */
export function useSupportTeamIds(departmentId: string | undefined): string[] | undefined {
  const [ids, setIds] = useState<string[] | undefined>();
  useEffect(() => {
    if (!departmentId) return;
    organizationApi.teams(departmentId).then(
      teams => setIds(teams.filter(t => t.division === 'SUPPORT').map(t => t.id)),
      () => setIds([])
    );
  }, [departmentId]);
  return ids;
}

/** Real team numbers for Wabastore Support (members, customers added, tickets by status, tasks). */
export function useSupportOverview(departmentId: string | undefined) {
  const [data, setData] = useState<DivisionSupportOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!departmentId) return;
    pipelineApi
      .divisionSupportOverview(departmentId, 'SUPPORT')
      .then(setData, err => setError(errorMessage(err)))
      .finally(() => setLoading(false));
    setError(null);
  }, [departmentId]);

  useEffect(load, [load]);
  usePipelineRealtime(load);
  // Tickets and tasks change in their own tables: reload when they do (no timer).
  useRealtime('support_tickets', load);
  useRealtime('work_tasks', load);
  return { data, error, loading, reload: load };
}

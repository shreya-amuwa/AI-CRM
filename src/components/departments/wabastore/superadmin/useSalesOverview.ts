import { useCallback, useEffect, useState } from 'react';
import type { DivisionLeadsOverview } from '../../../../../shared/contracts';
import { errorMessage } from '../../../../lib/api/client';
import { pipelineApi } from '../../../../lib/api/endpoints';
import { usePipelineRealtime } from '../../../team-member/pipeline/shared';
import { useDepartments } from '../../../../context/DepartmentContext';

/** The Wabastore department id (database uuid) - the sub-department is department + the SALES team division. */
export function useWabastoreId(): string | undefined {
  const { departments } = useDepartments();
  return departments.find(d => d.id === 'wabastore')?.dbId;
}

/** Real team numbers for Wabastore Sales (members, leads added, status mix, follow-ups). Refreshes like the pipeline views. */
export function useSalesOverview(departmentId: string | undefined) {
  const [data, setData] = useState<DivisionLeadsOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    if (!departmentId) return;
    pipelineApi
      .divisionOverview(departmentId, 'SALES')
      .then(setData, err => setError(errorMessage(err)))
      .finally(() => setLoading(false));
    setError(null);
  }, [departmentId]);

  useEffect(load, [load]);
  usePipelineRealtime(load);
  return { data, error, loading, reload: load };
}

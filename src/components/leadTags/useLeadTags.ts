import { useCallback, useEffect, useMemo, useState } from 'react';
import type { LeadTag } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { leadTagsApi } from '../../lib/api/leadTags';

/**
 * The lead tags the signed-in person may see (with a department: those visible there). `reload()` reads them again.
 * `skip`: nothing is read yet (e.g. the lead, and so its department, is still loading).
 */
export function useLeadTags(departmentId?: string, opts: { skip?: boolean } = {}): { tags: LeadTag[]; byId: Map<string, LeadTag>; reload: () => void; loading: boolean; error: string } {
  const [tags, setTags] = useState<LeadTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [n, setN] = useState(0);
  const skip = !!opts.skip;
  useEffect(() => {
    if (skip) return;
    let live = true;
    setLoading(true);
    leadTagsApi.list(departmentId)
      .then(list => { if (live) { setTags(Array.isArray(list) ? list : []); setError(''); } })
      .catch(e => { if (live) setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not load the lead tags.'); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [departmentId, n, skip]);
  const byId = useMemo(() => new Map(tags.map(t => [t.id, t])), [tags]);
  const reload = useCallback(() => setN(x => x + 1), []);
  return { tags, byId, reload, loading, error };
}

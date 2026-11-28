import { useCallback, useEffect, useRef, useState } from 'react';
import type { SupportRechargeList } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { rechargesApi, type RechargeListQuery } from '../../lib/api/endpoints';
import { useDebounced } from '../team-member/pipeline/shared';

/** One list of recharges: loads again when its filters change; a late answer for an old filter is ignored. */
export function useRecharges(query: RechargeListQuery) {
  const [data, setData] = useState<SupportRechargeList | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const search = useDebounced(query.search ?? '', 300);
  const { kind, paymentStatus, invoiceStatus, from, to, min, max, rm, limit, offset } = query;
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError('');
    try {
      const r = await rechargesApi.list({ kind, search, paymentStatus, invoiceStatus, from, to, min, max, rm, limit, offset });
      if (mine === seq.current) setData(r);
    } catch (e) {
      if (mine === seq.current) setError(errorMessage(e));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [kind, search, paymentStatus, invoiceStatus, from, to, min, max, rm, limit, offset]);
  useEffect(() => { void load(); }, [load]);
  return { data, error, loading, reload: load };
}

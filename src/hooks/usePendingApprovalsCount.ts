import { useCallback, useEffect, useState } from 'react';
import { approvalsApi } from '../lib/api/endpoints';
import { getSupabase } from '../services/supabaseClient';
import { useAuth } from '../context/AuthContext';

export const APPROVALS_CHANGED_EVENT = 'crm:approvals-changed';

/**
 * Number of registration requests the current user may decide. The server
 * (RLS) decides which requests are visible; Realtime pings trigger a refetch.
 */
export function usePendingApprovalsCount(): number {
  const { profile } = useAuth();
  const isManager = !!profile && profile.role !== 'TEAM_MEMBER';
  const [count, setCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!isManager) return setCount(0);
    try {
      setCount((await approvalsApi.list({ status: 'PENDING', pageSize: 1 })).total);
    } catch {
      setCount(0);
    }
  }, [isManager]);

  useEffect(() => {
    void refresh();
    if (!isManager) return;
    const supabase = getSupabase();
    const channel = supabase
      ?.channel(`approvals-${profile!.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_requests' }, () => void refresh())
      .subscribe();
    window.addEventListener(APPROVALS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener(APPROVALS_CHANGED_EVENT, refresh);
      if (channel) void supabase?.removeChannel(channel);
    };
  }, [isManager, profile, refresh]);

  return count;
}

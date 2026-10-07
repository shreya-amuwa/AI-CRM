import { useEffect, useReducer } from 'react';
import { teamMemberStore } from '../services/teamMemberStore';

/** Re-renders the caller whenever the member workspace changes (any device). */
export function useTeamMemberStore() {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => teamMemberStore.subscribe(rerender), []);
  return teamMemberStore;
}

import { useCallback, useState, type Dispatch, type SetStateAction } from 'react';
import { useAuth } from '../context/AuthContext';
import { PREFIX, read, write } from '../lib/rememberedPage';

/** useState for the current page of a dashboard. `name` tells dashboards apart; `valid` lists the pages that exist. */
export function useRememberedPage<T extends string>(name: string, fallback: T, valid: readonly T[]): [T, Dispatch<SetStateAction<T>>] {
  const { user } = useAuth();
  const key = user ? `${PREFIX}${user.id}.${name}` : null;
  const [page, setPage] = useState<T>(() => (key ? read(key, valid) : null) ?? fallback);
  const set: Dispatch<SetStateAction<T>> = useCallback(
    next => {
      setPage(prev => {
        const value = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        if (key && value !== prev) write(key, value);
        return value;
      });
    },
    [key]
  );
  return [page, set];
}

import type { PostgrestError } from '@supabase/supabase-js';
import { AppError, fromDatabaseError } from '../http/errors.js';

export interface PageRequest {
  page: number;
  pageSize: number;
}

export function pageRange({ page, pageSize }: PageRequest): [number, number] {
  const from = (page - 1) * pageSize;
  return [from, from + pageSize - 1];
}

/** Throw a mapped AppError for a failed query, otherwise return the data. */
export function unwrap<T>(result: { data: T | null; error: PostgrestError | null }): T {
  if (result.error) throw fromDatabaseError(result.error);
  return result.data as T;
}

/** Like unwrap, but a missing row becomes NOT_FOUND (RLS hides rows as "missing"). */
export function unwrapOne<T>(result: { data: T | null; error: PostgrestError | null }, what = 'Record'): T {
  const data = unwrap(result);
  if (data === null || data === undefined) throw new AppError('NOT_FOUND', `${what} not found.`);
  return data;
}

/** Escape LIKE wildcards in user-supplied search text. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, c => `\\${c}`).toLowerCase()}%`;
}

/** Drop undefined keys so PATCH only touches provided columns. */
export function compact<T extends Record<string, unknown>>(row: T): Partial<T> {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined)) as Partial<T>;
}

import { useCallback, useEffect, useState } from 'react';
import type { CustomerSegment, CustomerStatus, CustomerSummary } from '../../shared/contracts';
import type { CustomerCreateInput } from '../../shared/validation';
import type { Customer } from '../types/crm';
import { customersApi, type CustomerQuery } from '../lib/api/endpoints';
import { errorMessage } from '../lib/api/client';
import { toViewCustomer } from '../lib/customers';

export interface CustomerFilters {
  search: string;
  segment?: CustomerSegment;
  status?: CustomerStatus;
  sort: NonNullable<CustomerQuery['sort']>;
  order: NonNullable<CustomerQuery['order']>;
  page: number;
  pageSize: number;
}

const EMPTY_SUMMARY: CustomerSummary = { total: 0, active: 0, inactive: 0, prospect: 0, newThisMonth: 0, newLastMonth: 0, bySegment: {} };

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

/**
 * Server-driven customer list: filtering, sorting and pagination happen in
 * the database (RLS decides which customers are visible). Only one page is
 * held in memory; search is debounced.
 */
export function useCustomers(filters: CustomerFilters) {
  const search = useDebounced(filters.search.trim(), 300);
  const [items, setItems] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<CustomerSummary>(EMPTY_SUMMARY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { segment, status, sort, order, page, pageSize } = filters;

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Leads and potential customers live in My Leads; customers start at onboarding.
      const result = await customersApi.list({
        search: search || undefined,
        segment,
        status,
        sort,
        order,
        page,
        pageSize,
        lifecycle: 'ONBOARDING,CUSTOMER'
      });
      setItems(result.items.map(toViewCustomer));
      setTotal(result.total);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [search, segment, status, sort, order, page, pageSize]);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await customersApi.summary());
    } catch {
      /* KPIs are non-critical */
    }
  }, []);

  useEffect(() => {
    void loadPage();
  }, [loadPage]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const reload = useCallback(async () => {
    await Promise.all([loadPage(), loadSummary()]);
  }, [loadPage, loadSummary]);

  /** Persist a customer; the UI is refreshed from the database afterwards. */
  const createCustomer = useCallback(
    async (input: CustomerCreateInput): Promise<Customer> => {
      const created = await customersApi.create(input);
      await reload();
      return toViewCustomer(created);
    },
    [reload]
  );

  return { items, total, summary, loading, error, reload, createCustomer };
}

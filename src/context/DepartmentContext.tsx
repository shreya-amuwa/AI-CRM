import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { Department as DepartmentDto } from '../../shared/contracts';
import { Department, DepartmentId, DepartmentCreateInput } from '../types/crm';
import { organizationApi } from '../lib/api/endpoints';
import { errorMessage } from '../lib/api/client';
import { getSupabase } from '../services/supabaseClient';

/**
 * Departments are loaded from the database (GET /api/v1/departments) once the
 * user is signed in. Mutations go through the API, which only allows Super
 * Admins; the UI state is replaced with the server's response.
 */
interface DepartmentContextType {
  departments: Department[];
  /** Also the departments that are only the Sales / Support side of another (Wabatalk): for assigning a Department Head and for income screens. */
  allDepartments: (Department & { facetOf: string | null; facetDivision: 'SALES' | 'SUPPORT' | null })[];
  loading: boolean;
  getDepartment: (id: DepartmentId) => Department | undefined;
  addDepartment: (input: DepartmentCreateInput) => Promise<{ ok: boolean; error?: string; department?: Department }>;
  deleteDepartment: (id: DepartmentId) => Promise<{ ok: boolean; error?: string }>;
  refreshDepartments: () => Promise<void>;
}

export const DepartmentContext = createContext<DepartmentContextType | undefined>(undefined);

function toDepartment(d: DepartmentDto): Department {
  return {
    id: d.slug,
    dbId: d.id,
    name: d.name,
    description: d.description,
    category: d.category || undefined,
    iconName: d.iconName,
    accentColor: d.accentColor,
    logoUrl: d.logoUrl || undefined,
    // Lead counters / session limits are UI-only and not stored server-side.
    totalLeads: 0,
    activeSessions: 0,
    maxSessions: 2,
    locked: d.isLocked,
    createdAt: d.createdAt
  };
}

export const DepartmentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [allDepartments, setAllDepartments] = useState<DepartmentContextType['allDepartments']>([]);
  const [loading, setLoading] = useState(false);

  const refreshDepartments = useCallback(async () => {
    setLoading(true);
    try {
      // A department that is only the Sales / Support side of another (Wabatalk = D Talk's Support) has no people or teams of its own,
      // so the department hub, staff forms and sign-up lists show the real department; Accounts and the scope picker list the side too.
      const all = await organizationApi.departments();
      setAllDepartments(all.map(d => ({ ...toDepartment(d), facetOf: d.facetOf ?? null, facetDivision: d.facetDivision ?? null })));
      setDepartments(all.filter(d => !d.facetOf).map(toDepartment));
    } catch {
      setDepartments([]); // signed out / not yet approved
      setAllDepartments([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    try {
      // Old browser-side copies are no longer used.
      ['unified_crm_departments_v1', 'unified_crm_departments_v2'].forEach(k => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    const supabase = getSupabase();
    if (!supabase) return;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        if (!session || event === 'SIGNED_OUT') { setDepartments([]); setAllDepartments([]); }
        else if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') void refreshDepartments();
      }, 0);
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshDepartments]);

  const getDepartment = useCallback((id: DepartmentId) => departments.find(d => d.id === id), [departments]);

  const withDbId = (id: DepartmentId) => departments.find(d => d.id === id)?.dbId;

  const addDepartment = useCallback(async (input: DepartmentCreateInput) => {
    try {
      const created = toDepartment(
        await organizationApi.createDepartment({ name: input.name, description: input.description, category: input.category })
      );
      setDepartments(prev => [...prev, created]);
      return { ok: true, department: created };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  }, []);

  const deleteDepartment = useCallback(
    async (id: DepartmentId) => {
      const dbId = withDbId(id);
      if (!dbId) return { ok: false, error: 'Department not found.' };
      try {
        await organizationApi.deleteDepartment(dbId);
        setDepartments(prev => prev.filter(d => d.id !== id));
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [departments]
  );

  return (
    <DepartmentContext.Provider
      value={{
        departments,
        allDepartments,
        loading,
        getDepartment,
        addDepartment,
        deleteDepartment,
        refreshDepartments
      }}
    >
      {children}
    </DepartmentContext.Provider>
  );
};

export const useDepartments = () => {
  const context = useContext(DepartmentContext);
  if (!context) throw new Error('useDepartments must be used within DepartmentProvider');
  return context;
};

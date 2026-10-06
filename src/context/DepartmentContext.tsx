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
  loading: boolean;
  getDepartment: (id: DepartmentId) => Department | undefined;
  addDepartment: (input: DepartmentCreateInput) => Promise<{ ok: boolean; error?: string; department?: Department }>;
  deleteDepartment: (id: DepartmentId) => Promise<{ ok: boolean; error?: string }>;
  refreshDepartments: () => Promise<void>;
  lockDepartment: (id: DepartmentId) => Promise<{ ok: boolean; error?: string }>;
  unlockDepartment: (id: DepartmentId) => Promise<{ ok: boolean; error?: string }>;
}

const DepartmentContext = createContext<DepartmentContextType | undefined>(undefined);

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
  const [loading, setLoading] = useState(false);

  const refreshDepartments = useCallback(async () => {
    setLoading(true);
    try {
      setDepartments((await organizationApi.departments()).map(toDepartment));
    } catch {
      setDepartments([]); // signed out / not yet approved
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
        if (!session || event === 'SIGNED_OUT') setDepartments([]);
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

  const setLocked = useCallback(
    async (id: DepartmentId, isLocked: boolean) => {
      const dbId = withDbId(id);
      if (!dbId) return { ok: false, error: 'Department not found.' };
      try {
        const updated = toDepartment(await organizationApi.updateDepartment(dbId, { isLocked }));
        setDepartments(prev => prev.map(d => (d.id === id ? updated : d)));
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
        loading,
        getDepartment,
        addDepartment,
        deleteDepartment,
        refreshDepartments,
        lockDepartment: id => setLocked(id, true),
        unlockDepartment: id => setLocked(id, false)
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

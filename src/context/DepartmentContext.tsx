import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Department, DepartmentId, DepartmentCreateInput } from '../types/crm';
import { DEPARTMENTS as SEED_DEPARTMENTS } from '../data/departments';

const STORAGE_KEY = 'unified_crm_departments_v3';

const FALLBACK_ICONS = ['Building2', 'Sparkles', 'Star', 'ShoppingBag', 'MessageSquare', 'PhoneCall', 'Cpu', 'Layers'];
const FALLBACK_COLORS = ['#3B82F6', '#0EA5E9', '#6366F1', '#14B8A6', '#F97316', '#A855F7', '#EAB308', '#EF4444'];

const slugify = (name: string) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || `dept-${Date.now()}`;

interface DepartmentContextType {
  departments: Department[];
  getDepartment: (id: DepartmentId) => Department | undefined;
  addDepartment: (input: DepartmentCreateInput) => { ok: boolean; error?: string; department?: Department };
  deleteDepartment: (id: DepartmentId) => void;
  resetToDefaults: () => void;
  lockDepartment: (id: DepartmentId) => void;
  unlockDepartment: (id: DepartmentId) => void;
}

const DepartmentContext = createContext<DepartmentContextType | undefined>(undefined);

export const DepartmentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [departments, setDepartments] = useState<Department[]>(() => {
    try {
      if (typeof window !== 'undefined') {
        localStorage.removeItem('unified_crm_departments_v1');
        localStorage.removeItem('unified_crm_departments_v2');
      }
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Check that all 10 official seed departments exist
          const hasAllSeed = SEED_DEPARTMENTS.every(seed => parsed.some((p: any) => p.id === seed.id));
          if (hasAllSeed) {
            // Strip out stale test departments like 'ai-studio' or 'business'
            const cleaned = parsed.filter((p: any) => {
              const lowerName = (p.name || '').toLowerCase().trim();
              const lowerId = (p.id || '').toLowerCase().trim();
              return (
                lowerId !== 'ai-studio' &&
                lowerId !== 'business' &&
                lowerName !== 'ai studio' &&
                lowerName !== 'business'
              );
            });
            return cleaned;
          }
        }
      }
    } catch (e) {}
    // Always fall back to SEED_DEPARTMENTS if localStorage is missing, corrupted, or outdated
    return SEED_DEPARTMENTS;
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(departments));
    } catch (e) {}
  }, [departments]);

  const getDepartment = useCallback(
    (id: DepartmentId) => departments.find(d => d.id === id),
    [departments]
  );

  // IMPORTANT: real departments only ever live in this array. The "Add
  // Department" card is a UI affordance rendered after this list — it is
  // never stored here, so it can never end up positioned before a real
  // department.
  const addDepartment = useCallback(
    (input: DepartmentCreateInput) => {
      const name = input.name.trim();
      if (!name) return { ok: false, error: 'Department name is required.' };

      const duplicate = departments.some(d => d.name.trim().toLowerCase() === name.toLowerCase());
      if (duplicate) return { ok: false, error: 'A department with this name already exists.' };

      const id = slugify(name);
      if (departments.some(d => d.id === id)) {
        return { ok: false, error: 'A department with a conflicting identifier already exists.' };
      }

      const idx = departments.length % FALLBACK_ICONS.length;
      const newDepartment: Department = {
        id,
        name,
        description: input.description?.trim() || '',
        category: input.category?.trim() || undefined,
        iconName: FALLBACK_ICONS[idx],
        accentColor: FALLBACK_COLORS[idx],
        totalLeads: 0,
        activeSessions: 0,
        maxSessions: 2,
        locked: false,
        createdAt: new Date().toISOString()
      };

      // Appended to the end of the real-department collection — ordering of
      // the Add Department card relative to this list is handled entirely
      // by the rendering layer (DepartmentSelector), never here.
      setDepartments(prev => [...prev, newDepartment]);
      return { ok: true, department: newDepartment };
    },
    [departments]
  );

  const deleteDepartment = useCallback((id: DepartmentId) => {
    setDepartments(prev => {
      // Never delete official seed departments
      if (SEED_DEPARTMENTS.some(s => s.id === id)) return prev;
      return prev.filter(d => d.id !== id);
    });
  }, []);

  const resetToDefaults = useCallback(() => {
    setDepartments(SEED_DEPARTMENTS);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(SEED_DEPARTMENTS));
    } catch {}
  }, []);

  const lockDepartment = useCallback((id: DepartmentId) => {
    setDepartments(prev => prev.map(d => (d.id === id ? { ...d, locked: true } : d)));
  }, []);

  const unlockDepartment = useCallback((id: DepartmentId) => {
    setDepartments(prev => prev.map(d => (d.id === id ? { ...d, locked: false } : d)));
  }, []);

  return (
    <DepartmentContext.Provider
      value={{
        departments,
        getDepartment,
        addDepartment,
        deleteDepartment,
        resetToDefaults,
        lockDepartment,
        unlockDepartment
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

// Stand-ins for the app's contexts, so the real Add Member form renders without the providers (a Super Admin, three departments).
export const useAuth = () => ({ profile: (window as any).__profile, user: (window as any).__profile });
export const useDepartments = () => ({ departments: (window as any).__departments, allDepartments: (window as any).__departments.map((d: any) => ({ ...d, facetOf: null, facetDivision: null })) });

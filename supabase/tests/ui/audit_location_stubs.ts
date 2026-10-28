// Stand-ins for the three contexts, so the real components render without the app's providers.
export const useAuth = () => ({
  user: (window as any).__user,
  selectDepartment: (id: string) => {
    (window as any).__entered.push(id);
    return true;
  }
});
export const useDepartments = () => ({
  departments: (window as any).__departments,
  addDepartment: async () => ({ ok: true }),
  deleteDepartment: async () => ({ ok: true })
});
export const useTabs = () => ({ openDepartment: () => undefined, tabs: [] });

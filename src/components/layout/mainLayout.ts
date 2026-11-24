/**
 * The class of the dashboard's main content area (App.tsx). Chat fills the area edge to edge. Every other page sits in a centred column:
 * the HR dashboard uses a wider one (its grids of cards and tables use a 16:9 desktop well), the other dashboards keep theirs.
 */
export function mainClassFor(activeTab: string, departmentId: string | null | undefined): string {
  if (activeTab === 'chat') return 'flex-1 min-w-0 w-full';
  if (departmentId === 'hr') return 'flex-1 min-w-0 px-3 py-4 sm:px-6 sm:py-6 2xl:px-8 overflow-y-auto max-w-[1600px] mx-auto w-full';
  return 'flex-1 min-w-0 p-3 sm:p-6 overflow-y-auto max-w-7xl mx-auto w-full';
}

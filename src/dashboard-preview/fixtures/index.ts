import type { DatasetId } from '../../../shared/dashboardExplorer';
import type { FixtureModule } from '../runtime/demoStore';

/** The demonstration datasets, loaded only when a preview needs them (each its own chunk). */
const LOADERS: Record<DatasetId, () => Promise<FixtureModule[]>> = {
  general: () => import('./general').then(m => [m.general]),
  sales: () => import('./sales').then(m => [m.sales]),
  support: () => import('./support').then(m => [m.support]),
  hr: async () => [],
  accounts: async () => [],
  'ai-studio': async () => [],
  'design-studio': async () => []
};

export async function loadFixtures(datasets: readonly DatasetId[]): Promise<FixtureModule[]> {
  const wanted: DatasetId[] = ['general', ...datasets.filter(d => d !== 'general')];
  return (await Promise.all(wanted.map(d => LOADERS[d]()))).flat();
}

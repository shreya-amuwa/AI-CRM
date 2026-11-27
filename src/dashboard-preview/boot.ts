import { installGuards } from './runtime/guards';

// First, before any CRM module runs: in-memory storage, no service worker, no network (docs/DASHBOARD_EXPLORER.md).
installGuards();
void import('./main');

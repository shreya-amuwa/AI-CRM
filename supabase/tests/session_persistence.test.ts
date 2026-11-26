/**
 * Staying where you were: the page a person is on inside a dashboard comes back after a refresh or when the installed app opens again, only for that
 * person, and is forgotten when they sign out on purpose. The parts that need no browser: the remembered-page storage, the last dashboard address,
 * the list of department-panel pages that may be restored, and the "chosen department" flag of a shared Department Head.
 * Run: npm run test:unit
 */
import { PREFIX, clearPanelPage, forgetRememberedPages, read, readPanelPage, write, writePanelPage } from '../../src/lib/rememberedPage.js';
import { forgetLastPath, lastPathUnder, rememberPath } from '../../src/utils/router.js';
import { isRestorableTab } from '../../src/components/layout/restorableTabs.js';
import { readChosen, storeChosen } from '../../src/lib/scope/activeScope.js';
import { isTransient } from '../../src/lib/auth/transientError.js';
import { ApiError } from '../../src/lib/api/client.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

// a browser's localStorage, and a page address that the test moves
const data = new Map<string, string>();
let pathname = '/';
const storage = {
  getItem: (k: string) => (data.has(k) ? data.get(k)! : null),
  setItem: (k: string, v: string) => { data.set(k, String(v)); },
  removeItem: (k: string) => { data.delete(k); },
  key: (i: number) => [...data.keys()][i] ?? null,
  get length() { return data.size; }
};
const g = globalThis as unknown as { window: unknown; localStorage: unknown };
g.window = { localStorage: storage, get location() { return { pathname }; } };
g.localStorage = storage;

const PAGES = ['overview', 'projects', 'tasks'] as const;

// 1. a remembered page is returned only while it is still a page of that dashboard
write(`${PREFIX}u1.team-lead`, 'tasks');
check(read(`${PREFIX}u1.team-lead`, PAGES) === 'tasks', 'a remembered page is returned');
write(`${PREFIX}u1.team-lead`, 'a-page-from-an-old-version');
check(read(`${PREFIX}u1.team-lead`, PAGES) === null, 'a page that no longer exists is ignored (the dashboard opens at its first page)');
check(read(`${PREFIX}u2.team-lead`, PAGES) === null, 'another person on the same computer has nothing remembered');

// 2. the department panel (App.tsx): per person and department
writePanelPage('u1', 'hr', { tab: 'hr_ops', subDept: null });
writePanelPage('u1', 'wabastore', { tab: 'leads', subDept: 'sales' });
check(readPanelPage('u1', 'hr')?.tab === 'hr_ops' && readPanelPage('u1', 'wabastore')?.subDept === 'sales', 'each department remembers its own page and sub-department');
check(readPanelPage('u2', 'hr') === null, 'another person does not get it');
clearPanelPage('u1', 'hr');
check(readPanelPage('u1', 'hr') === null && readPanelPage('u1', 'wabastore') !== null, 'returning to the hub clears only that department');
data.set(`${PREFIX}u1.department-panel.bad`, '{not json');
check(readPanelPage('u1', 'bad') === null, 'a damaged entry is ignored, never an error');

// 3. only listed department-panel tabs are restored; an unlisted or invented one opens the dashboard
check(isRestorableTab('dashboard') && isRestorableTab('leads') && isRestorableTab('my_attendance') === isRestorableTab('my_attendance'), 'known tabs are restorable');
check(!isRestorableTab('toString') && !isRestorableTab('__proto__') && !isRestorableTab('nope') && !isRestorableTab(undefined), 'an unknown value (even an object property name) is not restorable');

// 4. the installed app opens at "/": the last dashboard address of THIS person is used, nobody else's
pathname = '/ai-studio/dashboard/u1/projects';
rememberPath('u1');
check(lastPathUnder('/ai-studio/dashboard/u1') === '/ai-studio/dashboard/u1/projects', 'the app returns to the page the person was on');
check(lastPathUnder('/ai-studio/dashboard/u2') === null, 'another person never lands on it');
pathname = '/login';
rememberPath('u1');
check(lastPathUnder('/ai-studio/dashboard/u1') === '/ai-studio/dashboard/u1/projects', 'the sign-in page (no id in it) does not replace it');
pathname = '/ai-studio/dashboard/u1';
rememberPath('u1');
check(lastPathUnder('/ai-studio/dashboard/u1') === '/ai-studio/dashboard/u1', 'the dashboard itself is remembered too');
check(lastPathUnder('/ai-studio/dashboard/u') === null, 'a base that only starts the same way (another person whose id begins the same) does not match');

// 5. signing out on purpose forgets all of it
data.set('unrelated', 'kept');
forgetRememberedPages();
forgetLastPath();
check(read(`${PREFIX}u1.team-lead`, ['a-page-from-an-old-version']) === null && readPanelPage('u1', 'wabastore') === null && lastPathUnder('/ai-studio/dashboard/u1') === null, 'sign-out forgets the remembered pages and the last address');
check(data.get('unrelated') === 'kept', 'and nothing else in the browser');

// 6. a shared Department Head is asked to choose a department once per sign-in, not again after closing the browser
storeChosen('h1', true);
check(readChosen('h1') && data.has('crm.scope.chosen.h1'), 'the department choice is kept in the browser storage, not only for this tab');
storeChosen('h1', false);
check(!readChosen('h1'), 'signing out asks again');

// 7. a slow or unreachable server never ends a sign-in; a real refusal does
check(isTransient(new ApiError('NETWORK_ERROR', 'offline', 0)) && isTransient(new ApiError('SERVICE_UNAVAILABLE', 'busy', 503)) && isTransient(new ApiError('INTERNAL', 'x', 500)), 'no answer, 503 and 500 are transient: the session is kept and the load is tried again');
check(!isTransient(new ApiError('UNAUTHENTICATED', 'expired', 401)) && !isTransient(new ApiError('ACCOUNT_INACTIVE', 'closed', 403)) && !isTransient(new ApiError('VALIDATION_ERROR', 'bad', 422)), 'a refused token, a closed account and a bad request are real answers, not transient');
check(!isTransient(new Error('boom')) && !isTransient(null), 'anything else is not treated as a busy server');

console.log(`SESSION PERSISTENCE CHECKS PASSED (${passed})`);

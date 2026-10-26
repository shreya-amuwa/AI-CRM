/** The shared Realtime channel: one channel per set of tables per tab, every listener still called, closed with the last listener. */
import { listenToTables } from '../../src/lib/realtimeShared.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) {
    console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra));
    process.exit(1);
  }
  passed++;
  console.log(`ok - ${label}`);
}

const opened: { name: string; tables: string[]; handlers: (() => void)[]; subscribed: boolean }[] = [];
const removed: string[] = [];
const fake: any = {
  channel(name: string) {
    const ch = { name, tables: [] as string[], handlers: [] as (() => void)[], subscribed: false };
    opened.push(ch);
    const api: any = {
      on(_e: string, f: { table: string }, h: () => void) { ch.tables.push(f.table); ch.handlers.push(h); return api; },
      subscribe() { ch.subscribed = true; return api; },
      _ch: ch
    };
    return api;
  },
  async removeChannel(api: any) { removed.push(api._ch.name); }
};
const change = (i: number) => opened[i].handlers[0]();

let a = 0, b = 0, c = 0;
const stopA = listenToTables(['customers', 'member_invoices'], () => a++, fake);
const stopB = listenToTables(['member_invoices', 'customers'], () => b++, fake);
check(opened.length === 1 && opened[0].subscribed && opened[0].tables.join(',') === 'customers,member_invoices', 'two listeners of the same tables share one channel', opened);
const stopC = listenToTables(['work_tasks'], () => c++, fake);
check(opened.length === 2, 'other tables get their own channel');
change(0);
check(a === 1 && b === 1 && c === 0, 'a change reaches every listener of those tables, and only them', { a, b, c });
stopA();
check(removed.length === 0, 'the channel stays open while someone still listens');
change(0);
check(a === 1 && b === 2, 'a listener that left is no longer called');
stopB();
check(removed.length === 1 && removed[0] === opened[0].name, 'the channel closes with its last listener');
stopB();
check(removed.length === 1, 'stopping twice does nothing more');
const stopD = listenToTables(['customers', 'member_invoices'], () => a++, fake);
check(opened.length === 3, 'listening again opens a fresh channel');
stopD(); stopC();
check(removed.length === 3, 'every channel is closed at the end');
const noop = listenToTables(['customers'], () => a++, null);
noop();
check(opened.length === 3, 'without a Supabase client nothing is opened (as before)');
console.log(`=== ${passed} SHARED REALTIME CHECKS PASSED ===`);

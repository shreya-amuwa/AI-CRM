#!/usr/bin/env node
/**
 * Creates the FIRST Super Admin. Works only while no Super Admin exists (the
 * database trigger refuses otherwise). Run once per environment:
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npm run bootstrap:super-admin -- admin@example.com "Full Name"
 *
 * The password is read interactively (never pass it on the command line) or
 * from SUPER_ADMIN_PASSWORD for CI. Nothing is written to disk.
 */
import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline';

const [email, fullName = 'Super Admin'] = process.argv.slice(2);
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !url || !serviceKey) {
  console.error('Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run bootstrap:super-admin -- <email> ["Full Name"]');
  process.exit(1);
}

async function readPassword() {
  if (process.env.SUPER_ADMIN_PASSWORD) return process.env.SUPER_ADMIN_PASSWORD;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = () => {};
  process.stdout.write('Password (min 12 chars): ');
  const pw = await new Promise(resolve => rl.question('', resolve));
  rl.close();
  process.stdout.write('\n');
  return pw;
}

const password = await readPassword();
if (!password || password.length < 12) {
  console.error('Password must be at least 12 characters.');
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
  app_metadata: { bootstrap_super_admin: true }
});

if (error) {
  console.error('Failed to create Super Admin:', error.message);
  console.error('(If a Super Admin already exists, the database refuses a second bootstrap.)');
  process.exit(1);
}
console.log(`Super Admin created: ${data.user.email} (${data.user.id})`);

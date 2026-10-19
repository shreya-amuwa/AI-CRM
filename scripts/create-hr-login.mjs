#!/usr/bin/env node
/**
 * Creates a login (e-mail + password) for the HR dashboard: the same HR dashboard the Super Admin opens from the
 * HR Department, behind its own sign-in. The account is created exactly like "HR Department -> Add Member" does it,
 * so the database applies the same rules (who may create whom, one Department Head per department).
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   npm run create:hr-login -- --email hr@yourcompany.com --name "HR Manager" --super-admin root@yourcompany.com \
 *        [--role DEPARTMENT_HEAD|TEAM_HEAD|TEAM_MEMBER] [--generate]
 *
 *   --role          DEPARTMENT_HEAD (default): the HR head, with Add Member, Access Control and Client Notices.
 *                   TEAM_HEAD / TEAM_MEMBER: the same dashboard for an HR team lead / member (added to the HR team).
 *   --super-admin   e-mail of an existing Super Admin (the account the new login is created on behalf of).
 *   --generate      make a strong random password and print it once. Otherwise the password is read without echo
 *                   (or from HR_LOGIN_PASSWORD for CI). It is never taken from the command line and never stored.
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'node:crypto';
import readline from 'node:readline';

const args = process.argv.slice(2);
const opt = name => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const email = opt('email')?.trim().toLowerCase();
const fullName = opt('name')?.trim() || 'HR Manager';
const superAdminEmail = opt('super-admin')?.trim().toLowerCase();
const role = (opt('role') || 'DEPARTMENT_HEAD').toUpperCase();
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!email || !superAdminEmail || !url || !serviceKey || !['DEPARTMENT_HEAD', 'TEAM_HEAD', 'TEAM_MEMBER'].includes(role)) {
  console.error('Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… npm run create:hr-login -- --email <login e-mail> --name "<Full Name>" --super-admin <super admin e-mail> [--role DEPARTMENT_HEAD|TEAM_HEAD|TEAM_MEMBER] [--generate]');
  process.exit(1);
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = crypto.randomBytes(16);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

async function readPassword() {
  if (args.includes('--generate')) return { password: generatePassword(), generated: true };
  if (process.env.HR_LOGIN_PASSWORD) return { password: process.env.HR_LOGIN_PASSWORD, generated: false };
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = () => {};
  process.stdout.write('Password for the new HR login (min 10 chars): ');
  const pw = await new Promise(resolve => rl.question('', resolve));
  rl.close();
  process.stdout.write('\n');
  return { password: pw, generated: false };
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: admin } = await supabase.from('profiles').select('id, role, status').eq('email', superAdminEmail).maybeSingle();
if (!admin || admin.role !== 'SUPER_ADMIN' || admin.status !== 'ACTIVE') {
  console.error(`No active Super Admin has the e-mail ${superAdminEmail}.`);
  process.exit(1);
}
const { data: dept } = await supabase.from('departments').select('id, name').eq('slug', 'hr').maybeSingle();
if (!dept) {
  console.error('The HR department was not found.');
  process.exit(1);
}
let teamId = null;
if (role !== 'DEPARTMENT_HEAD') {
  const { data: teams } = await supabase.from('teams').select('id, name').eq('department_id', dept.id).order('created_at').limit(1);
  teamId = teams?.[0]?.id ?? null;
  if (!teamId) {
    console.error('The HR department has no team yet. Create the HR head first, then add a team, or use --role DEPARTMENT_HEAD.');
    process.exit(1);
  }
}
if (role === 'DEPARTMENT_HEAD') {
  const { data: head } = await supabase.from('profiles').select('email').eq('department_id', dept.id).eq('role', 'DEPARTMENT_HEAD').in('status', ['ACTIVE', 'PENDING', 'SUSPENDED']).limit(1);
  if (head?.length) {
    console.error(`The HR department already has a Department Head (${head[0].email}); a department can have only one.`);
    console.error('Sign in with that account, or create this login with --role TEAM_HEAD or TEAM_MEMBER (same HR dashboard).');
    process.exit(1);
  }
}

const { password, generated } = await readPassword();
if (!password || password.length < 10) {
  console.error('The password must be at least 10 characters.');
  process.exit(1);
}

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName, position: null },
  // the database trigger checks that this Super Admin may create this role in this department
  app_metadata: {
    provisioned_by: admin.id,
    provisioned_role: role,
    provisioned_department_id: dept.id,
    provisioned_team_id: teamId,
    provisioned_technical_consultant: false
  }
});
if (error || !data.user) {
  console.error('Could not create the HR login:', error?.message || 'unknown error');
  process.exit(1);
}

console.log(`HR login created in ${dept.name}`);
console.log(`  Login ID (e-mail): ${email}`);
console.log(`  Role:              ${role === 'DEPARTMENT_HEAD' ? 'Department Head' : role === 'TEAM_HEAD' ? 'Team Lead' : 'Team Member'}`);
if (generated) console.log(`  Password:          ${password}   (shown once: share it securely; it is not stored anywhere)`);
else console.log('  Password:          the one you entered');
console.log('Sign in at the normal CRM login page: the HR dashboard opens.');

// Fixture for the browser tests: makes the staff accounts they sign in with and prints their passwords as JSON
// (pass that to the test as E2E_PASSWORDS). Passwords are made up on every run and never stored in the repository.
// Seeds: super admin (token-only) → Wabastore Sales team head + two sales members.
import crypto from 'node:crypto';
import pg from 'pg';
const SECRET = process.env.JWT_SECRET || 'local-test-secret-that-is-at-least-32-chars';
const BASE = process.env.E2E_BASE || 'http://localhost:3000';
const passwords = {};
const pw = email => (passwords[email] = `${crypto.randomBytes(9).toString('base64url')}-Aa1`);
const sign = p => { const e = o => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = e({ alg: 'HS256', typ: 'JWT' }), b = e({ iat: 1, exp: 2e9, ...p }); return `${h}.${b}.${crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url')}`; };
const db = new pg.Pool(); // PGHOST / PGPORT / PGUSER / PGDATABASE from the environment
const { rows: [sa] } = await db.query(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ('root@amuwa.com', '{"full_name":"Root"}', '{"bootstrap_super_admin":true}') returning id`);
const api = async (method, path, body) => {
  const r = await fetch(BASE + '/api/v1' + path, { method, headers: { authorization: `Bearer ${sign({ sub: sa.id, role: 'authenticated' })}`, 'content-type': 'application/json' }, body: body && JSON.stringify(body) });
  const j = await r.json(); if (!j.success) throw new Error(path + ' ' + JSON.stringify(j)); return j.data;
};
const wab = (await api('GET', '/departments')).find(d => d.slug === 'wabastore');
const sales = (await api('GET', `/teams?departmentId=${wab.id}`)).find(t => t.name === 'Sales');
await api('POST', '/users', { email: 'rahul@amuwa.com', fullName: 'Rahul Mehta', password: pw('rahul@amuwa.com'), role: 'TEAM_MEMBER', teamId: sales.id, position: 'Sales Executive' });
await api('POST', '/users', { email: 'neha@amuwa.com', fullName: 'Neha Shah', password: pw('neha@amuwa.com'), role: 'TEAM_MEMBER', teamId: sales.id });
await api('POST', '/users', { email: 'lead@amuwa.com', fullName: 'Lead Person', password: pw('lead@amuwa.com'), role: 'TEAM_HEAD', teamId: sales.id });
const support = (await api('GET', `/teams?departmentId=${wab.id}`)).find(t => t.name === 'Support');
await api('POST', '/users', { email: 'consultant@amuwa.com', fullName: 'Tara Consultant', password: pw('consultant@amuwa.com'), role: 'TEAM_MEMBER', teamId: support.id, technicalConsultant: true });
// Hand-over chain: department head → delivery team lead → delivery team member.
const dh = await api('POST', '/users', { email: 'dh@amuwa.com', fullName: 'Dev Head', password: pw('dh@amuwa.com'), role: 'DEPARTMENT_HEAD', departmentId: wab.id });
const delivery = await api('POST', '/teams', { departmentId: wab.id, name: 'Delivery', division: 'SUPPORT' });
await api('POST', '/users', { email: 'tl.delivery@amuwa.com', fullName: 'Dina Delivery', password: pw('tl.delivery@amuwa.com'), role: 'TEAM_HEAD', teamId: delivery.id });
await api('POST', '/users', { email: 'tm.delivery@amuwa.com', fullName: 'Mohan Member', password: pw('tm.delivery@amuwa.com'), role: 'TEAM_MEMBER', teamId: delivery.id });
await api('POST', '/users', { email: 'tm2.delivery@amuwa.com', fullName: 'Rina Rao', password: pw('tm2.delivery@amuwa.com'), role: 'TEAM_MEMBER', teamId: delivery.id });
// Accounts department: confirms the amount Sales sends, before the consultant gets the customer.
const acc = (await api('GET', '/departments')).find(d => d.slug === 'accounts');
const accHead = await api('POST', '/users', { email: 'acc.head@amuwa.com', fullName: 'Asha Accounts', password: pw('acc.head@amuwa.com'), role: 'DEPARTMENT_HEAD', departmentId: acc.id });
const accTeam = (await api('GET', '/teams?departmentId=' + acc.id))[0];
await api('POST', '/users', { email: 'acc.member@amuwa.com', fullName: 'Arun Accounts', password: pw('acc.member@amuwa.com'), role: 'TEAM_MEMBER', teamId: accTeam.id });
console.log(JSON.stringify(passwords));
await db.end();

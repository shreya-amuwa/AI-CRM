// Local stand-in for the Supabase API gateway, for integration tests only.
//   /rest/v1/*  → proxied to a real PostgREST (JWT-authenticated, RLS applies)
//   /auth/v1/*  → minimal GoTrue emulation: token verification, sign-in,
//                 admin create/update user (writes auth.users directly)
// Env: GATEWAY_PORT, POSTGREST_URL, JWT_SECRET, PG* for the database.
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';

const PORT = Number(process.env.GATEWAY_PORT || 54400);
const POSTGREST_URL = process.env.POSTGREST_URL || 'http://127.0.0.1:54401';
const SECRET = process.env.JWT_SECRET;
const db = new pg.Pool();
// email → password (test only). SEED_PASSWORDS="a@x.com=pw,b@x.com=pw" pre-seeds known users.
const passwords = new Map((process.env.SEED_PASSWORDS || '').split(',').filter(Boolean).map(p => p.split('=')));

const b64url = buf => Buffer.from(buf).toString('base64url');
export function signJwt(payload) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...payload }));
  const sig = crypto.createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}
function verifyJwt(token) {
  const [h, b, s] = (token || '').split('.');
  if (!s) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(`${h}.${b}`).digest('base64url');
  if (expected.length !== s.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(s))) return null;
  const claims = JSON.parse(Buffer.from(b, 'base64url').toString());
  return claims.exp > Date.now() / 1000 ? claims : null;
}

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS'
};
const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', ...CORS });
  res.end(JSON.stringify(body));
};
const readBody = req => new Promise(r => { let d = ''; req.on('data', c => (d += c)); req.on('end', () => r(d)); });
const userJson = row => ({
  id: row.id, aud: 'authenticated', role: 'authenticated', email: row.email,
  user_metadata: row.raw_user_meta_data, app_metadata: row.raw_app_meta_data, created_at: row.created_at
});

async function handleAuth(req, res, path) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer /i, '');
  const claims = verifyJwt(bearer);
  const body = req.method === 'GET' ? {} : JSON.parse((await readBody(req)) || '{}');

  if (path === '/user' && req.method === 'GET') {
    if (!claims?.sub) return json(res, 401, { msg: 'invalid JWT' });
    const { rows } = await db.query('select * from auth.users where id = $1', [claims.sub]);
    return rows[0] ? json(res, 200, userJson(rows[0])) : json(res, 404, { msg: 'User not found' });
  }
  if (path === '/signup' && req.method === 'POST') {
    try {
      const { rows } = await db.query(
        'insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning *',
        [body.email, body.data || {}]);
      passwords.set(body.email, body.password);
      return json(res, 200, { user: userJson(rows[0]), session: null });
    } catch (e) {
      return json(res, 500, { msg: 'Database error saving new user', detail: e.message });
    }
  }
  if (path === '/token' && req.method === 'POST') {
    const { rows } = await db.query('select * from auth.users where email = $1', [body.email]);
    if (!rows[0] || passwords.get(body.email) !== body.password) return json(res, 400, { error: 'invalid_grant' });
    const token = signJwt({ sub: rows[0].id, role: 'authenticated', email: rows[0].email });
    return json(res, 200, { access_token: token, token_type: 'bearer', expires_in: 3600, refresh_token: 'x', user: userJson(rows[0]) });
  }
  // Admin endpoints require the service-role key
  if (claims?.role !== 'service_role') return json(res, 403, { msg: 'forbidden' });
  if (path === '/admin/users' && req.method === 'POST') {
    try {
      const { rows } = await db.query(
        'insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, $3) returning *',
        [body.email, body.user_metadata || {}, body.app_metadata || {}]);
      passwords.set(body.email, body.password);
      return json(res, 200, userJson(rows[0]));
    } catch (e) {
      const dup = /duplicate/.test(e.message);
      return json(res, dup ? 422 : 500, { msg: dup ? 'A user with this email address has already been registered' : 'Database error creating new user', detail: e.message });
    }
  }
  const m = /^\/admin\/users\/([0-9a-f-]{36})$/.exec(path);
  if (m && req.method === 'PUT') {
    const { rows } = await db.query(
      `update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('banned', $2::text) where id = $1 returning *`,
      [m[1], body.ban_duration || null]);
    return rows[0] ? json(res, 200, userJson(rows[0])) : json(res, 404, { msg: 'not found' });
  }
  return json(res, 404, { msg: `unhandled auth route ${req.method} ${path}` });
}

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/auth/v1')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, CORS);
        return res.end();
      }
      if (url.pathname === '/auth/v1/logout') {
        res.writeHead(204, CORS);
        return res.end();
      }
      return await handleAuth(req, res, url.pathname.slice(8));
    }
    if (url.pathname.startsWith('/rest/v1')) {
      const target = POSTGREST_URL + url.pathname.slice(8) + url.search;
      const headers = { ...req.headers };
      delete headers.host;
      if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`;
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
      const r = await fetch(target, { method: req.method, headers, body });
      res.writeHead(r.status, Object.fromEntries([...r.headers].filter(([k]) => !['content-encoding', 'transfer-encoding'].includes(k))));
      return res.end(Buffer.from(await r.arrayBuffer()));
    }
    json(res, 404, { msg: 'not found' });
  } catch (e) {
    json(res, 500, { msg: e.message });
  }
}).listen(PORT, () => console.log(`gateway on ${PORT}`));

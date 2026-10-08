// Local stand-in for the Supabase API gateway, for integration tests only.
//   /rest/v1/*  → proxied to a real PostgREST (JWT-authenticated, RLS applies)
//   /auth/v1/*  → minimal GoTrue emulation: token verification, sign-in,
//                 admin create/update user (writes auth.users directly)
//   /storage/v1/* → in-memory Storage emulation (private buckets only): signed
//                 upload tokens, signed download URLs, list, remove. Object
//                 operations other than token-based ones need the service role.
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
    // Like Supabase Auth (GoTrue): the user row is inserted first and
    // app_metadata is written by a separate UPDATE in the same transaction.
    const client = await db.connect();
    try {
      await client.query('begin');
      const { rows: inserted } = await client.query(
        `insert into auth.users (email, raw_user_meta_data, raw_app_meta_data)
         values ($1, $2, '{"provider":"email","providers":["email"]}') returning id`,
        [body.email, body.user_metadata || {}]);
      const { rows } = await client.query(
        'update auth.users set raw_app_meta_data = raw_app_meta_data || $2 where id = $1 returning *',
        [inserted[0].id, body.app_metadata || {}]);
      await client.query('commit');
      passwords.set(body.email, body.password);
      return json(res, 200, userJson(rows[0]));
    } catch (e) {
      await client.query('rollback').catch(() => {});
      const dup = /duplicate/.test(e.message);
      return json(res, dup ? 422 : 500, { msg: dup ? 'A user with this email address has already been registered' : 'Database error creating new user', detail: e.message });
    } finally {
      client.release();
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

// ---- Storage emulation ------------------------------------------------------
const objects = new Map(); // "bucket/path" → { body: Buffer, contentType, created }
const tokens = new Map();  // token → { key, kind: 'upload' | 'read', exp }
const readRaw = req => new Promise(r => { const c = []; req.on('data', d => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
const newToken = (key, kind, seconds) => {
  const t = crypto.randomBytes(24).toString('base64url');
  tokens.set(t, { key, kind, exp: Date.now() + seconds * 1000 });
  return t;
};
async function bucketRules(bucket) {
  const { rows } = await db.query('select file_size_limit, allowed_mime_types from storage.buckets where id = $1', [bucket]);
  return rows[0];
}
async function handleStorage(req, res, path, url) {
  const claims = verifyJwt((req.headers.authorization || '').replace(/^Bearer /i, '') || req.headers.apikey);
  const service = claims?.role === 'service_role';
  let m;
  // Token-based upload (browser): PUT /object/upload/sign/<bucket>/<path>?token=
  if ((m = /^\/object\/upload\/sign\/(.+)$/.exec(path)) && req.method === 'PUT') {
    const key = decodeURIComponent(m[1]);
    const t = tokens.get(url.searchParams.get('token'));
    if (!t || t.kind !== 'upload' || t.key !== key || t.exp < Date.now()) return json(res, 400, { statusCode: '403', error: 'InvalidSignature', message: 'invalid signature' });
    if (objects.has(key)) return json(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    const rules = await bucketRules(key.split('/')[0]);
    const body = await readRaw(req);
    const type = (req.headers['content-type'] || '').split(';')[0];
    if (rules?.allowed_mime_types && !rules.allowed_mime_types.includes(type)) return json(res, 400, { statusCode: '415', error: 'invalid_mime_type', message: `mime type ${type} is not supported` });
    if (rules?.file_size_limit && body.length > Number(rules.file_size_limit)) return json(res, 400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
    tokens.delete(url.searchParams.get('token'));
    objects.set(key, { body, contentType: type, created: new Date().toISOString() });
    return json(res, 200, { Key: key });
  }
  // Token-based read: GET /object/sign/<bucket>/<path>?token=
  if ((m = /^\/object\/sign\/(.+)$/.exec(path)) && req.method === 'GET') {
    const key = decodeURIComponent(m[1]);
    const t = tokens.get(url.searchParams.get('token'));
    if (!t || t.kind !== 'read' || t.key !== key || t.exp < Date.now()) return json(res, 400, { statusCode: '400', error: 'InvalidJWT', message: 'jwt expired or invalid' });
    const obj = objects.get(key);
    if (!obj) return json(res, 404, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    const body = range ? obj.body.subarray(Number(range[1]), Number(range[2]) + 1) : obj.body;
    const headers = { 'content-type': obj.contentType, ...CORS };
    if (url.searchParams.has('download')) headers['content-disposition'] = `attachment; filename="${url.searchParams.get('download') || key.split('/').pop()}"`;
    res.writeHead(range ? 206 : 200, headers);
    return res.end(body);
  }
  if (!service) return json(res, 403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
  if ((m = /^\/object\/upload\/sign\/(.+)$/.exec(path)) && req.method === 'POST') {
    const key = decodeURIComponent(m[1]);
    return json(res, 200, { url: `/object/upload/sign/${m[1]}?token=${newToken(key, 'upload', 7200)}` });
  }
  if ((m = /^\/object\/sign\/(.+)$/.exec(path)) && req.method === 'POST') {
    const key = decodeURIComponent(m[1]);
    const body = JSON.parse((await readBody(req)) || '{}');
    if (!objects.has(key)) return json(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    return json(res, 200, { signedURL: `/object/sign/${m[1]}?token=${newToken(key, 'read', Number(body.expiresIn) || 60)}` });
  }
  if ((m = /^\/object\/list\/([^/]+)$/.exec(path)) && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const prefix = `${m[1]}/${body.prefix ? body.prefix.replace(/\/$/, '') + '/' : ''}`;
    const out = [];
    for (const [key, obj] of objects) {
      if (!key.startsWith(prefix) || key.slice(prefix.length).includes('/')) continue;
      const name = key.slice(prefix.length);
      if (body.search && !name.includes(body.search)) continue;
      out.push({ name, id: key, created_at: obj.created, metadata: { size: obj.body.length, mimetype: obj.contentType } });
    }
    return json(res, 200, out.slice(0, body.limit || 100));
  }
  if ((m = /^\/object\/([^/]+)$/.exec(path)) && req.method === 'DELETE') {
    const body = JSON.parse((await readBody(req)) || '{}');
    const removed = [];
    for (const p of body.prefixes || []) if (objects.delete(`${m[1]}/${p}`)) removed.push({ name: p });
    return json(res, 200, removed);
  }
  // Test hook: GET /__objects lists stored keys (service role only).
  if (path === '/__objects') return json(res, 200, [...objects.keys()]);
  return json(res, 404, { msg: `unhandled storage route ${req.method} ${path}` });
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
    if (url.pathname.startsWith('/storage/v1')) {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...CORS, 'access-control-allow-headers': CORS['access-control-allow-headers'] + ', x-upsert, cache-control, range' });
        return res.end();
      }
      return await handleStorage(req, res, url.pathname.slice(11), url);
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

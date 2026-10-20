// Local stand-in for Supabase Realtime (postgres_changes only), for integration and browser tests.
// It speaks the Phoenix v2 JSON protocol that @supabase/realtime-js uses, listens to row changes in Postgres (a trigger on
// every table in the supabase_realtime publication sends NOTIFY), and delivers a change to a subscriber ONLY when that
// subscriber can read the row: the row is re-read as the subscriber's own database role with their JWT claims, so row level
// security decides, exactly as it does on Supabase. Test infrastructure; nothing here ships.
import crypto from 'node:crypto';
import pg from 'pg';

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const KEYS = { chat_members: ['conversation_id', 'profile_id'] };
const keyOf = table => KEYS[table] || ['id'];

function frame(text) {
  const body = Buffer.from(text);
  const n = body.length;
  const head = n < 126 ? Buffer.from([0x81, n]) : n < 65536 ? Buffer.from([0x81, 126, n >> 8, n & 255]) : (() => { const b = Buffer.alloc(10); b[0] = 0x81; b[1] = 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
  return Buffer.concat([head, body]);
}

export async function attachRealtime(server, db, verifyJwt) {
  const subs = new Set(); // { socket, claims, joins: Map(topic -> {bindings:[{id,event,schema,table,filter}]}) }
  const listener = new pg.Client();
  await listener.connect();

  // a NOTIFY for every change on a published table
  const { rows: tables } = await db.query(`select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'`);
  await db.query(`create schema if not exists test_rt`);
  await db.query(`create or replace function test_rt.changed() returns trigger language plpgsql as $f$
    declare r jsonb := to_jsonb(coalesce(new, old)); k text[] := case tg_table_name when 'chat_members' then array['conversation_id','profile_id'] else array['id'] end; keys jsonb := '{}';
    begin
      select coalesce(jsonb_object_agg(x, r -> x), '{}') into keys from unnest(k) x;
      perform pg_notify('test_rt', jsonb_build_object('table', tg_table_name, 'type', tg_op, 'keys', keys)::text);
      return null;
    end $f$`);
  for (const { tablename } of tables) {
    await db.query(`drop trigger if exists test_rt_changed on public.${tablename}`);
    await db.query(`create trigger test_rt_changed after insert or update or delete on public.${tablename} for each row execute function test_rt.changed()`);
  }
  await listener.query('listen test_rt');

  const send = (s, join_ref, ref, topic, event, payload) => { try { s.socket.write(frame(JSON.stringify([join_ref, ref, topic, event, payload]))); } catch { /* closed */ } };

  // can this subscriber read the row? returns the row as they see it, or null
  async function readAs(claims, table, keys) {
    const c = await db.connect();
    try {
      await c.query('begin');
      await c.query('set local role authenticated');
      await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [JSON.stringify(claims), claims.sub || '']);
      const cols = Object.keys(keys);
      const { rows } = await c.query(`select to_jsonb(t) as r from public.${table} t where ${cols.map((k, i) => `t.${k} = $${i + 1}`).join(' and ')}`, cols.map(k => keys[k]));
      await c.query('rollback');
      return rows[0]?.r ?? null;
    } catch {
      await c.query('rollback').catch(() => undefined);
      return null;
    } finally {
      c.release();
    }
  }

  const debug = (...a) => process.env.RT_DEBUG && console.log('[rt]', ...a);
  listener.on('notification', async msg => {
    let n;
    try { n = JSON.parse(msg.payload); } catch { return; }
    debug('change', n.table, n.type, JSON.stringify(n.keys), 'subscribers', subs.size);
    for (const s of [...subs]) {
      for (const [topic, j] of s.joins) {
        const hits = j.bindings.filter(b => b.table === n.table && (b.event === '*' || b.event === n.type));
        if (!hits.length) continue;
        if (n.type === 'DELETE') continue; // a deleted row cannot be re-read; the chat never hard-deletes rows people watch
        const row = await readAs(s.claims, n.table, n.keys);
        debug('  ', topic, s.claims.sub, row ? 'visible' : 'hidden');
        if (!row) continue;
        const ids = hits.filter(b => {
          const m = /^([a-z_]+)=eq\.(.*)$/.exec(b.filter || '');
          return !m || String(row[m[1]]) === m[2];
        }).map(b => b.id);
        if (!ids.length) continue;
        send(s, null, null, topic, 'postgres_changes', { ids, data: { schema: 'public', table: n.table, commit_timestamp: new Date().toISOString(), type: n.type, record: row, columns: [], errors: null } });
      }
    }
  });

  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith('/realtime/v1/websocket')) return socket.destroy();
    const key = req.headers['sec-websocket-key'];
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${crypto.createHash('sha1').update(key + GUID).digest('base64')}\r\n\r\n`);
    const s = { socket, claims: {}, joins: new Map() };
    subs.add(s);
    let buf = Buffer.alloc(0);
    const handle = text => {
      let m;
      try { m = JSON.parse(text); } catch { return; }
      const [joinRef, ref, topic, event, payload] = m;
      if (topic === 'phoenix' && event === 'heartbeat') return send(s, null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} });
      if (event === 'phx_join') {
        const claims = verifyJwt(payload?.access_token || url.searchParams.get('apikey'));
        if (payload?.access_token && !claims) return send(s, joinRef, ref, topic, 'phx_reply', { status: 'error', response: { reason: 'invalid token' } });
        s.claims = claims || {};
        const bindings = (payload?.config?.postgres_changes || []).map((b, i) => ({ id: i + 1, event: b.event, schema: b.schema, table: b.table, filter: b.filter }));
        s.joins.set(topic, { bindings });
        send(s, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: bindings } });
        send(s, null, null, topic, 'system', { message: 'Subscribed to PostgreSQL', status: 'ok', extension: 'postgres_changes', channel: topic.replace(/^realtime:/, '') });
      } else if (event === 'access_token') {
        const claims = verifyJwt(payload?.access_token);
        if (claims) s.claims = claims;
        send(s, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} });
      } else if (event === 'phx_leave') {
        s.joins.delete(topic);
        send(s, joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} });
      }
    };
    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const op = buf[0] & 15;
        let len = buf[1] & 127;
        let off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const masked = (buf[1] & 128) !== 0;
        if (buf.length < off + (masked ? 4 : 0) + len) return;
        const mask = masked ? buf.subarray(off, off + 4) : null;
        if (masked) off += 4;
        const data = Buffer.from(buf.subarray(off, off + len));
        if (mask) for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
        buf = buf.subarray(off + len);
        if (op === 8) { socket.end(Buffer.from([0x88, 0])); return; }
        if (op === 9) socket.write(Buffer.concat([Buffer.from([0x8a, data.length]), data]));
        else if (op === 1) handle(data.toString());
      }
    });
    const gone = () => subs.delete(s);
    socket.on('close', gone);
    socket.on('error', gone);
  });
  return { close: () => listener.end() };
}

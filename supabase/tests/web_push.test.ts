// Unit test of the Web Push sender (server/automations/webPush.ts): the VAPID settings, the request it sends to the push service, and how it
// reads the answer (404 / 410 = the device is gone for good). Keys are generated here for the test; no real key or device is used.
import { sendWebPush, vapidConfig, type PushMessage, type PushTarget } from '../../server/automations/webPush';

let passed = 0;
const check = (ok: boolean, name: string, extra?: unknown) => { if (!ok) { console.error('not ok -', name, extra ?? ''); process.exit(1); } passed++; console.log('ok -', name); };
const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString('base64url');

const vapidKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const privateJWK = await crypto.subtle.exportKey('jwk', vapidKeys.privateKey);
const publicRaw = b64url(await crypto.subtle.exportKey('raw', vapidKeys.publicKey));
// a browser's subscription: its P-256 public key and 16 random auth bytes
const device = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const target: PushTarget = {
  id: '00000000-0000-4000-8000-000000000001',
  endpoint: 'https://push.example.com/send/abc123',
  p256dh: b64url(await crypto.subtle.exportKey('raw', device.publicKey)),
  auth: b64url(crypto.getRandomValues(new Uint8Array(16)))
};
const message: PushMessage = { title: 'Time to Punch In', body: 'Your day starts at 10:00. Open Attendance to punch in.', tag: 'att-punch_in-2027-01-11', url: '/?open=attendance' };

// --- the settings
const setEnv = (pub?: string, priv?: string, subject?: string) => {
  for (const [k, v] of [['VAPID_PUBLIC_KEY', pub], ['VAPID_PRIVATE_KEY', priv], ['VAPID_SUBJECT', subject]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
};
setEnv(publicRaw, JSON.stringify(privateJWK), undefined);
check(vapidConfig() === null, 'vapidConfig is null when a setting is missing (no subject)');
setEnv(publicRaw, 'not json', 'mailto:hr@example.com');
check(vapidConfig() === null, 'vapidConfig is null when the private key is not a JWK');
const otherKeys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
setEnv(b64url(await crypto.subtle.exportKey('raw', otherKeys.publicKey)), JSON.stringify(privateJWK), 'mailto:hr@example.com');
check(vapidConfig() === null, 'vapidConfig is null when the public key does not belong to the private key (every push would be refused)');
setEnv(undefined, JSON.stringify(privateJWK), 'mailto:hr@example.com');
check(vapidConfig()?.publicKey === publicRaw, 'the public key is taken from the private key when VAPID_PUBLIC_KEY is not set');
setEnv(publicRaw, JSON.stringify(privateJWK), 'mailto:hr@example.com');
const vapid = vapidConfig();
check(vapid !== null && vapid.publicKey === publicRaw && vapid.subject === 'mailto:hr@example.com', 'vapidConfig reads the three settings');

// --- the request
let seen: { url: string; init: RequestInit } | null = null;
const answer = (status: number) => async (url: string | URL | Request, init?: RequestInit) => { seen = { url: String(url), init: init ?? {} }; return new Response(null, { status }); };
check(await sendWebPush(target, message, vapid!, answer(201)) === 'ok', 'sendWebPush maps 201 to ok');
const sent = seen as unknown as { url: string; init: RequestInit };
const headers = new Headers(sent.init.headers);
check(sent.url === target.endpoint && sent.init.method === 'POST', 'the request goes to the subscription endpoint');
check(headers.get('content-encoding') === 'aes128gcm' && (sent.init.body as ArrayBuffer | Uint8Array).byteLength > 100, 'with an aes128gcm (encrypted) body', headers);
check(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/.test(headers.get('authorization') || ''), 'and a VAPID Authorization header', headers.get('authorization'));
check(headers.get('ttl') === '1800' && headers.get('urgency') === 'high', 'kept 30 minutes at most, sent as urgent');
check(/^[A-Za-z0-9_-]{1,32}$/.test(headers.get('topic') || ''), 'the topic is a valid push topic (the follow-up replaces a waiting reminder)', headers.get('topic'));
check(!new TextDecoder().decode(sent.init.body as ArrayBuffer).includes('Punch In'), 'the text is not readable on the way');

// --- the device can read it (RFC 8291, aes128gcm), and the push service can check who sent it (RFC 8292, VAPID)
const hmac = async (key: Uint8Array, data: Uint8Array) =>
  new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data));
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const enc = (s: string) => new TextEncoder().encode(s);
const body = new Uint8Array(sent.init.body as ArrayBuffer);
const salt = body.slice(0, 16);
const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0);
const idLen = body[20];
const senderPublic = body.slice(21, 21 + idLen);
const ciphertext = body.slice(21 + idLen);
check(rs === 4096 && idLen === 65 && senderPublic[0] === 4, 'the body starts with the aes128gcm header (salt, record size, sender key)', { rs, idLen });
const uaPublic = Buffer.from(target.p256dh, 'base64url');
const authSecret = Buffer.from(target.auth, 'base64url');
const senderKey = await crypto.subtle.importKey('raw', senderPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: senderKey }, device.privateKey, 256));
const ikm = (await hmac(await hmac(authSecret, ecdh), cat(enc('WebPush: info\0'), uaPublic, senderPublic, new Uint8Array([1])))).slice(0, 32);
const prk = await hmac(salt, ikm);
const cek = (await hmac(prk, cat(enc('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
const nonce = (await hmac(prk, cat(enc('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ciphertext));
check(plain[plain.length - 1] === 2, 'one record, marked as the last');
check(JSON.stringify(JSON.parse(new TextDecoder().decode(plain.slice(0, -1)))) === JSON.stringify(message), 'the device decrypts exactly the message that was sent');
const [, jwt, k] = /^vapid t=([^,]+), k=(.+)$/.exec(headers.get('authorization') || '') ?? [];
const [h64, c64, s64] = jwt.split('.');
const claims = JSON.parse(Buffer.from(c64, 'base64url').toString());
check(k === publicRaw && JSON.parse(Buffer.from(h64, 'base64url').toString()).alg === 'ES256', 'the VAPID header names the public key and ES256');
check(claims.aud === 'https://push.example.com' && claims.sub === 'mailto:hr@example.com' && claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600,
  'the token is for the push service, from our contact, valid less than 24 hours', claims);
check(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vapidKeys.publicKey, Buffer.from(s64, 'base64url'), enc(`${h64}.${c64}`)), 'the token is signed with our VAPID key');

// --- the answer
check(await sendWebPush(target, message, vapid!, answer(410)) === 'gone', 'sendWebPush maps 410 to gone');
check(await sendWebPush(target, message, vapid!, answer(404)) === 'gone', 'sendWebPush maps 404 to gone');
check(await sendWebPush(target, message, vapid!, answer(500)) === 'failed', 'sendWebPush maps 500 to failed');
check(await sendWebPush(target, message, vapid!, async () => { throw new Error('network down'); }) === 'failed', 'sendWebPush maps a thrown fetch to failed');
check(await sendWebPush({ ...target, p256dh: 'broken' }, message, vapid!, answer(201)) === 'failed', 'a broken device key is a failure, not a crash');
const hanging = (_u: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
const started = Date.now();
const keepAlive = setInterval(() => {}, 1000); // Node's AbortSignal.timeout does not keep the process alive on its own
check(await sendWebPush(target, message, vapid!, hanging, 100) === 'failed' && Date.now() - started < 2000, 'a push service that never answers is given up after the timeout');
clearInterval(keepAlive);

console.log(`=== WEB PUSH TESTS PASSED (${passed}) ===`);

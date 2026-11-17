/**
 * Web Push (attendance reminders on phones and laptops), with Web Crypto only, so it runs on the Cloudflare Worker as well as on Node.
 * - The message is encrypted for the device as RFC 8291 "aes128gcm" (the encoding every push service accepts, Apple's included).
 * - The request is signed with the CRM's VAPID key (RFC 8292), so the push service knows who sends it.
 *
 * Settings: VAPID_PUBLIC_KEY (the browser needs it to subscribe), VAPID_PRIVATE_KEY (secret: the private key as a JWK, e.g. from
 * `npx @pushforge/builder vapid`), VAPID_SUBJECT (a mailto: or https: contact the push services can reach).
 */
export interface PushTarget { id: string; endpoint: string; p256dh: string; auth: string }
export interface PushMessage { title: string; body: string; tag: string; url: string }
/** A P-256 private key as a JSON Web Key (what `npx @pushforge/builder vapid` prints). */
export interface VapidPrivateJwk { kty?: string; crv?: string; x?: string; y?: string; d?: string }
export interface VapidConfig { publicKey: string; privateJWK: VapidPrivateJwk; subject: string }
export type PushOutcome = 'ok' | 'gone' | 'failed';

/** The VAPID settings, or null when push is not set up (reminders then reach the CRM bell only). */
export function vapidConfig(): VapidConfig | null {
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject || !/^(mailto:|https:\/\/)/.test(subject)) return null;
  try {
    const privateJWK = JSON.parse(privateKey) as VapidPrivateJwk;
    if (privateJWK?.kty !== 'EC' || privateJWK.crv !== 'P-256' || !privateJWK.d || !privateJWK.x || !privateJWK.y) return null;
    return { publicKey, privateJWK, subject };
  } catch {
    return null;
  }
}

type Bytes = Uint8Array<ArrayBuffer>;
const enc = (s: string): Bytes => new TextEncoder().encode(s) as Bytes;
const b64url = (bytes: Uint8Array) => {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64url = (s: string): Bytes => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
};
const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const hmac = async (key: Bytes, data: Bytes): Promise<Bytes> =>
  new Uint8Array(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), data));
const ONE = new Uint8Array([1]);

/** RFC 8291: one aes128gcm record (header: salt, record size 4096, the sender's public key) for the device's key and auth secret. */
async function encrypt(payload: Bytes, p256dh: string, auth: string): Promise<Bytes> {
  const uaPublic = fromB64url(p256dh);
  const authSecret = fromB64url(auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error('The device key is not valid.');
  const device = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const sender = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])) as { publicKey: CryptoKey; privateKey: CryptoKey };
  const senderPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey) as ArrayBuffer);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: device }, sender.privateKey, 256));
  const ikm = (await hmac(await hmac(authSecret, ecdh), concat(enc('WebPush: info\0'), uaPublic, senderPublic, ONE))).slice(0, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(enc('Content-Encoding: aes128gcm\0'), ONE))).slice(0, 16);
  const nonce = (await hmac(prk, concat(enc('Content-Encoding: nonce\0'), ONE))).slice(0, 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = senderPublic.length;
  return concat(header, senderPublic, cipher);
}

/** RFC 8292: a short-lived ES256 token for the push service's origin, signed with the VAPID private key. */
async function vapidToken(endpoint: string, vapid: VapidConfig): Promise<string> {
  const { kty, crv, x, y, d } = vapid.privateJWK;
  const key = await crypto.subtle.importKey('jwk', { kty, crv, x, y, d }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (o: object) => b64url(enc(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: vapid.subject })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc(unsigned)));
  return `${unsigned}.${b64url(signature)}`;
}

/** A push "topic" (base64url characters, at most 32): a newer message with the same topic replaces one still waiting at the push service. */
const topicOf = (tag: string) => tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || 'amuwa-crm';

/** Send one message to one device. 404 / 410 mean the device unsubscribed or expired: it is "gone" and should not be tried again. */
export async function sendWebPush(target: PushTarget, message: PushMessage, vapid: VapidConfig, fetchImpl: typeof fetch = fetch): Promise<PushOutcome> {
  try {
    if (!/^https:\/\//.test(target.endpoint)) return 'failed';
    const body = await encrypt(enc(JSON.stringify(message)), target.p256dh, target.auth);
    const res = await fetchImpl(target.endpoint, {
      method: 'POST',
      headers: {
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: '1800',
        Urgency: 'high',
        Topic: topicOf(message.tag),
        Authorization: `vapid t=${await vapidToken(target.endpoint, vapid)}, k=${vapid.publicKey}`
      },
      body
    });
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'failed';
  } catch {
    return 'failed';
  }
}

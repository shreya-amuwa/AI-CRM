import { Aes256Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from '@hpke/core';
import type { ChatE2eeForViewer, ChatE2eeWrap, ChatKeyBackupBlob } from '../../../shared/contracts';

/**
 * End-to-end encryption of the internal chats: the cryptography, and nothing else (no network, no screens), so it runs the same in a
 * browser and in the Node tests.
 *
 *  Identity     one ECDH P-256 key pair per person. The private key never leaves the browser except inside a backup that is encrypted with
 *               the person's recovery passphrase (PBKDF2-HMAC-SHA256, 600,000 iterations -> AES-256-GCM). The server only ever holds that blob.
 *  Message      a random AES-256-GCM key K encrypts the message. K is sealed for EVERY current member with HPKE (RFC 9180) in AUTHENTICATED
 *               mode: DHKEM(P-256, HKDF-SHA256) / HKDF-SHA256 / AES-256-GCM, using the sender's identity key, so a recipient knows who sealed it
 *               and nobody else (the server included) can make a message that opens as somebody's. The conversation, the sender and the message id
 *               are bound into the ciphertext (AAD) and into every seal (info), so a message cannot be moved to another conversation or sender.
 *  File         encrypted in the browser with its own random AES-256-GCM key (which travels inside the encrypted message). The stored object is
 *               an envelope: "AME2", version 1, the nonce, the ciphertext.
 * The libraries are the browser's WebCrypto and hpke-js (@hpke/core, an implementation of RFC 9180). No algorithm here is home-made.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const P256 = { name: 'ECDH', namedCurve: 'P-256' } as const;
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_LENGTH = 12;

const suite = () => new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('This browser cannot do secure messaging (it needs a secure https connection).');
  return s;
};
/** A Uint8Array over its own ArrayBuffer (what WebCrypto and hpke-js want). */
const own = (b: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(b);

// ---------------------------------------------------------------------------------------------------------------------------------- base64
export function b64(bytes: ArrayBuffer | Uint8Array): string {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}
export function unb64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
const random = (n: number): Uint8Array<ArrayBuffer> => crypto.getRandomValues(new Uint8Array(n));

// ---------------------------------------------------------------------------------------------------------------------------------- identity
export interface Identity {
  /** Non-extractable once stored. */
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  /** The public key as the server and other people know it (uncompressed point, base64: 88 characters). */
  publicRaw: string;
  fingerprint: string;
}

/** A new key pair. The private key is extractable ONLY so it can go into the encrypted backup; `lock()` makes the stored copy non-extractable. */
export async function generateIdentity(): Promise<{ pair: CryptoKeyPair; pkcs8: Uint8Array<ArrayBuffer> }> {
  const pair = (await subtle().generateKey(P256, true, ['deriveBits'])) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await subtle().exportKey('pkcs8', pair.privateKey));
  return { pair, pkcs8 };
}

/** The identity from its PKCS#8 private key: the stored private key is NON-extractable from here on. */
export async function identityFromPkcs8(pkcs8: Uint8Array): Promise<Identity> {
  const extractable = await subtle().importKey('pkcs8', own(pkcs8), P256, true, ['deriveBits']);
  const jwk = await subtle().exportKey('jwk', extractable);
  const publicKey = await subtle().importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true }, P256, true, []);
  const privateKey = await subtle().importKey('pkcs8', own(pkcs8), P256, false, ['deriveBits']);
  const raw = new Uint8Array(await subtle().exportKey('raw', publicKey));
  return { privateKey, publicKey, publicRaw: b64(raw), fingerprint: await fingerprintOf(raw) };
}

export async function fingerprintOf(publicRaw: Uint8Array | string): Promise<string> {
  const raw = typeof publicRaw === 'string' ? unb64(publicRaw) : publicRaw;
  const d = new Uint8Array(await subtle().digest('SHA-256', own(raw)));
  return [...d].map(x => x.toString(16).padStart(2, '0')).join('');
}

/** "AB12 CD34 ..." (eight groups of eight for the first 32 hex characters is enough to compare by eye). */
export function formatFingerprint(hex: string): string {
  return (hex.slice(0, 32).toUpperCase().match(/.{1,4}/g) ?? []).join(' ');
}

// ---------------------------------------------------------------------------------------------------------------------------------- recovery backup
export interface Keyring {
  keys: { version: number; pkcs8: string }[];
}

async function passphraseKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey('raw', own(enc.encode(passphrase.normalize('NFKC'))), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: own(salt), iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
const BACKUP_AAD = enc.encode('amuwa-chat-keyring-v1');

export function passphraseProblem(passphrase: string): string | null {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  if (new Set(passphrase).size < 5) return 'Use a passphrase with more different characters.';
  return null;
}

export async function encryptKeyring(passphrase: string, ring: Keyring, iterations = PBKDF2_ITERATIONS): Promise<ChatKeyBackupBlob> {
  const salt = random(16);
  const iv = random(12);
  const key = await passphraseKey(passphrase, salt, iterations);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: BACKUP_AAD }, key, own(enc.encode(JSON.stringify(ring)))));
  return { v: 1, kdf: 'PBKDF2-SHA256', iter: iterations, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

/** Throws "wrong passphrase" when the passphrase does not open the backup (AES-GCM refuses a wrong key). */
export async function decryptKeyring(passphrase: string, blob: ChatKeyBackupBlob): Promise<Keyring> {
  if (blob.v !== 1 || blob.kdf !== 'PBKDF2-SHA256') throw new Error('This backup was made by a newer version of the app.');
  try {
    const key = await passphraseKey(passphrase, unb64(blob.salt), blob.iter);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: own(unb64(blob.iv)), additionalData: BACKUP_AAD }, key, own(unb64(blob.ct)));
    return JSON.parse(dec.decode(pt)) as Keyring;
  } catch {
    throw new Error('That is not the right recovery passphrase.');
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------- messages
/** What is inside an encrypted message (the server never sees it). */
export interface SecurePayload {
  /** The text. */
  t: string;
  /** The message being answered: only enough to show it. */
  r?: { id: string; seq: number; senderName: string | null; text: string };
  /** Files: where they are stored, what they are called and the key of each (the key lives only here). */
  a?: { id: string; name: string; mime: string; size: number; k: string }[];
}

export interface Recipient {
  profileId: string;
  keyVersion: number;
  publicKeyRaw: string;
}

const aadFor = (conversationId: string, senderId: string, clientMsgId: string) => enc.encode(`amuwa-chat-msg-v1|${conversationId}|${senderId}|${clientMsgId}`);
const infoFor = (conversationId: string, senderId: string, clientMsgId: string, recipientId: string) =>
  enc.encode(`amuwa-chat-wrap-v1|${conversationId}|${senderId}|${clientMsgId}|${recipientId}`);

export interface SealedMessage {
  v: 1;
  sv: number;
  iv: string;
  ct: string;
  wraps: ChatE2eeWrap[];
}

/** Encrypts `payload` for every recipient (the sender must be among them, to read their own message elsewhere). */
export async function sealMessage(args: {
  conversationId: string;
  clientMsgId: string;
  sender: { profileId: string; keyVersion: number; privateKey: CryptoKey; publicKey: CryptoKey };
  recipients: Recipient[];
  payload: SecurePayload;
}): Promise<SealedMessage> {
  const { conversationId, clientMsgId, sender, recipients, payload } = args;
  if (recipients.length === 0) throw new Error('Nobody to send this to.');
  const messageKey = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const rawKey = new Uint8Array(await subtle().exportKey('raw', messageKey));
  const iv = random(12);
  const aad = aadFor(conversationId, sender.profileId, clientMsgId);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: own(aad) }, messageKey, own(enc.encode(JSON.stringify(payload)))));
  const hpke = suite();
  const wraps: ChatE2eeWrap[] = [];
  for (const r of recipients) {
    const recipientPublicKey = await hpke.kem.deserializePublicKey(own(unb64(r.publicKeyRaw)).buffer);
    const ctx = await hpke.createSenderContext({
      recipientPublicKey,
      senderKey: { privateKey: sender.privateKey, publicKey: sender.publicKey },
      info: own(infoFor(conversationId, sender.profileId, clientMsgId, r.profileId))
    });
    const sealed = new Uint8Array(await ctx.seal(own(rawKey).buffer, own(aad).buffer));
    wraps.push({ to: r.profileId, kv: r.keyVersion, enc: b64(new Uint8Array(ctx.enc)), w: b64(sealed) });
  }
  rawKey.fill(0);
  return { v: 1, sv: sender.keyVersion, iv: b64(iv), ct: b64(ct), wraps };
}

export type OpenFailure = 'no-wrap' | 'old-key' | 'bad-signature' | 'damaged';
export class OpenError extends Error {
  constructor(readonly reason: OpenFailure, message: string) {
    super(message);
  }
}

/** Opens a message for the signed-in person. `myKeys` are the private keys this device holds, by version. */
export async function openMessage(args: {
  conversationId: string;
  clientMsgId: string;
  senderId: string;
  senderPublicRaw: string;
  e2ee: ChatE2eeForViewer;
  /** Both halves are passed: hpke-js cannot work out the public half of a NON-extractable private key (it then fails at random). */
  myKeys: Map<number, { privateKey: CryptoKey; publicKey: CryptoKey }>;
  myId: string;
}): Promise<SecurePayload> {
  const { conversationId, clientMsgId, senderId, senderPublicRaw, e2ee, myKeys, myId } = args;
  const wrap = e2ee.wrap;
  if (!wrap) throw new OpenError('no-wrap', 'This message was not sealed for you.');
  const myPair = myKeys.get(wrap.kv);
  if (!myPair) throw new OpenError('old-key', 'This message was sealed for a key this device does not have.');
  const aad = aadFor(conversationId, senderId, clientMsgId);
  let rawKey: ArrayBuffer;
  try {
    const hpke = suite();
    const senderPublicKey = await hpke.kem.deserializePublicKey(own(unb64(senderPublicRaw)).buffer);
    const ctx = await hpke.createRecipientContext({
      recipientKey: myPair,
      enc: own(unb64(wrap.enc)).buffer,
      senderPublicKey,
      info: own(infoFor(conversationId, senderId, clientMsgId, myId))
    });
    rawKey = await ctx.open(own(unb64(wrap.w)).buffer, own(aad).buffer);
  } catch {
    // an authenticated seal that does not open: not made by this sender's key, or altered, or made for another conversation
    throw new OpenError('bad-signature', 'This message could not be verified as sent by this person.');
  }
  try {
    const messageKey = await subtle().importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt']);
    const pt = await subtle().decrypt({ name: 'AES-GCM', iv: own(unb64(e2ee.iv)), additionalData: own(aad) }, messageKey, own(unb64(e2ee.ct)));
    return JSON.parse(dec.decode(pt)) as SecurePayload;
  } catch {
    throw new OpenError('damaged', 'This message is damaged.');
  } finally {
    new Uint8Array(rawKey).fill(0);
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------- files
const FILE_MAGIC = [0x41, 0x4d, 0x45, 0x32, 0x01]; // "AME2" + version 1

/** Encrypts a file's bytes with a fresh key. Returns the bytes to upload and the key (base64) to put inside the encrypted message. */
export async function encryptFile(bytes: Uint8Array): Promise<{ blob: Uint8Array<ArrayBuffer>; key: string }> {
  const key = await subtle().generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const raw = new Uint8Array(await subtle().exportKey('raw', key));
  const iv = random(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv, additionalData: own(new Uint8Array(FILE_MAGIC)) }, key, own(bytes)));
  const blob = new Uint8Array(FILE_MAGIC.length + iv.length + ct.length);
  blob.set(FILE_MAGIC, 0);
  blob.set(iv, FILE_MAGIC.length);
  blob.set(ct, FILE_MAGIC.length + iv.length);
  const k = b64(raw);
  raw.fill(0);
  return { blob, key: k };
}

export async function decryptFile(blob: Uint8Array, keyB64: string): Promise<Uint8Array<ArrayBuffer>> {
  if (blob.length < FILE_MAGIC.length + 12 + 16 || FILE_MAGIC.some((b, i) => blob[i] !== b)) throw new Error('This file is not a valid encrypted file.');
  const key = await subtle().importKey('raw', own(unb64(keyB64)), { name: 'AES-GCM' }, false, ['decrypt']);
  const iv = blob.subarray(FILE_MAGIC.length, FILE_MAGIC.length + 12);
  try {
    return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: own(iv), additionalData: own(new Uint8Array(FILE_MAGIC)) }, key, own(blob.subarray(FILE_MAGIC.length + 12))));
  } catch {
    throw new Error('This file is damaged or was changed.');
  }
}

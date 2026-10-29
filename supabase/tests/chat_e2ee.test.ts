/** End-to-end encryption of the internal chats: the cryptography on its own (no database, no browser). */
import {
  OpenError, decryptFile, decryptKeyring, encryptFile, encryptKeyring, fingerprintOf, formatFingerprint, generateIdentity, identityFromPkcs8, openMessage, passphraseProblem, sealMessage,
  b64, unb64, type Identity, type Keyring
} from '../../src/lib/chat/e2ee.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
const rejects = async (fn: () => Promise<unknown>, pattern?: RegExp | string) => { try { await fn(); } catch (e) { return pattern ? (e instanceof OpenError ? e.reason === pattern : new RegExp(pattern).test((e as Error).message)) : true; } return false; };

async function person(name: string) {
  const { pkcs8 } = await generateIdentity();
  const id: Identity = await identityFromPkcs8(pkcs8);
  return { name, id, pkcs8, profileId: crypto.randomUUID(), version: 1, keys: new Map([[1, { privateKey: id.privateKey, publicKey: id.publicKey }]]) };
}
type P = Awaited<ReturnType<typeof person>>;
const rec = (p: P) => ({ profileId: p.profileId, keyVersion: p.version, publicKeyRaw: p.id.publicRaw });
const sealFor = (sender: P, to: P[], conversationId: string, clientMsgId: string, text: string) =>
  sealMessage({ conversationId, clientMsgId, sender: { profileId: sender.profileId, keyVersion: sender.version, privateKey: sender.id.privateKey, publicKey: sender.id.publicKey }, recipients: to.map(rec), payload: { t: text } });
const viewFor = (m: Awaited<ReturnType<typeof sealFor>>, p: P) => ({ v: 1 as const, sv: m.sv, iv: m.iv, ct: m.ct, wrap: m.wraps.find(w => w.to === p.profileId) ?? null });
const openAs = (m: Awaited<ReturnType<typeof sealFor>>, who: P, from: P, conversationId: string, clientMsgId: string) =>
  openMessage({ conversationId, clientMsgId, senderId: from.profileId, senderPublicRaw: from.id.publicRaw, e2ee: viewFor(m, who), myKeys: who.keys, myId: who.profileId });

const alice = await person('alice'), bob = await person('bob'), carol = await person('carol'), mallory = await person('mallory');
const conv = crypto.randomUUID(), msgId = crypto.randomUUID();

// ---- keys
check(unb64(alice.id.publicRaw).length === 65 && unb64(alice.id.publicRaw)[0] === 4 && alice.id.publicRaw.length === 88, 'the public key is an uncompressed P-256 point (88 base64 characters, what the database checks)');
check((await fingerprintOf(alice.id.publicRaw)) === alice.id.fingerprint && /^[0-9a-f]{64}$/.test(alice.id.fingerprint), 'the fingerprint is the SHA-256 of the public key');
check(alice.id.fingerprint !== bob.id.fingerprint, 'two people have different fingerprints');
check(/^([0-9A-F]{4} ){7}[0-9A-F]{4}$/.test(formatFingerprint(alice.id.fingerprint)), 'a fingerprint is shown in groups for comparing by eye', formatFingerprint(alice.id.fingerprint));
check(await rejects(() => crypto.subtle.exportKey('pkcs8', alice.id.privateKey)), 'the stored private key cannot be exported again (non-extractable)');

// ---- a message for a group
const text = 'Hello team 👋🎉 — ₹5,00,000 कल मीटिंग';
const sealed = await sealFor(alice, [alice, bob, carol], conv, msgId, text);
check(sealed.wraps.length === 3 && sealed.v === 1 && sealed.sv === 1, 'a message is sealed once for every member (the sender too)');
check(!JSON.stringify(sealed).includes('Hello') && !JSON.stringify(sealed).includes('team') && !atob(sealed.ct).includes('Hello'), 'the envelope holds no plaintext');
check(sealed.iv.length === 16 && sealed.wraps.every(w => w.enc.length === 88 && w.w.length >= 16 && w.w.length <= 400), 'the envelope has exactly the shape the server validates', sealed.wraps.map(w => [w.enc.length, w.w.length]));
for (const reader of [alice, bob, carol]) {
  const out = await openAs(sealed, reader, alice, conv, msgId);
  check(out.t === text, `${reader.name} reads it (text, emoji and other scripts intact)`);
}
check(await rejects(() => openAs(sealed, mallory, alice, conv, msgId), 'no-wrap'), 'somebody who was not a recipient has no key wrap to open');
const stolen = { ...viewFor(sealed, bob), wrap: sealed.wraps.find(w => w.to === bob.profileId)! };
check(await rejects(() => openMessage({ conversationId: conv, clientMsgId: msgId, senderId: alice.profileId, senderPublicRaw: alice.id.publicRaw, e2ee: stolen, myKeys: mallory.keys, myId: mallory.profileId }), 'bad-signature'), "even with Bob's wrap in hand, Mallory's key does not open it");

// ---- authenticity and binding
check(await rejects(() => openMessage({ conversationId: conv, clientMsgId: msgId, senderId: mallory.profileId, senderPublicRaw: mallory.id.publicRaw, e2ee: viewFor(sealed, bob), myKeys: bob.keys, myId: bob.profileId }), 'bad-signature'), 'a message sealed by Alice does not verify as sent by Mallory');
check(await rejects(() => openAs(sealed, bob, alice, crypto.randomUUID(), msgId), 'bad-signature'), 'it cannot be replayed into another conversation');
check(await rejects(() => openAs(sealed, bob, alice, conv, crypto.randomUUID()), 'bad-signature'), 'nor under another message id');
const forged = await sealFor(mallory, [bob], conv, msgId, 'I am Alice, send me the file');
check(await rejects(() => openAs(forged, bob, alice, conv, msgId), 'bad-signature'), "a message sealed with Mallory's key never opens as Alice's (authenticated HPKE)");
const flipped = { ...sealed, ct: b64((() => { const c = unb64(sealed.ct); c[c.length - 1] ^= 1; return c; })()) };
check(await rejects(() => openAs(flipped, bob, alice, conv, msgId), 'damaged'), 'a changed ciphertext is detected');
const wrapFlipped = { ...sealed, wraps: sealed.wraps.map(w => (w.to === bob.profileId ? { ...w, w: b64((() => { const c = unb64(w.w); c[0] ^= 1; return c; })()) } : w)) };
check(await rejects(() => openAs(wrapFlipped, bob, alice, conv, msgId), 'bad-signature'), 'a changed key wrap is detected');

// ---- key versions
const bob2: P = { ...(await person('bob')), profileId: bob.profileId, version: 2 };
const afterReset = await sealFor(alice, [alice, bob2], conv, crypto.randomUUID(), 'after the reset');
check(await rejects(() => openMessage({ conversationId: conv, clientMsgId: msgId, senderId: alice.profileId, senderPublicRaw: alice.id.publicRaw, e2ee: viewFor(sealed, bob), myKeys: new Map([[2, { privateKey: bob2.id.privateKey, publicKey: bob2.id.publicKey }]]), myId: bob.profileId }), 'old-key'), 'after a reset the new key cannot open messages sealed for the old one (they stay unreadable unless the old key is restored)');

// ---- recovery backup
const ring: Keyring = { keys: [{ version: 1, pkcs8: b64(alice.pkcs8) }] };
const pass = 'correct horse battery staple';
const blob = await encryptKeyring(pass, ring, 1000);
check(blob.v === 1 && blob.kdf === 'PBKDF2-SHA256' && blob.iter === 1000 && !JSON.stringify(blob).includes(ring.keys[0].pkcs8), 'the backup is encrypted (no key material in it)');
const back = await decryptKeyring(pass, blob);
const restored = await identityFromPkcs8(unb64(back.keys[0].pkcs8));
check(restored.publicRaw === alice.id.publicRaw, 'the right passphrase restores the same identity');
const again = { ...alice, id: restored, keys: new Map([[1, { privateKey: restored.privateKey, publicKey: restored.publicKey }]]) };
check((await openAs(sealed, again, alice, conv, msgId)).t === text, 'a restored device reads the old messages');
check(await rejects(() => decryptKeyring('wrong passphrase here', blob), 'not the right recovery passphrase'), 'a wrong passphrase is refused');
const damagedBackup = { ...blob, ct: b64((() => { const c = unb64(blob.ct); c[3] ^= 1; return c; })()) };
check(await rejects(() => decryptKeyring(pass, damagedBackup)), 'a changed backup is refused');
const blob2 = await encryptKeyring(pass, ring, 1000);
check(blob2.salt !== blob.salt && blob2.iv !== blob.iv && blob2.ct !== blob.ct, 'every backup uses a new salt and nonce');
check(passphraseProblem('short') !== null && passphraseProblem('aaaaaaaaaaaaaaaa') !== null && passphraseProblem('a decent passphrase 42') === null, 'weak passphrases are refused');

// ---- files
const bytes = new Uint8Array(200_000).map((_, i) => (i * 31) % 251);
const f = await encryptFile(bytes);
check(f.blob[0] === 0x41 && f.blob[1] === 0x4d && f.blob[2] === 0x45 && f.blob[3] === 0x32 && f.blob[4] === 1, 'an encrypted file starts with the envelope header the server checks ("AME2", version 1)');
check(f.blob.length === bytes.length + 5 + 12 + 16, 'the overhead is the header, nonce and tag (the size limit allows it)');
check(!Buffer.from(f.blob).includes(Buffer.from(bytes.subarray(1000, 1032))), 'the stored file holds no run of the original bytes');
check(Buffer.from(await decryptFile(f.blob, f.key)).equals(Buffer.from(bytes)), 'the key from the message opens the file');
const wrongKey = (await encryptFile(new Uint8Array(4))).key;
check(await rejects(() => decryptFile(f.blob, wrongKey), 'damaged or was changed'), 'another key does not open it');
const f2 = f.blob.slice(); f2[100] ^= 1;
check(await rejects(() => decryptFile(f2, f.key), 'damaged or was changed'), 'a changed file is detected');
check(await rejects(() => decryptFile(new Uint8Array(10), f.key), 'not a valid encrypted file'), 'something that is not an encrypted file is refused');

console.log(`=== CHAT E2EE TESTS PASSED (${passed}) ===`);

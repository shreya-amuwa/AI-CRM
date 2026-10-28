/** The browser side of the encrypted chats (key setup, unlock on a new device, reset, colleagues' changed keys, messages that cannot be opened) against a stand-in server. */
import type { ChatKeyBackup, ChatKeyBackupBlob, ChatKeyStatus, ChatMemberKey, ChatMessage, ChatPublicKey } from '../../shared/contracts.js';
import { fingerprintOf } from '../../src/lib/chat/e2ee.js';
import { MemoryStore } from '../../src/lib/chat/keyStore.js';
import { SecureChatClient, SecureSendError, type SecureChatApi } from '../../src/lib/chat/secureChat.js';

let passed = 0;
function check(ok: unknown, label: string, extra?: unknown) {
  if (!ok) { console.error(`FAILED: ${label}`, extra === undefined ? '' : JSON.stringify(extra)); process.exit(1); }
  passed++; console.log(`ok - ${label}`);
}
const fails = async (fn: () => Promise<unknown>, test?: (e: any) => boolean) => { try { await fn(); } catch (e) { return test ? test(e) : true; } return false; };

/** Behaves like the database functions: public keys by version, one active key, a backup per person, the members of one conversation. */
class FakeServer {
  keys = new Map<string, { version: number; publicKey: string; fingerprint: string; retired: boolean }[]>();
  backups = new Map<string, ChatKeyBackup>();
  members: { id: string; name: string }[] = [];
  seen: unknown[] = [];
  api(me: string): SecureChatApi {
    const active = (id: string) => (this.keys.get(id) ?? []).find(k => !k.retired);
    return {
      keyStatus: async (): Promise<ChatKeyStatus> => { const k = active(me); return { hasKey: !!k, version: k?.version ?? null, publicKey: k?.publicKey ?? null, fingerprint: k?.fingerprint ?? null, hasBackup: this.backups.has(me) }; },
      keySetup: async (publicKey, blob) => { this.seen.push({ publicKey, blob }); if (active(me)) throw new Error('already set up'); return this.add(me, publicKey, blob); },
      keyReset: async (publicKey, blob) => { this.seen.push({ publicKey, blob }); (this.keys.get(me) ?? []).forEach(k => { k.retired = true; }); return this.add(me, publicKey, blob); },
      keyBackupGet: async () => this.backups.get(me) ?? null,
      keyBackupSet: async (blob: ChatKeyBackupBlob, version: number) => { this.backups.set(me, { version, blob }); },
      memberKeys: async (): Promise<ChatMemberKey[]> => this.members.map(m => { const k = active(m.id); return { profileId: m.id, name: m.name, keyVersion: k?.version ?? null, publicKey: k?.publicKey ?? null, fingerprint: k?.fingerprint ?? null }; }),
      keyLookup: async (id, version): Promise<ChatPublicKey | null> => { const k = (this.keys.get(id) ?? []).find(x => x.version === version); return k ? { profileId: id, keyVersion: k.version, publicKey: k.publicKey, fingerprint: k.fingerprint, retired: k.retired } : null; }
    };
  }
  private async add(id: string, publicKey: string, blob: ChatKeyBackupBlob) {
    const list = this.keys.get(id) ?? [];
    const version = (list.length ? Math.max(...list.map(k => k.version)) : 0) + 1;
    const fingerprint = await fingerprintOf(publicKey);
    list.push({ version, publicKey, fingerprint, retired: false });
    this.keys.set(id, list);
    this.backups.set(id, { version, blob });
    return { version, fingerprint };
  }
}

const server = new FakeServer();
const A = crypto.randomUUID(), B = crypto.randomUUID(), C = crypto.randomUUID();
server.members = [{ id: A, name: 'Asha' }, { id: B, name: 'Bilal' }];
const conv = { id: crypto.randomUUID() };
const client = (id: string, store = new MemoryStore()) => ({ c: new SecureChatClient(id, server.api(id), store), store });
const PASS = 'correct horse battery staple';

const asha = client(A);
await asha.c.init();
check(asha.c.getSnapshot().status === 'setup', 'a person who never set up secure messaging is asked to');
check(await fails(() => asha.c.setup('short')), 'a weak recovery passphrase is refused');
await asha.c.setup(PASS);
check(asha.c.getSnapshot().status === 'ready' && asha.c.getSnapshot().version === 1 && /^[0-9a-f]{64}$/.test(asha.c.getSnapshot().fingerprint ?? ''), 'after setup the key is ready');
check(!JSON.stringify(server.seen).includes(PASS), 'the passphrase never reached the server');
check(await fails(() => asha.c.seal(conv, crypto.randomUUID(), { t: 'hi' }), e => e instanceof SecureSendError && e.code === 'KEYS_MISSING' && e.people.join() === 'Bilal'), 'sending to somebody who has no key is refused, naming them (no plaintext fallback)');

const bilal = client(B);
await bilal.c.init();
await bilal.c.setup(PASS + ' too');

// ---- a conversation
const msgId = crypto.randomUUID();
const payload = { t: 'Quarterly numbers are ready 🎯', a: [{ id: crypto.randomUUID(), name: 'q3.pdf', mime: 'application/pdf', size: 1234, k: 'AAAA' }] };
const sealed = await asha.c.seal(conv, msgId, payload);
check(sealed.wraps.length === 2 && JSON.stringify(sealed).indexOf('Quarterly') < 0, 'sealed for both members, no plaintext in the envelope');
const wireFor = (viewer: string, over: Partial<ChatMessage> = {}): ChatMessage => ({
  id: crypto.randomUUID(), conversationId: conv.id, seq: 1, mine: viewer === A, senderKind: 'STAFF', senderName: 'Asha', senderLabel: null, kind: 'TEXT', body: '', attachments: [], clientMsgId: msgId,
  createdAt: new Date().toISOString(), replyTo: null, encrypted: true, senderId: A, e2ee: { v: 1, sv: sealed.sv, iv: sealed.iv, ct: sealed.ct, wrap: sealed.wraps.find(w => w.to === viewer) ?? null }, ...over
});
let [m] = await bilal.c.open(conv.id, [wireFor(B)]);
check(m.body === payload.t && m.secure?.state === 'ok' && m.attachments[0].name === 'q3.pdf' && m.attachments[0].secretKey === 'AAAA', 'the recipient reads it, with the file details from inside the message');
[m] = await asha.c.open(conv.id, [wireFor(A)]);
check(m.body === payload.t, 'the sender reads their own message');
const old = { ...wireFor(B), kind: 'TEXT' as const, encrypted: false, e2ee: null, body: 'written before encryption', senderId: null };
[m] = await bilal.c.open(conv.id, [old]);
check(m.body === 'written before encryption' && m.secure?.state === 'legacy', 'an older, unencrypted message is shown and labelled as such');
const gone = { ...wireFor(B), deleted: true, body: '', e2ee: null };
[m] = await bilal.c.open(conv.id, [gone]);
check(m.deleted === true && m.body === '' && m.secure === undefined, 'a deleted message stays a tombstone');

// ---- messages that cannot be opened
const tampered = { ...wireFor(B), e2ee: { ...wireFor(B).e2ee!, ct: wireFor(B).e2ee!.ct.slice(0, -4) + 'AAAA' } };
[m] = await bilal.c.open(conv.id, [tampered]);
check(m.body === '' && m.secure?.state === 'failed' && m.secure.reason === 'damaged', 'a changed ciphertext is shown as damaged, with no text');
[m] = await bilal.c.open(conv.id, [{ ...wireFor(B), senderId: C }]);
check(m.secure?.state === 'failed', 'a message claiming another sender does not open as theirs');
[m] = await bilal.c.open(conv.id, [{ ...wireFor(B), senderId: null }]);
check(m.secure?.state === 'failed' && m.secure.reason === 'unknown-sender', 'a message with no sender cannot be checked');
[m] = await bilal.c.open(conv.id, [{ ...wireFor(B), clientMsgId: crypto.randomUUID() }]);
check(m.secure?.state === 'failed' && m.secure.reason === 'bad-signature', 'a message moved under another message id does not open');

// ---- a new device: locked until the recovery passphrase is given
const asha2 = client(A);
await asha2.c.init();
check(asha2.c.getSnapshot().status === 'locked', 'a new device of somebody who already set up is locked');
[m] = await asha2.c.open(conv.id, [wireFor(A)]);
check(m.secure?.state === 'failed' && m.secure.reason === 'locked' && m.body === '', 'a locked device shows encrypted messages as locked');
check(await fails(() => asha2.c.seal(conv, crypto.randomUUID(), { t: 'x' }), e => e instanceof SecureSendError && e.code === 'LOCKED'), 'and cannot send');
check(await fails(() => asha2.c.unlock('the wrong passphrase!!'), e => /right recovery passphrase/.test(e.message)), 'the wrong passphrase does not unlock');
await asha2.c.unlock(PASS);
check(asha2.c.getSnapshot().status === 'ready', 'the right passphrase unlocks it');
[m] = await asha2.c.open(conv.id, [wireFor(A)]);
check(m.body === payload.t, 'and the old messages can be read on the new device');
check((await asha2.store.keys()).length === 1 && (await crypto.subtle.exportKey('pkcs8', (await asha2.store.keys())[0].privateKey).then(() => false, () => true)), 'the key on the new device is non-extractable');

// ---- changing the recovery passphrase
await asha2.c.changePassphrase(PASS, 'a brand new passphrase 77');
const asha3 = client(A); await asha3.c.init();
check(await fails(() => asha3.c.unlock(PASS), e => /right recovery passphrase/.test(e.message)), 'after changing it the old passphrase no longer unlocks');
await asha3.c.unlock('a brand new passphrase 77');
check(asha3.c.getSnapshot().status === 'ready', 'the new passphrase does');

// ---- a colleague's key changes
let peers = await asha.c.peers(conv.id);
check(peers.find(p => p.profileId === B)?.changed === false, "Bilal's key is trusted the first time it is seen");
await bilal.c.reset('another recovery passphrase 1');
peers = await asha.c.peers(conv.id);
check(peers.find(p => p.profileId === B)?.changed === true, "after Bilal resets, Asha's device notices the key changed");
check(await fails(() => asha.c.seal(conv, crypto.randomUUID(), { t: 'x' }), e => e instanceof SecureSendError && e.code === 'KEY_CHANGED' && e.people.join() === 'Bilal'), 'and will not send until it is accepted');
const bNow = peers.find(p => p.profileId === B)!;
await asha.c.accept(B, bNow.fingerprint!, true);
peers = await asha.c.peers(conv.id);
check(peers.find(p => p.profileId === B)?.changed === false && peers.find(p => p.profileId === B)?.verified === true, 'accepting (and confirming the fingerprints match) marks it verified');
const after = await asha.c.seal(conv, crypto.randomUUID(), { t: 'after the reset' });
check(after.wraps.find(w => w.to === B)?.kv === 2, "the next message is sealed for Bilal's NEW key");
// Bilal on a fresh device after the reset cannot read what was sealed for the old key
const bilal2 = client(B); await bilal2.c.init(); await bilal2.c.unlock('another recovery passphrase 1');
[m] = await bilal2.c.open(conv.id, [wireFor(B)]);
check(m.secure?.state === 'failed' && m.secure.reason === 'old-key', 'a new device after a reset cannot read messages sealed for the old key (and says why)');
// the device that held the old key still can
[m] = await bilal.c.open(conv.id, [wireFor(B)]);
check(m.body === payload.t, 'the device that still holds the old key keeps reading old messages');

// ---- removing keys from a device
await asha3.c.removeFromDevice();
check(asha3.c.getSnapshot().status === 'locked' && (await asha3.store.keys()).length === 0, 'removing the keys from a device locks it (the passphrase brings them back)');

console.log(`=== CHAT SECURE CLIENT TESTS PASSED (${passed}) ===`);

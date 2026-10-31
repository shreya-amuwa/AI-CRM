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
  /** Makes keyRegister fail (the network is down). */
  down = false;
  api(me: string): SecureChatApi {
    const active = (id: string) => (this.keys.get(id) ?? []).find(k => !k.retired);
    return {
      keyStatus: async (): Promise<ChatKeyStatus> => { const k = active(me); return { hasKey: !!k, version: k?.version ?? null, publicKey: k?.publicKey ?? null, fingerprint: k?.fingerprint ?? null, hasBackup: this.backups.has(me), backupVersion: this.backups.get(me)?.version ?? null }; },
      // the database functions: chat_key_register (idempotent for the same key, CONFLICT for another) and chat_key_rotate (no passphrase, the old key retired)
      keyRegister: async publicKey => {
        this.seen.push({ publicKey, via: 'register' });
        if (this.down) throw new Error('The server did not answer.');
        const fp = await fingerprintOf(publicKey);
        const k = active(me);
        if (k) { if (k.publicKey === publicKey) return { version: k.version, fingerprint: k.fingerprint }; throw Object.assign(new Error('Secure messaging is already set up for this account on another device.'), { code: 'CONFLICT' }); }
        return this.addNow(me, publicKey, null, fp);
      },
      keyRotate: async publicKey => {
        this.seen.push({ publicKey, via: 'rotate' });
        const fp = await fingerprintOf(publicKey);
        const k = active(me);
        if (k && k.publicKey === publicKey) return { version: k.version, fingerprint: k.fingerprint };
        (this.keys.get(me) ?? []).forEach(x => { x.retired = true; });
        return this.addNow(me, publicKey, null, fp);
      },
      keySetup: async (publicKey, blob) => { this.seen.push({ publicKey, blob }); if (active(me)) throw new Error('already set up'); return this.add(me, publicKey, blob); },
      keyReset: async (publicKey, blob) => { this.seen.push({ publicKey, blob }); (this.keys.get(me) ?? []).forEach(k => { k.retired = true; }); return this.add(me, publicKey, blob); },
      keyBackupGet: async () => this.backups.get(me) ?? null,
      keyBackupSet: async (blob: ChatKeyBackupBlob, version: number) => { this.backups.set(me, { version, blob }); },
      memberKeys: async (): Promise<ChatMemberKey[]> => this.members.map(m => { const k = active(m.id); return { profileId: m.id, name: m.name, keyVersion: k?.version ?? null, publicKey: k?.publicKey ?? null, fingerprint: k?.fingerprint ?? null }; }),
      keyLookup: async (id, version): Promise<ChatPublicKey | null> => { const k = (this.keys.get(id) ?? []).find(x => x.version === version); return k ? { profileId: id, keyVersion: k.version, publicKey: k.publicKey, fingerprint: k.fingerprint, retired: k.retired } : null; }
    };
  }
  /** One step with no awaiting in it, like the database function under its lock. */
  private add(id: string, publicKey: string, blob: ChatKeyBackupBlob | null) { return fingerprintOf(publicKey).then(fp => this.addNow(id, publicKey, blob, fp)); }
  private addNow(id: string, publicKey: string, blob: ChatKeyBackupBlob | null, fingerprint: string) {
    const list = this.keys.get(id) ?? [];
    const version = (list.length ? Math.max(...list.map(k => k.version)) : 0) + 1;
    list.push({ version, publicKey, fingerprint, retired: false });
    this.keys.set(id, list);
    if (blob) this.backups.set(id, { version, blob });
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


// ============================================================================================================================ automatic set-up
// A store that stands in for IndexedDB (keys survive between starts); the plain MemoryStore() is the private-window case.
const device = () => new MemoryStore(true);
{
  const S = new FakeServer();
  S.members = [{ id: A, name: 'Asha' }, { id: B, name: 'Bilal' }];
  const mk = (id: string, store = device()) => ({ c: new SecureChatClient(id, S.api(id), store), store });

  // ---- first use: nothing to click, nothing to type
  const a1 = mk(A);
  await a1.c.init();
  const snap = a1.c.getSnapshot();
  check(snap.status === 'ready' && snap.version === 1 && /^[0-9a-f]{64}$/.test(snap.fingerprint ?? ''), 'automatic set-up: a person with no key is ready after the first start, with nothing asked');
  check((await a1.store.keys()).length === 1 && (await a1.store.pending()) === null, 'the key is kept on the device and nothing is left pending');
  check(S.backups.size === 0 && snap.hasBackup === false, 'no recovery backup and no passphrase were made');
  check(S.seen.length === 1 && Object.keys(S.seen[0] as object).sort().join() === 'publicKey,via' && (S.seen[0] as { publicKey: string }).publicKey.length === 88, 'the server was given the public key and nothing else');
  const stored = (await a1.store.keys())[0];
  check(stored.privateKey.extractable === false && (await crypto.subtle.exportKey('pkcs8', stored.privateKey).then(() => false, () => true)), 'the private key is non-extractable: it cannot be read out of the browser');
  check(JSON.stringify(S).indexOf('PRIVATE') < 0 && !JSON.stringify(S.seen).includes('pkcs8'), 'no private key material reached the server');

  // ---- starting again, a reload, the same browser: the same key, no second one
  const a1b = mk(A, a1.store);
  await a1b.c.init();
  check(a1b.c.getSnapshot().status === 'ready' && a1b.c.getSnapshot().version === 1 && S.keys.get(A)!.length === 1 && S.seen.length === 1, 'a restart reuses the key: no second key, no second registration');

  // ---- two tabs of one browser start at the same moment (they share the store)
  const shared = device();
  const t1 = mk(B, shared), t2 = mk(B, shared);
  await Promise.all([t1.c.init(), t2.c.init()]);
  check(t1.c.getSnapshot().status === 'ready' && t2.c.getSnapshot().status === 'ready' && S.keys.get(B)!.length === 1 && (await shared.keys()).length === 1, 'two tabs starting together end with ONE key, both ready');
  check(t1.c.getSnapshot().fingerprint === t2.c.getSnapshot().fingerprint, 'and the same key');

  // ---- messages work with no passphrase anywhere
  const seal = await a1.c.seal(conv, msgId, { t: 'no passphrase needed' });
  check(seal.wraps.length === 2 && JSON.stringify(seal).indexOf('no passphrase') < 0, 'a message is sealed for both members, ciphertext only');
  const wire = (viewer: string): ChatMessage => ({ id: crypto.randomUUID(), conversationId: conv.id, seq: 1, mine: viewer === A, senderKind: 'STAFF', senderName: 'Asha', senderLabel: null, kind: 'TEXT', body: '', attachments: [], clientMsgId: msgId,
    createdAt: new Date().toISOString(), replyTo: null, encrypted: true, senderId: A, e2ee: { v: 1, sv: seal.sv, iv: seal.iv, ct: seal.ct, wrap: seal.wraps.find(w => w.to === viewer) ?? null } });
  const [got] = await t1.c.open(conv.id, [wire(B)]);
  check(got.body === 'no passphrase needed' && got.secure?.state === 'ok', 'the colleague reads it');

  // ---- a second device of an automatic account: locked, and nothing is replaced behind the person's back
  const a2 = mk(A);
  await a2.c.init();
  const lockedSnap = a2.c.getSnapshot();
  check(lockedSnap.status === 'locked' && lockedSnap.recovery === 'new-key' && lockedSnap.hasBackup === false, 'a new device of an account with no backup is locked and says the way in is a new key');
  check(S.keys.get(A)!.length === 1 && !S.keys.get(A)![0].retired && (await a2.store.keys()).length === 0, 'the account keeps its key: the login on another browser did not replace it');
  check(await fails(() => a2.c.seal(conv, crypto.randomUUID(), { t: 'x' }), e => e instanceof SecureSendError && e.code === 'LOCKED'), 'a locked device cannot send (no plaintext fallback)');
  const [lockedMsg] = await a2.c.open(conv.id, [wire(A)]);
  check(lockedMsg.body === '' && lockedMsg.secure?.state === 'failed' && lockedMsg.secure.reason === 'locked', 'and shows encrypted messages as locked, with no text');
  check(await fails(() => a2.c.unlock('anything at all 12345')), 'there is no passphrase that unlocks it');

  // ---- two devices start at the same moment: one key wins, the other is told (and keeps nothing)
  const S2 = new FakeServer();
  S2.members = S.members;
  const dev1 = new SecureChatClient(A, S2.api(A), device()), dev2 = new SecureChatClient(A, S2.api(A), device());
  await Promise.all([dev1.init(), dev2.init()]);
  const statuses = [dev1.getSnapshot().status, dev2.getSnapshot().status].sort().join();
  check(statuses === 'locked,ready' && S2.keys.get(A)!.length === 1, 'two devices at once: one is ready, the other locked, and the account has ONE key');
  const loser = dev1.getSnapshot().status === 'locked' ? dev1 : dev2;
  check(loser.getSnapshot().recovery === 'new-key', 'the other device is offered the new-key step, not a silent reset');

  // ---- the person chooses to go on with a new key on the new device
  await t1.c.peers(conv.id); // Bilal's device has seen Asha's first key
  await a2.c.continueWithNewKey();
  check(a2.c.getSnapshot().status === 'ready' && a2.c.getSnapshot().version === 2, 'on request the device continues with a NEW key (version 2)');
  check(S.keys.get(A)!.filter(k => !k.retired).length === 1 && S.keys.get(A)!.find(k => k.version === 1)!.retired, 'the old key is retired, one key is active');
  check(S.seen.filter(x => (x as { via?: string }).via === 'rotate').length === 1, 'it went through the explicit rotate call');
  const [oldMsg] = await a2.c.open(conv.id, [wire(A)]);
  check(oldMsg.secure?.state === 'failed' && oldMsg.secure.reason === 'old-key', 'messages sealed for the old key are marked unreadable here, with the reason');
  const bSeesA = await t1.c.peers(conv.id);
  check(bSeesA.find(p => p.profileId === A)?.changed === true, "Bilal's device sees that Asha's key changed and holds sending until it is accepted");
  check(await fails(() => t1.c.seal(conv, crypto.randomUUID(), { t: 'x' }), e => e instanceof SecureSendError && e.code === 'KEY_CHANGED'), 'no message goes out to the changed key until it is accepted');

  // ---- the network fails during set-up: nothing is lost, a retry finishes with the SAME key
  const S3 = new FakeServer();
  S3.members = [{ id: A, name: 'Asha' }];
  S3.down = true;
  const store3 = device();
  const n1 = new SecureChatClient(A, S3.api(A), store3);
  await n1.init();
  check(n1.getSnapshot().status === 'setup' && n1.getSnapshot().setupReason === 'failed' && S3.keys.size === 0, 'a failed registration leaves "set-up" with a reason, and nothing was registered');
  const pendingBefore = await store3.pending();
  check(!!pendingBefore, 'the key made on the device is kept (pending), not thrown away');
  S3.down = false;
  await n1.retryAutomatic();
  check(n1.getSnapshot().status === 'ready' && S3.keys.get(A)!.length === 1 && (await store3.pending()) === null, 'the retry publishes it: ready, one key, nothing pending');
  check((S3.seen as { publicKey: string }[]).every(x => x.publicKey === (S3.seen as { publicKey: string }[])[0].publicKey), 'every attempt carried the SAME public key (no second key was made)');

  // ---- the page closed after the server took the key and before the device recorded it
  const S4 = new FakeServer();
  S4.members = [{ id: A, name: 'Asha' }];
  const store4 = device();
  const half = new SecureChatClient(A, S4.api(A), store4);
  const { pkcs8 } = await (await import('../../src/lib/chat/e2ee.js')).generateIdentity();
  const idn = await (await import('../../src/lib/chat/e2ee.js')).identityFromPkcs8(pkcs8);
  await store4.putPendingIfAbsent({ version: 0, privateKey: idn.privateKey, publicKey: idn.publicKey });
  await S4.api(A).keyRegister(idn.publicRaw);
  await half.init();
  check(half.getSnapshot().status === 'ready' && half.getSnapshot().version === 1 && S4.keys.get(A)!.length === 1 && (await store4.keys()).length === 1, 'a set-up cut short is completed on the next start with the same key');

  // ---- a browser that cannot keep keys (a private window): nothing is registered by itself
  const S5 = new FakeServer();
  S5.members = [{ id: A, name: 'Asha' }];
  const priv = new SecureChatClient(A, S5.api(A), new MemoryStore());
  await priv.init();
  check(priv.getSnapshot().status === 'setup' && priv.getSnapshot().setupReason === 'storage' && S5.keys.size === 0 && S5.seen.length === 0, 'where keys cannot be kept the set-up is not done by itself (no key is published that would be lost with the tab)');
  check(await fails(() => priv.continueWithNewKey(), e => /cannot keep keys/.test(e.message)), 'and a new key is not made there either');
  await priv.setup('a recovery passphrase for a private window');
  check(priv.getSnapshot().status === 'ready' && priv.getSnapshot().hasBackup, 'the passphrase set-up still works there (the backup is what makes it recoverable)');

  // ---- an older account with a recovery backup: unlock with the passphrase, as before
  const S6 = new FakeServer();
  S6.members = [{ id: A, name: 'Asha' }];
  const first = new SecureChatClient(A, S6.api(A), new MemoryStore());
  await first.init();
  await first.setup(PASS);
  const other = new SecureChatClient(A, S6.api(A), device());
  await other.init();
  check(other.getSnapshot().status === 'locked' && other.getSnapshot().recovery === 'passphrase' && other.getSnapshot().hasBackup, 'an account with a backup: a new device is locked and offered the passphrase');
  await other.unlock(PASS);
  check(other.getSnapshot().status === 'ready' && S6.keys.get(A)!.length === 1, 'the passphrase unlocks it, and no new key was made');
  // a backup of an OLDER key is not offered as a way in
  const third = new SecureChatClient(A, S6.api(A), device());
  await third.init();
  await third.continueWithNewKey();
  const fourth = new SecureChatClient(A, S6.api(A), device());
  await fourth.init();
  check(fourth.getSnapshot().status === 'locked' && fourth.getSnapshot().recovery === 'new-key' && !fourth.getSnapshot().hasBackup, 'a backup that belongs to an older key is not offered as a way in');

  // ---- removing the keys from the only device of an automatic account
  await a1.c.removeFromDevice();
  check(a1.c.getSnapshot().status === 'locked' && a1.c.getSnapshot().recovery === 'new-key' && S.keys.get(A)![0].retired === true && S.keys.get(A)!.length === 2, 'removing the keys leaves the account locked (it does not quietly make a new key)');
}

console.log(`=== CHAT SECURE CLIENT TESTS PASSED (${passed}) ===`);

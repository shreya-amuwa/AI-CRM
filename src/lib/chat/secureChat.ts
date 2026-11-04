import type {
  ChatKeyBackup, ChatKeyBackupBlob, ChatKeyStatus, ChatMemberKey, ChatMessage, ChatPublicKey, ChatSecureState
} from '../../../shared/contracts';
import {
  OpenError, b64, decryptFile, decryptKeyring, encryptFile, encryptKeyring, fingerprintOf, generateIdentity, identityFromPkcs8, openMessage, passphraseProblem,
  sealMessage, unb64, type Keyring, type SealedMessage, type SecurePayload
} from './e2ee';
import type { KeyStore, PeerPin, StoredKey } from './keyStore';

/** What the secure-messaging client needs from the server (the API in the app, a stand-in in the tests). */
export interface SecureChatApi {
  keyStatus(): Promise<ChatKeyStatus>;
  /** The automatic first key: the public key only. Repeating it with the same key is safe; a different key is refused (CONFLICT). */
  keyRegister(publicKey: string): Promise<{ version: number; fingerprint: string }>;
  /** A new key on this device when the person chose to go on without the old one (no passphrase). */
  keyRotate(publicKey: string): Promise<{ version: number; fingerprint: string }>;
  keySetup(publicKey: string, backup: ChatKeyBackupBlob): Promise<{ version: number; fingerprint: string }>;
  keyReset(publicKey: string, backup: ChatKeyBackupBlob): Promise<{ version: number; fingerprint: string }>;
  keyBackupGet(): Promise<ChatKeyBackup | null>;
  keyBackupSet(backup: ChatKeyBackupBlob, version: number): Promise<unknown>;
  memberKeys(conversationId: string): Promise<ChatMemberKey[]>;
  keyLookup(profileId: string, version: number): Promise<ChatPublicKey | null>;
}

/**
 * loading | preparing (the key is being made and published, nothing to do) | ready |
 * locked (a key exists for this account but this device does not hold it) |
 * setup (no key could be made automatically: this browser cannot keep keys, or the server did not answer; see `setupReason`) | error
 */
export type SecureStatus = 'loading' | 'preparing' | 'setup' | 'locked' | 'ready' | 'error';
/** What opens a locked device: the recovery passphrase (an older account with a backup), or a new key made here after the person agrees. */
export type SecureRecovery = 'passphrase' | 'new-key';
export interface SecureSnapshot {
  status: SecureStatus;
  /** For `locked`: how this device can get back in. */
  recovery: SecureRecovery | null;
  /** For `setup`: why it was not done by itself. */
  setupReason: 'storage' | 'failed' | null;
  /** A recovery backup (protected by a passphrase) of the CURRENT key exists on the server. */
  hasBackup: boolean;
  error: string;
  version: number | null;
  fingerprint: string | null;
  /** false: the keys live only as long as this tab (no IndexedDB). */
  persistent: boolean;
  /** Bumps whenever something changed that screens should re-read (keys unlocked, a colleague's key accepted). */
  revision: number;
}

export type SecureSendFailure = 'LOCKED' | 'KEYS_MISSING' | 'KEY_CHANGED' | 'KEYS_STALE';
export class SecureSendError extends Error {
  constructor(readonly code: SecureSendFailure, message: string, readonly people: string[] = []) {
    super(message);
  }
}

export interface PeerInfo {
  profileId: string;
  name: string;
  fingerprint: string | null;
  me: boolean;
  /** The key differs from the one this device first saw / last accepted: it must be accepted before sending. */
  changed: boolean;
  verified: boolean;
  keyVersion: number | null;
}

const peerCacheKey = (id: string, v: number) => `${id}:${v}`;
const publicRawOf = async (key: CryptoKey) => b64(new Uint8Array(await crypto.subtle.exportKey('raw', key)));

/**
 * The browser side of the end-to-end encrypted chats. It owns the person's keys (via the key store), turns a message into an envelope for
 * every member and opens the envelopes it receives. The server is only ever given public keys, the passphrase-encrypted backup and envelopes.
 */
export class SecureChatClient {
  private snap: SecureSnapshot;
  private readonly listeners = new Set<() => void>();
  private keys = new Map<number, StoredKey>();
  private activeVersion: number | null = null;
  private readonly peerKeys = new Map<string, ChatPublicKey | null>();
  private readonly opened = new Map<string, { payload: SecurePayload }>();
  private myPublicRaw = new Map<number, string>();
  /** Make the first key by itself (end-to-end mode). Off in the company-readable mode. */
  private autoProvision = true;

  constructor(private readonly myId: string, private readonly api: SecureChatApi, private readonly store: KeyStore) {
    this.snap = { status: 'loading', recovery: null, setupReason: null, hasBackup: false, error: '', version: null, fingerprint: null, persistent: store.persistent, revision: 0 };
  }

  // ------------------------------------------------------------------------------------------------------------------------ state
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  getSnapshot = () => this.snap;
  private set(patch: Partial<SecureSnapshot>) {
    this.snap = { ...this.snap, ...patch, revision: this.snap.revision + 1 };
    this.listeners.forEach(l => l());
  }

  /**
   * Looks at the server and at this device and decides. A person with no key yet gets one made here without being asked (see provision);
   * a person whose key exists but is not on this device is "locked"; a person whose key is on this device is "ready".
   */
  async init(opts: { autoProvision?: boolean } = {}): Promise<void> {
    if (opts.autoProvision !== undefined) this.autoProvision = opts.autoProvision;
    try {
      const status = await this.api.keyStatus();
      // in the company-readable mode no key is needed to chat: one is never made by itself (this device may still hold an older one to read old messages)
      if (!status.hasKey && this.store.persistent && this.autoProvision) {
        this.set({ status: 'preparing', error: '' });
        try {
          await this.provision();
        } catch (e) {
          // the server did not take the key (or did not answer): the person can try again, or choose a passphrase set-up
          this.set({ status: 'setup', setupReason: 'failed', recovery: null, error: e instanceof Error ? e.message : 'Secure messaging could not be prepared.' });
        }
        return;
      }
      await this.evaluate(status);
    } catch (e) {
      this.set({ status: 'error', error: e instanceof Error ? e.message : 'Secure messaging could not start.' });
    }
  }

  /** Decides from what the server says and what this device holds. Never changes a key. */
  private async evaluate(status: ChatKeyStatus): Promise<void> {
    let local = await this.store.keys();
    // a key made here whose publication was cut short: if the server holds exactly that key, it is this device's key for that version
    const pend = await this.store.pending();
    if (pend && status.hasKey && status.version !== null && !local.some(k => k.version === status.version) && (await publicRawOf(pend.publicKey)) === status.publicKey) {
      await this.store.promote(status.version);
      local = await this.store.keys();
    }
    this.keys = new Map(local.map(k => [k.version, k]));
    await this.indexOwnPublicKeys();
    this.activeVersion = status.version;
    const hasBackup = status.hasBackup && (status.backupVersion === undefined || status.backupVersion === null || status.backupVersion === status.version);
    if (!status.hasKey) return this.set({ status: 'setup', setupReason: 'storage', recovery: null, hasBackup: false, error: '', version: null, fingerprint: null });
    const mine = status.version !== null ? this.keys.get(status.version) : undefined;
    if (mine && status.publicKey && this.myPublicRaw.get(mine.version) === status.publicKey) {
      return this.set({ status: 'ready', setupReason: null, recovery: null, hasBackup, error: '', version: status.version, fingerprint: status.fingerprint });
    }
    this.set({ status: 'locked', setupReason: null, recovery: hasBackup ? 'passphrase' : 'new-key', hasBackup, error: '', version: status.version, fingerprint: status.fingerprint });
  }

  /** Runs one thing at a time for this person across the tabs of this browser (Web Locks); where they do not exist the steps below are safe to repeat. */
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    if (!locks?.request) return fn();
    return locks.request(`amuwa-chat-keys:${this.myId}`, fn) as Promise<T>;
  }

  /**
   * The first key, made without a passphrase. The key pair is made in this browser and kept as a NON-extractable key in IndexedDB; only the
   * public half is sent. Steps that make it safe to repeat: the key is first stored as "pending" (created only if there is none), then
   * published (the server accepts the same key twice and refuses a different one), then it becomes the key of that version. A second tab, a
   * reload half way and a retry all end with one key; an existing key of the account is never replaced.
   */
  private async provision(): Promise<void> {
    await this.exclusive(async () => {
      const status = await this.api.keyStatus(); // somebody else (another tab, another device) may have done it while this waited
      if (status.hasKey) return this.evaluate(status);
      let key = await this.store.pending();
      if (!key) {
        const { pkcs8 } = await generateIdentity();
        const id = await identityFromPkcs8(pkcs8);
        pkcs8.fill(0);
        const fresh: StoredKey = { version: 0, privateKey: id.privateKey, publicKey: id.publicKey };
        key = (await this.store.putPendingIfAbsent(fresh)) ? fresh : await this.store.pending();
      }
      if (!key) throw new Error('This browser could not keep the key.');
      await this.publish(key, 'register');
    });
  }

  private async publish(key: StoredKey, how: 'register' | 'rotate'): Promise<void> {
    const raw = await publicRawOf(key.publicKey);
    let done: { version: number; fingerprint: string };
    try {
      done = how === 'register' ? await this.api.keyRegister(raw) : await this.api.keyRotate(raw);
    } catch (e) {
      if ((e as { code?: string }).code === 'CONFLICT') { // the account got a key from another device first: this one is of no use
        await this.store.dropPending();
        return this.evaluate(await this.api.keyStatus());
      }
      throw e;
    }
    // (a second tab may have promoted the same pending key a moment ago: then it is already the key of that version)
    const stored = (await this.store.promote(done.version)) ?? (await this.store.keys()).find(k => k.version === done.version) ?? null;
    if (!stored) throw new Error('This browser lost the key while it was being published. Reload the page.');
    this.keys.set(done.version, stored);
    await this.indexOwnPublicKeys();
    this.activeVersion = done.version;
    this.opened.clear();
    this.set({ status: 'ready', setupReason: null, recovery: null, hasBackup: false, error: '', version: done.version, fingerprint: done.fingerprint });
  }

  /** Try the automatic set-up again (after it failed). */
  async retryAutomatic(): Promise<void> { await this.init(); }

  /**
   * A locked device, no backup: go on here with a NEW key. It is only done when the person asks for it: the old key stays with the device
   * that holds it, colleagues are asked to accept the new one, and messages sealed for the old key cannot be read on this device.
   */
  async continueWithNewKey(): Promise<void> {
    if (!this.store.persistent) throw new Error('This browser cannot keep keys. Use a normal browser window.');
    await this.exclusive(async () => {
      let key = await this.store.pending();
      if (!key) {
        const { pkcs8 } = await generateIdentity();
        const id = await identityFromPkcs8(pkcs8);
        pkcs8.fill(0);
        const fresh: StoredKey = { version: 0, privateKey: id.privateKey, publicKey: id.publicKey };
        key = (await this.store.putPendingIfAbsent(fresh)) ? fresh : await this.store.pending();
      }
      if (!key) throw new Error('This browser could not keep the key.');
      await this.publish(key, 'rotate');
    });
  }

  private async indexOwnPublicKeys() {
    this.myPublicRaw.clear();
    for (const k of this.keys.values()) this.myPublicRaw.set(k.version, b64(new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey))));
  }

  private async keep(pkcs8: Uint8Array, version: number) {
    const id = await identityFromPkcs8(pkcs8);
    const stored: StoredKey = { version, privateKey: id.privateKey, publicKey: id.publicKey };
    await this.store.putKey(stored);
    this.keys.set(version, stored);
    this.myPublicRaw.set(version, id.publicRaw);
    return id;
  }

  /** The keyring for a backup: the keys this device could export. Only called while the PKCS#8 of each key is at hand. */
  private async ringWith(extra: { version: number; pkcs8: Uint8Array }, older: Keyring | null): Promise<Keyring> {
    const keys = new Map<number, string>((older?.keys ?? []).map(k => [k.version, k.pkcs8]));
    keys.set(extra.version, b64(extra.pkcs8));
    return { keys: [...keys.entries()].map(([version, pkcs8]) => ({ version, pkcs8 })).sort((a, b) => a.version - b.version) };
  }

  // ------------------------------------------------------------------------------------------------------------------------ setup, unlock, reset
  /** First time: a new identity, its recovery backup (encrypted with the passphrase, here) and its public key. */
  async setup(passphrase: string): Promise<void> {
    const problem = passphraseProblem(passphrase);
    if (problem) throw new Error(problem);
    const { pkcs8 } = await generateIdentity();
    const probe = await identityFromPkcs8(pkcs8);
    const ring = await this.ringWith({ version: 1, pkcs8 }, null);
    const blob = await encryptKeyring(passphrase, ring);
    const done = await this.api.keySetup(probe.publicRaw, blob);
    if (done.version !== 1) await this.api.keyBackupSet(await encryptKeyring(passphrase, await this.ringWith({ version: done.version, pkcs8 }, null)), done.version);
    await this.keep(pkcs8, done.version);
    this.activeVersion = done.version;
    this.set({ status: 'ready', recovery: null, setupReason: null, hasBackup: true, error: '', version: done.version, fingerprint: done.fingerprint });
  }

  /** Another device (or after clearing site data): the passphrase opens the backup and the keys are kept here, non-extractable. */
  async unlock(passphrase: string): Promise<void> {
    const backup = await this.api.keyBackupGet();
    if (!backup) throw new Error('There is no backup to unlock. Set up secure messaging instead.');
    const ring = await decryptKeyring(passphrase, backup.blob);
    for (const k of ring.keys) await this.keep(unb64(k.pkcs8), k.version);
    await this.init();
    if (this.snap.status !== 'ready') throw new Error('The backup does not hold your current key. Reset secure messaging if you cannot recover it.');
  }

  /**
   * A new key (the passphrase and the devices are lost, or a change on purpose). Messages sealed for the old key stay unreadable here unless
   * this device still holds it (then it is kept in the new backup). Colleagues see the changed key and must accept it.
   */
  async reset(passphrase: string): Promise<void> {
    const problem = passphraseProblem(passphrase);
    if (problem) throw new Error(problem);
    const { pkcs8 } = await generateIdentity();
    const probe = await identityFromPkcs8(pkcs8);
    const expected = (this.activeVersion ?? 0) + 1;
    let ring = await this.ringWith({ version: expected, pkcs8 }, null);
    let done = await this.api.keyReset(probe.publicRaw, await encryptKeyring(passphrase, ring));
    if (done.version !== expected) {
      ring = await this.ringWith({ version: done.version, pkcs8 }, null);
      await this.api.keyBackupSet(await encryptKeyring(passphrase, ring), done.version);
      done = { ...done };
    }
    await this.keep(pkcs8, done.version);
    this.activeVersion = done.version;
    this.opened.clear();
    this.set({ status: 'ready', recovery: null, setupReason: null, hasBackup: true, error: '', version: done.version, fingerprint: done.fingerprint });
  }

  /** A new recovery passphrase: the current one opens the backup, the new one seals it again. */
  async changePassphrase(current: string, next: string): Promise<void> {
    const problem = passphraseProblem(next);
    if (problem) throw new Error(problem);
    const backup = await this.api.keyBackupGet();
    if (!backup) throw new Error('There is no backup.');
    const ring = await decryptKeyring(current, backup.blob);
    await this.api.keyBackupSet(await encryptKeyring(next, ring), backup.version);
  }

  /** Forget the keys on THIS device (the backup on the server stays: the passphrase brings them back). */
  async removeFromDevice(): Promise<void> {
    await this.store.wipe();
    this.keys.clear();
    this.opened.clear();
    await this.init();
  }

  // ------------------------------------------------------------------------------------------------------------------------ colleagues' keys
  /** The members of a conversation with their current key and whether it is the one this device trusts. */
  async peers(conversationId: string): Promise<PeerInfo[]> {
    const members = await this.api.memberKeys(conversationId);
    const out: PeerInfo[] = [];
    for (const m of members) {
      const me = m.profileId === this.myId;
      let changed = false;
      let verified = false;
      if (!me && m.fingerprint) {
        const pin = await this.store.peer(m.profileId);
        if (!pin) await this.store.putPeer({ profileId: m.profileId, fingerprint: m.fingerprint, verified: false, seenAt: new Date().toISOString() });
        else { changed = pin.fingerprint !== m.fingerprint; verified = pin.verified && !changed; }
      }
      out.push({ profileId: m.profileId, name: m.name, fingerprint: m.fingerprint, me, changed, verified, keyVersion: m.keyVersion });
    }
    return out;
  }

  /** The person accepts a colleague's new key (or confirms the fingerprints match when `verified`). */
  async accept(profileId: string, fingerprint: string, verified = false): Promise<void> {
    const pin: PeerPin = { profileId, fingerprint, verified, seenAt: new Date().toISOString() };
    await this.store.putPeer(pin);
    this.set({});
  }

  // ------------------------------------------------------------------------------------------------------------------------ sending
  /** Encrypts for everybody who is in the conversation now. Throws a SecureSendError that says what to do. */
  async seal(conversation: { id: string }, clientMsgId: string, payload: SecurePayload): Promise<SealedMessage> {
    const mine = this.activeVersion !== null ? this.keys.get(this.activeVersion) : undefined;
    if (this.snap.status !== 'ready' || !mine || this.activeVersion === null) throw new SecureSendError('LOCKED', 'Unlock secure messaging first.');
    const peers = await this.peers(conversation.id);
    const missing = peers.filter(p => !p.fingerprint).map(p => p.name);
    if (missing.length) throw new SecureSendError('KEYS_MISSING', `${missing.join(', ')} ${missing.length === 1 ? 'has' : 'have'} not set up secure messaging yet. Ask them to open Chat once, then try again.`, missing);
    const changed = peers.filter(p => p.changed).map(p => p.name);
    if (changed.length) throw new SecureSendError('KEY_CHANGED', `The security key of ${changed.join(', ')} changed. Check it and accept it before sending.`, changed);
    const members = await this.api.memberKeys(conversation.id);
    const recipients = members.map(m => ({ profileId: m.profileId, keyVersion: m.keyVersion as number, publicKeyRaw: m.publicKey as string }));
    const me = recipients.find(r => r.profileId === this.myId);
    if (!me || me.keyVersion !== this.activeVersion) throw new SecureSendError('KEYS_STALE', 'Your secure messaging key changed. Reload the page.');
    return sealMessage({ conversationId: conversation.id, clientMsgId, sender: { profileId: this.myId, keyVersion: this.activeVersion, privateKey: mine.privateKey, publicKey: mine.publicKey }, recipients, payload });
  }

  /** A file: encrypted here with its own key; the key goes inside the message. */
  encryptAttachment(bytes: Uint8Array) { return encryptFile(bytes); }
  decryptAttachment(bytes: Uint8Array, key: string) { return decryptFile(bytes, key); }

  // ------------------------------------------------------------------------------------------------------------------------ receiving
  private async senderPublic(senderId: string, version: number): Promise<string | null> {
    if (senderId === this.myId) return this.myPublicRaw.get(version) ?? (await this.lookup(senderId, version))?.publicKey ?? null;
    return (await this.lookup(senderId, version))?.publicKey ?? null;
  }
  private async lookup(profileId: string, version: number): Promise<ChatPublicKey | null> {
    const k = peerCacheKey(profileId, version);
    if (!this.peerKeys.has(k)) this.peerKeys.set(k, await this.api.keyLookup(profileId, version));
    return this.peerKeys.get(k) ?? null;
  }

  /** Opens the encrypted messages of a page. A message that cannot be opened stays in the list, marked, with no text. */
  async open(conversationId: string, messages: ChatMessage[]): Promise<ChatMessage[]> {
    const out: ChatMessage[] = [];
    const myKeys = new Map([...this.keys.values()].map(k => [k.version, { privateKey: k.privateKey, publicKey: k.publicKey }]));
    for (const m of messages) {
      if (m.kind !== 'TEXT' || m.deleted) { out.push(m); continue; }
      if (!m.encrypted || !m.e2ee) { out.push({ ...m, secure: { state: 'legacy' } }); continue; }
      const cached = this.opened.get(m.id);
      if (cached) { out.push(this.withPayload(m, cached.payload)); continue; }
      const fail = (reason: Extract<ChatSecureState, { state: 'failed' }>['reason']): ChatMessage => ({ ...m, body: '', attachments: [], secure: { state: 'failed', reason } });
      if (this.snap.status !== 'ready') { out.push(fail('locked')); continue; }
      if (!m.senderId) { out.push(fail('unknown-sender')); continue; }
      try {
        const senderPublicRaw = await this.senderPublic(m.senderId, m.e2ee.sv);
        if (!senderPublicRaw) { out.push(fail('unknown-sender')); continue; }
        const payload = await openMessage({ conversationId, clientMsgId: m.clientMsgId ?? '', senderId: m.senderId, senderPublicRaw, e2ee: m.e2ee, myKeys, myId: this.myId });
        this.opened.set(m.id, { payload });
        out.push(this.withPayload(m, payload));
      } catch (e) {
        const reason = e instanceof OpenError ? (e.reason === 'no-wrap' ? 'no-key' : e.reason === 'old-key' ? 'old-key' : e.reason === 'bad-signature' ? 'bad-signature' : 'damaged') : 'damaged';
        out.push(fail(reason));
      }
    }
    return out;
  }

  private withPayload(m: ChatMessage, p: SecurePayload): ChatMessage {
    return {
      ...m,
      body: p.t,
      attachments: (p.a ?? []).map(a => ({ id: a.id, name: a.name, mime: a.mime, size: a.size, secretKey: a.k })),
      replyTo: p.r ? { id: p.r.id, seq: p.r.seq, senderName: p.r.senderName, body: p.r.text } : m.replyTo,
      secure: { state: 'ok' }
    };
  }

  /** Tell the screens to look at the people's keys again (a send was refused because a key changed). */
  refresh() { this.set({}); }

  /** Forget what was opened (after a reset, or when keys were unlocked: failed messages are tried again). */
  forget() { this.opened.clear(); }
  fingerprintOfPublic(raw: string) { return fingerprintOf(raw); }
}

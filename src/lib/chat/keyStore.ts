/**
 * Where a device keeps what it needs for secure messaging: the person's private key(s) (as NON-extractable CryptoKeys: the page can use
 * them but cannot read them out, and they never reach the network) and the public-key fingerprints of colleagues it has seen (to notice
 * a changed key). IndexedDB can hold CryptoKey objects directly. Where IndexedDB is not available (a private window, a locked-down
 * browser) the keys are kept for the life of the tab only and the screens say so.
 */
export interface StoredKey {
  version: number;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}
export interface PeerPin {
  profileId: string;
  /** The fingerprint this device first saw (or last accepted) for this person. */
  fingerprint: string;
  /** The person compared fingerprints and confirmed they match. */
  verified: boolean;
  seenAt: string;
}

export interface KeyStore {
  readonly persistent: boolean;
  /** The keys of published versions (1, 2, ...). A key that is not published yet (see pending) is not in this list. */
  keys(): Promise<StoredKey[]>;
  putKey(k: StoredKey): Promise<void>;
  /**
   * A key that was made on this device and not yet published. It is kept so that a page closed half way through (or a second tab) never makes a
   * second key: the next start publishes this one. `putPendingIfAbsent` is atomic and says whether this call stored it.
   */
  pending(): Promise<StoredKey | null>;
  putPendingIfAbsent(k: StoredKey): Promise<boolean>;
  /** The pending key was published as this version: it becomes that version's key (one step). */
  promote(version: number): Promise<StoredKey | null>;
  dropPending(): Promise<void>;
  peer(profileId: string): Promise<PeerPin | null>;
  putPeer(p: PeerPin): Promise<void>;
  /** Forget everything on this device (keys and pins) for this person. */
  wipe(): Promise<void>;
}

class MemoryStore implements KeyStore {
  /** Only the tests say `true` (a store that stands in for IndexedDB); the real one made when IndexedDB is missing is not persistent. */
  constructor(readonly persistent = false) {}
  private k = new Map<number, StoredKey>();
  private p = new Map<string, PeerPin>();
  private pend: StoredKey | null = null;
  async keys() { return [...this.k.values()]; }
  async putKey(k: StoredKey) { this.k.set(k.version, k); }
  async pending() { return this.pend; }
  async putPendingIfAbsent(k: StoredKey) { if (this.pend) return false; this.pend = k; return true; }
  async promote(version: number) { const k = this.pend; if (!k) return null; const stored = { ...k, version }; this.k.set(version, stored); this.pend = null; return stored; }
  async dropPending() { this.pend = null; }
  async peer(id: string) { return this.p.get(id) ?? null; }
  async putPeer(p: PeerPin) { this.p.set(p.profileId, p); }
  async wipe() { this.k.clear(); this.p.clear(); this.pend = null; }
}

const DB = 'amuwa-chat-e2ee';
const open = (): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('peers')) db.createObjectStore('peers', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
const done = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

class IdbStore implements KeyStore {
  readonly persistent = true;
  constructor(private readonly userId: string, private readonly db: IDBDatabase) {}
  private id = (x: string | number) => `${this.userId}:${x}`;
  async keys(): Promise<StoredKey[]> {
    const rows = (await done(this.db.transaction('keys').objectStore('keys').getAll())) as (StoredKey & { id: string; userId: string })[];
    return rows.filter(r => r.userId === this.userId && r.version >= 1).map(r => ({ version: r.version, privateKey: r.privateKey, publicKey: r.publicKey }));
  }
  // the unpublished key is kept in the same store under the name "pending" (version 0)
  async pending(): Promise<StoredKey | null> {
    const row = (await done(this.db.transaction('keys').objectStore('keys').get(this.id('pending')))) as (StoredKey & { id: string }) | undefined;
    return row ? { version: 0, privateKey: row.privateKey, publicKey: row.publicKey } : null;
  }
  async putPendingIfAbsent(k: StoredKey): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const req = this.db.transaction('keys', 'readwrite').objectStore('keys').add({ id: this.id('pending'), userId: this.userId, version: 0, privateKey: k.privateKey, publicKey: k.publicKey });
      req.onsuccess = () => resolve(true);
      req.onerror = event => { if (req.error?.name === 'ConstraintError') { event.preventDefault(); resolve(false); } else reject(req.error); };
    });
  }
  async promote(version: number): Promise<StoredKey | null> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('keys', 'readwrite');
      const store = tx.objectStore('keys');
      let out: StoredKey | null = null;
      const get = store.get(this.id('pending'));
      get.onsuccess = () => {
        const row = get.result as (StoredKey & { id: string }) | undefined;
        if (!row) return;
        out = { version, privateKey: row.privateKey, publicKey: row.publicKey };
        store.put({ id: this.id(version), userId: this.userId, ...out });
        store.delete(this.id('pending'));
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async dropPending() { await done(this.db.transaction('keys', 'readwrite').objectStore('keys').delete(this.id('pending'))); }
  async putKey(k: StoredKey) {
    await done(this.db.transaction('keys', 'readwrite').objectStore('keys').put({ id: this.id(k.version), userId: this.userId, ...k }));
  }
  async peer(profileId: string): Promise<PeerPin | null> {
    const row = (await done(this.db.transaction('peers').objectStore('peers').get(this.id(profileId)))) as (PeerPin & { id: string }) | undefined;
    return row ? { profileId: row.profileId, fingerprint: row.fingerprint, verified: row.verified, seenAt: row.seenAt } : null;
  }
  async putPeer(p: PeerPin) {
    await done(this.db.transaction('peers', 'readwrite').objectStore('peers').put({ id: this.id(p.profileId), userId: this.userId, ...p }));
  }
  async wipe() {
    for (const name of ['keys', 'peers'] as const) {
      const store = this.db.transaction(name, 'readwrite').objectStore(name);
      const rows = (await done(store.getAll())) as { id: string; userId: string }[];
      const w = this.db.transaction(name, 'readwrite').objectStore(name);
      await Promise.all(rows.filter(r => r.userId === this.userId).map(r => done(w.delete(r.id))));
    }
  }
}

/** The store for this person on this device. */
export async function openKeyStore(userId: string): Promise<KeyStore> {
  try {
    if (typeof indexedDB === 'undefined') return new MemoryStore();
    return new IdbStore(userId, await open());
  } catch {
    return new MemoryStore();
  }
}
export { MemoryStore };

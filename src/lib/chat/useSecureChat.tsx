import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { chatKeysApi } from './api';
import { openKeyStore } from './keyStore';
import type { SecureChatApi, SecureChatClient, SecureSnapshot } from './secureChat';

const secureApi: SecureChatApi = {
  keyStatus: chatKeysApi.status,
  keyRegister: async pk => { const r = await chatKeysApi.register(pk); return { version: r.version, fingerprint: r.fingerprint }; },
  keyRotate: async pk => { const r = await chatKeysApi.rotate(pk); return { version: r.version, fingerprint: r.fingerprint }; },
  keySetup: chatKeysApi.setup,
  keyReset: chatKeysApi.reset,
  keyBackupGet: chatKeysApi.backup,
  keyBackupSet: chatKeysApi.setBackup,
  memberKeys: chatKeysApi.members,
  keyLookup: chatKeysApi.lookup
};

const Ctx = createContext<SecureChatClient | null>(null);
/** True under a SecureChatProvider (even while its client is still starting), so a screen does not start a second one. */
const ProvidedCtx = createContext(false);
export const useHasSecureChatProvider = () => useContext(ProvidedCtx);

/**
 * Secure messaging for the internal chats of the signed-in person. It is mounted once for every signed-in employee (App.tsx), so a person's key is
 * made when they sign in and colleagues can message them before they have ever opened Chat. Children read it with useSecureChat(); null until the
 * key store is open.
 */
export const SecureChatProvider: React.FC<{ userId: string | null; children: React.ReactNode }> = ({ userId, children }) => {
  const [client, setClient] = useState<SecureChatClient | null>(null);
  useEffect(() => {
    let live = true;
    setClient(null);
    if (!userId) return undefined;
    // the cryptography (hpke-js) is loaded here, after the page has opened, not with the first screen
    void Promise.all([openKeyStore(userId), import('./secureChat')]).then(async ([store, { SecureChatClient: Client }]) => {
      const c = new Client(userId, secureApi, store);
      await c.init();
      if (live) setClient(c);
    }).catch(() => undefined);
    return () => { live = false; };
  }, [userId]);
  return <ProvidedCtx.Provider value><Ctx.Provider value={client}>{children}</Ctx.Provider></ProvidedCtx.Provider>;
};

/** The secure-messaging client, or null where there is none (client chats, or before it has started). */
export const useSecureChat = (): SecureChatClient | null => useContext(Ctx);

const NOTHING: SecureSnapshot = { status: 'loading', recovery: null, setupReason: null, hasBackup: false, error: '', version: null, fingerprint: null, persistent: true, revision: 0 };
const never = () => () => undefined;
export function useSecureSnapshot(client: SecureChatClient | null): SecureSnapshot {
  return useSyncExternalStore(client ? client.subscribe : never, client ? client.getSnapshot : () => NOTHING, () => NOTHING);
}

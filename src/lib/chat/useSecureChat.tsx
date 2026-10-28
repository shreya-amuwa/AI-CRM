import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { chatKeysApi } from './api';
import { openKeyStore } from './keyStore';
import { SecureChatClient, type SecureChatApi, type SecureSnapshot } from './secureChat';

const secureApi: SecureChatApi = {
  keyStatus: chatKeysApi.status,
  keySetup: chatKeysApi.setup,
  keyReset: chatKeysApi.reset,
  keyBackupGet: chatKeysApi.backup,
  keyBackupSet: chatKeysApi.setBackup,
  memberKeys: chatKeysApi.members,
  keyLookup: chatKeysApi.lookup
};

const Ctx = createContext<SecureChatClient | null>(null);

/** Secure messaging for the internal chats of the signed-in person. Children read it with useSecureChat(); null until the key store is open. */
export const SecureChatProvider: React.FC<{ userId: string; children: React.ReactNode }> = ({ userId, children }) => {
  const [client, setClient] = useState<SecureChatClient | null>(null);
  useEffect(() => {
    let live = true;
    setClient(null);
    void openKeyStore(userId).then(async store => {
      const c = new SecureChatClient(userId, secureApi, store);
      await c.init();
      if (live) setClient(c);
    });
    return () => { live = false; };
  }, [userId]);
  return <Ctx.Provider value={client}>{children}</Ctx.Provider>;
};

/** The secure-messaging client, or null where there is none (client chats, or before it has started). */
export const useSecureChat = (): SecureChatClient | null => useContext(Ctx);

const NOTHING: SecureSnapshot = { status: 'loading', error: '', version: null, fingerprint: null, persistent: true, revision: 0 };
const never = () => () => undefined;
export function useSecureSnapshot(client: SecureChatClient | null): SecureSnapshot {
  return useSyncExternalStore(client ? client.subscribe : never, client ? client.getSnapshot : () => NOTHING, () => NOTHING);
}

import { useEffect } from 'react';

/**
 * Opening the Wallet from elsewhere (20270206000100): a wallet notification in the bell (incentive credited, withdrawal approved, ...). Every dashboard with a
 * Wallet entry listens and shows it; Accounts' wallet credits (a credit waiting for approval) open the wallet administration instead.
 */
export const OPEN_WALLET_EVENT = 'crm:open-wallet';
export const OPEN_WALLET_ADMIN_EVENT = 'crm:open-wallet-admin';
export const openWallet = () => window.dispatchEvent(new Event(OPEN_WALLET_EVENT));
export const openWalletAdmin = () => window.dispatchEvent(new Event(OPEN_WALLET_ADMIN_EVENT));

/** For a dashboard: show the Wallet page when something asks for it. */
export function useOpenWalletRequest(show: () => void) {
  useEffect(() => {
    window.addEventListener(OPEN_WALLET_EVENT, show);
    return () => window.removeEventListener(OPEN_WALLET_EVENT, show);
  }, [show]);
}
/** For a dashboard that has the wallet administration (Accounts, Super Admin). */
export function useOpenWalletAdminRequest(show: () => void) {
  useEffect(() => {
    window.addEventListener(OPEN_WALLET_ADMIN_EVENT, show);
    return () => window.removeEventListener(OPEN_WALLET_ADMIN_EVENT, show);
  }, [show]);
}

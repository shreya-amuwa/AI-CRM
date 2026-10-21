import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { errorMessage } from '../../lib/api/client';
import { customersApi } from '../../lib/api/endpoints';
import { btn, Dialog, ErrorBanner, notifyPipelineChanged } from '../team-member/pipeline/shared';

/** Only the Super Admin and a Department Head see the button; the database also checks the Department Head's department. */
export const useCanDeleteCustomers = (): boolean => {
  const { profile } = useAuth();
  return profile?.role === 'SUPER_ADMIN' || profile?.role === 'DEPARTMENT_HEAD';
};

/**
 * "Delete customer" with a confirmation. The customer, its conversations, onboarding, documents, tickets and payments that were never
 * verified are removed. A customer with an issued invoice or a verified payment is refused: those are Accounts' records.
 */
export const DeleteCustomerButton: React.FC<{ customerId: string; name: string; onDeleted: () => void; className?: string }> = ({ customerId, name, onDeleted, className }) => {
  const allowed = useCanDeleteCustomers();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!allowed) return null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await customersApi.remove(customerId);
      notifyPipelineChanged();
      setOpen(false);
      onDeleted();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className={className ?? btn.danger} onClick={() => { setError(null); setOpen(true); }}>
        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Delete customer
      </button>
      {open && (
        <Dialog title={`Delete ${name}?`} description="This cannot be undone." onClose={() => !busy && setOpen(false)} persistent>
          <div className="text-sm text-slate-700 space-y-2">
            <p>The customer and everything kept on them are removed: conversations, onboarding, uploaded documents, tickets and any payment that was never verified. The client login is removed too.</p>
            <p className="text-xs text-slate-500">A customer that has an issued invoice or a verified payment cannot be deleted: Accounts keeps those records.</p>
          </div>
          {error && <ErrorBanner message={error} />}
          <div className="flex justify-end gap-2">
            <button type="button" className={btn.secondary} disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-50" disabled={busy} onClick={confirm}>
              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Deleting…' : 'Delete permanently'}
            </button>
          </div>
        </Dialog>
      )}
    </>
  );
};

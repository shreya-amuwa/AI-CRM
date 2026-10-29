import React, { useState } from 'react';
import { Mail } from 'lucide-react';
import { api, errorMessage } from '../../lib/api/client';

/**
 * Sends the client the "set your password" e-mail (a one-time link: nobody types or sends a password). Used after the login is made
 * (automatically at payment confirmation, or by hand) when the first e-mail did not arrive or its link expired.
 */
export const SetPasswordEmailButton: React.FC<{ customerId: string }> = ({ customerId }) => {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const send = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await api.post<{ email: string; sent: boolean; detail?: string }>(`/customers/${customerId}/client-password-email`);
      setNote(r.sent ? { ok: true, text: `Sent to ${r.email}.` } : { ok: false, text: r.detail ?? 'The e-mail could not be sent.' });
    } catch (e) {
      setNote({ ok: false, text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button type="button" onClick={() => void send()} disabled={busy}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-300 bg-white text-emerald-800 font-bold text-xs disabled:opacity-60">
        <Mail className="w-3.5 h-3.5" aria-hidden="true" /> {busy ? 'Sending…' : 'Send set-password e-mail'}
      </button>
      {note && <span role="status" className={`text-xs ${note.ok ? 'text-emerald-800' : 'text-rose-700'}`}>{note.text}</span>}
    </span>
  );
};

import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import type { CrocodialHealth, CrocodialKeySource } from '../../../shared/contracts';
import { ApiError } from '../../lib/api/client';
import { crocodialApi } from '../../lib/api/endpoints';
import { confirmAction } from '../feedback/AppFeedback';
import { btn } from '../team-member/pipeline/shared';

const errText = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Something went wrong. Please try again.');
const primary = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#2F5BEA] text-white text-xs font-bold hover:bg-[#2549c4] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2F5BEA] focus-visible:ring-offset-2 transition-colors';

/**
 * A connection's Crocodial key (20270307000100): pasted into a password field and sent once to the server, which tests it with one live read
 * and stores it encrypted. The key is cleared from the field after every attempt and never shown again: only "•••• <last 4>". Every refusal
 * is the server's own copy (refused, unreachable, already connected elsewhere, the rate limit, a department the person does not run).
 */
export const CrocodialKeyForm: React.FC<{
  connectionId: string;
  keySource: CrocodialKeySource | undefined;
  keyLast4: string | null | undefined;
  health?: CrocodialHealth;
  onSaved: (text?: string) => void;
}> = ({ connectionId, keySource, keyLast4, health, onSaved }) => {
  const stored = keySource === 'DATABASE';
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const showField = open || keySource === 'NONE' || !keySource;
  const fieldId = `croc-key-${connectionId}`;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = key;
    // the key leaves the field (and React state) at once, whatever the answer
    setKey('');
    if (!typed.trim()) { setError('Paste the Crocodial key.'); return; }
    setBusy(true);
    setError('');
    setResult('');
    try {
      const r = await crocodialApi.saveKey(connectionId, typed);
      setResult(`Connected: ${r.users} Crocodial user${r.users === 1 ? '' : 's'} found`);
      setOpen(false);
      onSaved();
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!(await confirmAction({
      title: 'Disconnect this Crocodial account?',
      description: 'The stored key is removed and the connection is switched off. Activity already read stays in the CRM.',
      confirmLabel: 'Disconnect', cancelLabel: 'Keep connected', variant: 'destructive'
    }))) return;
    setBusy(true);
    setError('');
    setResult('');
    try {
      await crocodialApi.removeKey(connectionId);
      onSaved('Disconnected: the key was removed and the connection switched off.');
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2 min-w-0" data-testid="croc-key">
      <p className="text-xs font-bold text-slate-700 flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" aria-hidden /> Crocodial key</p>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        {stored ? <span>Saved key: <span className="font-mono">•••• {keyLast4 ?? '????'}</span></span>
          : keySource === 'SERVER_SETTING' ? <span>The key is a server setting (set by the Managing Director).</span>
          : <span>No key yet. Create one in Crocodial (Setup → Outbound API, with “Allow changes” off) and paste it here.</span>}
        {health === 'KEY_UNREADABLE' ? <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800">Key needs to be entered again</span> : null}
        {!showField ? <button type="button" className="font-semibold text-[#2F5BEA] hover:underline disabled:opacity-50" disabled={busy} onClick={() => { setOpen(true); setResult(''); setError(''); }}>Replace key</button> : null}
        {stored ? <button type="button" className={btn.danger} disabled={busy} onClick={() => void disconnect()}>Disconnect</button> : null}
      </div>
      {showField ? (
        <form onSubmit={save} className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-48">
            <label htmlFor={fieldId} className="block text-xs font-medium text-slate-600 mb-1">Crocodial key</label>
            <input id={fieldId} type="password" autoComplete="off" spellCheck={false} value={key} onChange={e => setKey(e.target.value)} maxLength={5000}
              className="w-full min-w-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-[#2F5BEA]/40" />
          </div>
          <button type="submit" className={primary} disabled={busy}>{busy ? 'Testing…' : 'Test and save'}</button>
          {open ? <button type="button" className={btn.secondary} disabled={busy} onClick={() => { setOpen(false); setKey(''); setError(''); }}>Cancel</button> : null}
        </form>
      ) : null}
      {result ? <p className="text-xs text-emerald-800" role="status">{result}</p> : null}
      {error ? <p className="text-xs text-rose-700" role="alert">{error}</p> : null}
    </div>
  );
};

export default CrocodialKeyForm;

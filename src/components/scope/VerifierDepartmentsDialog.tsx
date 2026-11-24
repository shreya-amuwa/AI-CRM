import React, { useCallback, useEffect, useState } from 'react';
import type { Profile, VerifierDepartments } from '../../../shared/contracts';
import { usersApi } from '../../lib/api/endpoints';
import { errorMessage } from '../../lib/api/client';
import { Dialog } from '../team-member/pipeline/shared';
import { OperationsDepartmentsField } from '../common/OperationsDepartmentsField';

/**
 * The departments a Meta Verifier verifies for: the home department (always) plus the ones an Operations Head or the Super Admin adds. Department
 * access here is NOT Operations Head ownership: the person stays a Team Member and only sees the Meta-verification customers of these departments.
 * The server (and the database underneath) decides who may change it and refuses anything else.
 */
export const VerifierDepartmentsDialog: React.FC<{ member: Pick<Profile, 'id' | 'fullName'>; departments: { id: string; name: string }[]; onClose: () => void }> = ({ member, departments, onClose }) => {
  const [info, setInfo] = useState<VerifierDepartments | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const i = await usersApi.verifierDepartments(member.id);
      setInfo(i);
      setSelected(i.extra.map(d => d.id));
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [member.id]);
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    setBusy(true); setError(null); setNotice(null);
    try {
      const r = await usersApi.setVerifierDepartments(member.id, selected);
      setInfo(r); setSelected(r.extra.map(d => d.id));
      setNotice(r.reassigned ? `Saved. ${r.reassigned} unfinished verification${r.reassigned === 1 ? ' was' : 's were'} moved to another verifier or are waiting to be assigned.` : 'Saved.');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const choices = departments.filter(d => d.id !== info?.home?.id);

  return (
    <Dialog title={`Verification departments · ${member.fullName}`} description="One account verifies Meta customers for the home department and the departments ticked here. Unticking a department removes the access at once." onClose={onClose} wide>
      <div className="space-y-3" data-testid="verifier-departments-dialog">
        {error && <p role="alert" className="text-xs font-semibold text-rose-600">{error}</p>}
        {notice && <p role="status" className="text-xs font-semibold text-emerald-700">{notice}</p>}
        {!info && !error && <p className="text-xs text-slate-500" role="status">Loading…</p>}
        {info && (
          <>
            <p className="text-xs text-slate-600">Home department: <strong>{info.home?.name ?? 'none'}</strong> (always included).</p>
            {info.canEdit ? (
              <>
                <OperationsDepartmentsField departments={choices} selected={selected} onSelected={setSelected} legend="Extra departments this Meta Verifier verifies for"
                  hint="Meta Verification customers of these departments appear in their queue. This does not give approval, employee-management or finance permissions." allowEmpty />
                <div className="flex justify-end"><button type="button" className="px-4 py-2 rounded-xl bg-blue-600 text-white text-xs font-bold disabled:opacity-60" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save departments'}</button></div>
              </>
            ) : (
              <p className="text-xs text-slate-600">Extra departments: <strong>{info.extra.length ? info.extra.map(d => d.name).join(', ') : 'none'}</strong>. Only the Managing Director or the CEO who owns these departments can change them.</p>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
};

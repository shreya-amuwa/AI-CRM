import React, { useCallback, useState } from 'react';
import type {
  CareerOffer,
  CareerDocument,
  CareerTraining,
} from '../../shared/contracts';
import { candidateRequest } from './api';
import { uploadCareerPdf } from './uploads';
import {
  Card,
  Failure,
  Loading,
  Notice,
  button,
  secondary,
  useRemote,
  readable,
  when,
  stageName,
} from './parts';
export const Offers: React.FC = () => {
  const get = useCallback(
    () => candidateRequest<CareerOffer[]>('/candidate/offers'),
    [],
  );
  const r = useRemote(get);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const reply = async (o: CareerOffer, response: 'ACCEPTED' | 'DECLINED') => {
    if (
      !window.confirm(
        `${response === 'ACCEPTED' ? 'Accept' : 'Decline'} this offer? Please review all terms first.`,
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await candidateRequest(`/candidate/offers/${o.id}`, {
        response,
        version: o.version,
      });
      r.reload();
    } catch (e) {
      setError(readable(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Offers & joining</h1>
      {error && <Notice error>{error}</Notice>}
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <Failure message={r.error} retry={r.reload} />
      ) : !r.data?.length ? (
        <Card>
          No offer has been released yet. Recruitment will publish an approved
          offer here if you are selected.
        </Card>
      ) : (
        r.data.map((o) => (
          <Card key={o.id} title={o.title}>
            <p className="text-sm text-blue-700 font-semibold">
              {stageName(o.status)}
            </p>
            <p className="text-sm text-slate-500 mt-2">
              Joining date: {o.joining_date} · Respond before{' '}
              {when(o.expires_at)}
            </p>
            <p className="whitespace-pre-wrap text-sm text-slate-700 my-5">
              {o.terms}
            </p>
            {o.status === 'RELEASED' && (
              <div className="flex gap-3">
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => void reply(o, 'ACCEPTED')}
                >
                  Accept offer
                </button>
                <button
                  className={secondary}
                  disabled={busy}
                  onClick={() => void reply(o, 'DECLINED')}
                >
                  Decline offer
                </button>
              </div>
            )}
            {o.status === 'ACCEPTED' && (
              <Notice>
                Your acceptance is recorded. Complete requested documents; HR
                will confirm joining and induction arrangements.
              </Notice>
            )}
          </Card>
        ))
      )}
    </div>
  );
};
export const Documents: React.FC = () => {
  const get = useCallback(
    () => candidateRequest<CareerDocument[]>('/candidate/documents'),
    [],
  );
  const r = useRemote(get);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upload = async (d: CareerDocument, file: File) => {
    setBusy(true);
    setError('');
    try {
      const f = await uploadCareerPdf(file);
      await candidateRequest(`/candidate/documents/${d.id}`, { file_id: f.id });
      r.reload();
    } catch (e) {
      setError(readable(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Requested documents</h1>
      <Notice>
        Only upload documents explicitly requested by recruitment. Files are
        private. PDF only, up to 10 MB.
      </Notice>
      {error && <Notice error>{error}</Notice>}
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <Failure message={r.error} retry={r.reload} />
      ) : !r.data?.length ? (
        <Card>No documents requested yet.</Card>
      ) : (
        r.data.map((d) => (
          <Card key={d.id} title={d.title}>
            <p className="font-semibold text-sm text-blue-700">
              {stageName(d.status)}
            </p>
            {d.message && (
              <p className="text-sm mt-3 text-slate-600 whitespace-pre-wrap">
                {d.message}
              </p>
            )}
            {d.status !== 'APPROVED' && (
              <label className={`${button} mt-4 cursor-pointer`}>
                {busy
                  ? 'Uploading…'
                  : d.file_id
                    ? 'Replace document'
                    : 'Upload document'}
                <input
                  type="file"
                  aria-label={`Upload ${d.title}`}
                  accept=".pdf,application/pdf"
                  className="sr-only"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (file) void upload(d, file);
                  }}
                />
              </label>
            )}
          </Card>
        ))
      )}
    </div>
  );
};
export const Training: React.FC = () => {
  const get = useCallback(
    () => candidateRequest<CareerTraining[]>('/candidate/training'),
    [],
  );
  const r = useRemote(get);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Induction & training</h1>
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <Failure message={r.error} retry={r.reload} />
      ) : !r.data?.length ? (
        <Card>
          Training becomes available after offer acceptance, document
          verification and HR enrollment.
        </Card>
      ) : (
        r.data.map((t) => (
          <Card key={t.id} title={t.title}>
            <p className="text-sm text-slate-500">
              Starts {t.start_date} · {stageName(t.status)}
            </p>
            <div className="grid lg:grid-cols-3 gap-4 mt-5">
              {t.days.map((d) => (
                <section key={d.day_no} className="rounded-xl border p-4">
                  <p className="text-xs text-blue-700 font-bold">
                    DAY {d.day_no}
                  </p>
                  <h3 className="font-semibold mt-2">{d.title}</h3>
                  <p className="text-xs text-slate-500 mt-2">
                    Trainer: {d.trainer_name || 'To be assigned'}
                  </p>
                  <ul className="text-sm space-y-2 my-4">
                    {d.topics.map((topic, i) => (
                      <li key={i}>{topic}</li>
                    ))}
                  </ul>
                  <p className="text-sm">
                    Attendance:{' '}
                    {d.attendance ? stageName(d.attendance) : 'Not recorded'}
                  </p>
                  <p className="text-sm">
                    Assessment:{' '}
                    {d.assessment_result
                      ? stageName(d.assessment_result)
                      : 'Not recorded'}
                  </p>
                  <p className="text-sm font-semibold mt-2">
                    {d.completed
                      ? 'Day completed'
                      : 'Awaiting training evidence'}
                  </p>
                </section>
              ))}
            </div>
            <p className="text-xs text-slate-500 mt-4">
              Attendance and training outcomes are verified by your trainer or
              HR. Completion does not automatically activate a staff account.
            </p>
          </Card>
        ))
      )}
    </div>
  );
};
export const Notifications: React.FC = () => {
  const get = useCallback(
    () =>
      candidateRequest<{ id: string; kind: string; created_at: string }[]>(
        '/candidate/notifications',
      ),
    [],
  );
  const r = useRemote(get);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Updates</h1>
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <Failure message={r.error} retry={r.reload} />
      ) : (
        <Card>
          {!r.data?.length ? (
            <p>No updates yet.</p>
          ) : (
            <ul className="divide-y">
              {r.data.map((e) => (
                <li key={e.id} className="py-3">
                  <p className="font-semibold">
                    {stageName(e.kind.replace(/^CAREER_/, ''))}
                  </p>
                  <p className="text-xs text-slate-500">{when(e.created_at)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
};

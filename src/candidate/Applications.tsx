import React, { useCallback, useState } from 'react';
import type {
  CareerApplication,
  CareerInterview,
} from '../../shared/contracts';
import { candidateRequest } from './api';
import {
  Card,
  Failure,
  Loading,
  Notice,
  button,
  secondary,
  useRemote,
  stageName,
  when,
} from './parts';
export const Applications: React.FC = () => {
  const get = useCallback(
    () => candidateRequest<CareerApplication[]>('/candidate/applications'),
    [],
  );
  const r = useRemote(get);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const withdraw = async (id: string) => {
    if (
      !window.confirm(
        'Withdraw this application? Contact HR if you change your mind afterward.',
      )
    )
      return;
    setBusy(true);
    setError('');
    try {
      await candidateRequest(`/candidate/applications/${id}/withdraw`, {});
      r.reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not withdraw application.',
      );
    } finally {
      setBusy(false);
    }
  };
  if (r.loading) return <Loading />;
  if (r.error) return <Failure message={r.error} retry={r.reload} />;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">My applications</h1>
      {error && <Notice error>{error}</Notice>}
      {!r.data?.length ? (
        <Card>
          <p className="text-slate-500">
            You have not applied for a role yet. Explore jobs to get started.
          </p>
        </Card>
      ) : (
        r.data.map((a) => (
          <Card key={a.id} title={a.snapshot.job.title}>
            <span className="inline-block rounded-full px-3 py-1 text-sm font-semibold bg-blue-50 text-blue-800">
              {stageName(a.stage)}
            </span>
            <p className="text-xs text-slate-500 mt-3">
              Applied {when(a.created_at)} · Application {a.id.slice(0, 8)}
            </p>
            {a.candidate_message && (
              <div className="mt-4">
                <Notice>{a.candidate_message}</Notice>
              </div>
            )}
            <details className="mt-5">
              <summary className="cursor-pointer text-sm font-semibold">
                Submitted details and timeline
              </summary>
              <dl className="text-sm mt-3 grid sm:grid-cols-2 gap-3">
                <div>
                  <dt className="text-slate-500">Name</dt>
                  <dd>{a.snapshot.profile.name}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Email</dt>
                  <dd>{a.snapshot.profile.email}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Mobile</dt>
                  <dd>{a.snapshot.profile.phone}</dd>
                </div>
              </dl>
              <ol className="mt-4 space-y-3 border-l-2 border-blue-100 pl-4">
                {a.timeline.map((event, i) => (
                  <li key={i} className="text-sm">
                    <p className="font-medium">
                      {stageName(event.kind.replace(/^CAREER_/, ''))}
                    </p>
                    <p className="text-xs text-slate-500">
                      {when(event.created_at)}
                    </p>
                  </li>
                ))}
              </ol>
            </details>
            {![
              'WITHDRAWN',
              'REJECTED',
              'JOINING',
              'TRAINING',
              'COMPLETED',
            ].includes(a.stage) && (
              <button
                className={`${secondary} mt-4`}
                disabled={busy}
                onClick={() => void withdraw(a.id)}
              >
                Withdraw application
              </button>
            )}
          </Card>
        ))
      )}
    </div>
  );
};
export const Interviews: React.FC = () => {
  const get = useCallback(
    () => candidateRequest<CareerInterview[]>('/candidate/interviews'),
    [],
  );
  const r = useRemote(get);
  if (r.loading) return <Loading />;
  if (r.error) return <Failure message={r.error} retry={r.reload} />;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Interviews</h1>
      {!r.data?.length ? (
        <Card>
          <p className="text-slate-500">
            No interviews scheduled. Your recruitment team will publish details
            here when you reach this stage.
          </p>
        </Card>
      ) : (
        r.data.map((i) => (
          <Card key={i.id} title={`${stageName(i.round)} interview`}>
            <p className="font-semibold">{when(i.scheduled_at)}</p>
            <p className="text-sm text-slate-600 whitespace-pre-wrap mt-3">
              {i.location}
            </p>
            <p className="text-sm text-blue-700 mt-3">{stageName(i.status)}</p>
          </Card>
        ))
      )}
    </div>
  );
};
export const Overview: React.FC<{ navigate: (page: string) => void }> = ({
  navigate,
}) => {
  const get = useCallback(
    () => candidateRequest<CareerApplication[]>('/candidate/applications'),
    [],
  );
  const r = useRemote(get);
  if (r.loading) return <Loading />;
  if (r.error) return <Failure message={r.error} retry={r.reload} />;
  const active =
    r.data?.filter(
      (a) => !['REJECTED', 'WITHDRAWN', 'COMPLETED'].includes(a.stage),
    ) ?? [];
  const next = active.find((a) => a.stage === 'ASSESSMENT')
    ? 'Assessments'
    : active.find((a) => a.stage === 'INTERVIEW')
      ? 'Interviews'
      : active.find((a) => a.stage === 'SELECTED' || a.stage === 'JOINING')
        ? 'Offers & joining'
        : active.find((a) => a.stage === 'TRAINING')
          ? 'Training'
          : r.data?.length
            ? 'My applications'
            : 'My profile';
  return (
    <div className="space-y-5">
      <div className="rounded-2xl bg-blue-800 p-6 sm:p-8 text-white">
        <p className="text-blue-200 text-sm">YOUR CAREER AT AMUWA</p>
        <h1 className="text-3xl font-bold mt-2">
          Your next chapter starts here.
        </h1>
        <p className="text-blue-100 mt-3 max-w-xl">
          Keep your details ready, follow each application, and complete your
          next step when it becomes available.
        </p>
      </div>
      <div className="grid sm:grid-cols-3 gap-4">
        {[
          ['Applications', r.data?.length ?? 0],
          ['Active', active.length],
          [
            'Selected',
            r.data?.filter((a) =>
              ['SELECTED', 'JOINING', 'TRAINING', 'COMPLETED'].includes(
                a.stage,
              ),
            ).length ?? 0,
          ],
        ].map(([label, count]) => (
          <Card key={label}>
            <p className="text-sm text-slate-500">{label}</p>
            <p className="text-3xl font-bold mt-2">{count}</p>
          </Card>
        ))}
      </div>
      <Card title="Your next step">
        <p className="text-slate-600 text-sm mb-4">
          {next === 'My profile'
            ? 'Complete your profile and upload a PDF resume before applying.'
            : `Open ${next.toLowerCase()} to see the latest instructions from recruitment.`}
        </p>
        <button className={button} onClick={() => navigate(next)}>
          Open {next}
        </button>
      </Card>
    </div>
  );
};

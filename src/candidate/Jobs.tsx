import { Modal } from '../components/support-member/SupportParts';
import React, { useCallback, useState } from 'react';
import type { CareerJob, CareerFile } from '../../shared/contracts';
import { candidateRequest, publicJobs } from './api';
import {
  Card,
  Failure,
  Loading,
  Notice,
  Field,
  button,
  secondary,
  textInput,
  useRemote,
  readable,
  when,
  stageName,
} from './parts';
export const Jobs: React.FC<{
  signedIn: boolean;
  onSignIn: () => void;
  onApplied: () => void;
}> = ({ signedIn, onSignIn, onApplied }) => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [selected, setSelected] = useState<CareerJob | null>(null);
  const get = useCallback(
    () => publicJobs<{ items: CareerJob[]; total: number }>(page, term),
    [page, term],
  );
  const r = useRemote(get);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Find your next opportunity
        </h1>
        <p className="text-slate-500 mt-2">
          Explore roles at Amuwa Corporation and build what comes next.
        </p>
      </div>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTerm(search.trim());
          setPage(1);
        }}
      >
        <input
          className={textInput}
          aria-label="Search jobs"
          placeholder="Search by job title"
          maxLength={120}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className={button}>Search</button>
      </form>
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <Failure message={r.error} retry={r.reload} />
      ) : !r.data?.items.length ? (
        <Card>
          <p className="text-slate-500">
            No open roles match your search. Please check back later.
          </p>
        </Card>
      ) : (
        <>
          <div className="grid lg:grid-cols-2 gap-4">
            {r.data.items.map((j) => (
              <Card key={j.id}>
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                  {stageName(j.employment_type)} · {j.location}
                </p>
                <h2 className="text-xl font-bold mt-2">{j.title}</h2>
                <p className="text-sm text-slate-600 mt-3 whitespace-pre-wrap line-clamp-4">
                  {j.description}
                </p>
                {j.closes_at && (
                  <p className="text-xs text-slate-500 mt-3">
                    Apply by {when(j.closes_at)}
                  </p>
                )}
                <button
                  className={`${secondary} mt-5`}
                  onClick={() => setSelected(j)}
                >
                  View role & apply
                </button>
              </Card>
            ))}
          </div>
          <div className="flex gap-3 items-center">
            <button
              className={secondary}
              disabled={page === 1}
              onClick={() => setPage((n) => n - 1)}
            >
              Previous
            </button>
            <span className="text-sm">Page {page}</span>
            <button
              className={secondary}
              disabled={page * 20 >= r.data.total}
              onClick={() => setPage((n) => n + 1)}
            >
              Next
            </button>
          </div>
        </>
      )}
      {selected && (
        <Modal title={selected.title} onClose={() => setSelected(null)}>
          <button
            className={`${secondary} mb-4`}
            onClick={() => setSelected(null)}
          >
            Close role
          </button>
          <p className="text-sm whitespace-pre-wrap text-slate-600 mb-6">
            {selected.description}
          </p>
          {signedIn ? (
            <Apply
              job={selected}
              onDone={() => {
                setSelected(null);
                onApplied();
              }}
            />
          ) : (
            <button className={button} onClick={onSignIn}>
              Sign in to apply
            </button>
          )}
        </Modal>
      )}
    </div>
  );
};
const Apply: React.FC<{ job: CareerJob; onDone: () => void }> = ({
  job,
  onDone,
}) => {
  const get = useCallback(
    () => candidateRequest<CareerFile[]>('/candidate/resumes'),
    [],
  );
  const r = useRemote(get);
  const [resume, setResume] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const apply = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await candidateRequest('/candidate/applications', {
        posting_id: job.id,
        resume_id: resume,
      });
      onDone();
    } catch (e) {
      setError(readable(e));
    } finally {
      setBusy(false);
    }
  };
  if (r.loading) return <Loading />;
  if (r.error) return <Failure message={r.error} retry={r.reload} />;
  if (!r.data?.length)
    return (
      <Notice>
        Complete your profile and upload your resume before applying.
      </Notice>
    );
  return (
    <form className="space-y-4" onSubmit={apply}>
      <Field id="application-resume" label="Resume to submit">
        <select
          id="application-resume"
          className={textInput}
          required
          value={resume}
          onChange={(e) => setResume(e.target.value)}
        >
          <option value="">Choose a resume version</option>
          {r.data.map((f) => (
            <option key={f.id} value={f.id}>
              {f.file_name} · {when(f.created_at)}
            </option>
          ))}
        </select>
      </Field>
      <p className="text-sm text-slate-500">
        Your profile and this resume version will be shared with the recruitment
        team. Review your details before submitting.
      </p>
      {error && <Notice error>{error}</Notice>}
      <button className={button} disabled={busy || !resume}>
        {busy ? 'Submitting…' : 'Submit application'}
      </button>
    </form>
  );
};

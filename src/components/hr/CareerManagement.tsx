import { CareerJoining } from './CareerJoining';
import { careerDateTimeLocal } from '../../../shared/careerTime';
import React, { useCallback, useEffect, useState } from 'react';
import type {
  CareerJob,
  CareerStaffApplication,
  CareerTest,
  RecruitmentPosition,
} from '../../../shared/contracts';
import {
  careerPostingSchema,
  careerTestSchema,
  careerInviteSchema,
  careerStageSchema,
  careerInterviewSchema,
} from '../../../shared/validation';
import { api } from '../../lib/api/client';
import { recruitmentApi } from '../../lib/api/endpoints';
import { recruiterApi } from '../../lib/api/recruiter';
import {
  Card,
  Field,
  Failure,
  Loading,
  Notice,
  button,
  secondary,
  textInput,
  useRemote,
  readable,
  when,
  stageName,
} from '../../candidate/parts';
import type { z } from 'zod';
const root = '/hr/recruitment/careers';
function validated<T>(schema: z.ZodType<T>, body: unknown): T {
  const p = schema.safeParse(body);
  if (!p.success)
    throw new Error(
      p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' '),
    );
  return p.data;
}
export const CareerManagement: React.FC = () => {
  const [tab, setTab] = useState<'applications' | 'jobs' | 'tests'>(
    'applications',
  );
  return (
    <div className="space-y-5">
      <div className="flex gap-2 flex-wrap">
        {(['applications', 'jobs', 'tests'] as const).map((t) => (
          <button
            className={tab === t ? button : secondary}
            key={t}
            onClick={() => setTab(t)}
          >
            {stageName(t)}
          </button>
        ))}
        <a
          href="/careers"
          target="_blank"
          rel="noopener noreferrer"
          className={secondary}
        >
          Open public careers page
        </a>
      </div>
      {tab === 'jobs' ? (
        <PostingManager />
      ) : tab === 'tests' ? (
        <TestManager />
      ) : (
        <ApplicationManager />
      )}
    </div>
  );
};
const PostingManager: React.FC = () => {
  const get = useCallback(
    async () => ({
      jobs: await api.get<CareerJob[]>(`${root}/postings`),
      positions: await recruitmentApi.positions(),
    }),
    [],
  );
  const r = useRemote(get);
  const [edit, setEdit] = useState<CareerJob | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  if (r.loading) return <Loading />;
  if (r.error) return <Failure message={r.error} retry={r.reload} />;
  return (
    <div className="space-y-4">
      <button
        className={button}
        onClick={() => {
          setEdit(null);
          setNewOpen(true);
        }}
      >
        Create job posting
      </button>
      {newOpen && (
        <PostingForm
          key={edit?.id ?? 'new'}
          initial={edit}
          positions={r.data?.positions ?? []}
          onSaved={() => {
            setNewOpen(false);
            r.reload();
          }}
        />
      )}
      {!r.data?.jobs.length ? (
        <Card>
          No job postings yet. Existing HR positions are not automatically
          published.
        </Card>
      ) : (
        r.data.jobs.map((j) => (
          <Card key={j.id} title={j.title}>
            <p className="text-sm text-slate-500">
              {j.location} · {j.vacancy_status ? j.vacancy_status.replace('_', ' ').toLowerCase() : j.published ? 'Published' : 'Draft / paused'}{j.openings ? ` · ${j.openings} opening${j.openings === 1 ? '' : 's'}` : ''}
            </p>
            <button
              className={`${secondary} mt-3`}
              onClick={() => {
                setEdit(j);
                setNewOpen(true);
              }}
            >
              Edit posting
            </button>
          </Card>
        ))
      )}
    </div>
  );
};
const PostingForm: React.FC<{
  initial: CareerJob | null;
  positions: RecruitmentPosition[];
  onSaved: () => void;
}> = ({ initial, positions, onSaved }) => {
  const [form, setForm] = useState({
    position_id: initial?.position_id ?? '',
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    location: initial?.location ?? '',
    employment_type: initial?.employment_type ?? 'FULL_TIME',
    published: initial?.published ?? false,
    closes_at: initial?.closes_at ? careerDateTimeLocal(initial.closes_at) : '',
    openings: initial?.openings ?? 1,
    vacancy_status: initial?.vacancy_status ?? (initial?.published ? 'OPEN' : 'DRAFT'),
    responsible_id: initial?.responsible_id ?? '',
    qualifications: initial?.qualifications ?? '',
    skills: initial?.skills ?? '',
    experience: initial?.experience ?? '',
    required_steps: initial?.required_steps ?? ([] as ('CALL' | 'ASSESSMENT' | 'INTERVIEW')[]),
  });
  // Only the Super Admin and the Department Head of HR may allocate a vacancy to a Recruiter (the database refuses everyone else); the list of
  // Recruiters is theirs alone, so for anyone else the field simply does not appear.
  const [recruiters, setRecruiters] = useState<{ id: string; name: string }[] | null>(null);
  useEffect(() => {
    let live = true;
    recruiterApi.directory().then(r => { if (live) setRecruiters(r); }, () => { if (live) setRecruiters(null); });
    return () => { live = false; };
  }, []);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = validated(careerPostingSchema, {
        ...form,
        published: form.vacancy_status === 'OPEN',
        responsible_id: recruiters ? form.responsible_id || null : undefined,
        qualifications: form.qualifications || null,
        skills: form.skills || null,
        experience: form.experience || null,
        closes_at: form.closes_at
          ? new Date(form.closes_at).toISOString()
          : null,
        ...(initial ? { id: initial.id, version: initial.version } : {}),
      });
      await api.post(`${root}/postings`, body);
      onSaved();
    } catch (e) {
      setError(readable(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title={initial ? 'Edit posting' : 'New posting'}>
      <form onSubmit={save} className="space-y-4">
        <Field label="HR position" id="job-position">
          <select
            id="job-position"
            className={textInput}
            required
            disabled={!!initial}
            value={form.position_id}
            onChange={(e) => setForm({ ...form, position_id: e.target.value })}
          >
            <option value="">Choose an open position</option>
            {positions
              .filter((p) => p.id && p.isOpen)
              .map((p) => (
                <option key={p.id!} value={p.id!}>
                  {p.title}
                </option>
              ))}
          </select>
        </Field>
        {(['title', 'description', 'location'] as const).map((k) => (
          <Field key={k} label={stageName(k)} id={`job-${k}`}>
            <textarea
              id={`job-${k}`}
              className={textInput}
              rows={k === 'description' ? 5 : 1}
              required
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
          </Field>
        ))}
        <Field label="Employment type" id="job-type">
          <select
            id="job-type"
            className={textInput}
            value={form.employment_type}
            onChange={(e) =>
              setForm({
                ...form,
                employment_type: e.target.value as CareerJob['employment_type'],
              })
            }
          >
            {['FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="Application deadline (optional)" id="job-deadline">
          <input
            id="job-deadline"
            type="datetime-local"
            className={textInput}
            value={form.closes_at}
            onChange={(e) => setForm({ ...form, closes_at: e.target.value })}
          />
        </Field>
        <Field label="Number of openings" id="job-openings">
          <input
            id="job-openings"
            type="number"
            min={1}
            max={500}
            className={textInput}
            required
            value={form.openings}
            onChange={(e) => setForm({ ...form, openings: Number(e.target.value) })}
          />
        </Field>
        <Field label="Vacancy status" id="job-status">
          <select
            id="job-status"
            className={textInput}
            value={form.vacancy_status}
            onChange={(e) => setForm({ ...form, vacancy_status: e.target.value as typeof form.vacancy_status })}
          >
            <option value="DRAFT">Draft</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="OPEN">Open (shown on the careers page)</option>
            <option value="ON_HOLD">On hold</option>
            <option value="CLOSED">Closed</option>
            <option value="FILLED">Filled</option>
          </select>
        </Field>
        {recruiters && (
          <Field label="Responsible recruiter" id="job-recruiter">
            <select
              id="job-recruiter"
              className={textInput}
              value={form.responsible_id}
              onChange={(e) => setForm({ ...form, responsible_id: e.target.value })}
            >
              <option value="">Unassigned (waiting for a recruiter)</option>
              {recruiters.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </Field>
        )}
        {(['qualifications', 'skills', 'experience'] as const).map((k) => (
          <Field key={k} label={stageName(k)} id={`job-${k}`}>
            <textarea
              id={`job-${k}`}
              className={textInput}
              rows={2}
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
            />
          </Field>
        ))}
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Required before a candidate can be selected</legend>
          {([['CALL', 'A completed call'], ['ASSESSMENT', 'A passed assessment'], ['INTERVIEW', 'A completed interview']] as const).map(([k, label]) => (
            <label key={k} className="flex gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.required_steps.includes(k)}
                onChange={(e) =>
                  setForm({ ...form, required_steps: e.target.checked ? [...form.required_steps, k] : form.required_steps.filter((x) => x !== k) })
                }
              />
              {label}
            </label>
          ))}
        </fieldset>
        {error && <Notice error>{error}</Notice>}
        <button className={button} disabled={busy}>
          {busy ? 'Saving…' : 'Save posting'}
        </button>
      </form>
    </Card>
  );
};
const TestManager: React.FC = () => {
  const get = useCallback(() => api.get<CareerTest[]>(`${root}/tests`), []);
  const r = useRemote(get);
  const [title, setTitle] = useState('');
  const [duration, setDuration] = useState('30');
  const [pass, setPass] = useState('60');
  const [questions, setQuestions] = useState([
    { prompt: '', options: ['', '', '', ''], correct: 0 },
  ]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.post(
        `${root}/tests`,
        validated(careerTestSchema, {
          title,
          duration_minutes: Number(duration),
          pass_percent: Number(pass),
          questions,
        }),
      );
      r.reload();
      setTitle('');
      setQuestions([{ prompt: '', options: ['', '', '', ''], correct: 0 }]);
    } catch (e) {
      setError(readable(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5">
      <Card title="Publish an assessment">
        <Notice>
          Published assessments are immutable. To change questions or scoring,
          publish a new version. Candidates never receive the answer key.
        </Notice>
        <form className="mt-4 space-y-4" onSubmit={save}>
          <Field label="Assessment title" id="test-title">
            <input
              id="test-title"
              required
              className={textInput}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Duration in minutes" id="test-duration">
              <input
                id="test-duration"
                type="number"
                min={1}
                max={180}
                className={textInput}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
              />
            </Field>
            <Field label="Pass percentage" id="test-pass">
              <input
                id="test-pass"
                type="number"
                min={1}
                max={100}
                className={textInput}
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
            </Field>
          </div>
          {questions.map((q, i) => (
            <fieldset key={i} className="p-4 border rounded-xl space-y-3">
              <legend className="text-sm font-bold">Question {i + 1}</legend>
              <Field label="Question" id={`q-${i}`}>
                <textarea
                  id={`q-${i}`}
                  className={textInput}
                  required
                  value={q.prompt}
                  onChange={(e) =>
                    setQuestions(
                      questions.map((x, n) =>
                        n === i ? { ...x, prompt: e.target.value } : x,
                      ),
                    )
                  }
                />
              </Field>
              {q.options.map((o, j) => (
                <Field key={j} label={`Choice ${j + 1}`} id={`q-${i}-${j}`}>
                  <input
                    id={`q-${i}-${j}`}
                    className={textInput}
                    required
                    value={o}
                    onChange={(e) =>
                      setQuestions(
                        questions.map((x, n) =>
                          n === i
                            ? {
                                ...x,
                                options: x.options.map((v, m) =>
                                  m === j ? e.target.value : v,
                                ),
                              }
                            : x,
                        ),
                      )
                    }
                  />
                </Field>
              ))}
              <Field label="Correct choice" id={`q-correct-${i}`}>
                <select
                  id={`q-correct-${i}`}
                  className={textInput}
                  value={q.correct}
                  onChange={(e) =>
                    setQuestions(
                      questions.map((x, n) =>
                        n === i ? { ...x, correct: Number(e.target.value) } : x,
                      ),
                    )
                  }
                >
                  {q.options.map((_, j) => (
                    <option key={j} value={j}>
                      Choice {j + 1}
                    </option>
                  ))}
                </select>
              </Field>
              {questions.length > 1 && (
                <button
                  type="button"
                  className={secondary}
                  onClick={() =>
                    setQuestions(questions.filter((_, n) => n !== i))
                  }
                >
                  Remove question
                </button>
              )}
            </fieldset>
          ))}
          <button
            type="button"
            className={secondary}
            disabled={questions.length >= 100}
            onClick={() =>
              setQuestions([
                ...questions,
                { prompt: '', options: ['', '', '', ''], correct: 0 },
              ])
            }
          >
            Add question
          </button>
          {error && <Notice error>{error}</Notice>}
          <div>
            <button className={button} disabled={busy}>
              {busy ? 'Publishing…' : 'Publish assessment'}
            </button>
          </div>
        </form>
      </Card>
      <Card title="Published assessments">
        {r.loading ? (
          <Loading />
        ) : r.error ? (
          <Failure message={r.error} retry={r.reload} />
        ) : !r.data?.length ? (
          <p>No assessments published.</p>
        ) : (
          <ul className="space-y-3">
            {r.data.map((t) => (
              <li key={t.id}>
                <p className="font-semibold">{t.title}</p>
                <p className="text-sm text-slate-500">
                  {t.question_count} questions · {t.duration_minutes} minutes ·{' '}
                  {t.pass_percent}% to pass
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
};
const ApplicationManager: React.FC = () => {
  const [page, setPage] = useState(1);
  const get = useCallback(
    async () => ({
      applications: await api.get<{
        items: CareerStaffApplication[];
        total: number;
      }>(`${root}/applications`, { page }),
      tests: await api.get<CareerTest[]>(`${root}/tests`),
    }),
    [page],
  );
  const r = useRemote(get);
  if (r.loading) return <Loading />;
  if (r.error) return <Failure message={r.error} retry={r.reload} />;
  return (
    <div className="space-y-4">
      {!r.data?.applications.items.length ? (
        <Card>No candidate portal applications yet.</Card>
      ) : (
        r.data.applications.items.map((a) => (
          <StaffApplication
            key={`${a.id}-${a.version}`}
            application={a}
            tests={r.data!.tests}
            reload={r.reload}
          />
        ))
      )}
      <div className="flex gap-3 items-center">
        <button
          className={secondary}
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Previous
        </button>
        <span>Page {page}</span>
        <button
          className={secondary}
          disabled={page * 20 >= (r.data?.applications.total ?? 0)}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
};
const StaffApplication: React.FC<{
  application: CareerStaffApplication;
  tests: CareerTest[];
  reload: () => void;
}> = ({ application: a, tests, reload }) => {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('SCREENING');
  const [message, setMessage] = useState('');
  const [test, setTest] = useState('');
  const [until, setUntil] = useState('');
  const [round, setRound] = useState('HR');
  const [at, setAt] = useState('');
  const [location, setLocation] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      reload();
    } catch (e) {
      setError(readable(e));
    } finally {
      setBusy(false);
    }
  };
  const resume = async () => {
    setError('');
    try {
      const x = await api.get<{ url: string }>(
        `${root}/resumes/${a.resume_id}/url`,
      );
      window.open(x.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(readable(e));
    }
  };
  return (
    <Card title={`${a.snapshot.profile.name} · ${a.title}`}>
      <p className="text-sm text-slate-500">
        {a.snapshot.profile.email} · {stageName(a.stage)} · {when(a.created_at)}
      </p>
      <div className="flex gap-3 mt-4">
        <button className={secondary} onClick={() => setOpen(!open)}>
          {open ? 'Hide details' : 'Review application'}
        </button>
        <button className={secondary} onClick={() => void resume()}>
          Download resume
        </button>
      </div>
      {error && (
        <div className="mt-3">
          <Notice error>{error}</Notice>
        </div>
      )}
      {open && (
        <div className="mt-5 space-y-6">
          <dl className="grid sm:grid-cols-2 gap-3 text-sm">
            {(
              [
                'phone',
                'city',
                'state',
                'education',
                'experience',
                'skills',
                'bio',
              ] as const
            ).map((k) => (
              <div key={k}>
                <dt className="text-slate-500">{stageName(k)}</dt>
                <dd className="whitespace-pre-wrap">
                  {a.snapshot.profile[k] || 'Not provided'}
                </dd>
              </div>
            ))}
          </dl>
          <form
            className="space-y-3 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                api.post(
                  `${root}/stage`,
                  validated(careerStageSchema, {
                    application_id: a.id,
                    stage,
                    version: a.version,
                    message: message || null,
                  }),
                ),
              );
            }}
          >
            <h3 className="font-bold">Recruitment stage</h3>
            <select
              aria-label="New application stage"
              className={textInput}
              value={stage}
              onChange={(e) => setStage(e.target.value)}
            >
              {[
                'SCREENING',
                'INTERVIEW',
                'SELECTED',
                'ON_HOLD',
                'REJECTED',
              ].map((x) => (
                <option key={x} value={x}>
                  {stageName(x)}
                </option>
              ))}
            </select>
            <textarea
              className={textInput}
              aria-label="Message visible to candidate"
              placeholder="Message visible to candidate (optional)"
              value={message}
              maxLength={1000}
              onChange={(e) => setMessage(e.target.value)}
            />
            <button className={button} disabled={busy}>
              Update stage
            </button>
          </form>
          <form
            className="space-y-3 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                api.post(
                  `${root}/invitations`,
                  validated(careerInviteSchema, {
                    application_id: a.id,
                    test_id: test,
                    available_until: new Date(until).toISOString(),
                  }),
                ),
              );
            }}
          >
            <h3 className="font-bold">Assessment invitation</h3>
            <select
              className={textInput}
              aria-label="Assessment to invite"
              required
              value={test}
              onChange={(e) => setTest(e.target.value)}
            >
              <option value="">Choose an assessment</option>
              {tests.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <Field label="Available until" id={`until-${a.id}`}>
              <input
                id={`until-${a.id}`}
                className={textInput}
                type="datetime-local"
                required
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </Field>
            <button className={button} disabled={busy || !tests.length}>
              Invite candidate
            </button>
          </form>
          <ul className="text-sm space-y-2">
            {a.attempts.map((x) => (
              <li key={x.id}>
                {x.title}{' '}
                {x.submitted_at
                  ? `${x.passed ? 'Passed' : 'Not passed'} · Score ${x.score}`
                  : x.started_at
                    ? 'In progress'
                    : 'Invited'}
              </li>
            ))}
          </ul>
          <form
            className="space-y-3 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                api.post(
                  `${root}/interviews`,
                  validated(careerInterviewSchema, {
                    application_id: a.id,
                    round,
                    scheduled_at: new Date(at).toISOString(),
                    location,
                  }),
                ),
              );
            }}
          >
            <h3 className="font-bold">Schedule interview</h3>
            <select
              className={textInput}
              aria-label="Interview round"
              value={round}
              onChange={(e) => setRound(e.target.value)}
            >
              {['HR', 'DEPARTMENT_HEAD', 'MANAGEMENT'].map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
            <input
              className={textInput}
              aria-label="Interview date and time"
              required
              type="datetime-local"
              value={at}
              onChange={(e) => setAt(e.target.value)}
            />
            <textarea
              className={textInput}
              aria-label="Interview location or meeting details"
              required
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Meeting link or office address — visible to candidate"
            />
            <button className={button} disabled={busy}>
              Schedule interview
            </button>
          </form>
          {a.interviews.map((i) => (
            <InterviewFeedback
              key={`${i.id}-${i.version}`}
              interview={i}
              run={run}
              busy={busy}
            />
          ))}
          {['SELECTED', 'JOINING', 'TRAINING', 'COMPLETED'].includes(
            a.stage,
          ) && (
            <CareerJoining
              application={a}
              tests={tests}
              busy={busy}
              run={run}
            />
          )}
        </div>
      )}
    </Card>
  );
};
const InterviewFeedback: React.FC<{
  interview: CareerStaffApplication['interviews'][number];
  run: (fn: () => Promise<unknown>) => Promise<void>;
  busy: boolean;
}> = ({ interview: i, run, busy }) => {
  const [recommendation, setRecommendation] = useState('PROCEED');
  const [feedback, setFeedback] = useState('');
  return (
    <div className="border rounded-xl p-4 space-y-3">
      <p className="font-semibold">
        {stageName(i.round)} · {when(i.scheduled_at)} · {stageName(i.status)}
      </p>
      {i.status === 'SCHEDULED' && (
        <>
          <select
            className={textInput}
            aria-label="Interview recommendation"
            value={recommendation}
            onChange={(e) => setRecommendation(e.target.value)}
          >
            {['PROCEED', 'REJECT', 'HOLD'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
          <textarea
            className={textInput}
            aria-label="Internal interview feedback"
            placeholder="Internal feedback — never shown to candidate"
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
          <div className="flex gap-3">
            {(['COMPLETED', 'CANCELLED'] as const).map((status) => (
              <button
                key={status}
                disabled={busy}
                className={secondary}
                onClick={() =>
                  void run(() =>
                    api.post(
                      `${root}/interviews`,
                      validated(careerInterviewSchema, {
                        application_id: i.application_id,
                        id: i.id,
                        version: i.version,
                        status,
                        recommendation:
                          status === 'COMPLETED' ? recommendation : null,
                        internal_feedback: feedback,
                      }),
                    ),
                  )
                }
              >
                {status === 'COMPLETED' ? 'Record outcome' : 'Cancel interview'}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

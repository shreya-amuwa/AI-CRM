import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CareerAttempt } from '../../shared/contracts';
import { candidateRequest } from './api';
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
} from './parts';
export const Assessments: React.FC<{ onActive: (active: boolean) => void }> = ({
  onActive,
}) => {
  const get = useCallback(
    () => candidateRequest<CareerAttempt[]>('/candidate/assessments'),
    [],
  );
  const r = useRemote(get);
  const [selected, setSelected] = useState<CareerAttempt | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const open = async (a: CareerAttempt) => {
    setBusy(true);
    setError('');
    try {
      const next = await candidateRequest<CareerAttempt>(
        `/candidate/assessments/${a.id}`,
        a.started_at ? undefined : { action: 'START' },
      );
      setSelected(next);
    } catch (e) {
      setError(readable(e));
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    onActive(!!selected?.started_at && !selected.submitted_at);
    return () => onActive(false);
  }, [selected, onActive]);
  if (selected)
    return (
      <Test
        onActive={onActive}
        key={selected.id}
        initial={selected}
        onDone={() => {
          setSelected(null);
          r.reload();
        }}
      />
    );
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">Assessments</h1>
      <Notice>
        Read the instructions before starting. The timer continues if you leave
        this page. Each answer is saved to the server; wait for the saved
        confirmation.
      </Notice>
      {error && <Notice error>{error}</Notice>}
      {r.loading ? (
        <Loading />
      ) : r.error ? (
        <Failure message={r.error} retry={r.reload} />
      ) : !r.data?.length ? (
        <Card>
          <p className="text-slate-500">
            No assessments assigned yet. Invitations appear after recruitment
            screening.
          </p>
        </Card>
      ) : (
        r.data.map((a) => (
          <Card key={a.id} title={a.title}>
            <p className="text-sm text-slate-500">
              {a.question_count} questions · {a.duration_minutes} minutes ·
              Available until {when(a.available_until)}
            </p>
            {a.submitted_at ? (
              <p className="mt-4 font-semibold">
                {a.passed
                  ? 'Passed — recruitment will review your next step.'
                  : 'Not passed — contact recruitment for any retest decision.'}{' '}
                Score: {a.score}/{a.question_count}
              </p>
            ) : (
              <div className="mt-4">
                <button
                  className={button}
                  disabled={
                    busy || new Date(a.available_until).getTime() <= Date.now()
                  }
                  onClick={() => {
                    if (
                      a.started_at ||
                      window.confirm(
                        'Start this timed assessment now? The timer will continue if you leave.',
                      )
                    )
                      void open(a);
                  }}
                >
                  {a.started_at ? 'Resume assessment' : 'Start assessment'}
                </button>
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  );
};
const Test: React.FC<{
  initial: CareerAttempt;
  onDone: () => void;
  onActive: (active: boolean) => void;
}> = ({ initial, onDone, onActive }) => {
  const [attempt, setAttempt] = useState(initial);
  useEffect(() => {
    onActive(!attempt.submitted_at);
  }, [attempt.submitted_at, onActive]);
  const [answers, setAnswers] = useState(initial.answers ?? {});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const expired = useRef(false);
  const baseline = useRef({
    server: new Date(initial.server_time ?? new Date().toISOString()).getTime(),
    local: performance.now(),
  });
  const [remaining, setRemaining] = useState(0);
  const questions = attempt.questions ?? [];
  const save = useCallback(
    async (next: Record<string, number>, action: 'SAVE' | 'SUBMIT') => {
      if (saving.current) return;
      saving.current = true;
      setBusy(true);
      setError('');
      try {
        const result = await candidateRequest<CareerAttempt>(
          `/candidate/assessments/${attempt.id}`,
          { action, version: attempt.version, answers: next },
        );
        setAttempt(result);
        baseline.current = {
          server: new Date(result.server_time!).getTime(),
          local: performance.now(),
        };
      } catch (e) {
        setError(readable(e));
      } finally {
        setBusy(false);
        saving.current = false;
      }
    },
    [attempt.id, attempt.version],
  );
  useEffect(() => {
    if (attempt.submitted_at) return;
    const update = () => {
      const now =
        baseline.current.server + performance.now() - baseline.current.local;
      const left = Math.max(
        0,
        Math.ceil((new Date(attempt.deadline!).getTime() - now) / 1000),
      );
      setRemaining(left);
      if (left === 0 && !expired.current && !saving.current) {
        expired.current = true;
        void save(answers, 'SUBMIT');
      }
    };
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [attempt.deadline, attempt.submitted_at, answers, save]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (!attempt.submitted_at) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [attempt.submitted_at]);
  if (attempt.submitted_at)
    return (
      <Card title="Assessment submitted">
        <Notice>
          Your answers have been recorded.{' '}
          {attempt.passed
            ? 'You passed this assessment. Recruitment will confirm the next step.'
            : 'Recruitment will review your result and any available next steps.'}
        </Notice>
        <button className={`${button} mt-5`} onClick={onDone}>
          Back to assessments
        </button>
      </Card>
    );
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-3 justify-between items-center sticky top-0 bg-slate-50 py-3 z-10">
        <h1 className="text-xl font-bold">{attempt.title}</h1>
        <p
          role="timer"
          aria-label="Time remaining"
          className="font-mono font-bold text-blue-800"
        >
          {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}
        </p>
      </div>
      <p role="status" className="text-sm text-slate-600">
        {busy
          ? 'Saving…'
          : error
            ? 'Some answers may not be saved. Retry below.'
            : 'Answers saved to the server.'}
      </p>
      {error && (
        <>
          <Notice error>{error}</Notice>
          <div className="flex gap-3">
            <button
              className={secondary}
              disabled={busy}
              onClick={() => void save(answers, 'SAVE')}
            >
              Retry save
            </button>
            <button className={secondary} disabled={busy} onClick={onDone}>
              Reload assessment
            </button>
          </div>
        </>
      )}
      {questions.map((q, index) => (
        <Card key={index}>
          <fieldset disabled={busy || remaining === 0}>
            <legend className="font-semibold mb-3">
              {index + 1}. {q.prompt}
            </legend>
            <div className="space-y-2">
              {q.options.map((option, choice) => (
                <label
                  key={choice}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer ${answers[String(index)] === choice ? 'bg-blue-50 border-blue-500' : 'border-slate-200'}`}
                >
                  <input
                    className="mt-1"
                    type="radio"
                    name={`question-${index}`}
                    checked={answers[String(index)] === choice}
                    onChange={() => {
                      const next = { ...answers, [index]: choice };
                      setAnswers(next);
                      void save(next, 'SAVE');
                    }}
                  />
                  <span className="text-sm">{option}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </Card>
      ))}
      <div className="flex justify-between">
        <button className={secondary} disabled={busy} onClick={onDone}>
          Leave assessment
        </button>
        <button
          className={button}
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                'Submit your final answers? You cannot edit them afterward.',
              )
            )
              void save(answers, 'SUBMIT');
          }}
        >
          Submit assessment
        </button>
      </div>
    </div>
  );
};

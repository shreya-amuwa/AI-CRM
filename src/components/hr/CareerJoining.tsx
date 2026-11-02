import React, { useCallback, useState } from 'react';
import type {
  CareerStaffApplication,
  CareerTest,
} from '../../../shared/contracts';
import {
  careerOfferSchema,
  careerDocumentRequestSchema,
  careerTrainingSchema,
  careerTrainingInviteSchema,
} from '../../../shared/validation';
import { api } from '../../lib/api/client';
import { trainingApi } from '../../lib/api/endpoints';
import {
  Field,
  Failure,
  Loading,
  Notice,
  button,
  secondary,
  textInput,
  useRemote,
  stageName,
  when,
} from '../../candidate/parts';
import type { z } from 'zod';
const root = '/hr/recruitment/careers';
function validated<T>(schema: z.ZodType<T>, body: unknown): T {
  const p = schema.safeParse(body);
  if (!p.success) throw new Error(p.error.issues[0].message);
  return p.data;
}
export const CareerJoining: React.FC<{
  application: CareerStaffApplication;
  tests: CareerTest[];
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}> = ({ application: a, tests, busy, run }) => {
  const get = useCallback(() => trainingApi.programs(), []);
  const programs = useRemote(get);
  const [title, setTitle] = useState('');
  const [terms, setTerms] = useState('');
  const [expiry, setExpiry] = useState('');
  const [joining, setJoining] = useState('');
  const [document, setDocument] = useState('');
  const [message, setMessage] = useState('');
  const [program, setProgram] = useState('');
  const [test, setTest] = useState('');
  const [day, setDay] = useState('1');
  const [until, setUntil] = useState('');
  const [reason, setReason] = useState('');
  const download = (id: string) =>
    run(async () => {
      const x = await api.get<{ url: string }>(`${root}/resumes/${id}/url`);
      window.open(x.url, '_blank', 'noopener,noreferrer');
    });
  return (
    <div className="space-y-5 border-t pt-5">
      <h3 className="font-bold">Offer, joining & induction</h3>
      <Notice>
        Draft offers require release by an HR head or team head. Joining
        documents must be approved before induction. Staff login activation
        remains a separate authorized HR process.
      </Notice>
      {a.stage === 'SELECTED' &&
        !a.offers?.some((o) =>
          ['DRAFT', 'RELEASED', 'ACCEPTED'].includes(o.status),
        ) && (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                api.post(
                  `${root}/offers`,
                  validated(careerOfferSchema, {
                    application_id: a.id,
                    title,
                    terms,
                    expires_at: new Date(expiry).toISOString(),
                    joining_date: joining,
                  }),
                ),
              );
            }}
          >
            <Field label="Offer title" id={`offer-title-${a.id}`}>
              <input
                id={`offer-title-${a.id}`}
                required
                className={textInput}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </Field>
            <Field label="Offer terms" id={`offer-terms-${a.id}`}>
              <textarea
                id={`offer-terms-${a.id}`}
                required
                rows={6}
                className={textInput}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
              />
            </Field>
            <Field label="Offer expiry" id={`offer-expiry-${a.id}`}>
              <input
                id={`offer-expiry-${a.id}`}
                required
                type="datetime-local"
                className={textInput}
                value={expiry}
                onChange={(e) => setExpiry(e.target.value)}
              />
            </Field>
            <Field label="Joining date" id={`offer-joining-${a.id}`}>
              <input
                id={`offer-joining-${a.id}`}
                required
                type="date"
                className={textInput}
                value={joining}
                onChange={(e) => setJoining(e.target.value)}
              />
            </Field>
            <button className={button} disabled={busy}>
              Save offer draft
            </button>
          </form>
        )}
      {a.offers?.map((o) => (
        <div key={o.id} className="p-4 border rounded-xl space-y-3">
          <p className="font-semibold">
            {o.title} · {stageName(o.status)}
          </p>
          <p className="text-xs text-slate-500">
            Expires {when(o.expires_at)} · Joining {o.joining_date}
          </p>
          <p className="text-sm whitespace-pre-wrap">{o.terms}</p>
          {o.status === 'DRAFT' && (
            <button
              className={button}
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm(
                    'Approve and release these exact offer terms to the candidate?',
                  )
                )
                  void run(() =>
                    api.post(`${root}/offers`, {
                      application_id: a.id,
                      id: o.id,
                      version: o.version,
                      action: 'RELEASE',
                    }),
                  );
              }}
            >
              Approve & release
            </button>
          )}
          {['DRAFT', 'RELEASED'].includes(o.status) && (
            <button
              className={`${secondary} ml-2`}
              disabled={busy}
              onClick={() => {
                if (window.confirm('Withdraw this offer?'))
                  void run(() =>
                    api.post(`${root}/offers`, {
                      application_id: a.id,
                      id: o.id,
                      version: o.version,
                      action: 'WITHDRAW',
                    }),
                  );
              }}
            >
              Withdraw offer
            </button>
          )}
        </div>
      ))}
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() =>
            api.post(
              `${root}/documents`,
              validated(careerDocumentRequestSchema, {
                application_id: a.id,
                title: document,
                message,
              }),
            ),
          );
        }}
      >
        <h4 className="font-semibold">Request a joining document</h4>
        <input
          className={textInput}
          aria-label="Document request title"
          placeholder="Document title"
          required
          value={document}
          onChange={(e) => setDocument(e.target.value)}
        />
        <textarea
          className={textInput}
          aria-label="Document instructions"
          placeholder="What the candidate needs to upload"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        <button className={button} disabled={busy}>
          Request document
        </button>
      </form>
      {a.documents?.map((d) => (
        <div key={d.id} className="p-4 border rounded-xl space-y-3">
          <p className="font-semibold">
            {d.title} · {stageName(d.status)}
          </p>
          {d.file_id && (
            <button
              className={secondary}
              disabled={busy}
              onClick={() => void download(d.file_id!)}
            >
              Download document
            </button>
          )}
          {d.status === 'UPLOADED' && (
            <>
              <input
                className={textInput}
                aria-label={`Review note for ${d.title}`}
                placeholder="Review note (required when rejecting)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                {(['APPROVED', 'REJECTED'] as const).map((status) => (
                  <button
                    className={secondary}
                    disabled={busy}
                    key={status}
                    onClick={() =>
                      void run(() =>
                        api.post(
                          `${root}/documents`,
                          validated(careerDocumentRequestSchema, {
                            application_id: a.id,
                            id: d.id,
                            version: d.version,
                            status,
                            message: reason,
                          }),
                        ),
                      )
                    }
                  >
                    {status === 'APPROVED' ? 'Approve' : 'Request replacement'}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      ))}
      {['JOINING', 'TRAINING'].includes(a.stage) && (
        <>
          <h4 className="font-semibold">Training enrollment</h4>
          {programs.loading ? (
            <Loading />
          ) : programs.error ? (
            <Failure message={programs.error} retry={programs.reload} />
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() =>
                  api.post(
                    `${root}/training`,
                    validated(careerTrainingSchema, {
                      application_id: a.id,
                      program_id: program,
                      complete: false,
                    }),
                  ),
                );
              }}
            >
              <select
                className={textInput}
                aria-label="Training program"
                required
                value={program}
                onChange={(e) => setProgram(e.target.value)}
              >
                <option value="">Choose an active training program</option>
                {programs.data
                  ?.filter((p) => !p.isCancelled)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
              <button
                className={button}
                disabled={busy || !programs.data?.length}
              >
                Enroll in training
              </button>
            </form>
          )}
        </>
      )}
      {a.stage === 'TRAINING' && (
        <>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() =>
                api.post(
                  `${root}/training-invitations`,
                  validated(careerTrainingInviteSchema, {
                    application_id: a.id,
                    test_id: test,
                    available_until: new Date(until).toISOString(),
                    day: Number(day),
                  }),
                ),
              );
            }}
          >
            <h4 className="font-semibold">Online training assessment</h4>
            <select
              aria-label="Training assessment"
              className={textInput}
              required
              value={test}
              onChange={(e) => setTest(e.target.value)}
            >
              <option value="">
                Choose a separate assessment for this day
              </option>
              {tests.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title}
                </option>
              ))}
            </select>
            <select
              aria-label="Training day"
              className={textInput}
              value={day}
              onChange={(e) => setDay(e.target.value)}
            >
              {[1, 2, 3].map((d) => (
                <option key={d} value={d}>
                  Day {d}
                </option>
              ))}
            </select>
            <input
              aria-label="Training test deadline"
              required
              type="datetime-local"
              className={textInput}
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
            <button className={button} disabled={busy}>
              Assign training test
            </button>
          </form>
          <p className="text-sm text-slate-500">
            Record attendance and practical assessments in the existing HR
            Training workspace. All three online tests and verified training
            evidence are required for final placement.
          </p>
          <button
            className={button}
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  'Approve final placement? This does not activate a staff login.',
                )
              )
                void run(() =>
                  api.post(`${root}/training`, {
                    application_id: a.id,
                    program_id: null,
                    complete: true,
                  }),
                );
            }}
          >
            Approve final placement
          </button>
        </>
      )}
    </div>
  );
};

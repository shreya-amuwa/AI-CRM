import React from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, CircleDashed, Clock3, FolderUp, MessageCircle, PartyPopper, RefreshCw, ShieldCheck, UserRound, Wrench, XCircle } from 'lucide-react';
import type { ClientJourney, JourneyStage, JourneyStageStatus, MetaStatus } from '../../shared/contracts';
import { dashboardPath, useShell } from './shell';
import { Badge, Button, Card, PageHeader, Query, fmtDate, fmtDateTime, initials, type Tone } from './ui';

export const STAGE_TITLE: Record<JourneyStage['key'], string> = {
  PAYMENT: 'Account & payment confirmation',
  META_VERIFICATION: 'Meta verification',
  RELATIONSHIP_MANAGER: 'Your Relationship Manager',
  SERVICE_SETUP: 'Service setup & integration',
  COMPLETED: 'Onboarding completed'
};

const STATUS: Record<JourneyStageStatus, { label: string; tone: Tone }> = {
  COMPLETED: { label: 'Completed', tone: 'success' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  PENDING: { label: 'Pending', tone: 'neutral' },
  ACTION_REQUIRED: { label: 'Action required', tone: 'attention' },
  REJECTED: { label: 'Rejected', tone: 'danger' }
};
const META_LABEL: Record<MetaStatus | 'NOT_REQUIRED', string> = {
  PENDING: 'Pending', IN_PROGRESS: 'In progress', DOCUMENTS_REQUIRED: 'Documents required', REJECTED: 'Rejected', COMPLETED: 'Completed', NOT_REQUIRED: 'Not required'
};
const SERVICE_STATUS = { READY: { label: 'Ready', tone: 'success' as Tone }, IN_PROGRESS: { label: 'Setting up', tone: 'info' as Tone }, PENDING: { label: 'Waiting', tone: 'neutral' as Tone } };

const Dot: React.FC<{ status: JourneyStageStatus }> = ({ status }) => {
  const size = 20;
  return status === 'COMPLETED' ? <CheckCircle2 size={size} aria-hidden />
    : status === 'ACTION_REQUIRED' ? <AlertTriangle size={size} aria-hidden />
    : status === 'REJECTED' ? <XCircle size={size} aria-hidden />
    : status === 'IN_PROGRESS' ? <Clock3 size={size} aria-hidden />
    : <CircleDashed size={size} aria-hidden />;
};

const Person: React.FC<{ title: string; person: { name: string; position: string | null }; action?: React.ReactNode }> = ({ title, person, action }) => (
  <div className="cd-jr-person">
    <span className="cd-avatar" aria-hidden>{initials(person.name)}</span>
    <div className="grow"><small className="cd-muted">{title}</small><p style={{ fontWeight: 700 }}>{person.name}</p>{person.position ? <p className="cd-small cd-muted">{person.position}</p> : null}</div>
    {action}
  </div>
);

/** One short sentence on what happens next, for the summary at the top. */
export function nextStep(j: ClientJourney): string {
  const meta = j.stages.find((s): s is Extract<JourneyStage, { key: 'META_VERIFICATION' }> => s.key === 'META_VERIFICATION');
  const svc = j.stages.find((s): s is Extract<JourneyStage, { key: 'SERVICE_SETUP' }> => s.key === 'SERVICE_SETUP');
  switch (j.stage) {
    case 'PAYMENT': return 'We are confirming your payment. Your journey starts as soon as it is confirmed.';
    case 'META_VERIFICATION':
      if (meta?.status === 'ACTION_REQUIRED') return 'Action needed: send the documents listed below so your Meta verification can continue.';
      if (meta?.status === 'REJECTED') return 'Meta did not approve this submission. Read the feedback below and send the corrections to your Meta Verifier.';
      if (meta?.status === 'IN_PROGRESS') return 'Your Meta Verifier is working on your verification. It usually takes about 2-3 weeks. We will tell you if anything is needed.';
      return 'Your Meta verification is about to start. Make sure your documents are complete, and message your Meta Verifier with any question.';
    case 'RELATIONSHIP_MANAGER': return 'Meta verification is done. We are assigning your Relationship Manager, who will guide you from here.';
    case 'SERVICE_SETUP': {
      const ready = svc?.services.filter(s => s.status === 'READY').length ?? 0;
      return `Our team is setting up your services: ${ready} of ${svc?.services.length ?? 0} ready.`;
    }
    default: return 'Everything is set up. Every section that matches your services is open.';
  }
}

const Dates: React.FC<{ rows: [string, string | null | undefined][] }> = ({ rows }) => {
  const shown = rows.filter(([, v]) => v);
  if (!shown.length) return null;
  return <p className="cd-small cd-muted" style={{ marginTop: 6 }}>{shown.map(([k, v], i) => <span key={k}>{i ? ' · ' : ''}{k} {fmtDateTime(v as string)}</span>)}</p>;
};

const StageBody: React.FC<{ s: JourneyStage; j: ClientJourney; go: (to: string) => void }> = ({ s, j, go }) => {
  switch (s.key) {
    case 'PAYMENT':
      return s.status === 'COMPLETED' ? (
        <>
          <p>Your payment is confirmed and your dashboard account is ready.</p>
          <Dates rows={[['Payment confirmed', s.completedAt], ['Account created', s.accountCreatedAt]]} />
          {s.accountEmail ? <p className="cd-small cd-muted">Sign-in e-mail: {s.accountEmail}</p> : null}
        </>
      ) : <p>Our Accounts team is confirming your payment. You can already see how the journey will go.</p>;

    case 'META_VERIFICATION': {
      if (!s.required) return <p>Your services do not need Meta verification, so this step is done.</p>;
      const tone = s.status === 'REJECTED' ? 'danger' : 'attention';
      return (
        <>
          <p>
            {s.metaStatus === 'COMPLETED' ? 'Your Meta verification is complete.'
              : s.metaStatus === 'DOCUMENTS_REQUIRED' ? 'We need something from you before the verification can continue.'
              : s.metaStatus === 'REJECTED' ? 'Meta did not approve this submission. Your Meta Verifier will resubmit once you send the corrections.'
              : s.metaStatus === 'IN_PROGRESS' ? 'Your Meta verification is being processed. It usually takes about 2-3 weeks.'
              : 'Your Meta verification starts once your documents reach our Technical Consultant.'}
          </p>
          <Dates rows={[['Started', s.startedAt], ['Last update', s.status === 'COMPLETED' ? null : s.updatedAt], ['Completed', s.completedAt]]} />
          {s.feedback ? (
            <div className={`cd-banner ${tone}`} role="note" style={{ marginTop: 12 }}>
              <AlertTriangle size={18} aria-hidden style={{ flexShrink: 0 }} />
              <span><b>Feedback from your Meta Verifier:</b> {s.feedback}</span>
            </div>
          ) : null}
          {s.outstanding.length > 0 ? (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontWeight: 700, marginBottom: 6 }}>Still needed from you</p>
              <ul className="cd-jr-list">
                {s.outstanding.map(o => (
                  <li key={o.code}>
                    <span><b>{o.label}</b>{o.status === 'REJECTED' ? <Badge tone="danger">Sent back</Badge> : <Badge tone="attention">Missing</Badge>}</span>
                    {o.note ? <small className="cd-muted">{o.note}</small> : null}
                  </li>
                ))}
              </ul>
              {s.status !== 'COMPLETED' ? <div style={{ marginTop: 10 }}><Button small onClick={() => go(dashboardPath('documents'))}><FolderUp size={15} aria-hidden /> Open documents</Button></div> : null}
            </div>
          ) : null}
          {s.verifier ? (
            <Person title="Your Meta Verifier" person={s.verifier}
              action={s.status !== 'COMPLETED' ? <Button small variant="outline" onClick={() => go(dashboardPath('chat', '/meta'))}><MessageCircle size={15} aria-hidden /> Message</Button> : (
                <Button small variant="outline" onClick={() => go(dashboardPath('chat', '/meta'))}>View chat</Button>)} />
          ) : s.status !== 'COMPLETED' ? <p className="cd-small cd-muted" style={{ marginTop: 10 }}>A Meta Verifier will be assigned to you soon.</p> : null}
        </>
      );
    }

    case 'RELATIONSHIP_MANAGER':
      if (!s.required && !s.manager) return <p>Your services do not need a Relationship Manager hand-over, so this step is done.</p>;
      if (s.status === 'PENDING') return <p>Your Relationship Manager is assigned after Meta verification is completed. Until then your Meta Verifier is your contact.</p>;
      if (!s.manager && !s.teamLead) return <p>Meta verification is complete. We are assigning your Relationship Manager now; you will see their name here.</p>;
      return (
        <>
          <p>{s.status === 'COMPLETED' ? 'Your Relationship Manager is your main contact from here.' : 'Your team lead is already with you while your Relationship Manager is being assigned.'}</p>
          <Dates rows={[['Assigned', s.completedAt]]} />
          {s.manager ? <Person title="Relationship Manager" person={s.manager} action={<Button small variant="outline" onClick={() => go(dashboardPath('chat', '/rm'))}><MessageCircle size={15} aria-hidden /> Message</Button>} /> : null}
          {s.teamLead ? <Person title="Team Lead" person={s.teamLead} /> : null}
        </>
      );

    case 'SERVICE_SETUP': {
      const ready = s.services.filter(x => x.status === 'READY').length;
      return (
        <>
          <p>{s.status === 'PENDING' ? 'Setup starts after the steps above. This is what you bought:' : s.status === 'COMPLETED' ? 'All your services are ready.' : `${ready} of ${s.services.length} services ready. A service is marked ready only when our team has finished its setup and approvals.`}</p>
          <Dates rows={[['Completed', s.completedAt]]} />
          <ul className="cd-jr-services">
            {s.services.map(x => {
              const st = SERVICE_STATUS[x.status];
              return (
                <li key={x.code}>
                  <div className="grow">
                    <p style={{ fontWeight: 600 }}>{x.name}</p>
                    <p className="cd-small cd-muted">
                      {x.status === 'READY' ? `Ready${x.readyAt ? ` since ${fmtDate(x.readyAt)}` : ''}` : x.waitingFor ? `Waiting for ${x.waitingFor}` : 'Our team is setting it up'}
                    </p>
                    {x.note ? <p className="cd-small cd-muted">{x.note}</p> : null}
                  </div>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </li>
              );
            })}
          </ul>
        </>
      );
    }

    default:
      return s.status === 'COMPLETED' ? (
        <>
          <p>Your onboarding is complete. Every part of your dashboard that matches your services is now open.</p>
          <Dates rows={[['Completed', s.completedAt]]} />
        </>
      ) : <p>This completes once your payment, Meta verification, Relationship Manager and every service are done.</p>;
  }
};

const STAGE_ICON: Record<JourneyStage['key'], React.ReactNode> = {
  PAYMENT: null, META_VERIFICATION: <ShieldCheck size={16} aria-hidden />, RELATIONSHIP_MANAGER: <UserRound size={16} aria-hidden />,
  SERVICE_SETUP: <Wrench size={16} aria-hidden />, COMPLETED: <PartyPopper size={16} aria-hidden />
};

export const JourneyView: React.FC<{ j: ClientJourney; go: (to: string) => void }> = ({ j, go }) => {
  const done = j.stages.filter(s => s.status === 'COMPLETED').length;
  const pct = Math.round((done / j.stages.length) * 100);
  const currentIndex = Math.max(0, j.stages.findIndex(s => s.current));
  return (
    <div className="cd-stack" style={{ gap: 20 }}>
      <section className="cd-jr-summary" aria-label="Progress">
        <div className="cd-between" style={{ gap: 12, flexWrap: 'wrap' }}>
          <div>
            <span className="eyebrow">{j.completed ? 'All done' : `Step ${currentIndex + 1} of ${j.stages.length}`}</span>
            <h2 style={{ fontSize: 20, fontWeight: 800 }}>{j.completed ? 'Your onboarding is complete' : STAGE_TITLE[j.stage]}</h2>
          </div>
          <Badge tone={j.completed ? 'success' : 'info'}>{j.completed ? 'Completed' : `${pct}% done`}</Badge>
        </div>
        <div role="progressbar" aria-label="Onboarding progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="cd-jr-bar"><i style={{ width: `${pct}%` }} /></div>
        <p style={{ marginTop: 10 }}>{nextStep(j)}</p>
        {j.completedAt ? <p className="cd-small cd-muted">Completed on {fmtDate(j.completedAt)}</p> : null}
      </section>

      <ol className="cd-jr" aria-label="Onboarding stages">
        {j.stages.map((s, i) => {
          const st = STATUS[s.status];
          return (
            <li key={s.key} className="cd-jr-step" data-status={s.status} data-current={s.current ? 'true' : undefined} aria-current={s.current ? 'step' : undefined}>
              <span className="cd-jr-dot" aria-hidden><Dot status={s.status} /></span>
              <div className="cd-jr-card">
                <div className="cd-between" style={{ gap: 10, flexWrap: 'wrap' }}>
                  <h3 className="cd-jr-title"><span className="cd-muted cd-small">Stage {i + 1}</span>{STAGE_ICON[s.key]} {STAGE_TITLE[s.key]}</h3>
                  <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {s.current && !j.completed ? <Badge tone="new">Current stage</Badge> : null}
                    <Badge tone={st.tone}>{s.key === 'META_VERIFICATION' && s.required ? META_LABEL[s.metaStatus] : st.label}</Badge>
                  </span>
                </div>
                <div className="cd-jr-content"><StageBody s={s} j={j} go={go} /></div>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

/** The compact version for the overview: where the client is and what comes next. */
export const JourneySummary: React.FC<{ j: ClientJourney; go: (to: string) => void }> = ({ j, go }) => {
  const done = j.stages.filter(s => s.status === 'COMPLETED').length;
  const pct = Math.round((done / j.stages.length) * 100);
  const attention = j.stages.some(s => s.status === 'ACTION_REQUIRED' || s.status === 'REJECTED');
  return (
    <section className="cd-jr-summary cd-jr-hero" aria-label="Onboarding journey" data-attention={attention ? 'true' : undefined}>
      <div className="cd-between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div>
          <span className="eyebrow">Onboarding journey</span>
          <h2 style={{ fontSize: 20, fontWeight: 800 }}>{STAGE_TITLE[j.stage]}</h2>
        </div>
        <Button small onClick={() => go(dashboardPath('journey'))}>View journey <ArrowRight size={15} aria-hidden /></Button>
      </div>
      <div role="progressbar" aria-label="Onboarding progress" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} className="cd-jr-bar"><i style={{ width: `${pct}%` }} /></div>
      <ol className="cd-jr-mini" aria-hidden>
        {j.stages.map(s => <li key={s.key} data-status={s.status} data-current={s.current ? 'true' : undefined}><span /><small>{STAGE_TITLE[s.key].split(' ')[0]}</small></li>)}
      </ol>
      <p style={{ marginTop: 10 }}>{nextStep(j)}</p>
    </section>
  );
};

export const Journey: React.FC = () => {
  const { journey, go } = useShell();
  return (
    <>
      <PageHeader
        title="Onboarding journey"
        subtitle="From payment to a fully set up account: where you are, what we are doing and what we need from you."
        action={<Button variant="outline" small onClick={journey.reload} loading={journey.loading && !!journey.data}><RefreshCw size={14} aria-hidden /> Refresh</Button>}
      />
      <Query q={journey} errorTitle="Your onboarding journey could not be loaded" rows={3}>
        {j => <JourneyView j={j} go={go} />}
      </Query>
    </>
  );
};
export default Journey;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Download, Eye, FilePlus2, FileSignature, Plus, RefreshCw, Save, Sparkles, Trash2 } from 'lucide-react';
import { EMPTY_SCOPE_CONTENT, PROFILE_FIELDS, SCOPE_SECTION_LABELS, scopeContentSchema, type ScopeContent, type ScopeSection } from '../../../shared/baContent';
import type { BaScope, BaScopeRow, ServicePrice } from '../../../shared/contracts';
import { errorMessage } from '../../lib/api/client';
import { businessAssociateApi } from '../../lib/api/endpoints';
import { PageTitle } from '../layout/shell';
import { Card, CardHead } from '../tasks/head/headParts';
import { ErrorBanner, Field, Spinner } from '../team-member/pipeline/shared';
import { EmptyState, dateText, tcBtn, tcInput, tcSelect } from '../telecaller/ui';
import type { BaNavigate } from './BusinessAssociateDashboard';
import { DocBadge, notifyBaChanged, openFile, useContactOptions } from './ui';

export const ScopePage: React.FC<{ go: BaNavigate; initialContactId?: string; initialScopeId?: string }> = ({ initialContactId, initialScopeId }) => {
  const [scopeId, setScopeId] = useState<string | null>(initialScopeId ?? null);
  if (scopeId) return <ScopeEditor id={scopeId} onClose={() => setScopeId(null)} onOpen={setScopeId} />;
  return <ScopeStart initialContactId={initialContactId} onOpen={setScopeId} />;
};

/** Step 1: pick the client; see the versions already written; start (or continue) one. */
const ScopeStart: React.FC<{ initialContactId?: string; onOpen: (id: string) => void }> = ({ initialContactId, onOpen }) => {
  const contacts = useContactOptions();
  const [contactId, setContactId] = useState(initialContactId ?? '');
  const [versions, setVersions] = useState<BaScopeRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const loadVersions = useCallback(() => {
    if (!contactId) { setVersions(null); return; }
    businessAssociateApi.scopes(contactId).then(setVersions, err => (setError(errorMessage(err)), setVersions([])));
  }, [contactId]);
  useEffect(loadVersions, [loadVersions]);

  const draft = versions?.find(v => v.status === 'DRAFT');
  const start = async () => {
    if (busy || !contactId) return;
    setBusy(true); setError(null);
    try {
      if (draft) { onOpen(draft.id); return; }
      const c = await businessAssociateApi.contact(contactId);
      const doc = await businessAssociateApi.createScope(contactId, { title: `Scope of Project - ${c.company || c.name}`, inputs: Object.fromEntries(Object.entries(c.profile).filter(([, v]) => v)) });
      notifyBaChanged();
      onOpen(doc.id);
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  const download = async (id: string) => { const m = await openFile(() => businessAssociateApi.scopeFile(id, 'download')); if (m) setError(m); };

  return (
    <div className="space-y-5">
      <PageTitle title="Scope of Project" subtitle="An AI-assisted business analysis and project blueprint for one client. You review it, edit it and finalise it as a PDF." />
      {error && <ErrorBanner message={error} />}
      <Card className="p-5 space-y-4">
        <Field label="Select client" htmlFor="sc-client">
          <select id="sc-client" className={`${tcInput} max-w-lg`} value={contactId} onChange={e => setContactId(e.target.value)} disabled={contacts.items === null}>
            <option value="">{contacts.items === null ? 'Loading…' : 'Choose one of your contacts…'}</option>
            {(contacts.items ?? []).map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ` · ${c.company}` : ''}</option>)}
          </select>
        </Field>
        {contactId && (
          <button type="button" className={tcBtn.primary} onClick={() => void start()} disabled={busy || versions === null}><FilePlus2 className="w-4 h-4" aria-hidden="true" /> {draft ? `Continue the draft (version ${draft.version})` : versions && versions.length ? 'Start a new version' : 'Start the Scope of Project'}</button>
        )}
      </Card>
      {contactId && versions && (
        <Card label="Versions">
          <h2 className="px-5 pt-5 pb-3 text-base font-extrabold text-slate-900">Versions</h2>
          {versions.length === 0 ? <EmptyState title="No scope document for this client yet" /> : (
            <ul className="divide-y divide-slate-100">
              {versions.map(v => (
                <li key={v.id} className="px-5 py-3 flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1"><div className="font-semibold text-slate-900">Version {v.version}</div><div className="text-xs text-slate-500">{v.status === 'FINAL' ? `Finalised ${dateText(v.finalizedAt)}` : `Updated ${dateText(v.updatedAt)}`} · {v.createdBy || ''}</div></div>
                  <DocBadge status={v.status} aiGenerated={v.aiGenerated} reviewed={v.reviewed} />
                  <button type="button" className={tcBtn.row} onClick={() => onOpen(v.id)}>{v.status === 'DRAFT' ? 'Edit' : 'View'}</button>
                  {v.hasPdf && <button type="button" className={tcBtn.row} onClick={() => void download(v.id)} aria-label={`Download version ${v.version}`}><Download className="w-3.5 h-3.5" aria-hidden="true" /> PDF</button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// The small editors the content is made of
// ---------------------------------------------------------------------------
/** One string per line. Keeps what is being typed (blank lines included) until the document is replaced by a new one. */
const LinesField: React.FC<{ id: string; label: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean; resetKey: number; rows?: number }> = ({ id, label, value, onChange, disabled, resetKey, rows = 3 }) => {
  const [text, setText] = useState(value.join('\n'));
  useEffect(() => setText(value.join('\n')), [resetKey]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <Field label={label} htmlFor={id}>
      <textarea id={id} className={`${tcInput} min-h-[${rows * 28}px]`} rows={rows} disabled={disabled} value={text} onChange={e => { setText(e.target.value); onChange(e.target.value.split('\n').map(x => x.trim()).filter(Boolean)); }} placeholder="One per line" />
    </Field>
  );
};

type AnalysisItem = { text: string; basis: 'VERIFIED' | 'ASSUMPTION' };
const AnalysisList: React.FC<{ label: string; items: AnalysisItem[]; onChange: (v: AnalysisItem[]) => void; disabled?: boolean }> = ({ label, items, onChange, disabled }) => (
  <div>
    <h4 className="text-sm font-bold text-slate-800 mb-1.5">{label}</h4>
    <div className="space-y-1.5">
      {items.map((it, i) => (
        <div key={i} className="flex gap-2 items-start">
          <input className={tcInput} disabled={disabled} maxLength={700} value={it.text} onChange={e => onChange(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} aria-label={`${label} ${i + 1}`} />
          <select className={`${tcSelect} shrink-0`} disabled={disabled} value={it.basis} onChange={e => onChange(items.map((x, j) => (j === i ? { ...x, basis: e.target.value as AnalysisItem['basis'] } : x)))} aria-label={`Basis of ${label} ${i + 1}`}>
            <option value="VERIFIED">Verified</option><option value="ASSUMPTION">Assumption</option>
          </select>
          {!disabled && <button type="button" className="p-2 text-rose-600" onClick={() => onChange(items.filter((_, j) => j !== i))} aria-label={`Remove ${label} ${i + 1}`}><Trash2 className="w-4 h-4" aria-hidden="true" /></button>}
        </div>
      ))}
      {!disabled && items.length < 10 && <button type="button" className={tcBtn.link} onClick={() => onChange([...items, { text: '', basis: 'ASSUMPTION' }])}>+ Add a point</button>}
    </div>
  </div>
);

const SectionCard: React.FC<{ title: string; section?: ScopeSection; busy: string | null; onRegenerate?: (s: ScopeSection) => void; canAi: boolean; children: React.ReactNode }> = ({ title, section, busy, onRegenerate, canAi, children }) => (
  <Card>
    <CardHead
      title={title}
      right={section && canAi && onRegenerate ? (
        <button type="button" className={tcBtn.row} disabled={busy !== null} onClick={() => onRegenerate(section)} aria-label={`Regenerate ${SCOPE_SECTION_LABELS[section]}`}>
          <RefreshCw className={`w-3.5 h-3.5 ${busy === section ? 'animate-spin' : ''}`} aria-hidden="true" /> {busy === section ? 'Writing…' : 'Regenerate this section'}
        </button>
      ) : undefined}
    />
    <div className="px-5 pb-5 space-y-4">{children}</div>
  </Card>
);

const text = (v: string | undefined) => v ?? '';
const parseContent = (c: unknown): ScopeContent => {
  const r = scopeContentSchema.safeParse(c ?? {});
  return r.success ? r.data : EMPTY_SCOPE_CONTENT;
};

const ScopeEditor: React.FC<{ id: string; onClose: () => void; onOpen: (id: string) => void }> = ({ id, onClose, onOpen }) => {
  const [doc, setDoc] = useState<BaScope | null>(null);
  const [title, setTitle] = useState('');
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [content, setContent] = useState<ScopeContent>(EMPTY_SCOPE_CONTENT);
  const [rev, setRev] = useState(0);
  const [catalogue, setCatalogue] = useState<ServicePrice[]>([]);
  const [versions, setVersions] = useState<BaScopeRow[]>([]);
  const [instructions, setInstructions] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lock = useRef(false);
  const final = doc?.status === 'FINAL';
  const ro = !!final || busy !== null;

  const apply = useCallback((d: BaScope) => {
    setDoc(d); setTitle(d.title); setInputs(d.inputs || {}); setContent(parseContent(d.content)); setRev(r => r + 1);
    businessAssociateApi.scopes(d.contactId).then(setVersions, () => undefined);
  }, []);
  useEffect(() => {
    setLoading(true);
    businessAssociateApi.scope(id).then(d => { apply(d); setLoading(false); }, err => { setError(errorMessage(err)); setLoading(false); });
    businessAssociateApi.prices().then(setCatalogue, () => undefined);
  }, [id, apply]);

  const say = (m: string) => { setNotice(m); setTimeout(() => setNotice(null), 5000); };
  const act = async (name: string, fn: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(name); setError(null);
    try { await fn(); } catch (err) { setError(errorMessage(err)); } finally { lock.current = false; setBusy(null); }
  };
  const payload = () => ({ title: title.trim() || 'Scope of Project', inputs: Object.fromEntries(Object.entries(inputs).filter(([, v]) => v && v.trim())), content: content as unknown as Record<string, unknown> });
  const save = async () => { const d = await businessAssociateApi.saveScope(id, payload()); setDoc(d); return d; };

  const onSave = () => act('save', async () => { await save(); say('Draft saved.'); notifyBaChanged(); });
  const onAi = (section?: ScopeSection) => act(section ?? 'ai', async () => {
    await save();
    apply(await businessAssociateApi.aiScope(id, { section, instructions: instructions.trim() || undefined }));
    say(section ? `${SCOPE_SECTION_LABELS[section]} was rewritten. Read it and edit what you need.` : 'The AI drafted the scope. Read it, correct it, and mark it as reviewed.');
    notifyBaChanged();
  });
  const onReview = () => act('review', async () => { await save(); apply(await businessAssociateApi.reviewScope(id)); say('Marked as reviewed.'); });
  const onFinalize = () => act('final', async () => { await save(); apply(await businessAssociateApi.finalizeScope(id)); say('Version finalised and its PDF saved against the client.'); notifyBaChanged(); });
  const onFile = (action: 'view' | 'download', fileId = id) => act(action, async () => { const m = await openFile(() => businessAssociateApi.scopeFile(fileId, action)); if (m) setError(m); });
  const onNewVersion = () => act('new', async () => { if (doc) { const d = await businessAssociateApi.createScope(doc.contactId, { inputs: Object.fromEntries(Object.entries(doc.inputs).filter(([, v]) => v)) }); notifyBaChanged(); onOpen(d.id); } });

  const setC = (patch: Partial<ScopeContent>) => setContent(c => ({ ...c, ...patch }));
  const setBA = (patch: Partial<ScopeContent['businessAnalysis']>) => setContent(c => ({ ...c, businessAnalysis: { ...c.businessAnalysis, ...patch } }));
  const setSwot = (patch: Partial<ScopeContent['businessAnalysis']['swot']>) => setContent(c => ({ ...c, businessAnalysis: { ...c.businessAnalysis, swot: { ...c.businessAnalysis.swot, ...patch } } }));
  const setPS = (patch: Partial<ScopeContent['projectScope']>) => setContent(c => ({ ...c, projectScope: { ...c.projectScope, ...patch } }));
  const ps = content.projectScope;
  const names = useMemo(() => new Map(catalogue.map(c => [c.serviceCode, c.name])), [catalogue]);
  const needsReview = !!doc?.aiGenerated && !doc.reviewed;
  const empty = JSON.stringify(content) === JSON.stringify(EMPTY_SCOPE_CONTENT);

  if (loading) return <Spinner label="Loading the document…" />;
  if (!doc) return <div className="space-y-4"><button type="button" className={tcBtn.secondary} onClick={onClose}><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back</button>{error && <ErrorBanner message={error} />}</div>;
  const profile = (group: 'A' | 'B') => PROFILE_FIELDS.filter(f => f.group === group);

  return (
    <div className="space-y-5">
      <button type="button" className={tcBtn.secondary} onClick={onClose}><ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back to versions</button>
      <PageTitle title={`${doc.client?.company || doc.client?.name || 'Client'} · version ${doc.version}`} subtitle="Scope of Project" actions={<DocBadge status={doc.status} aiGenerated={doc.aiGenerated} reviewed={doc.reviewed} />} />
      {error && <ErrorBanner message={error} />}
      {notice && <div role="status" className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm font-medium">{notice}</div>}
      {final && <div className="p-3 rounded-xl bg-blue-50 border border-blue-200 text-blue-900 text-sm">This version is final and kept as it is. Start a new version to change anything.</div>}

      {!final && (
        <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-5 flex flex-col lg:flex-row lg:items-end gap-3">
          <div className="flex-1"><label htmlFor="sc-ai-notes" className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-blue-600" aria-hidden="true" /> Generate Scope with AI</label>
            <p className="text-xs text-slate-600 mb-2">The AI uses only this client's information, what you type below and the approved service catalogue. Points are marked Verified or Assumption. Fill in what you know first: where something is missing, it asks instead of guessing.</p>
            <input id="sc-ai-notes" className={tcInput} maxLength={600} value={instructions} onChange={e => setInstructions(e.target.value)} placeholder="Anything to emphasise? (optional)" /></div>
          <button type="button" className={`${tcBtn.primary} shrink-0`} disabled={busy !== null} onClick={() => void onAi()}>{busy === 'ai' ? 'Writing…' : <><Sparkles className="w-4 h-4" aria-hidden="true" /> {empty ? 'Generate Scope with AI' : 'Regenerate everything with AI'}</>}</button>
        </div>
      )}

      {content.missingInformation.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-bold mb-1">Information still needed from the client</p><ul className="list-disc pl-5 space-y-0.5">{content.missingInformation.map(m => <li key={m}>{m}</li>)}</ul></div>
      )}

      <SectionCard title="A. Client and business profile" busy={busy} canAi={false}>
        <Field label="Document title" htmlFor="sc-title"><input id="sc-title" className={tcInput} disabled={ro} maxLength={200} value={title} onChange={e => setTitle(e.target.value)} /></Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Client name" htmlFor="sc-cname"><input id="sc-cname" className={`${tcInput} bg-slate-50`} readOnly value={doc.client?.name || ''} /></Field>
          <Field label="Company / business name" htmlFor="sc-ccomp"><input id="sc-ccomp" className={`${tcInput} bg-slate-50`} readOnly value={doc.client?.company || ''} /></Field>
          {profile('A').map(f => <Field key={f.key} label={f.label} htmlFor={`sc-${f.key}`}><textarea id={`sc-${f.key}`} className={`${tcInput} min-h-[64px]`} disabled={ro} maxLength={2000} value={text(inputs[f.key])} onChange={e => setInputs(x => ({ ...x, [f.key]: e.target.value }))} /></Field>)}
        </div>
      </SectionCard>
      <SectionCard title="B. Current business situation" busy={busy} canAi={false}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {profile('B').map(f => <Field key={f.key} label={f.label} htmlFor={`sc-${f.key}`}><textarea id={`sc-${f.key}`} className={`${tcInput} min-h-[64px]`} disabled={ro} maxLength={2000} value={text(inputs[f.key])} onChange={e => setInputs(x => ({ ...x, [f.key]: e.target.value }))} /></Field>)}
        </div>
      </SectionCard>

      <SectionCard title="C. Business analysis" section="businessAnalysis" busy={busy} onRegenerate={onAi} canAi={!final}>
        <p className="text-xs text-slate-500">Mark a point <b>Verified</b> only when the client told you or you checked it. The AI's own judgements are <b>Assumptions</b>; they are labelled as such in the PDF.</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <AnalysisList label="Strengths" items={content.businessAnalysis.swot.strengths} disabled={ro} onChange={v => setSwot({ strengths: v })} />
          <AnalysisList label="Weaknesses" items={content.businessAnalysis.swot.weaknesses} disabled={ro} onChange={v => setSwot({ weaknesses: v })} />
          <AnalysisList label="Opportunities" items={content.businessAnalysis.swot.opportunities} disabled={ro} onChange={v => setSwot({ opportunities: v })} />
          <AnalysisList label="Threats" items={content.businessAnalysis.swot.threats} disabled={ro} onChange={v => setSwot({ threats: v })} />
          <AnalysisList label="Key business challenges" items={content.businessAnalysis.keyChallenges} disabled={ro} onChange={v => setBA({ keyChallenges: v })} />
          <AnalysisList label="Potential growth areas" items={content.businessAnalysis.growthAreas} disabled={ro} onChange={v => setBA({ growthAreas: v })} />
          <AnalysisList label="Areas requiring improvement" items={content.businessAnalysis.improvementAreas} disabled={ro} onChange={v => setBA({ improvementAreas: v })} />
        </div>
      </SectionCard>

      <SectionCard title="D. Recommended solutions" section="recommendedSolutions" busy={busy} onRegenerate={onAi} canAi={!final}>
        <p className="text-xs text-slate-500">Only services from the approved Amuwa catalogue can be recommended.</p>
        {content.recommendedSolutions.map((r, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2">
            <div className="flex gap-2 items-end">
              <div className="flex-1"><label className="text-xs font-medium text-slate-500" htmlFor={`sc-rs-${i}`}>Service</label>
                <select id={`sc-rs-${i}`} className={tcInput} disabled={ro} value={r.serviceCode} onChange={e => setC({ recommendedSolutions: content.recommendedSolutions.map((x, j) => (j === i ? { ...x, serviceCode: e.target.value } : x)) })}>
                  {!names.has(r.serviceCode) && <option value={r.serviceCode}>{r.serviceCode}</option>}
                  {catalogue.map(s => <option key={s.serviceCode} value={s.serviceCode}>{s.name}</option>)}
                </select></div>
              {!ro && <button type="button" className="p-2 text-rose-600" onClick={() => setC({ recommendedSolutions: content.recommendedSolutions.filter((_, j) => j !== i) })} aria-label={`Remove recommendation ${i + 1}`}><Trash2 className="w-4 h-4" aria-hidden="true" /></button>}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {([['reason', 'Why we recommend it'], ['benefits', 'Expected business benefits'], ['integrations', 'Proposed integrations'], ['dependencies', 'Dependencies and prerequisites'], ['considerations', 'Implementation considerations']] as const).map(([k, label]) => (
                <div key={k}><label className="text-xs font-medium text-slate-500" htmlFor={`sc-rs-${i}-${k}`}>{label}</label>
                  <textarea id={`sc-rs-${i}-${k}`} className={`${tcInput} min-h-[60px]`} disabled={ro} maxLength={1200} value={r[k]} onChange={e => setC({ recommendedSolutions: content.recommendedSolutions.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} /></div>
              ))}
            </div>
          </div>
        ))}
        {!ro && <button type="button" className={tcBtn.secondary} onClick={() => setC({ recommendedSolutions: [...content.recommendedSolutions, { serviceCode: catalogue[0]?.serviceCode ?? '', reason: '', benefits: '', integrations: '', dependencies: '', considerations: '' }] })} disabled={catalogue.length === 0}><Plus className="w-4 h-4" aria-hidden="true" /> Add a recommendation</button>}
      </SectionCard>

      <SectionCard title="E. Project scope" section="projectScope" busy={busy} onRegenerate={onAi} canAi={!final}>
        <Field label="Project overview" htmlFor="sc-overview"><textarea id="sc-overview" className={`${tcInput} min-h-[90px]`} disabled={ro} maxLength={3000} value={ps.overview} onChange={e => setPS({ overview: e.target.value })} /></Field>
        <Field label="Proposed solution" htmlFor="sc-solution"><textarea id="sc-solution" className={`${tcInput} min-h-[90px]`} disabled={ro} maxLength={3000} value={ps.proposedSolution} onChange={e => setPS({ proposedSolution: e.target.value })} /></Field>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {([['objectives', 'Client objectives'], ['challenges', 'Current challenges'], ['servicesIncluded', 'Services included'], ['deliverables', 'Deliverables'], ['functionalRequirements', 'Functional requirements'], ['clientResponsibilities', 'Client responsibilities'], ['amuwaResponsibilities', 'Amuwa Corporation responsibilities'], ['assumptions', 'Assumptions'], ['dependencies', 'Dependencies'], ['outOfScope', 'Out-of-scope items'], ['kpis', 'Success metrics and KPIs'], ['nextSteps', 'Next steps']] as const).map(([k, label]) => (
            <LinesField key={k} id={`sc-${k}`} label={label} value={ps[k]} resetKey={rev} disabled={ro} onChange={v => setPS({ [k]: v } as Partial<ScopeContent['projectScope']>)} />
          ))}
        </div>
        <div>
          <h4 className="text-sm font-bold text-slate-800 mb-1.5">Implementation phases (proposed)</h4>
          <div className="space-y-2">{ps.phases.map((p, i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
              <input className={`${tcInput} md:col-span-3`} disabled={ro} maxLength={200} value={p.name} onChange={e => setPS({ phases: ps.phases.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label={`Phase ${i + 1} name`} placeholder="Phase" />
              <input className={`${tcInput} md:col-span-2`} disabled={ro} maxLength={100} value={p.duration} onChange={e => setPS({ phases: ps.phases.map((x, j) => (j === i ? { ...x, duration: e.target.value } : x)) })} aria-label={`Phase ${i + 1} duration`} placeholder="Duration" />
              <input className={`${tcInput} md:col-span-6`} disabled={ro} value={p.activities.join('; ')} onChange={e => setPS({ phases: ps.phases.map((x, j) => (j === i ? { ...x, activities: e.target.value.split(';').map(a => a.trim()).filter(Boolean) } : x)) })} aria-label={`Phase ${i + 1} activities`} placeholder="Activities, separated by ;" />
              {!ro && <button type="button" className="p-2 text-rose-600 md:col-span-1" onClick={() => setPS({ phases: ps.phases.filter((_, j) => j !== i) })} aria-label={`Remove phase ${i + 1}`}><Trash2 className="w-4 h-4" aria-hidden="true" /></button>}
            </div>))}
            {!ro && ps.phases.length < 10 && <button type="button" className={tcBtn.link} onClick={() => setPS({ phases: [...ps.phases, { name: '', duration: '', activities: [] }] })}>+ Add a phase</button>}
          </div>
        </div>
        <div>
          <h4 className="text-sm font-bold text-slate-800 mb-1.5">Timeline and milestones (proposed)</h4>
          <div className="space-y-2">{ps.milestones.map((m, i) => (
            <div key={i} className="flex gap-2">
              <input className={tcInput} disabled={ro} maxLength={200} value={m.name} onChange={e => setPS({ milestones: ps.milestones.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} aria-label={`Milestone ${i + 1}`} placeholder="Milestone" />
              <input className={`${tcInput} max-w-[14rem]`} disabled={ro} maxLength={100} value={m.timing} onChange={e => setPS({ milestones: ps.milestones.map((x, j) => (j === i ? { ...x, timing: e.target.value } : x)) })} aria-label={`Milestone ${i + 1} timing`} placeholder="Timing" />
              {!ro && <button type="button" className="p-2 text-rose-600" onClick={() => setPS({ milestones: ps.milestones.filter((_, j) => j !== i) })} aria-label={`Remove milestone ${i + 1}`}><Trash2 className="w-4 h-4" aria-hidden="true" /></button>}
            </div>))}
            {!ro && ps.milestones.length < 12 && <button type="button" className={tcBtn.link} onClick={() => setPS({ milestones: [...ps.milestones, { name: '', timing: '' }] })}>+ Add a milestone</button>}
          </div>
        </div>
        <div>
          <h4 className="text-sm font-bold text-slate-800 mb-1.5">Risks and mitigation</h4>
          <div className="space-y-2">{ps.risks.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input className={tcInput} disabled={ro} maxLength={500} value={r.risk} onChange={e => setPS({ risks: ps.risks.map((x, j) => (j === i ? { ...x, risk: e.target.value } : x)) })} aria-label={`Risk ${i + 1}`} placeholder="Risk" />
              <input className={tcInput} disabled={ro} maxLength={600} value={r.mitigation} onChange={e => setPS({ risks: ps.risks.map((x, j) => (j === i ? { ...x, mitigation: e.target.value } : x)) })} aria-label={`Mitigation ${i + 1}`} placeholder="Mitigation" />
              {!ro && <button type="button" className="p-2 text-rose-600" onClick={() => setPS({ risks: ps.risks.filter((_, j) => j !== i) })} aria-label={`Remove risk ${i + 1}`}><Trash2 className="w-4 h-4" aria-hidden="true" /></button>}
            </div>))}
            {!ro && ps.risks.length < 10 && <button type="button" className={tcBtn.link} onClick={() => setPS({ risks: [...ps.risks, { risk: '', mitigation: '' }] })}>+ Add a risk</button>}
          </div>
        </div>
      </SectionCard>

      {versions.length > 1 && (
        <Card label="Version history">
          <h2 className="px-5 pt-5 pb-3 text-base font-extrabold text-slate-900">Version history</h2>
          <ul className="divide-y divide-slate-100">{versions.map(v => (
            <li key={v.id} className="px-5 py-2.5 flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold">Version {v.version}</span><DocBadge status={v.status} aiGenerated={v.aiGenerated} reviewed={v.reviewed} /><span className="text-xs text-slate-500 flex-1">{dateText(v.finalizedAt || v.updatedAt)}</span>
              {v.id !== id && <button type="button" className={tcBtn.row} onClick={() => onOpen(v.id)}>Open</button>}
              {v.hasPdf && <button type="button" className={tcBtn.row} onClick={() => void onFile('download', v.id)} aria-label={`Download version ${v.version}`}><Download className="w-3.5 h-3.5" aria-hidden="true" /> PDF</button>}
            </li>))}</ul>
        </Card>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 sm:mx-0 border-t sm:border sm:rounded-2xl border-slate-200 bg-white/95 backdrop-blur p-3 flex flex-wrap items-center gap-2 shadow-sm">
        {!final ? (
          <>
            <button type="button" className={tcBtn.secondary} onClick={() => void onSave()} disabled={busy !== null}><Save className="w-4 h-4" aria-hidden="true" /> {busy === 'save' ? 'Saving…' : 'Save Draft'}</button>
            <button type="button" className={tcBtn.secondary} onClick={() => void onReview()} disabled={busy !== null || !!doc.reviewed}>{doc.reviewed ? 'Reviewed ✓' : 'I have reviewed this document'}</button>
            <span className="flex-1" />
            {needsReview && <span className="text-xs text-amber-700">Review the AI draft before you finalise it.</span>}
            <button type="button" className={tcBtn.primary} onClick={() => void onFinalize()} disabled={busy !== null || needsReview || empty}><FileSignature className="w-4 h-4" aria-hidden="true" /> {busy === 'final' ? 'Finalising…' : 'Finalize Scope and generate PDF'}</button>
          </>
        ) : (
          <>
            <button type="button" className={tcBtn.primary} onClick={() => void onFile('download')} disabled={busy !== null}><Download className="w-4 h-4" aria-hidden="true" /> Download PDF</button>
            <button type="button" className={tcBtn.secondary} onClick={() => void onFile('view')} disabled={busy !== null}><Eye className="w-4 h-4" aria-hidden="true" /> View PDF</button>
            <button type="button" className={tcBtn.secondary} onClick={() => void onNewVersion()} disabled={busy !== null}><FilePlus2 className="w-4 h-4" aria-hidden="true" /> Start a new version</button>
          </>
        )}
      </div>
    </div>
  );
};

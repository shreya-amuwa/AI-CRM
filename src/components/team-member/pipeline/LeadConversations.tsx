import React, { useState } from 'react';
import { MessageSquarePlus, Pencil } from 'lucide-react';
import type { Conversation } from '../../../../shared/contracts';
import { conversationSchema } from '../../../../shared/validation';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import { fmtDateTime } from '../../payments/PaymentBits';
import { btn, Card, ErrorBanner, inputCls } from './shared';

const MAX = 5000;

const Composer: React.FC<{
  initial?: string;
  label: string;
  submitLabel: string;
  busy: boolean;
  error: string | null;
  onSubmit: (note: string) => void;
  onCancel: () => void;
  id: string;
}> = ({ initial = '', label, submitLabel, busy, error, onSubmit, onCancel, id }) => {
  const [note, setNote] = useState(initial);
  const [localError, setLocalError] = useState<string | null>(null);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = conversationSchema.safeParse({ note });
    if (!parsed.success) return setLocalError(parsed.error.issues[0]?.message ?? 'Write what was discussed.');
    setLocalError(null);
    onSubmit(parsed.data.note);
  };
  const shown = localError || error;
  return (
    <form onSubmit={submit} className="space-y-2" noValidate>
      <label htmlFor={id} className="block text-xs font-semibold text-slate-700">
        {label}
      </label>
      <textarea
        id={id}
        rows={3}
        maxLength={MAX}
        className={`${inputCls} ${shown ? 'border-rose-400' : ''}`}
        value={note}
        onChange={e => setNote(e.target.value)}
        placeholder="What did you discuss? What did the customer say or ask for? What happens next?"
        aria-invalid={!!shown}
        autoFocus
      />
      {shown && <p className="text-[11px] text-rose-600">{shown}</p>}
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">
          {note.length}/{MAX}
        </span>
        <div className="flex gap-2">
          <button type="button" className={btn.secondary} onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btn.primary} disabled={busy}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
};

/**
 * "Last conversation" (the newest record) and the full "Conversation history".
 * Every save adds a new timestamped record; editing changes only that record.
 */
export const ConversationSection: React.FC<{
  customerId: string;
  conversations: Conversation[];
  /** Latest list from the server (after an add or an edit). */
  onChange: (list: Conversation[]) => void;
  /** Called after something was saved so the page can refresh its activity list. */
  onSaved?: () => void;
}> = ({ customerId, conversations, onChange, onSaved }) => {
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const last = conversations[0] ?? null;

  const add = async (note: string) => {
    setBusy(true);
    setError(null);
    try {
      const list = await pipelineApi.addConversation(customerId, note);
      onChange(list);
      setAdding(false);
      setNotice('Conversation saved.');
      onSaved?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const edit = async (id: string, note: string) => {
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.updateConversation(id, note);
      onChange(await pipelineApi.conversations(customerId));
      setEditingId(null);
      setNotice('Conversation updated.');
      onSaved?.();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="p-5 border-indigo-200/70" >
        <section aria-labelledby="last-conversation-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="last-conversation-heading" className="text-sm font-bold text-slate-900">
              Last conversation
            </h2>
            {!adding && (
              <button type="button" className={btn.primary} onClick={() => { setAdding(true); setError(null); setNotice(null); setEditingId(null); }}>
                <MessageSquarePlus className="w-3.5 h-3.5" aria-hidden="true" /> {last ? 'Add new conversation' : 'Add conversation'}
              </button>
            )}
          </div>
          {notice && !adding && (
            <p role="status" className="mt-2 text-xs text-emerald-700">
              {notice}
            </p>
          )}
          {last ? (
            <blockquote className="mt-3 rounded-xl bg-slate-50 border border-slate-200 p-4" data-testid="last-conversation">
              <p className="text-sm text-slate-900 whitespace-pre-line break-words">{last.note}</p>
              <footer className="mt-2 text-[11px] text-slate-500">
                {last.author ? `Recorded by ${last.author.fullName} · ` : ''}
                {fmtDateTime(last.occurredAt)}
                {last.editedAt ? ' · edited' : ''}
              </footer>
            </blockquote>
          ) : (
            !adding && (
              <p className="mt-3 text-xs text-slate-500" data-testid="no-conversation">
                No conversation recorded yet. After you speak to the customer, add what was discussed so you remember it next time.
              </p>
            )
          )}
          {adding && (
            <div className="mt-3">
              <Composer id="new-conversation" label="What was discussed?" submitLabel="Save conversation" busy={busy} error={error} onSubmit={add} onCancel={() => { setAdding(false); setError(null); }} />
              <p className="mt-2 text-[11px] text-slate-500">This is saved as a new entry. Earlier conversations stay in the history below.</p>
            </div>
          )}
        </section>
      </Card>

      <Card className="p-5">
        <section aria-labelledby="conversation-history-heading">
          <div className="flex items-center justify-between">
            <h2 id="conversation-history-heading" className="text-sm font-bold text-slate-900">
              Conversation history
            </h2>
            <span className="text-xs text-slate-500">{conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'}</span>
          </div>
          {conversations.length === 0 ? (
            <p className="mt-3 text-xs text-slate-500">Conversations you record appear here, newest first.</p>
          ) : (
            <ol className="mt-4 space-y-4 border-l border-slate-200 ml-1.5" data-testid="conversation-history">
              {conversations.map((c, i) => (
                <li key={c.id} className="relative pl-5">
                  <span className={`absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full ring-2 ring-white ${i === 0 ? 'bg-indigo-600' : 'bg-slate-300'}`} aria-hidden="true" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs">
                      <span className="font-semibold text-slate-900">{fmtDateTime(c.occurredAt)}</span>
                      <span className="text-slate-500">
                        {c.author ? ` · ${c.author.fullName}` : ''}
                        {c.source === 'LEAD_NOTE' ? ' · note when the lead was added' : ''}
                        {c.editedAt ? ' · edited' : ''}
                      </span>
                    </div>
                    {c.canEdit && editingId !== c.id && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800"
                        onClick={() => { setEditingId(c.id); setError(null); setNotice(null); setAdding(false); }}
                        aria-label={`Edit the conversation from ${fmtDateTime(c.occurredAt)}`}
                      >
                        <Pencil className="w-3 h-3" aria-hidden="true" /> Edit
                      </button>
                    )}
                  </div>
                  {editingId === c.id ? (
                    <div className="mt-2">
                      <Composer id={`edit-conversation-${c.id}`} initial={c.note} label="Correct this conversation" submitLabel="Update conversation" busy={busy} error={error} onSubmit={note => edit(c.id, note)} onCancel={() => { setEditingId(null); setError(null); }} />
                    </div>
                  ) : (
                    <p className="mt-1 text-sm text-slate-700 whitespace-pre-line break-words">{c.note}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
          {error && !adding && editingId === null && (
            <div className="mt-3">
              <ErrorBanner message={error} />
            </div>
          )}
        </section>
      </Card>
    </>
  );
};

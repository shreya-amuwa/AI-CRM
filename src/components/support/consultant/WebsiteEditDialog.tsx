import React, { useState } from 'react';
import { normalizeWebsite } from '../../../../shared/contactValidation';
import { pipelineApi } from '../../../lib/api/endpoints';
import { btn, Dialog, ErrorBanner, Field, inputCls } from '../../team-member/pipeline/shared';
import { userMessage } from '../../../lib/feedback/errors';

/**
 * The Technical Consultant adds or corrects the customer's website link (for example, after building
 * the customer's mini website). The link is saved as a detail waiting for "Authorize": authorizing a
 * mini website we built is what sends the customer the "your website is ready" email + WhatsApp.
 */
export const WebsiteEditDialog: React.FC<{
  customerId: string;
  current: string;
  onClose: () => void;
  onSaved: () => void;
}> = ({ customerId, current, onClose, onSaved }) => {
  const [url, setUrl] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const w = normalizeWebsite(url);
    if (w.url === null) return setError(w.error);
    setBusy(true);
    setError(null);
    try {
      await pipelineApi.setWebsite(customerId, w.url);
      onSaved();
    } catch (err) {
      setError(userMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={current ? 'Edit website' : 'Add website'}
      description='Save the link of the customer&#39;s website. Then click "Authorize" on the Website URL card: the customer gets the "your website is ready" email and WhatsApp with this link.'
      onClose={onClose}
    >
      <form onSubmit={save} className="space-y-3" noValidate>
        <Field label="Website address" htmlFor="tc-website">
          <input
            id="tc-website"
            type="url"
            inputMode="url"
            maxLength={500}
            autoFocus
            placeholder="https://www.example.com"
            className={inputCls}
            value={url}
            onChange={e => {
              setError(null);
              setUrl(e.target.value);
            }}
          />
        </Field>
        {error && <ErrorBanner message={error} />}
        <div className="flex justify-end gap-2">
          <button type="button" className={btn.secondary} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className={btn.primary} disabled={busy}>
            {busy ? 'Saving…' : 'Save website'}
          </button>
        </div>
      </form>
    </Dialog>
  );
};

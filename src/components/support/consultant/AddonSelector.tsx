import React, { useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { PipelineCustomer, ServiceCatalogItem } from '../../../../shared/contracts';
import { errorMessage } from '../../../lib/api/client';
import { pipelineApi } from '../../../lib/api/endpoints';
import { btn } from '../../team-member/pipeline/shared';

const OTHER = '__OTHER__';
export type Addon = { code?: string; name: string };

/**
 * The add-on services of a customer: chips of what is selected, a picker built from the service
 * catalogue (no hard-coded list) and a way to type one by hand. Every change is saved straight
 * away through the same API the Customers panel always used.
 */
export const AddonSelector: React.FC<{
  customerId: string;
  label: string;
  addons: Addon[];
  catalog: ServiceCatalogItem[];
  disabled?: boolean;
  onChanged: (fresh: PipelineCustomer) => void;
}> = ({ customerId, label, addons, catalog, disabled, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const serviceName = (code: string) => catalog.find(s => s.code === code)?.name || code;

  const save = async (next: Addon[]) => {
    setBusy(true);
    setError(null);
    try {
      onChanged(await pipelineApi.consultantSetAddons(customerId, next.map(a => (a.code ? { code: a.code } : { name: a.name }))));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const pick = (value: string) => {
    if (!value) return;
    if (value === OTHER) return setTyping(true);
    void save([...addons, { code: value, name: serviceName(value) }]);
  };
  const addTyped = async () => {
    const name = typed.trim();
    if (name.length < 2) return setError('Type the add-on name (at least 2 characters).');
    await save([...addons, { name }]);
    setTyped('');
    setTyping(false);
  };

  const taken = new Set(addons.filter(a => a.code).map(a => a.code));
  const categories = [...new Set(catalog.map(s => s.category))];

  return (
    <div>
      {addons.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 mb-2" aria-label={`Add-ons of ${label}`}>
          {addons.map((a, i) => (
            <li key={`${a.code || a.name}-${i}`} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-indigo-50 text-indigo-800 text-[11px] font-semibold">
              {a.name}
              {!a.code && <span className="text-indigo-400 font-normal">(manual)</span>}
              <button
                type="button"
                onClick={() => void save(addons.filter((_, j) => j !== i))}
                disabled={busy || disabled}
                className="p-0.5 rounded hover:bg-indigo-100 disabled:opacity-40"
                aria-label={`Remove add-on ${a.name} from ${label}`}
              >
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {typing ? (
        <div className="flex items-center gap-1.5">
          <input
            value={typed}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && void addTyped()}
            maxLength={120}
            placeholder="Type the add-on"
            aria-label={`Add-on name for ${label}`}
            className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs"
            autoFocus
          />
          <button type="button" onClick={() => void addTyped()} disabled={busy || disabled} className={btn.green} aria-label={`Add typed add-on to ${label}`}>
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add
          </button>
          <button
            type="button"
            onClick={() => {
              setTyping(false);
              setTyped('');
            }}
            className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"
            aria-label="Cancel typing an add-on"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <select
          aria-label={`Add an add-on service to ${label}`}
          value=""
          onChange={e => pick(e.target.value)}
          disabled={busy || disabled}
          className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-600"
        >
          <option value="">Add a service…</option>
          {categories.map(cat => {
            const opts = catalog.filter(s => s.category === cat && !taken.has(s.code));
            return opts.length ? (
              <optgroup key={cat} label={cat}>
                {opts.map(s => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </optgroup>
            ) : null;
          })}
          <option value={OTHER}>Other - type manually…</option>
        </select>
      )}
      {error && (
        <p className="text-[11px] text-rose-700 mt-1.5" role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

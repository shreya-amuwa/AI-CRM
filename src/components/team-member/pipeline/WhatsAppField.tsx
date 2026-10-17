import React from 'react';
import { whatsappValue } from '../../../../shared/whatsapp';
import { Field, inputCls } from './shared';

/**
 * WhatsApp number with a "Same as mobile number" box right under it. While the box is ticked the field shows the mobile
 * number and follows it (it is derived from the mobile number, so there is nothing to forget to update). Clearing the box
 * keeps the number that was showing and lets it be edited on its own.
 */
export const WhatsAppField: React.FC<{
  id: string;
  phone: string;
  whatsapp: string;
  same: boolean;
  error?: string;
  disabled?: boolean;
  /** Extra classes for the input (the edit form uses a flat style). */
  inputClassName?: string;
  onChange: (next: { whatsapp: string; same: boolean }) => void;
}> = ({ id, phone, whatsapp, same, error, disabled, inputClassName, onChange }) => {
  const shown = whatsappValue(same, phone, whatsapp);
  return (
    <Field label="WhatsApp number" htmlFor={id} error={error}>
      <input
        id={id}
        type="tel"
        className={`${inputClassName ?? inputCls} ${error ? 'border-rose-400' : ''}`}
        value={shown}
        readOnly={same}
        disabled={disabled}
        placeholder={same ? 'Same as mobile' : '+91'}
        autoComplete="off"
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={e => onChange({ whatsapp: e.target.value, same: false })}
      />
      <label className="mt-1.5 flex items-center gap-2 text-xs text-slate-600 select-none cursor-pointer">
        <input
          id={`${id}-same`}
          type="checkbox"
          className="rounded border-slate-300"
          checked={same}
          disabled={disabled}
          onChange={e => onChange({ whatsapp: e.target.checked ? whatsapp : phone, same: e.target.checked })}
        />
        Same as mobile number
      </label>
    </Field>
  );
};

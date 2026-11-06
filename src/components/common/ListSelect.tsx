import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export interface ListSelectOption {
  value: string;
  label: string;
}

/**
 * A select whose options are clearly separated (a thin line between each one), with the same font, spacing, hover and selected look in every
 * browser - a native <select> cannot show separators reliably. It follows the WAI-ARIA "select-only combobox" pattern: the trigger is a
 * button with role="combobox" (so <label htmlFor> names it), the list is role="listbox". Keyboard: Enter / Space / Arrow keys open it,
 * Up / Down / Home / End move, typing jumps to an option, Enter / Space chooses, Escape or Tab closes. The values are the caller's own.
 */
export const ListSelect: React.FC<{
  id: string;
  value: string;
  options: ListSelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  className?: string;
}> = ({ id, value, options, onChange, placeholder = 'Select…', disabled, invalid, describedBy, className = '' }) => {
  const listId = `${id}-listbox`;
  const uid = useId().replace(/:/g, '');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const typed = useRef({ text: '', at: 0 });
  const selectedIndex = useMemo(() => options.findIndex(o => o.value === value), [options, value]);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  const optionId = (i: number) => `${uid}-opt-${i}`;

  // a click outside closes it
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // keep the highlighted option in view
  useEffect(() => {
    if (!open || active < 0) return;
    const el = listRef.current?.querySelector<HTMLElement>(`#${CSS.escape(optionId(active))}`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [open, active]); // eslint-disable-line react-hooks/exhaustive-deps

  const openList = (at = selectedIndex >= 0 ? selectedIndex : 0) => { setActive(at); setOpen(true); };
  const choose = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
  };
  const jumpTo = (key: string) => {
    const now = Date.now();
    typed.current = { text: now - typed.current.at < 700 ? typed.current.text + key.toLowerCase() : key.toLowerCase(), at: now };
    const from = open ? active : selectedIndex;
    const order = [...options.keys()].map(k => (k + Math.max(0, from) + (typed.current.text.length === 1 ? 1 : 0)) % options.length);
    const hit = order.find(i => options[i].label.toLowerCase().startsWith(typed.current.text));
    if (hit !== undefined) {
      if (open) setActive(hit);
      else onChange(options[hit].value);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const last = options.length - 1;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!open) openList(); else setActive(a => Math.min(last, a + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (!open) openList(); else setActive(a => Math.max(0, a - 1));
        break;
      case 'Home':
        if (open) { e.preventDefault(); setActive(0); }
        break;
      case 'End':
        if (open) { e.preventDefault(); setActive(last); }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        if (open) choose(active); else openList();
        break;
      case 'Escape':
        if (open) { e.preventDefault(); setOpen(false); }
        break;
      case 'Tab':
        setOpen(false);
        break;
      default:
        if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) jumpTo(e.key);
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? optionId(active) : undefined}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        disabled={disabled}
        data-value={value}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl border bg-white text-left text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed ${
          invalid ? 'border-rose-400' : 'border-slate-200'
        } ${selected ? 'text-slate-800' : 'text-slate-400'}`}
      >
        <span className="truncate">{selected ? selected.label : placeholder}</span>
        <ChevronDown className={`w-4 h-4 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      <ul
        ref={listRef}
        id={listId}
        role="listbox"
        aria-labelledby={id}
        tabIndex={-1}
        hidden={!open}
        className="absolute z-30 mt-1 left-0 right-0 min-w-full max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg py-1 text-sm"
      >
        {options.map((o, i) => {
          const isSelected = i === selectedIndex;
          const isActive = i === active;
          return (
            <li
              key={o.value}
              id={optionId(i)}
              role="option"
              aria-selected={isSelected}
              data-value={o.value}
              onPointerDown={e => e.preventDefault() /* keep the focus on the trigger */}
              onClick={() => choose(i)}
              onMouseEnter={() => setActive(i)}
              className={`flex items-center justify-between gap-2 px-3 py-2.5 cursor-pointer border-b border-slate-100 last:border-b-0 ${
                isActive ? 'bg-indigo-50 text-indigo-900' : 'text-slate-700'
              } ${isSelected ? 'font-semibold' : ''}`}
            >
              <span>{o.label}</span>
              {isSelected && <Check className="w-4 h-4 text-indigo-600 shrink-0" aria-hidden="true" />}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

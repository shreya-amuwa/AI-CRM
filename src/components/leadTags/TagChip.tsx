import React from 'react';
import type { LeadTag, LeadTagColour } from '../../../shared/contracts';

const COLOUR: Record<LeadTagColour, string> = {
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
  blue: 'bg-blue-50 text-blue-700 border-blue-200',
  indigo: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  violet: 'bg-violet-50 text-violet-700 border-violet-200',
  green: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  orange: 'bg-orange-50 text-orange-700 border-orange-200',
  red: 'bg-rose-50 text-rose-700 border-rose-200'
};
export const SWATCH: Record<LeadTagColour, string> = {
  slate: 'bg-slate-500', blue: 'bg-blue-500', indigo: 'bg-indigo-500', violet: 'bg-violet-500', green: 'bg-emerald-500', amber: 'bg-amber-500', orange: 'bg-orange-500', red: 'bg-rose-500'
};

/** A lead tag as a small coloured label. */
export const TagChip: React.FC<{ tag: Pick<LeadTag, 'label' | 'colour'> & Partial<Pick<LeadTag, 'retired'>> }> = ({ tag }) => (
  <span data-testid="tag-chip" className={`inline-flex max-w-full items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${COLOUR[tag.colour] ?? COLOUR.slate} ${tag.retired ? 'opacity-60' : ''}`}>
    <span className="truncate">{tag.label}</span>
  </span>
);

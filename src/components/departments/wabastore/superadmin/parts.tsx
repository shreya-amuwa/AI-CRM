import React from 'react';
import { Card } from '../../../team-member/pipeline/shared';

/** A headline number card (Team Performance pages). */
export const Tile: React.FC<{ icon: React.ReactNode; label: string; value: number; hint?: string; tone?: string; testId: string }> = ({
  icon,
  label,
  value,
  hint,
  tone = 'text-slate-900',
  testId
}) => (
  <Card className="p-4">
    <div className="flex items-center justify-between text-slate-500">
      <span className="text-xs font-semibold uppercase tracking-wide">{label}</span>
      {icon}
    </div>
    <div className={`mt-2 text-3xl font-bold ${tone}`} data-testid={testId}>
      {value}
    </div>
    {hint && <div className="text-xs text-slate-500 mt-1">{hint}</div>}
  </Card>
);

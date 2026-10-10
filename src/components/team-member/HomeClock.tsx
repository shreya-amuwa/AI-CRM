import React, { useEffect, useState } from 'react';
import { Clock } from 'lucide-react';

const DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const TIME = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true });

/** Today's date and the time in India (IST), 12-hour hh:mm, kept current without a reload. */
export const HomeClock: React.FC = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 10000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-3 bg-white border border-slate-200/80 rounded-2xl px-4 py-2.5 self-start sm:self-auto" role="timer" aria-label="Current date and time in India">
      <Clock className="w-4 h-4 text-slate-400 shrink-0" aria-hidden="true" />
      <div className="leading-tight">
        <div className="text-sm font-bold text-slate-900 tabular-nums" data-testid="home-time">
          {TIME.format(now)} <span className="text-[11px] font-semibold text-slate-400">IST</span>
        </div>
        <div className="text-[11px] text-slate-500" data-testid="home-date">
          {DATE.format(now)}
        </div>
      </div>
    </div>
  );
};

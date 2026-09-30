import React, { useState, useEffect } from 'react';
import { TrendingUp, PhoneCall, MessageCircle, PresentationIcon, FileText, Trophy } from 'lucide-react';

interface DailySalesScoreProps {
  achieved: number;
  target: number;
  activities: {
    calls: number;
    followups: number;
    demos: number;
    proposals: number;
    won: number;
  };
}

export const DailySalesScore: React.FC<DailySalesScoreProps> = ({
  achieved,
  target,
  activities
}) => {
  const [animatedPercent, setAnimatedPercent] = useState(0);

  const progressPercent = (achieved / target) * 100;

  useEffect(() => {
    let progress = 0;
    const interval = setInterval(() => {
      if (progress < progressPercent) {
        progress += Math.random() * 15;
        setAnimatedPercent(Math.min(progress, progressPercent));
      } else {
        clearInterval(interval);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [progressPercent]);

  const getPerformanceLevel = (percent: number) => {
    if (percent >= 100) return { label: '🎯 EXCELLENCE', color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200' };
    if (percent >= 75) return { label: '⭐ ON TRACK', color: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200' };
    if (percent >= 50) return { label: '💪 GOOD', color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200' };
    return { label: '🚀 PUSH NEEDED', color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200' };
  };

  const performance = getPerformanceLevel(progressPercent);

  return (
    <div className={`rounded-3xl border-2 ${performance.border} ${performance.bg} p-6 sm:p-8`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left: Sales Target Progress */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wide mb-1">Today's Sales Score</h3>
              <p className={`text-4xl font-bold ${performance.color}`}>{Math.round(progressPercent)}%</p>
              <p className={`text-xs font-semibold ${performance.color} uppercase tracking-wider mt-1`}>{performance.label}</p>
            </div>
            <div className="text-5xl">
              {progressPercent >= 100 ? '🏆' : progressPercent >= 75 ? '⭐' : progressPercent >= 50 ? '💪' : '🚀'}
            </div>
          </div>

          <div className="mb-4">
            <div className="text-sm mb-2">
              <span className="font-semibold text-slate-900">₹{(achieved / 1000).toLocaleString('en-IN')}K</span>
              <span className="text-slate-600"> of ₹{(target / 1000).toLocaleString('en-IN')}K target</span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-3 bg-white rounded-full overflow-hidden border border-white/50 shadow-sm">
              <div
                className="h-full bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500 transition-all duration-300 ease-out rounded-full"
                style={{ width: `${Math.min(animatedPercent, 100)}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="bg-white/60 rounded-lg p-2 border border-white/50">
              <span className="text-slate-600">Achieved</span>
              <p className="font-bold text-slate-900">₹{(achieved / 1000).toFixed(1)}K</p>
            </div>
            <div className="bg-white/60 rounded-lg p-2 border border-white/50">
              <span className="text-slate-600">Remaining</span>
              <p className="font-bold text-slate-900">₹{((target - achieved) / 1000).toFixed(1)}K</p>
            </div>
          </div>
        </div>

        {/* Right: Activity Breakdown */}
        <div>
          <h3 className="text-sm font-bold text-slate-600 uppercase tracking-wide mb-4">Activity Today</h3>
          <div className="space-y-3">
            <ActivityRow
              icon={<PhoneCall className="w-4 h-4" />}
              label="Calls Made"
              value={activities.calls}
              color="text-emerald-600"
              bgColor="bg-emerald-50"
            />
            <ActivityRow
              icon={<MessageCircle className="w-4 h-4" />}
              label="Follow-ups"
              value={activities.followups}
              color="text-purple-600"
              bgColor="bg-purple-50"
            />
            <ActivityRow
              icon={<PresentationIcon className="w-4 h-4" />}
              label="Demos Done"
              value={activities.demos}
              color="text-indigo-600"
              bgColor="bg-indigo-50"
            />
            <ActivityRow
              icon={<FileText className="w-4 h-4" />}
              label="Proposals Sent"
              value={activities.proposals}
              color="text-cyan-600"
              bgColor="bg-cyan-50"
            />
            <ActivityRow
              icon={<Trophy className="w-4 h-4" />}
              label="Deals Won"
              value={activities.won}
              color="text-amber-600"
              bgColor="bg-amber-50"
            />
          </div>
        </div>
      </div>
    </div>
  );
};

interface ActivityRowProps {
  icon: JSX.Element;
  label: string;
  value: number;
  color: string;
  bgColor: string;
}

const ActivityRow: React.FC<ActivityRowProps> = ({ icon, label, value, color, bgColor }) => {
  return (
    <div className="flex items-center justify-between bg-white/60 rounded-lg p-3 border border-white/50">
      <div className="flex items-center gap-2.5">
        <div className={`${bgColor} ${color} p-2 rounded-lg`}>
          {icon}
        </div>
        <span className="text-sm font-semibold text-slate-700">{label}</span>
      </div>
      <span className="text-lg font-bold text-slate-900">{value}</span>
    </div>
  );
};

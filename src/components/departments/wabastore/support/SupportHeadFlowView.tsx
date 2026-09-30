import React, { useState } from 'react';
import {
  GitFork, ArrowRight, CheckCircle2, Clock, ShieldCheck, Sparkles,
  MessageSquare, Bot, UserCheck, Wrench, ThumbsUp, AlertCircle
} from 'lucide-react';

export const SupportHeadFlowView: React.FC = () => {
  const [activeStep, setActiveStep] = useState<number>(1);

  const steps = [
    {
      step: 1,
      name: 'Inbound Ingestion',
      icon: MessageSquare,
      throughput: '142 / day',
      latency: '120ms',
      sla: 'Instant (< 5s)',
      desc: 'Customer sends inquiry through WhatsApp Business API, Webhook portal, or Email desk.',
      details: 'Payload is verified for HMAC signatures, normalized into unified JSON schema, and injected into real-time broker.'
    },
    {
      step: 2,
      name: 'AI Smart Triage & Tagging',
      icon: Bot,
      throughput: '100% processed',
      latency: '450ms',
      sla: '< 10 secs',
      desc: 'AI extracts intent, sentiment, priority, and automatically categorizes the ticket into technical domains.',
      details: 'Classifies into Meta Templates, Catalog Sync, Payments, or Access. Detects frustration markers to flag VIP enterprise accounts.'
    },
    {
      step: 3,
      name: 'First Response SLA Dispatch',
      icon: Clock,
      throughput: '96.4% on-target',
      latency: '14 mins avg',
      sla: '< 30 mins',
      desc: 'Auto-acknowledgment sent with ticket reference number. Inbound queue routed to available Tier-1 or Tier-2 specialist.',
      details: 'Agent receives push alert. Round-robin assignment based on agent active chat load and category specialization.'
    },
    {
      step: 4,
      name: 'Investigation & Escalation',
      icon: Wrench,
      throughput: '72.4% FCR',
      latency: '1.4 hrs avg',
      sla: '< 4 hrs',
      desc: 'Frontline agent investigates log traces. If technical bug exists, ticket is escalated to engineering lead.',
      details: 'Tier-1 handles standard configuration and guidance. Tier-2/Tier-3 engineering handles code hotfixes and Meta Graph API re-submissions.'
    },
    {
      step: 5,
      name: 'Fix Implementation & Verification',
      icon: ShieldCheck,
      throughput: '94.2% verified',
      latency: '3.8 hrs avg',
      sla: '< 6 hrs',
      desc: 'Fix deployed to staging/production. Agent verifies functionality with client via screen-share or WhatsApp test.',
      details: 'Sanity checks confirmed on customer store. Client confirms resolution and authorizes ticket closure.'
    },
    {
      step: 6,
      name: 'Resolution & CSAT Survey',
      icon: ThumbsUp,
      throughput: '4.8 / 5.0 rating',
      latency: 'Instant trigger',
      sla: 'Within 2 hrs',
      desc: 'Ticket marked Resolved. Automated 5-star rating survey sent via WhatsApp. Knowledge base auto-updated with solution.',
      details: 'Customer ratings feed directly into Team Performance dashboard. Unsolved tickets automatically scheduled for follow-up.'
    }
  ];

  return (
    <div className="space-y-6 font-sans">
      <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs">
        <h2 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
          <GitFork className="w-6 h-6 text-teal-600" />
          <span>Support Flow &amp; Lifecycle Architecture</span>
        </h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Visual lifecycle tracking the 6-stage customer journey from inbound ingestion to automated CSAT closure
        </p>
      </div>

      {/* Visual Pipeline Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {steps.map(s => {
          const Icon = s.icon;
          const isSelected = activeStep === s.step;
          return (
            <div
              key={s.step}
              onClick={() => setActiveStep(s.step)}
              className={`bg-white border rounded-2xl p-5 shadow-xs hover:shadow-md transition-all cursor-pointer space-y-3 relative overflow-hidden ${
                isSelected ? 'border-teal-500 ring-2 ring-teal-500/20' : 'border-slate-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-bold text-xs ${
                    isSelected ? 'bg-teal-600 text-white' : 'bg-slate-100 text-slate-700'
                  }`}>
                    {s.step}
                  </div>
                  <div className={`p-2 rounded-xl border ${
                    isSelected ? 'bg-teal-50 text-teal-600 border-teal-200' : 'bg-slate-50 text-slate-500 border-slate-100'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                </div>
                <span className="font-mono text-xs font-bold text-slate-400">Step 0{s.step}</span>
              </div>

              <div>
                <h3 className="font-bold text-sm text-slate-900">{s.name}</h3>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">{s.desc}</p>
              </div>

              <div className="pt-3 border-t border-slate-100 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">Latency</span>
                  <span className="font-mono font-bold text-slate-800">{s.latency}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase font-bold">SLA Target</span>
                  <span className="font-mono font-bold text-teal-700">{s.sla}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Selected Step Deep Dive */}
      <div className="bg-gradient-to-br from-teal-900 to-slate-900 text-white rounded-3xl p-6 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full bg-teal-500/20 text-teal-300 text-xs font-bold font-mono">
              STAGE 0{activeStep} DEEP DIVE
            </span>
            <h3 className="font-bold text-base text-white">{steps[activeStep - 1].name}</h3>
          </div>
          <span className="text-xs font-mono text-teal-300 font-semibold">Throughput: {steps[activeStep - 1].throughput}</span>
        </div>
        <p className="text-sm text-slate-200 leading-relaxed max-w-3xl">
          {steps[activeStep - 1].details}
        </p>
      </div>
    </div>
  );
};

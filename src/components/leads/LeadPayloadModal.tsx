import React from 'react';
import { X, Copy, Check, Terminal } from 'lucide-react';
import { Lead } from '../../types/crm';
import { LEAD_SOURCES } from '../../data/leadSources';

interface LeadPayloadModalProps {
  lead: Lead | null;
  onClose: () => void;
}

export const LeadPayloadModal: React.FC<LeadPayloadModalProps> = ({ lead, onClose }) => {
  const [copied, setCopied] = React.useState(false);

  if (!lead) return null;

  const srcObj = LEAD_SOURCES[lead.sourceId];
  const jsonString = JSON.stringify(lead.rawPayload, null, 2);

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl p-6 shadow-2xl relative overflow-hidden animate-scale-up">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 border border-blue-100 text-blue-600">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold font-heading text-slate-900">Raw Webhook Payload</h3>
                <span
                  className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold border ${srcObj.bgClass} ${srcObj.textClass} ${srcObj.borderClass}`}
                >
                  {srcObj.badgeLabel}
                </span>
              </div>
              <p className="text-xs font-mono text-slate-500">
                Lead ID: <strong className="text-slate-900">{lead.id}</strong> &bull; Received {new Date(lead.receivedAt).toLocaleString()}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-2 gap-3 mb-4 text-xs font-mono">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-slate-400 block text-[10px]">PROSPECT NAME</span>
            <span className="text-slate-900 font-semibold">{lead.name}</span>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <span className="text-slate-400 block text-[10px]">CONTACT / PHONE</span>
            <span className="text-blue-600 font-semibold">{lead.contact}</span>
          </div>
        </div>

        {/* Code Snippet Box */}
        <div className="relative">
          <div className="flex items-center justify-between px-4 py-2 bg-slate-800 text-slate-300 rounded-t-xl text-xs font-mono">
            <span>application/json</span>
            <button
              onClick={handleCopy}
              className="flex items-center gap-1 text-slate-300 hover:text-white transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'COPIED!' : 'COPY JSON'}</span>
            </button>
          </div>

          <pre className="p-4 bg-slate-900 rounded-b-xl overflow-x-auto text-xs font-mono text-cyan-300 leading-relaxed max-h-72">
            {jsonString}
          </pre>
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-mono font-medium transition-colors"
          >
            Close Viewer
          </button>
        </div>
      </div>
    </div>
  );
};

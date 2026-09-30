import React from 'react';

export const VisualIngestionStreamAnimation: React.FC = () => {
  return (
    <div className="hidden lg:flex items-center justify-center relative w-16 -mx-2 z-10 pointer-events-none self-stretch">
      <svg className="w-full h-full min-h-[300px]" viewBox="0 0 100 400" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* 10 Converging Clean Flow Lines */}
        <path d="M 0 30 C 40 30, 60 200, 100 200" stroke="#10B981" strokeWidth="2" strokeDasharray="5 5" className="animate-dash-flow opacity-75" />
        <path d="M 0 70 C 40 70, 60 200, 100 200" stroke="#3B82F6" strokeWidth="2" strokeDasharray="5 5" className="animate-dash-flow opacity-75" style={{ animationDelay: '0.2s' }} />
        <path d="M 0 110 C 40 110, 60 200, 100 200" stroke="#F59E0B" strokeWidth="2" strokeDasharray="5 5" className="animate-dash-flow opacity-75" style={{ animationDelay: '0.4s' }} />
        <path d="M 0 150 C 40 150, 60 200, 100 200" stroke="#8B5CF6" strokeWidth="2" strokeDasharray="5 5" className="animate-dash-flow opacity-75" style={{ animationDelay: '0.6s' }} />
        <path d="M 0 190 C 40 190, 60 200, 100 200" stroke="#06B6D4" strokeWidth="2.5" strokeDasharray="5 5" className="animate-dash-flow opacity-90" style={{ animationDelay: '0.1s' }} />
        <path d="M 0 230 C 40 230, 60 200, 100 200" stroke="#EC4899" strokeWidth="2.5" strokeDasharray="5 5" className="animate-dash-flow opacity-90" style={{ animationDelay: '0.3s' }} />
        <path d="M 0 270 C 40 270, 60 200, 100 200" stroke="#6366F1" strokeWidth="2" strokeDasharray="5 5" className="animate-dash-flow opacity-75" style={{ animationDelay: '0.5s' }} />
        <path d="M 0 310 C 40 310, 60 200, 100 200" stroke="#14B8A6" strokeWidth="2" strokeDasharray="5 5" className="animate-dash-flow opacity-75" style={{ animationDelay: '0.7s' }} />
        <path d="M 0 350 C 40 350, 60 200, 100 200" stroke="#F97316" strokeWidth="2" strokeDasharray="5 5" className="animate-dash-flow opacity-75" style={{ animationDelay: '0.8s' }} />
        <path d="M 0 390 C 40 390, 60 200, 100 200" stroke="#F43F5E" strokeWidth="2" strokeDasharray="5 5" className="animate-dash-flow opacity-75" style={{ animationDelay: '0.9s' }} />
      </svg>
    </div>
  );
};

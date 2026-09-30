import React from 'react';
import { X, Plus } from 'lucide-react';
import { useTabs } from '../../context/TabContext';

export const TabBar: React.FC = () => {
  const { tabs, activeTabId, closeTab, switchTab, closeAllTabs } = useTabs();

  if (tabs.length === 0) {
    return null;
  }

  return (
    <div className="bg-white border-b border-slate-200 px-4 py-0 flex items-center gap-1 h-12 overflow-x-auto">
      {tabs.map(tab => (
        <div
          key={tab.id}
          onClick={() => switchTab(tab.id)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg cursor-pointer transition-all border-b-2 whitespace-nowrap text-sm font-medium ${
            activeTabId === tab.id
              ? 'bg-blue-50 border-b-blue-500 text-blue-700'
              : 'bg-slate-50 border-b-transparent text-slate-600 hover:bg-slate-100'
          }`}
        >
          <span className="w-3 h-3 rounded-full bg-current opacity-60" />
          <span>{tab.departmentName}</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
            className="p-0.5 hover:bg-white rounded opacity-60 hover:opacity-100 transition-all"
            title="Close tab"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}

      {/* Close All Button */}
      {tabs.length > 1 && (
        <button
          onClick={closeAllTabs}
          className="ml-auto px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded transition-all"
          title="Close all tabs"
        >
          Close All
        </button>
      )}
    </div>
  );
};

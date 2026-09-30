import React, { createContext, useContext, useState, useCallback } from 'react';

export interface DepartmentTab {
  id: string;
  departmentId: string;
  departmentName: string;
  activeTab: string;
  subDept: 'sales' | 'support' | 'education_training' | 'product_training' | null;
}

interface TabContextType {
  tabs: DepartmentTab[];
  activeTabId: string | null;
  openDepartment: (departmentId: string, departmentName: string) => void;
  closeTab: (tabId: string) => void;
  switchTab: (tabId: string) => void;
  updateTabState: (tabId: string, activeTab: string, subDept?: any) => void;
  closeAllTabs: () => void;
}

const TabContext = createContext<TabContextType | undefined>(undefined);

export const TabProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [tabs, setTabs] = useState<DepartmentTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const openDepartment = useCallback((departmentId: string, departmentName: string) => {
    // Check if department is already open
    const existingTab = tabs.find(t => t.departmentId === departmentId);

    if (existingTab) {
      // Switch to existing tab
      setActiveTabId(existingTab.id);
    } else {
      // Create new tab
      const newTabId = `tab-${departmentId}-${Date.now()}`;
      const newTab: DepartmentTab = {
        id: newTabId,
        departmentId,
        departmentName,
        activeTab: 'dashboard',
        subDept: null
      };
      setTabs(prev => [...prev, newTab]);
      setActiveTabId(newTabId);
    }
  }, [tabs]);

  const closeTab = useCallback((tabId: string) => {
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId);

      // If closing active tab, switch to another tab
      if (activeTabId === tabId) {
        if (newTabs.length > 0) {
          setActiveTabId(newTabs[newTabs.length - 1].id);
        } else {
          setActiveTabId(null);
        }
      }

      return newTabs;
    });
  }, [activeTabId]);

  const switchTab = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  const updateTabState = useCallback((tabId: string, activeTab: string, subDept?: any) => {
    setTabs(prev => prev.map(tab =>
      tab.id === tabId
        ? { ...tab, activeTab, subDept: subDept || tab.subDept }
        : tab
    ));
  }, []);

  const closeAllTabs = useCallback(() => {
    setTabs([]);
    setActiveTabId(null);
  }, []);

  return (
    <TabContext.Provider value={{ tabs, activeTabId, openDepartment, closeTab, switchTab, updateTabState, closeAllTabs }}>
      {children}
    </TabContext.Provider>
  );
};

export const useTabs = () => {
  const context = useContext(TabContext);
  if (!context) {
    throw new Error('useTabs must be used within TabProvider');
  }
  return context;
};

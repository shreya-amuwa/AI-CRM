import React from 'react';
import { Employee } from '../../../types/amuwaHq';
import { HrLettersPage } from './HrLettersPage';

interface AutomatedLetterGeneratorWorkspaceProps {
  initialTab?: 'offer' | 'experience' | 'nda';
  employees?: Employee[];
  onClose?: () => void;
  onSuccessToast?: (msg: string) => void;
}

/**
 * The HR dashboard's letter cards (Offer / Experience / NDA Letter Management) open the same Employee Letters page as the sidebar: every letter
 * is made by the server from the HR record and stored on the employee (no sample data, no browser-only letters).
 */
export const AutomatedLetterGeneratorWorkspace: React.FC<AutomatedLetterGeneratorWorkspaceProps> = ({ initialTab = 'offer', employees = [], onSuccessToast }) => (
  <HrLettersPage
    initialType={initialTab === 'experience' ? 'EXPERIENCE' : initialTab === 'nda' ? 'NDA' : 'OFFER'}
    employees={employees}
    onSuccessToast={onSuccessToast}
  />
);

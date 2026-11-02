import React from 'react';
import { createRoot } from 'react-dom/client';
import { Profile } from '../../../src/candidate/Profile';
import { Jobs } from '../../../src/candidate/Jobs';
import { Resumes } from '../../../src/candidate/Resumes';
import { Assessments } from '../../../src/candidate/Assessments';
import { Offers, Documents, Training } from '../../../src/candidate/Joining';
declare global {
  interface Window {
    mountCandidate: (screen: string) => void;
  }
}
window.mountCandidate = (screen: string) => {
  const root = createRoot(document.getElementById('root')!);
  root.render(
    screen === 'profile' ? (
      <Profile />
    ) : screen === 'jobs' ? (
      <Jobs
        signedIn
        onSignIn={() => {}}
        onApplied={() => {
          document.body.dataset.applied = 'yes';
        }}
      />
    ) : screen === 'resumes' ? (
      <Resumes />
    ) : screen === 'offers' ? (
      <Offers />
    ) : screen === 'documents' ? (
      <Documents />
    ) : screen === 'training' ? (
      <Training />
    ) : (
      <Assessments onActive={() => {}} />
    ),
  );
};

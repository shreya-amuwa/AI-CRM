import { TraineeProgress } from '../types/training';

export const INITIAL_TRAINEES: TraineeProgress[] = [
  {
    id: 'TRN-101',
    employeeId: 'EMP-1003',
    traineeName: 'Rohan Mehta',
    designation: 'Operations Trainee Candidate',
    track: 'Corporate Induction',
    startDate: '2026-08-18',
    targetEndDate: '2026-08-20',
    daysCompleted: 2,
    totalDays: 3,
    progressPercentage: 66,
    currentModule: 'Day 2: Briefing of Company by Assigned Trainer',
    evaluationScore: 88,
    trainerName: 'Alexander Wright (Operations Lead)',
    trainerFeedback: 'Exceptional progress in 3-day induction training. Completed website and brochure analysis.',
    status: 'In-Training',
    modules: [
      { id: 'M1', title: 'Day 1: Website & Products Analysis', track: 'Corporate Induction', durationDays: 1, description: 'Analyze amuwa.com, amuwacorporation.com, and 12-page Product Brochure PDF', status: 'Completed' },
      { id: 'M2', title: 'Day 2: Company Briefing by Trainer', track: 'Corporate Induction', durationDays: 1, description: 'Interactive briefing on company structure, lead ingestion, and client SLA expectations', status: 'In-Progress' },
      { id: 'M3', title: 'Day 3: Evaluation Quiz Google Form', track: 'Corporate Induction', durationDays: 1, description: 'Final evaluation quiz submission via official Google Form', status: 'Pending' }
    ]
  },
  {
    id: 'TRN-102',
    employeeId: 'EMP-1004',
    traineeName: 'Kavya Nair',
    designation: 'Creative Design Candidate',
    track: 'Corporate Induction',
    startDate: '2026-08-19',
    targetEndDate: '2026-08-21',
    daysCompleted: 1,
    totalDays: 3,
    progressPercentage: 33,
    currentModule: 'Day 1: Website & Products Analysis',
    evaluationScore: 92,
    trainerName: 'Priya Sharma (HR Lead)',
    trainerFeedback: 'Great initial progress on Day 1 website & product brochure review.',
    status: 'In-Training',
    modules: [
      { id: 'M1', title: 'Day 1: Website & Products Analysis', track: 'Corporate Induction', durationDays: 1, description: 'Analyze amuwa.com, amuwacorporation.com, and 12-page Product Brochure PDF', status: 'In-Progress' },
      { id: 'M2', title: 'Day 2: Company Briefing by Trainer', track: 'Corporate Induction', durationDays: 1, description: 'Interactive briefing on company structure, lead ingestion, and client SLA expectations', status: 'Pending' },
      { id: 'M3', title: 'Day 3: Evaluation Quiz Google Form', track: 'Corporate Induction', durationDays: 1, description: 'Final evaluation quiz submission via official Google Form', status: 'Pending' }
    ]
  }
];

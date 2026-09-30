export type TrainingStatus = 'In-Training' | 'Ready for Conversion' | 'Converted' | 'Extended';

export interface TrainingModuleItem {
  id: string;
  title: string;
  track: string;
  durationDays: number;
  description: string;
  status: 'Completed' | 'In-Progress' | 'Pending';
}

export interface TraineeProgress {
  id: string;
  employeeId: string;
  traineeName: string;
  designation: string;
  avatarUrl?: string;
  track: 'AI Video & Media' | 'Corporate Operations' | 'HR & Talent' | 'Client Relations' | 'Corporate Induction';
  startDate: string;
  targetEndDate: string;
  daysCompleted: number;
  totalDays: number;
  progressPercentage: number;
  currentModule: string;
  evaluationScore: number; // e.g. 88/100
  trainerName: string;
  trainerFeedback: string;
  status: TrainingStatus;
  modules: TrainingModuleItem[];
}

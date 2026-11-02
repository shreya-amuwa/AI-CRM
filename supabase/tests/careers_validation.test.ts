import assert from 'node:assert/strict';
import {
  careerProfileSchema,
  careerPostingSchema,
  careerUploadSchema,
  careerTestSchema,
  careerAttemptSchema,
  careerOfferReplySchema,
} from '../../shared/validation';
const profile = {
  name: 'Applicant Name',
  phone: '9847650321',
  city: '',
  state: '',
  education: '',
  experience: '',
  skills: '',
  bio: '',
  version: 1,
};
assert(careerProfileSchema.safeParse(profile).success);
for (const extra of [
  { role: 'SUPER_ADMIN' },
  { id: 'someone-else' },
  { version: 0 },
  { phone: 'not-mobile' },
  { name: '' },
])
  assert(!careerProfileSchema.safeParse({ ...profile, ...extra }).success);
assert(
  !careerUploadSchema.safeParse({ file_name: 'resume.exe', size_bytes: 100 })
    .success,
);
assert(
  !careerUploadSchema.safeParse({
    file_name: 'resume.pdf',
    size_bytes: 10485761,
  }).success,
);
assert(
  careerUploadSchema.safeParse({ file_name: 'resume.pdf', size_bytes: 1024 })
    .success,
);
assert(!careerPostingSchema.safeParse({ title: 'Job' }).success);
const test = {
  title: 'Assessment',
  duration_minutes: 15,
  pass_percent: 60,
  questions: [{ prompt: 'Question', options: ['One', 'Two'], correct: 1 }],
};
assert(careerTestSchema.safeParse(test).success);
assert(
  !careerTestSchema.safeParse({
    ...test,
    questions: [{ prompt: 'Question', options: ['One', 'Two'], correct: 3 }],
  }).success,
);
assert(
  !careerAttemptSchema.safeParse({
    action: 'SUBMIT',
    version: 1,
    answers: { '0': 1 },
    score: 100,
    passed: true,
  }).success,
);
assert(
  !careerAttemptSchema.safeParse({
    action: 'SAVE',
    version: 1,
    answers: { '-1': 1 },
  }).success,
);
assert(
  careerAttemptSchema.safeParse({
    action: 'SAVE',
    version: 2,
    answers: { '0': 1 },
  }).success,
);
assert(!careerOfferReplySchema.safeParse({ response: 'ACCEPTED' }).success);
assert(
  careerOfferReplySchema.safeParse({ response: 'ACCEPTED', version: 2 })
    .success,
);
console.log('Candidate payload validation checks passed');

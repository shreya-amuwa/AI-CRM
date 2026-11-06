import assert from 'node:assert/strict';
import {
  careerProfileSchema,
  careerPostingSchema,
  careerUploadSchema,
  careerTestSchema,
  careerAttemptSchema,
  careerOfferReplySchema,
  careerJobQuerySchema,
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
// Job catalogue: public list filters and the catalogue fields HR can save.
{
  const q = careerJobQuerySchema.parse({});
  assert.deepEqual([q.page, q.search, q.team, q.mode, q.location], [1, '', '', '', '']);
  assert.equal(careerJobQuerySchema.parse({ mode: 'REMOTE', team: ' Design ', page: '2' }).team, 'Design');
  assert.equal(careerJobQuerySchema.parse({ page: '2' }).page, 2);
  for (const bad of [{ mode: 'SOMETIMES' }, { page: 0 }, { page: 10001 }, { team: 'x'.repeat(81) }, { search: 'x'.repeat(121) }])
    assert(!careerJobQuerySchema.safeParse(bad).success, `refused: ${JSON.stringify(bad).slice(0, 40)}`);
  const base = {
    position_id: '11111111-1111-4111-8111-111111111111', title: 'Engineer', description: 'Build the things that matter, together.',
    location: 'Mumbai', employment_type: 'FULL_TIME', published: true, closes_at: null,
  };
  assert(careerPostingSchema.safeParse(base).success, 'an older form (no catalogue fields) still validates');
  assert(careerPostingSchema.safeParse({ ...base, team: 'Engineering', work_mode: 'ONSITE', salary_text: 'Competitive', responsibilities: 'a\nb', benefits: 'c' }).success);
  assert(careerPostingSchema.safeParse({ ...base, team: null, work_mode: null, salary_text: null, responsibilities: null, benefits: null }).success, 'empty values clear a field');
  for (const bad of [{ work_mode: 'SOMETIMES' }, { team: 'x'.repeat(81) }, { salary_text: 'x'.repeat(121) }, { responsibilities: 'x'.repeat(4001) }, { code: 'JOB-9999' }])
    assert(!careerPostingSchema.safeParse({ ...base, ...bad }).success, `refused: ${JSON.stringify(bad).slice(0, 40)}`);
}
console.log('Candidate payload validation checks passed');

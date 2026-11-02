import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
let chromium;
for (const pkg of [
  'playwright',
  '/opt/node-tools/node_modules/playwright',
  'playwright-core',
]) {
  try {
    ({ chromium } = require(pkg));
    break;
  } catch {}
}
if (!chromium) {
  console.log(
    'SKIPPED - Playwright is not installed; candidate portal browser tests did not run',
  );
  process.exit(0);
}
const work = mkdtempSync(path.join(tmpdir(), 'career-ui-'));
const out = path.join(work, 'candidate.js');
execFileSync(
  'npx',
  [
    'esbuild',
    'supabase/tests/ui/candidate_portal_harness.tsx',
    '--bundle',
    '--format=iife',
    '--platform=browser',
    `--outfile=${out}`,
    '--define:import.meta.env={"VITE_SUPABASE_URL":"https://candidate.example.test","VITE_SUPABASE_ANON_KEY":"test-anon-key"}',
    '--jsx=automatic',
    '--log-level=error',
  ],
  { stdio: 'inherit' },
);
const js = readFileSync(out, 'utf8');
const assets = 'dist/assets';
const css = readFileSync(
  path.join(
    assets,
    readdirSync(assets).find((f) => /^index-.*\.css$/.test(f)),
  ),
  'utf8',
);
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
} catch (e) {
  rmSync(work, { recursive: true, force: true });
  console.log('SKIPPED - Chromium could not start:', e.message.split('\n')[0]);
  process.exit(0);
}
let count = 0;
const check = (value, label) => {
  if (!value) throw new Error(label);
  count++;
  console.log('ok -', label);
};
const setup = () => {
  const profile = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'candidate@example.com',
    name: 'Applicant',
    phone: '9847650321',
    city: 'Mumbai',
    state: 'Maharashtra',
    education: 'Graduate',
    experience: 'Fresher',
    skills: 'React',
    bio: '',
    version: 1,
    updated_at: new Date().toISOString(),
  };
  const file = {
    id: '22222222-2222-4222-8222-222222222222',
    file_name: 'resume.pdf',
    size_bytes: 25,
    created_at: new Date().toISOString(),
  };
  const job = {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Product Engineer',
    description: 'Help build thoughtful products for our customers.',
    location: 'Mumbai',
    employment_type: 'FULL_TIME',
    closes_at: null,
  };
  let files = [file];
  let started = false;
  let submitted = false;
  let version = 1;
  let answers = {};
  window.careerCalls = [];
  window.careerSaved = null;
  const respond = (data) =>
    new Response(JSON.stringify({ success: true, data }), {
      headers: { 'content-type': 'application/json' },
    });
  window.fetch = async (input, init = {}) => {
    const url = String(input);
    const method = init.method || 'GET';
    if (url === 'https://upload.example.test')
      return new Response('', { status: 200 });
    const body = init.body ? JSON.parse(init.body) : null;
    window.careerCalls.push({ url, method, body });
    if (url === 'https://upload.example.test')
      return new Response('', { status: 200 });
    if (url.includes('/careers/jobs'))
      return respond({ items: [job], total: 1 });
    if (url.endsWith('/candidate/profile')) {
      if (method === 'PATCH') {
        Object.assign(profile, body, { version: profile.version + 1 });
        window.careerSaved = body;
      }
      return respond(profile);
    }
    if (url.endsWith('/candidate/resumes')) {
      if (method === 'POST')
        return respond({
          file,
          bucket: 'career-resumes',
          path: 'candidate/resume.pdf',
          provider: 'R2',
          upload: { url: 'https://upload.example.test', headers: {} },
        });
      return respond(files);
    }
    if (url.endsWith('/complete')) {
      files = [{ ...file, file_name: 'new-resume.pdf' }];
      return respond({ ...file, status: 'READY' });
    }
    if (url.endsWith('/candidate/applications'))
      return respond({ id: 'application' });
    if (url.endsWith('/candidate/offers'))
      return respond([
        {
          id: 'offer',
          application_id: 'application',
          title: 'Approved offer',
          terms: 'Approved terms for this test candidate.',
          status: 'RELEASED',
          version: 2,
          joining_date: '2027-01-01',
          expires_at: new Date(Date.now() + 3600000).toISOString(),
        },
      ]);
    if (url.includes('/candidate/offers/')) {
      window.careerSaved = body;
      return respond({});
    }
    if (url.endsWith('/candidate/documents')) return respond([]);
    if (url.endsWith('/candidate/training')) return respond([]);
    if (url.endsWith('/candidate/assessments'))
      return respond([
        {
          id: 'test',
          application_id: 'application',
          title: 'Engineering basics',
          duration_minutes: 10,
          question_count: 1,
          available_until: new Date(Date.now() + 3600000).toISOString(),
          started_at: null,
          deadline: null,
          submitted_at: null,
          score: null,
          passed: null,
          version: 1,
        },
      ]);
    if (url.includes('/candidate/assessments/test')) {
      if (body?.action === 'START') started = true;
      if (body?.answers) answers = body.answers;
      if (body?.action === 'SUBMIT') submitted = true;
      version++;
      return respond({
        id: 'test',
        application_id: 'application',
        title: 'Engineering basics',
        version,
        started_at: started ? new Date().toISOString() : null,
        deadline: new Date(Date.now() + 600000).toISOString(),
        server_time: new Date().toISOString(),
        submitted_at: submitted ? new Date().toISOString() : null,
        answers,
        questions: submitted
          ? []
          : [
              {
                prompt: 'Which option is correct?',
                options: ['First option', 'Second option'],
              },
            ],
        passed: submitted ? true : null,
        score: submitted ? 1 : null,
      });
    }
    throw new Error(`Unexpected request ${method} ${url}`);
  };
};
const open = async (screen, width = 1100) => {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.setContent(`<style>${css}</style><div id="root"></div>`);
  await page.evaluate(setup);
  await page.addScriptTag({ content: js });
  await page.evaluate((s) => window.mountCandidate(s), screen);
  return page;
};
try {
  let page = await open('profile');
  await page.getByLabel('Full name').waitFor();
  check(
    (await page.getByLabel('Full name').inputValue()) === 'Applicant',
    'profile prepopulates from the API',
  );
  await page.getByLabel('City', { exact: true }).fill('Pune');
  await page.getByRole('button', { name: 'Save profile' }).click();
  await page.getByText('Profile saved.', { exact: false }).waitFor();
  check(
    await page.evaluate(
      () =>
        window.careerSaved.city === 'Pune' &&
        !('updated_at' in window.careerSaved) &&
        !('id' in window.careerSaved),
    ),
    'profile sends only validated editable fields',
  );
  await page.close();
  page = await open('jobs', 390);
  await page.getByRole('button', { name: 'View role & apply' }).click();
  await page
    .getByLabel('Resume to submit')
    .selectOption('22222222-2222-4222-8222-222222222222');
  await page.getByRole('button', { name: 'Submit application' }).click();
  await page.waitForFunction(() => document.body.dataset.applied === 'yes');
  check(
    await page.evaluate(() =>
      window.careerCalls.some(
        (c) =>
          c.method === 'POST' &&
          c.body?.posting_id === '33333333-3333-4333-8333-333333333333',
      ),
    ),
    'application submits the selected job and resume',
  );
  await page.close();
  page = await open('resumes');
  await page
    .getByLabel('Upload PDF resume')
    .setInputFiles({
      name: 'new-resume.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 resume test'),
    });
  await page.getByText('new-resume.pdf', { exact: true }).waitFor();
  check(
    await page.evaluate(() =>
      window.careerCalls.some((c) => c.url.endsWith('/complete')),
    ),
    'resume upload completes verification before showing the new version',
  );
  await page.close();
  page = await open('assessments', 390);
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Start assessment' }).click();
  await page.getByText('Which option is correct?').waitFor();
  await page.getByLabel('Second option').check();
  await page.waitForFunction(() =>
    window.careerCalls.some(
      (c) => c.body?.action === 'SAVE' && c.body.answers['0'] === 1,
    ),
  );
  await page.getByRole('button', { name: 'Submit assessment' }).click();
  await page.getByText('Assessment submitted', { exact: true }).waitFor();
  check(
    await page.evaluate(() =>
      window.careerCalls.some((c) => c.body?.action === 'SUBMIT'),
    ),
    'test answer is saved and final submission acknowledged',
  );
  check(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    'assessment fits a mobile viewport',
  );
  await page.close();
  page = await open('offers');
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Accept offer' }).click();
  await page.waitForFunction(() => window.careerSaved?.response === 'ACCEPTED');
  check(
    await page.evaluate(() => window.careerSaved.version === 2),
    'offer acceptance identifies the exact released version',
  );
  await page.close();
  page = await open('training');
  await page
    .getByText('Training becomes available', { exact: false })
    .waitFor();
  check(true, 'training has an honest empty state without demo trainees');
  await page.close();
  console.log(`=== CANDIDATE PORTAL BROWSER CHECKS PASSED (${count}) ===`);
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}

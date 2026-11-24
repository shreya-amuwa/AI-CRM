-- =============================================================================
-- Role-based Offer Letter templates (docs/HR_DOCUMENTS.md, "Role-based Offer Letters"). Run after 20270205000100_notice_board_delete.sql.
-- Additive and safe to run twice; needs 20261231000600_hr_letter_templates.sql (the Offer Letter documents).
--
-- HR > Offer Letter Generation: HR chooses the designation, the matching template loads with its own fields, letterhead and wording; the
-- server draws the PDF and stores it against the employee (public.hr_documents, as the other HR letters).
--
--   hr_offer_templates            one per designation (Technical Support, Customer Support, ...; more can be added)
--   hr_offer_template_versions    the versions of a template: wording + fields (content), letterhead, the sample document; never changed
--   hr_offer_template_files       uploaded sample documents and letterhead PDFs (private storage, bucket hr-documents)
--   hr_documents                  + offer_template_id / offer_template_version: the template version an issued letter was made from
--
-- Version 1 of the five initial templates is the wording of the samples HR supplied (shared/offerTemplates.ts INITIAL_OFFER_TEMPLATES).
-- Replacing a template adds a version; new letters use the newest; an issued letter is a stored PDF and never changes.
--
-- Who: HR staff (not HR Recruiters) read templates and generate letters (private.hr_doc_require_staff); only the Super Admin and the HR Admin
-- Head (private.is_hr_leadership) add, replace or upload templates. The tables have RLS on and no grants.
-- =============================================================================

create table if not exists public.hr_offer_template_files (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('SAMPLE', 'LETTERHEAD')),
  file_name text not null check (length(btrim(file_name)) between 1 and 200),
  mime_type text not null check (mime_type in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes integer not null check (size_bytes between 1 and 5242880),
  storage_provider text not null default 'SUPABASE' check (storage_provider in ('SUPABASE', 'R2')),
  storage_bucket text not null,
  storage_path text not null unique,
  storage_ref text,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid references public.profiles (id) on delete set null,
  uploaded_by_name text,
  created_at timestamptz not null default now(),
  check (kind <> 'LETTERHEAD' or mime_type = 'application/pdf')
);

create table if not exists public.hr_offer_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique check (template_key ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  designation text not null check (length(btrim(designation)) between 2 and 80),
  description text check (length(description) <= 300),
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists hr_offer_templates_designation_idx on public.hr_offer_templates (lower(btrim(designation)));

create table if not exists public.hr_offer_template_versions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.hr_offer_templates (id) on delete restrict,
  version integer not null check (version >= 1),
  content jsonb not null check (jsonb_typeof(content) = 'object' and jsonb_typeof(content -> 'blocks') = 'array'
                                and jsonb_typeof(content -> 'fields') = 'array' and jsonb_typeof(content -> 'dateLine') = 'object'),
  letterhead jsonb not null check (jsonb_typeof(letterhead) = 'object' and (letterhead ? 'builtin' or letterhead ? 'fileId')),
  sample_file_id uuid references public.hr_offer_template_files (id) on delete restrict,
  note text check (length(note) <= 200),
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (template_id, version)
);

alter table public.hr_documents add column if not exists offer_template_id uuid references public.hr_offer_templates (id) on delete restrict;
alter table public.hr_documents add column if not exists offer_template_version integer;
create index if not exists hr_documents_offer_template_idx on public.hr_documents (offer_template_id, created_at desc) where offer_template_id is not null;

alter table public.hr_offer_template_files enable row level security;
alter table public.hr_offer_templates enable row level security;
alter table public.hr_offer_template_versions enable row level security;
revoke all on public.hr_offer_template_files, public.hr_offer_templates, public.hr_offer_template_versions from public, anon, authenticated;

-- a version is a record of what was issued: it is never changed or deleted
create or replace function private.tg_hr_offer_template_versions_frozen()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'FORBIDDEN: A template version cannot be changed. Save a new version instead.' using errcode = '42501';
end $$;
drop trigger if exists hr_offer_template_versions_frozen on public.hr_offer_template_versions;
create trigger hr_offer_template_versions_frozen before update or delete on public.hr_offer_template_versions
  for each row execute function private.tg_hr_offer_template_versions_frozen();

-- ---------------------------------------------------------------------------
-- The five supplied samples (version 1). Inserted once; a later run leaves every template and version as it is.
-- ---------------------------------------------------------------------------
do $seed$
declare
  r record;
  v_id uuid;
begin
  for r in
    select * from jsonb_to_recordset($json$[{"key":"technical-support","designation":"Technical Support","description":"Offer Letter – Technical Support Executive (Amuwa Corporation).","sortOrder":1,"letterhead":{"builtin":"technical-support"},"content":{"dateLine":{"right":"Date: {letterDate}"},"fields":[{"key":"letterDate","label":"Offer date","type":"date","required":true,"source":"today"},{"key":"employeeName","label":"Employee name","type":"text","required":true,"source":"employeeName"},{"key":"designation","label":"Designation","type":"text","required":true,"default":"Technical Support Executive"},{"key":"department","label":"Department","type":"text","required":true,"source":"department"},{"key":"joiningDate","label":"Date of joining","type":"date","required":true,"source":"joiningDate"},{"key":"salary","label":"Salary per month (₹)","type":"money","required":true,"source":"monthlySalary","help":"Whole rupees, for example 18000."},{"key":"employmentType","label":"Employment type","type":"text","required":true,"default":"Full-Time"},{"key":"workingHours","label":"Working hours","type":"text","required":true,"default":"As per company policy"},{"key":"probation","label":"Probation period","type":"text","required":true,"default":"6 Months"},{"key":"reportingTo","label":"Reporting to","type":"text","required":true,"default":"Team Leader"},{"key":"signatoryName","label":"Signatory","type":"text","required":true,"default":"Miss Aarti Kalange"}],"blocks":[{"type":"title","text":"OFFER LETTER"},{"type":"paragraph","text":"**Subject:** Offer Letter for the Position of **{designation}**","align":"center"},{"type":"paragraph","text":"**Dear {employeeName},**"},{"type":"paragraph","text":"With reference to your application and our discussions, we are pleased to offer you the position of **{designation}** in the {department} Department at Amuwa Corporation, effective from {joiningDate}."},{"type":"paragraph","text":"In this role, you will be responsible for providing technical assistance, resolving system-related issues, and ensuring smooth operational support for Wabastore.","tight":true},{"type":"heading","text":"Key Responsibilities"},{"type":"bullets","items":["Providing technical support for systems, tools, and platforms used by the team","Resolving technical issues related to orders, dashboards, and internal processes","Assisting in troubleshooting customer-related technical concerns","Coordinating with internal teams for issue resolution","Maintaining system records and technical documentation","Ensuring smooth functioning of day-to-day technical operations","Supporting team members with basic technical guidance"]},{"type":"heading","text":"Employment Terms"},{"type":"bullets","items":["Designation: {designation}","Department: {department}","Employment Type: {employmentType}","Date of Joining: {joiningDate}","Salary: ₹{salary}/- per month (Fixed)","Working Hours: {workingHours}","Probation Period: {probation}","Reporting To: {reportingTo}"]},{"type":"paragraph","text":"This offer is subject to your acceptance and adherence to company policies, rules, and regulations."},{"type":"paragraph","text":"We look forward to your contribution and a successful association with Amuwa Corporation.","tight":true},{"type":"paragraph","text":"**For Amuwa Corporation,**"},{"type":"paragraph","text":"**Name:- {signatoryName}**"},{"type":"signature","label":"**Signature:-**"},{"type":"heading","text":"Acceptance"},{"type":"paragraph","text":"I, **{employeeName}**, hereby accept the offer for the position of {designation} at Amuwa Corporation and agree to abide by all the terms and conditions mentioned above.","tight":true},{"type":"signature","label":"**Signature:**"},{"type":"signature","label":"**Date:**"}]}},{"key":"customer-support","designation":"Customer Support","description":"Appointment Letter – Customer Support Executive, with Annexure A – Company Policies (Amuwa Corporation).","sortOrder":2,"letterhead":{"builtin":"customer-support"},"content":{"dateLine":{"right":"Date: {letterDate}"},"fields":[{"key":"letterDate","label":"Offer date","type":"date","required":true,"source":"today"},{"key":"title","label":"Title","type":"select","required":true,"options":["Mr.","Ms.","Mrs.","Miss"],"help":"Printed before the name (the sample letter has \"Ms.\"). Never guessed from the name."},{"key":"employeeName","label":"Employee name","type":"text","required":true,"source":"employeeName"},{"key":"designation","label":"Designation","type":"text","required":true,"default":"Customer Support Executive"},{"key":"joiningDate","label":"Date of joining","type":"date","required":true,"source":"joiningDate"},{"key":"salary","label":"Salary per month (₹)","type":"money","required":true,"source":"monthlySalary","help":"Whole rupees, for example 18000."},{"key":"signatoryName","label":"Signatory","type":"text","required":true,"default":"Miss.Aarti Kalange"},{"key":"annexureSignatoryName","label":"Signatory (Annexure A)","type":"text","required":true,"default":"Mrs.Aarti Kalange"}],"blocks":[{"type":"title","text":"APPOINTMENT LETTER"},{"type":"paragraph","text":"We are pleased to appoint {title} {employeeName} as {designation} with Amuwa Corporation, effective from {joiningDate}, on the following terms and conditions:"},{"type":"heading","text":"1. Designation","plain":true},{"type":"paragraph","text":"You are appointed as {designation}. Your duties will include customer communication, query handling, client follow-ups, complaint resolution, service coordination, and any other tasks assigned related to your role.","tight":true},{"type":"heading","text":"2. Date of Joining","plain":true},{"type":"paragraph","text":"Your Date of Joining (DOJ) shall be {joiningDate}","tight":true},{"type":"heading","text":"3. Salary","plain":true},{"type":"paragraph","text":"You will be paid a consolidated salary of ₹{salary}/- (Rupees {salaryWords} Only) per month.","tight":true},{"type":"heading","text":"4. Roles & Responsibilities:","plain":true},{"type":"bullets","items":["Handle customer inquiries through calls, messages, email, and other channels","Resolve customer queries professionally and in a timely manner","Maintain customer records and follow-up updates","Coordinate with internal teams for smooth service delivery","Handle complaints politely and ensure customer satisfaction","Assist clients with product/service information and support","Maintain daily reports of customer interactions and feedback","Ensure professional communication standards at all times"]},{"type":"heading","text":"5. Probation Period","plain":true},{"type":"bullets","items":["You will be on probation for a period of six (6) months from your date of joining.","Your confirmation after probation shall depend upon satisfactory performance, discipline, attendance, and management approval. (Refer- Annexure A )"]},{"type":"heading","text":"6. Working Hours & Attendance","plain":true},{"type":"bullets","items":["You shall follow the official office timings and maintain punctuality.Attendance, late marks, half-day deductions, and discipline rules shall be applicable as per Company Policy(Refer-Annexure A )"]},{"type":"heading","text":"7. Leave Policy","plain":true},{"type":"bullets","items":["Your leave entitlement, paid leave rules, leave without pay, sandwich leave, encashment, and approval process shall be governed strictly as per Company Policy"]},{"type":"paragraph","text":"(Refer- Annexure A )","tight":true},{"type":"heading","text":"8. Increment / Incentive","plain":true},{"type":"bullets","items":["Any salary increment, bonus, incentive, or performance reward shall be entirely based on management discretion and performance review. (Refer- Annexure A )"]},{"type":"heading","text":"9. Confidentiality","plain":true},{"type":"bullets","items":["You shall maintain complete confidentiality regarding client data, passwords, pricing, creative files, leads, internal processes, and business information.","Any breach shall invite disciplinary/legal action. (Refer- Annexure A )"]},{"type":"heading","text":"10. Company Assets","plain":true},{"type":"bullets","items":["Any company equipment, software login, mobile, laptop, camera, accessories, or tools issued to you must be handled responsibly and returned upon separation."]},{"type":"heading","text":"11. Transfer / Additional Duties","plain":true},{"type":"bullets","items":["The company reserves the right to assign additional responsibilities or modify job duties based on business requirements."]},{"type":"heading","text":"12. Termination / Separation","plain":true},{"type":"bullets","items":["Your employment may be terminated by either side by serving notice period as applicable","(Refer- Annexure A )"]},{"type":"paragraph","text":"Full & Final Settlement shall be subject to handover of work, assets, passwords, and pending dues.","tight":true},{"type":"heading","text":"13. Acceptance","plain":true},{"type":"bullets","items":["Please sign and return a copy of this letter as a token of your acceptance of the above terms."]},{"type":"paragraph","text":"We welcome you to Amuwa Corporation and wish you a successful career with us."},{"type":"paragraph","text":"Regards,"},{"type":"paragraph","text":"Amuwa Corporation","tight":true},{"type":"paragraph","text":"{signatoryName}","tight":true},{"type":"signature","label":"Signature:"},{"type":"paragraph","text":"Employee Acceptance"},{"type":"paragraph","text":"I, {title} {employeeName} accept the above appointment terms and agree to follow company rules.","tight":true},{"type":"signature","label":"Employee Signature:"},{"type":"signature","label":"Name:"},{"type":"signature","label":"Date:"},{"type":"pageBreak"},{"type":"paragraph","text":"ANNEXURE A – Company Policies (Part of Appointment Letter)","align":"center"},{"type":"heading","text":"1. Leave Policy","plain":true},{"type":"paragraph","text":"Purpose This policy outlines the leave structure applicable to employees of the company and ensures consistency, transparency, and fairness in leave management.","tight":true},{"type":"heading","text":"Probation Period","plain":true},{"type":"bullets","items":["All newly hired employees will be on probation for six (6) months from their date of joining.","During this period, employees’ performance, attendance, discipline, and suitability for permanent employment will be evaluated.","If total leaves / absenteeism during probation is 15 days or more, probation will be extended by one (1) month."]},{"type":"heading","text":"Leave During Probation","plain":true},{"type":"bullets","items":["No paid leave during probation.","Any leave availed will be treated as Leave Without Pay (LWP).","Excessive absenteeism may impact confirmation."]},{"type":"heading","text":"Confirmation","plain":true},{"type":"bullets","items":["Upon successful completion of probation, employees may be confirmed subject to satisfactory performance and management approval."]},{"type":"heading","text":"Leave After Confirmation","plain":true},{"type":"bullets","items":["Confirmed employees are entitled to two (2) paid leaves per month.","Paid leave is credited monthly.","If absenteeism in a particular month is more than 10 days, only one (1) paid leave will be credited for that month."]},{"type":"heading","text":"Carry Forward Rule","plain":true},{"type":"bullets","items":["No leaves will be carried forward to the next calendar year.","Any leave balance more than 50% of total yearly entitled leaves will automatically lapse."]},{"type":"heading","text":"Leave Encashment","plain":true},{"type":"bullets","items":["Up to 50% of total yearly entitled paid leaves may be eligible for encashment.","Encashment shall be processed annually or during Full & Final Settlement, subject to management approval."]},{"type":"heading","text":"Sandwich Leave Policy","plain":true},{"type":"bullets","items":["If an employee remains absent immediately before and after weekly off / public holiday without approval, intervening holiday(s) may be counted as leave.","Applicability shall be subject to management review."]},{"type":"heading","text":"Leave Approval Process","plain":true},{"type":"bullets","items":["Planned leaves must be applied in advance and approved by reporting manager.","Leave requests are subject to work requirements."]},{"type":"heading","text":"Emergency Leave","plain":true},{"type":"bullets","items":["Employees must inform the reporting manager at the earliest possible time. Such requests will be reviewed case-by-case."]},{"type":"heading","text":"General Conditions","plain":true},{"type":"bullets","items":["Unauthorized absence may lead to disciplinary action.","Habitual absenteeism may affect increment, incentives, confirmation, or continuation.","Company reserves the right to amend this policy."]},{"type":"heading","text":"2. Increment Policy","plain":true},{"type":"bullets","items":["Salary increments are performance-based and not automatic.","The increment will take place annually .","Performance, discipline, attendance, quality of work, and contribution will be considered.","Employees with poor attendance or warnings may not be eligible."]},{"type":"heading","text":"3. Bonus / Incentive Policy","plain":true},{"type":"bullets","items":["Incentives / bonuses may be monthly, quarterly, yearly, or project-based.","Incentives depend on targets, punctuality, productivity, revenue generation, and client satisfaction.","Incentives are not part of fixed salary.","Final decision remains with management."]},{"type":"heading","text":"4. Code of Conduct Policy","plain":true},{"type":"bullets","items":["Maintain professionalism, discipline, punctuality, and respectful behavior.","Misconduct or misuse of company reputation/data may invite action."]},{"type":"heading","text":"5. Attendance & Working Hours Policy","plain":true},{"type":"bullets","items":["Employees must follow official office timings.","Repeated late coming or attendance issues may lead to deductions or disciplinary action.","Late marks beyond three (3) in a month will lead to one half-day present / deduction as per payroll policy.","Attendance must be maintained through approved system/register."]},{"type":"heading","text":"6. Confidentiality Policy","plain":true},{"type":"bullets","items":["Company data, passwords, client information, pricing, creatives, leads, and internal systems are confidential.","Unauthorized sharing may lead to termination and legal action."]},{"type":"heading","text":"7. Asset / Equipment Policy","plain":true},{"type":"bullets","items":["Company-issued laptop, mobile, camera, accessories, SIM, software login, or other assets must be used responsibly.","Damage due to negligence may be recovered from employee."]},{"type":"heading","text":"8. Separation / Notice Period Policy","plain":true},{"type":"bullets","items":["Employees must serve notice period as mentioned Below.","During Probition Period -5 Day’s","After Confirmation- 2 Months","Pending dues, assets handover, and work handover are mandatory before Full & Final Settlement."]},{"type":"paragraph","text":"**Declaration**"},{"type":"paragraph","text":"I have read, understood, and agreed to abide by the above Annexure A policies.","tight":true},{"type":"signature","label":"Employee Signature:"},{"type":"signature","label":"Name:"},{"type":"signature","label":"Date:"},{"type":"paragraph","text":"For Amuwa Corporation"},{"type":"paragraph","text":"{annexureSignatoryName}","tight":true},{"type":"signature","label":"Signature:"}]}},{"key":"business-development","designation":"Business Development Executive","description":"Offer Letter – Business Development Executive (BDE), on the M Pillar Corporation letterhead.","sortOrder":3,"letterhead":{"builtin":"business-development"},"content":{"dateLine":{"left":"REF-NO:{refNo}","right":"Date: {letterDate}"},"fields":[{"key":"refNo","label":"Reference number","type":"text","required":true,"help":"Printed after \"REF-NO:\", for example MPL/OFFER/2026/07."},{"key":"letterDate","label":"Offer date","type":"date","required":true,"source":"today"},{"key":"employeeName","label":"Employee name","type":"text","required":true,"source":"employeeName"},{"key":"designation","label":"Designation","type":"text","required":true,"default":"Business Development Executive"},{"key":"department","label":"Department","type":"text","required":true,"source":"department"},{"key":"joiningDate","label":"Date of joining","type":"date","required":true,"source":"joiningDate"},{"key":"salary","label":"Salary per month (₹)","type":"money","required":true,"source":"monthlySalary","help":"Whole rupees, for example 18000."},{"key":"employmentType","label":"Employment type","type":"text","required":true,"default":"Full-Time"},{"key":"workingHours","label":"Working hours","type":"text","required":true,"default":"As per company policy"},{"key":"probation","label":"Probation period","type":"text","required":true,"default":"6 Months"},{"key":"reportingTo","label":"Reporting to","type":"text","required":true,"default":"Team Leader"},{"key":"signatoryName","label":"Signatory","type":"text","required":true,"default":"Reshma Wadhavane (CEO)"}],"blocks":[{"type":"title","text":"OFFER LETTER"},{"type":"paragraph","text":"**Subject:** Offer Letter for the Position of **{designation}**","align":"center"},{"type":"paragraph","text":"Dear **{employeeName}**,"},{"type":"paragraph","text":"With reference to your application and our discussions, we are pleased to offer you the position of {designation} (BDE) in the at M Pillar Corporation, effective from {joiningDate}."},{"type":"paragraph","text":"In this role, you will be responsible for driving business growth, generating leads, and contributing to the overall sales performance Of M pillar Corporation.","tight":true},{"type":"heading","text":"Key Responsibilities"},{"type":"bullets","items":["Identifying and generating new business opportunities","Handling customer inquiries and converting leads into sales","Maintaining relationships with existing and potential clients","Coordinating with the marketing and support team","Achieving monthly sales targets and revenue goals","Assisting in planning and executing sales strategies","Maintaining proper records of leads and conversions"]},{"type":"heading","text":"Employment Terms"},{"type":"bullets","items":["Designation: {designation} (BDE)","Department: {department}","Employment Type: {employmentType}","Date of Joining: {joiningDate}","Salary: ₹{salary}/- per month (Fixed)","Working Hours: {workingHours}","Probation Period: {probation}","Reporting To: {reportingTo}"]},{"type":"paragraph","text":"This offer is subject to your acceptance and adherence to company policies, rules, and regulations."},{"type":"paragraph","text":"We look forward to your contribution and a successful association with M-Pillar Corporation.","tight":true},{"type":"paragraph","text":"**For M-Pillar Corporation,**"},{"type":"paragraph","text":"**Name:- {signatoryName}**"},{"type":"signature","label":"**Signature:-**"},{"type":"heading","text":"Acceptance"},{"type":"paragraph","text":"I, **{employeeName}**, hereby accept the offer for the position of {designation} at M-Pillar Corporation and agree to abide by all the terms and conditions mentioned above.","tight":true},{"type":"signature","label":"**Signature:**"},{"type":"signature","label":"**Date:**"}]}},{"key":"sales-executive","designation":"Sales Executive","description":"Offer Letter – Sales Executive (Amuwa Corporation, Wabastore).","sortOrder":4,"letterhead":{"builtin":"sales-executive"},"content":{"dateLine":{"right":"Date: {letterDate}"},"fields":[{"key":"letterDate","label":"Offer date","type":"date","required":true,"source":"today"},{"key":"employeeName","label":"Employee name","type":"text","required":true,"source":"employeeName"},{"key":"designation","label":"Designation","type":"text","required":true,"default":"Sales Executive"},{"key":"department","label":"Department","type":"text","required":true,"source":"department"},{"key":"joiningDate","label":"Date of joining","type":"date","required":true,"source":"joiningDate"},{"key":"salary","label":"Salary per month (₹)","type":"money","required":true,"source":"monthlySalary","help":"Whole rupees, for example 18000."},{"key":"employmentType","label":"Employment type","type":"text","required":true,"default":"Full-Time"},{"key":"workingHours","label":"Working hours","type":"text","required":true,"default":"As per company policy"},{"key":"probation","label":"Probation period","type":"text","required":true,"default":"6 Months"},{"key":"reportingTo","label":"Reporting to","type":"text","required":true,"default":"Team Leader and Department Head"},{"key":"signatoryName","label":"Signatory","type":"text","required":true,"default":"Miss. Aarti Kalange (CEO)"}],"blocks":[{"type":"title","text":"OFFER LETTER"},{"type":"paragraph","text":"**Subject:** Offer Letter for the Position of **{designation}**","align":"center"},{"type":"paragraph","text":"Dear **{employeeName}**,"},{"type":"paragraph","text":"With reference to your application and our discussions, we are pleased to offer you the position of **{designation}** at Amuwa Corporation, effective from {joiningDate}."},{"type":"paragraph","text":"In this role, you will be responsible for generating sales, building strong customer relationships, and representing the company in the assigned territory.","tight":true},{"type":"heading","text":"Key Responsibilities"},{"type":"bullets","items":["Visit existing and potential customers within the assigned territory on a daily basis.","Generate new business opportunities through field visits, referrals, and lead generation activities.","Promote and explain the company's products and services to prospective customers.","Conduct product demonstrations and presentations when required.","Meet daily, weekly, and monthly sales targets assigned by the management.","Develop and maintain strong relationships with customers to ensure repeat business.","Follow up with leads and convert inquiries into successful sales..","Travel within the assigned territory as required for business development and client meetings.","Comply with all company policies, procedures, and safety guidelines."]},{"type":"heading","text":"Employment Terms"},{"type":"bullets","items":["Designation: {designation}","Department: {department}","Employment Type: {employmentType}","Date of Joining: {joiningDate}","Salary: ₹{salary}/- per month (Fixed)","Working Hours: {workingHours}","Probation Period: {probation}","Reporting To: {reportingTo}"]},{"type":"paragraph","text":"This offer is subject to your acceptance and adherence to company policies, rules, and regulations."},{"type":"paragraph","text":"We look forward to your contribution and a successful association with Amuwa Corporation.","tight":true},{"type":"paragraph","text":"**For Amuwa Corporation,**"},{"type":"paragraph","text":"**Name:- {signatoryName}**"},{"type":"signature","label":"**Signature:-**"},{"type":"heading","text":"Acceptance"},{"type":"paragraph","text":"I **{employeeName}**, hereby accept the offer for the position of {designation} at Amuwa Corporation and agree to abide by all the terms and conditions mentioned above.","tight":true},{"type":"signature","label":"**Signature:**"},{"type":"signature","label":"**Date:**"}]}},{"key":"ai-developer","designation":"AI Developer","description":"Offer Letter – Ai Developer Intern (Amuwa Corporation, AI Studio).","sortOrder":5,"letterhead":{"builtin":"ai-developer"},"content":{"dateLine":{"right":"Date: {letterDate}"},"fields":[{"key":"letterDate","label":"Offer date","type":"date","required":true,"source":"today"},{"key":"employeeName","label":"Employee name","type":"text","required":true,"source":"employeeName"},{"key":"designation","label":"Designation","type":"text","required":true,"default":"Ai Developer Intern"},{"key":"department","label":"Department","type":"text","required":true,"default":"Ai Studio"},{"key":"joiningDate","label":"Date of joining","type":"date","required":true,"source":"joiningDate"},{"key":"salary","label":"Salary per month (₹)","type":"money","required":true,"source":"monthlySalary","help":"Whole rupees, for example 18000."},{"key":"employmentType","label":"Employment type","type":"text","required":true,"default":"Full-Time"},{"key":"workingHours","label":"Working hours","type":"text","required":true,"default":"As per company policy"},{"key":"probation","label":"Probation period","type":"text","required":true,"default":"6 Months"},{"key":"reportingTo","label":"Reporting to","type":"text","required":true,"default":"Team Leader"},{"key":"signatoryName","label":"Signatory","type":"text","required":true,"default":"Mr. Amol Kamble"}],"blocks":[{"type":"title","text":"OFFER LETTER"},{"type":"paragraph","text":"**Subject:** Offer Letter for the Position of **{designation}**","align":"center"},{"type":"paragraph","text":"Dear {employeeName},"},{"type":"paragraph","text":"With reference to your application and our discussions, we are pleased to offer you the position of **{designation}** at Amuwa Corporation, effective from {joiningDate}."},{"type":"paragraph","text":"In this role, you will support the AI development team in building, testing, improving, and implementing AI-based solutions and applications while gaining practical experience in AI and software development.","tight":true},{"type":"heading","text":"Key Responsibilities"},{"type":"bullets","items":["Assisting in building, training, and fine-tuning machine learning and AI models.","Integrating AI/LLM solutions into company products and platforms.","Writing clean, maintainable, and efficient code for software modules.","Collaborating with engineering and product teams to design technical workflows.","Testing, debugging, and optimizing existing algorithm performance.","Maintaining technical documentation and reporting weekly progress."]},{"type":"heading","text":"Employment Terms"},{"type":"bullets","items":["Designation: {designation}","Department: {department}","Employment Type: {employmentType}","Date of Joining : {joiningDate}","Salary: ₹{salary}/- per month (Fixed)","Working Hours: {workingHours}","Probation Period: {probation}","Reporting To: {reportingTo}"]},{"type":"paragraph","text":"This offer is subject to your acceptance and adherence to company policies, rules, and regulations."},{"type":"paragraph","text":"We look forward to your contribution and a successful association with Amuwa Corporation.","tight":true},{"type":"paragraph","text":"**For Amuwa Corporation,**"},{"type":"paragraph","text":"**Name:- {signatoryName}**"},{"type":"signature","label":"**Signature:-**"},{"type":"heading","text":"Acceptance"},{"type":"paragraph","text":"I, **{employeeName},** hereby accept the offer for the position of {designation} at Amuwa Corporation and agree to abide by all the terms and conditions mentioned above.","tight":true},{"type":"signature","label":"**Signature:**"},{"type":"signature","label":"**Date:**"}]}}]$json$::jsonb)
      as t(key text, designation text, description text, "sortOrder" integer, letterhead jsonb, content jsonb)
  loop
    insert into public.hr_offer_templates (template_key, designation, description, sort_order)
    values (r.key, r.designation, r.description, r."sortOrder")
    on conflict (template_key) do nothing;
    select id into v_id from public.hr_offer_templates where template_key = r.key;
    insert into public.hr_offer_template_versions (template_id, version, content, letterhead, note, created_by_name)
    values (v_id, 1, r.content, r.letterhead, 'The supplied sample', 'HR (supplied sample)')
    on conflict (template_id, version) do nothing;
  end loop;
end $seed$;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function private.offer_tpl_require_manager()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_hr_leadership() then
    raise exception 'FORBIDDEN: Only the Super Admin and the HR Admin Head add or replace offer letter templates.' using errcode = '42501';
  end if;
end $$;
revoke all on function private.offer_tpl_require_manager() from public, anon;
grant execute on function private.offer_tpl_require_manager() to authenticated, service_role;

create or replace function private.offer_tpl_file_json(f public.hr_offer_template_files)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when f.id is null then null else jsonb_build_object(
    'id', f.id, 'kind', f.kind, 'fileName', f.file_name, 'mimeType', f.mime_type, 'sizeBytes', f.size_bytes,
    'uploadedBy', f.uploaded_by_name, 'createdAt', f.created_at) end
$$;

create or replace function private.offer_tpl_version_json(v public.hr_offer_template_versions, p_with_content boolean default true)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'templateId', v.template_id, 'version', v.version, 'letterhead', v.letterhead,
    'sampleFile', (select private.offer_tpl_file_json(f) from public.hr_offer_template_files f where f.id = v.sample_file_id),
    'letterheadFile', (select private.offer_tpl_file_json(f) from public.hr_offer_template_files f where f.id::text = v.letterhead ->> 'fileId'),
    'note', v.note, 'createdBy', v.created_by_name, 'createdAt', v.created_at)
    || case when p_with_content then jsonb_build_object('content', v.content) else '{}'::jsonb end
$$;

create or replace function private.offer_tpl_json(t public.hr_offer_templates)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'key', t.template_key, 'designation', t.designation, 'description', t.description, 'sortOrder', t.sort_order,
    'active', t.is_active, 'updatedAt', t.updated_at,
    'versionCount', (select count(*) from public.hr_offer_template_versions v where v.template_id = t.id),
    'current', (select private.offer_tpl_version_json(v) from public.hr_offer_template_versions v where v.template_id = t.id order by v.version desc limit 1),
    'issued', (select count(*) from public.hr_documents d where d.offer_template_id = t.id))
$$;
revoke all on function private.offer_tpl_file_json(public.hr_offer_template_files), private.offer_tpl_version_json(public.hr_offer_template_versions, boolean),
  private.offer_tpl_json(public.hr_offer_templates) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reading (HR staff)
-- ---------------------------------------------------------------------------
create or replace function public.hr_offer_templates_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.hr_doc_require_staff();
  return jsonb_build_object(
    'canManage', private.is_hr_leadership(),
    'templates', coalesce((select jsonb_agg(private.offer_tpl_json(t) order by t.sort_order, lower(t.designation))
                             from public.hr_offer_templates t), '[]'::jsonb));
end $$;
revoke all on function public.hr_offer_templates_list() from public, anon;
grant execute on function public.hr_offer_templates_list() to authenticated;

create or replace function public.hr_offer_template_versions(p_template uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.hr_offer_templates;
begin
  perform private.hr_doc_require_staff();
  select * into t from public.hr_offer_templates where id = p_template;
  if t.id is null then raise exception 'NOT_FOUND: That offer letter template does not exist.' using errcode = 'P0001'; end if;
  return private.offer_tpl_json(t) || jsonb_build_object(
    'versions', coalesce((select jsonb_agg(private.offer_tpl_version_json(v, false) || jsonb_build_object(
                                     'issued', (select count(*) from public.hr_documents d where d.offer_template_id = t.id and d.offer_template_version = v.version))
                                   order by v.version desc)
                            from public.hr_offer_template_versions v where v.template_id = t.id), '[]'::jsonb));
end $$;
revoke all on function public.hr_offer_template_versions(uuid) from public, anon;
grant execute on function public.hr_offer_template_versions(uuid) to authenticated;

create or replace function public.hr_offer_template_version(p_template uuid, p_version integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  t public.hr_offer_templates;
  v public.hr_offer_template_versions;
begin
  perform private.hr_doc_require_staff();
  select * into t from public.hr_offer_templates where id = p_template;
  select * into v from public.hr_offer_template_versions where template_id = p_template and version = p_version;
  if t.id is null or v.id is null then raise exception 'NOT_FOUND: That template version does not exist.' using errcode = 'P0001'; end if;
  return private.offer_tpl_version_json(v) || jsonb_build_object('key', t.template_key, 'designation', t.designation);
end $$;
revoke all on function public.hr_offer_template_version(uuid, integer) from public, anon;
grant execute on function public.hr_offer_template_version(uuid, integer) to authenticated;

-- an uploaded file: for the server (it opens the stored object to draw a letterhead, or makes a short-lived link to a sample)
create or replace function public.hr_offer_template_file(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  f public.hr_offer_template_files;
begin
  perform private.hr_doc_require_staff();
  select * into f from public.hr_offer_template_files where id = p_id;
  if f.id is null then raise exception 'NOT_FOUND: That file does not exist.' using errcode = 'P0001'; end if;
  return private.offer_tpl_file_json(f) || jsonb_build_object('storageProvider', f.storage_provider, 'storageBucket', f.storage_bucket, 'storagePath', f.storage_path);
end $$;
revoke all on function public.hr_offer_template_file(uuid) from public, anon;
grant execute on function public.hr_offer_template_file(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Managing (Super Admin, HR Admin Head)
-- ---------------------------------------------------------------------------
-- called by the server after it stored an uploaded sample / letterhead (the server checked the file's real type and size)
create or replace function public.hr_offer_template_file_record(
  p_kind text, p_file_name text, p_mime text, p_size integer, p_provider text, p_bucket text, p_path text, p_ref text, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  f public.hr_offer_template_files;
begin
  perform private.offer_tpl_require_manager();
  if p_kind not in ('SAMPLE', 'LETTERHEAD') then
    raise exception 'VALIDATION_ERROR: Choose a sample document or a letterhead.' using errcode = 'P0001';
  end if;
  if p_kind = 'LETTERHEAD' and p_mime is distinct from 'application/pdf' then
    raise exception 'VALIDATION_ERROR: A letterhead must be a PDF.' using errcode = 'P0001';
  end if;
  if p_mime not in ('application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') then
    raise exception 'VALIDATION_ERROR: Upload a PDF or a Word (.docx) file.' using errcode = 'P0001';
  end if;
  if p_size is null or p_size < 1 or p_size > 5242880 then
    raise exception 'VALIDATION_ERROR: The file must be at most 5 MB.' using errcode = 'P0001';
  end if;
  if p_bucket is distinct from 'hr-documents' or p_path is null or p_path !~ '^offer-templates/' or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_ERROR: The stored file reference is not valid.' using errcode = 'P0001';
  end if;
  insert into public.hr_offer_template_files (kind, file_name, mime_type, size_bytes, storage_provider, storage_bucket, storage_path, storage_ref, sha256,
                                              uploaded_by, uploaded_by_name)
  values (p_kind, left(btrim(p_file_name), 200), p_mime, p_size, case when p_provider = 'R2' then 'R2' else 'SUPABASE' end, p_bucket, p_path, p_ref, p_sha256,
          auth.uid(), (select full_name from public.profiles where id = auth.uid()))
  returning * into f;
  perform private.write_audit('HR_OFFER_TEMPLATE_FILE_UPLOADED', 'hr_offer_template_file', f.id, null, null,
    jsonb_build_object('kind', f.kind, 'fileName', f.file_name, 'sizeBytes', f.size_bytes));
  return private.offer_tpl_file_json(f);
end $$;
revoke all on function public.hr_offer_template_file_record(text, text, text, integer, text, text, text, text, text) from public, anon;
grant execute on function public.hr_offer_template_file_record(text, text, text, integer, text, text, text, text, text) to authenticated;

-- a new template (p_template null) or a new version of one. The server checked the wording and fields first (shared/offerTemplates.ts);
-- here: who, that the version being replaced is still the newest (two people never overwrite each other), the letterhead and the sample.
create or replace function public.hr_offer_template_save(
  p_template uuid, p_designation text, p_description text, p_content jsonb, p_letterhead jsonb, p_sample_file uuid, p_base_version integer, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.hr_offer_templates;
  v public.hr_offer_template_versions;
  v_current integer;
  v_designation text := btrim(coalesce(p_designation, ''));
  v_key text;
  v_actor text;
begin
  perform private.offer_tpl_require_manager();
  if length(v_designation) < 2 or length(v_designation) > 80 then
    raise exception 'VALIDATION_ERROR: Enter the designation (2 to 80 characters).' using errcode = 'P0001';
  end if;
  if p_content is null or jsonb_typeof(p_content) <> 'object' or jsonb_typeof(p_content -> 'blocks') <> 'array' or jsonb_array_length(p_content -> 'blocks') = 0
     or jsonb_typeof(p_content -> 'fields') <> 'array' or jsonb_array_length(p_content -> 'fields') = 0 or jsonb_typeof(p_content -> 'dateLine') <> 'object' then
    raise exception 'VALIDATION_ERROR: The template needs its wording and at least one field.' using errcode = 'P0001';
  end if;
  if p_letterhead is null or jsonb_typeof(p_letterhead) <> 'object' then
    raise exception 'VALIDATION_ERROR: Choose the letterhead.' using errcode = 'P0001';
  end if;
  if p_letterhead ? 'builtin' then
    if (p_letterhead ->> 'builtin') not in ('technical-support', 'customer-support', 'business-development', 'sales-executive', 'ai-developer') then
      raise exception 'VALIDATION_ERROR: That letterhead does not exist.' using errcode = 'P0001';
    end if;
  elsif not exists (select 1 from public.hr_offer_template_files f where f.id::text = p_letterhead ->> 'fileId' and f.kind = 'LETTERHEAD') then
    raise exception 'VALIDATION_ERROR: Upload the letterhead PDF again.' using errcode = 'P0001';
  end if;
  if p_sample_file is not null and not exists (select 1 from public.hr_offer_template_files f where f.id = p_sample_file and f.kind = 'SAMPLE') then
    raise exception 'VALIDATION_ERROR: Upload the sample document again.' using errcode = 'P0001';
  end if;
  select full_name into v_actor from public.profiles where id = auth.uid();

  if p_template is null then
    v_key := trim(both '-' from regexp_replace(lower(v_designation), '[^a-z0-9]+', '-', 'g'));
    if length(v_key) < 3 then v_key := 'designation-' || v_key; end if;
    v_key := left(v_key, 40);
    if exists (select 1 from public.hr_offer_templates where lower(btrim(designation)) = lower(v_designation) or template_key = v_key) then
      raise exception 'CONFLICT: A template for "%" already exists. Open it and save a new version instead.', v_designation using errcode = 'P0001';
    end if;
    insert into public.hr_offer_templates (template_key, designation, description, sort_order, created_by)
    values (v_key, v_designation, nullif(left(btrim(coalesce(p_description, '')), 300), ''),
            coalesce((select max(sort_order) from public.hr_offer_templates), 0) + 1, auth.uid())
    returning * into t;
    v_current := 0;
  else
    select * into t from public.hr_offer_templates where id = p_template for update;
    if t.id is null then raise exception 'NOT_FOUND: That offer letter template does not exist.' using errcode = 'P0001'; end if;
    if exists (select 1 from public.hr_offer_templates where id <> t.id and lower(btrim(designation)) = lower(v_designation)) then
      raise exception 'CONFLICT: Another template already uses the designation "%".', v_designation using errcode = 'P0001';
    end if;
    select coalesce(max(version), 0) into v_current from public.hr_offer_template_versions where template_id = t.id;
    if p_base_version is distinct from v_current then
      raise exception 'CONFLICT: Someone saved this template in the meantime (now version %). Load the newest version and make your change again.', v_current using errcode = 'P0001';
    end if;
    update public.hr_offer_templates set designation = v_designation, description = nullif(left(btrim(coalesce(p_description, '')), 300), ''), updated_at = now()
     where id = t.id returning * into t;
  end if;

  insert into public.hr_offer_template_versions (template_id, version, content, letterhead, sample_file_id, note, created_by, created_by_name)
  values (t.id, v_current + 1, p_content, p_letterhead, p_sample_file, nullif(left(btrim(coalesce(p_note, '')), 200), ''), auth.uid(), v_actor)
  returning * into v;
  perform private.write_audit('HR_OFFER_TEMPLATE_SAVED', 'hr_offer_template', t.id, null, null,
    jsonb_build_object('designation', t.designation, 'version', v.version, 'created', v_current = 0, 'note', v.note));
  return private.offer_tpl_json(t);
end $$;
revoke all on function public.hr_offer_template_save(uuid, text, text, jsonb, jsonb, uuid, integer, text) from public, anon;
grant execute on function public.hr_offer_template_save(uuid, text, text, jsonb, jsonb, uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Issuing: as 20261231000600, plus a role-based Offer Letter keeps the template version it was made from (which must exist)
-- ---------------------------------------------------------------------------
create or replace function public.hr_document_record(
  p_employee_key text, p_doc_type text, p_fields jsonb, p_file_name text,
  p_provider text, p_bucket text, p_path text, p_ref text, p_etag text, p_size integer, p_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e record;
  v_problems jsonb;
  v_actor text;
  v_row public.hr_documents;
  v_tpl uuid;
  v_tpl_version integer;
begin
  perform private.hr_doc_require_staff();
  if p_doc_type not in ('NDA', 'EXPERIENCE', 'OFFER') then
    raise exception 'VALIDATION_ERROR: Choose the NDA, the Offer Letter or the Experience Letter.' using errcode = 'P0001';
  end if;
  select * into e from private.hr_doc_employee(p_employee_key);
  if not found then
    raise exception 'NOT_FOUND: This employee is not in the HR directory.' using errcode = 'P0001';
  end if;
  v_problems := private.hr_doc_problems(p_doc_type, p_employee_key);
  if jsonb_array_length(v_problems) > 0 then
    raise exception 'VALIDATION_ERROR: %', v_problems -> 0 ->> 'message' using errcode = 'P0001';
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or nullif(btrim(coalesce(p_fields ->> 'employeeName', '')), '') is null then
    raise exception 'VALIDATION_ERROR: The document values are missing.' using errcode = 'P0001';
  end if;
  if p_doc_type = 'EXPERIENCE' then
    if (p_fields ->> 'joiningDate')::date is distinct from e.joining_date then
      raise exception 'VALIDATION_ERROR: The joining date must be the one on the employee''s record.' using errcode = 'P0001';
    end if;
    if (p_fields ->> 'lastWorkingDate')::date < e.joining_date then
      raise exception 'VALIDATION_ERROR: The last working date is before the joining date.' using errcode = 'P0001';
    end if;
    if (p_fields ->> 'letterDate')::date < (p_fields ->> 'lastWorkingDate')::date then
      raise exception 'VALIDATION_ERROR: The letter date cannot be before the last working date.' using errcode = 'P0001';
    end if;
  end if;
  if p_doc_type = 'OFFER' and p_fields ? 'offerTemplateId' then
    -- a role-based Offer Letter: the designation template and its version must exist
    v_tpl := (p_fields ->> 'offerTemplateId')::uuid;
    v_tpl_version := (p_fields ->> 'templateVersion')::integer;
    if not exists (select 1 from public.hr_offer_template_versions v where v.template_id = v_tpl and v.version = v_tpl_version) then
      raise exception 'VALIDATION_ERROR: The letter''s template version is not known. Reload the page.' using errcode = 'P0001';
    end if;
    if jsonb_typeof(p_fields -> 'values') is distinct from 'object' then
      raise exception 'VALIDATION_ERROR: The offer letter values are missing.' using errcode = 'P0001';
    end if;
  else
    if p_doc_type in ('OFFER', 'EXPERIENCE') and p_fields ? 'templateVersion' then
      if jsonb_typeof(p_fields -> 'content') is distinct from 'object' or not exists (
           select 1 from public.hr_letter_templates t where t.doc_type = p_doc_type and t.version = (p_fields ->> 'templateVersion')::integer) then
        raise exception 'VALIDATION_ERROR: The letter''s template version is not known. Reload the page.' using errcode = 'P0001';
      end if;
    end if;
    if p_doc_type = 'OFFER' and not (p_fields ? 'templateVersion' and p_fields ? 'content' and p_fields ? 'joiningDate' and p_fields ? 'designation') then
      raise exception 'VALIDATION_ERROR: The offer letter values are missing.' using errcode = 'P0001';
    end if;
  end if;
  if p_path is null or p_bucket is distinct from 'hr-documents' or p_size is null or p_size <= 0 or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'VALIDATION_ERROR: The stored file reference is not valid.' using errcode = 'P0001';
  end if;
  select full_name into v_actor from public.profiles where id = auth.uid();
  insert into public.hr_documents (doc_type, employee_key, profile_id, hr_record_id, employee_code, employee_name, fields, file_name,
                                   storage_provider, storage_bucket, storage_path, storage_ref, storage_etag, size_bytes, sha256, generated_by, generated_by_name,
                                   offer_template_id, offer_template_version)
  values (p_doc_type, e.employee_key, e.profile_id, e.hr_record_id, e.employee_code, e.full_name, p_fields, p_file_name,
          case when p_provider = 'R2' then 'R2' else 'SUPABASE' end, p_bucket, p_path, p_ref, p_etag, p_size, p_sha256, auth.uid(), v_actor,
          v_tpl, v_tpl_version)
  returning * into v_row;
  perform private.write_audit('HR_DOCUMENT_GENERATED', 'hr_document', v_row.id, null, null,
    jsonb_build_object('type', p_doc_type, 'employeeKey', e.employee_key, 'employeeCode', e.employee_code, 'fileName', p_file_name,
                       'templateVersion', p_fields -> 'templateVersion', 'offerTemplateId', v_tpl));
  return jsonb_build_object('id', v_row.id, 'type', v_row.doc_type, 'employeeKey', v_row.employee_key, 'employeeCode', v_row.employee_code,
    'employeeName', v_row.employee_name, 'fileName', v_row.file_name, 'sizeBytes', v_row.size_bytes, 'fields', v_row.fields,
    'generatedBy', v_row.generated_by_name, 'createdAt', v_row.created_at);
end $$;
revoke all on function public.hr_document_record(text, text, jsonb, text, text, text, text, text, text, integer, text) from public, anon;
grant execute on function public.hr_document_record(text, text, jsonb, text, text, text, text, text, text, integer, text) to authenticated;

notify pgrst, 'reload schema';

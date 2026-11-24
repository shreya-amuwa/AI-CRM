# HR documents: NDA and Experience Letter

HR dashboard > **Dashboard > Experience Letter Management / NDA Letter Management** (the "Automated Letter & Contract Generator", tabs *Offer Letter*, *Experience Letter*,
*NDA Letter*). The NDA and the Experience Letter are drawn **by the server on the official templates**, stored per employee and can be downloaded again.
The *Offer Letter* is now made the same way, and the Offer and Experience Letters have editable, versioned master templates: see
[Employee Letters](#employee-letters-offer-letter-and-master-templates) below. The same page opens from the sidebar's **Employee Letters** section.

Migration: `supabase/migrations/20261229000200_hr_generated_documents.sql` (additive, safe to rerun; needs the HR migrations `20261222000100` for `private.is_hr_staff()`).
Before it is run the screens show the "latest migrations" set-up message instead of failing.

## What HR does

1. Choose the letter (tab) and the employee. The form is filled from the HR record: employee ID, department, status, joining date, last working date,
   designation, and the employment duration (read-only, for checking).
2. Edit what may be edited (below). The PDF on the right is the server's own rendering, redrawn about 0.7 s after the last edit.
3. **Generate PDF** stores it against the employee. **Download PDF** (under the form, or in the preview toolbar) downloads the stored file of the current values; if the letter was not generated yet, or was edited since, it is stored first, so the file is never an older version. **Print** prints the preview. Earlier documents are listed under the preview.

| Letter | Filled from the HR record | HR may edit | Never editable |
| --- | --- | --- | --- |
| NDA | employee name | agreement date, printed name | every clause, the company party, the signatories |
| Experience Letter | name, designation, last working date, joining date | title (Mr. / Miss / Mrs. / Ms.), name, designation, last working date, letter date, signatory name and title | joining date (change it in the employee's record), the wording |

* The **title** decides *he / she / his / her / him* in the letter. It has no default and is never guessed from a name.
* The **signatory** starts as the one printed on the supplied letter (Aarti Kalange, Ceo); HR can change it per letter.

## Rules (enforced in the database, not only on screen)

* Only **HR staff** (Super Admin, HR Admin Head, HR Assistant; not HR Recruiters) can prepare, generate, list or open: `private.hr_doc_require_staff()`.
* The employee is resolved from the HR record by key (CRM account = profile id, HR-only record = `HR:<id>`); the browser never sends a name, code or joining date
  as the truth. Super Admins and rejected accounts are not employees.
* **Experience Letter** only when the employee has **left** (HR status *Left*, or the account is revoked / suspended), the record has a **joining date** (the
  account creation date is never used instead), the last working date is not before the joining date, and the letter is not dated before the last working date.
  The last working date is the one HR recorded when marking the employee *Left* (`hr_employees.data.leftDate`); if there is none, HR enters it.
* Each generation is a new stored document; nothing is overwritten. Generating and opening a document are audited (`HR_DOCUMENT_GENERATED`, `HR_DOCUMENT_OPENED`),
  without e-mail addresses or printed names.

## Templates

`server/hrDocuments/templateAssets.ts` holds the two official templates (generated; do not edit). `scripts/prepare-hr-templates.mjs` rebuilds it:

```bash
node scripts/prepare-hr-templates.mjs <NDA.pdf> <experience-letter.pdf>
```

* **NDA** (5 pages): the supplied PDF itself. The sample person's date (page 1) and the Employee Acceptance line (page 5) are *removed from the page content*
  (not painted over, so they cannot be copied out of a finished file) and the file properties are cleared. All 9 clauses, the artwork and the page numbers are untouched.
* **Experience Letter**: the supplied `.docx` converted to PDF (LibreOffice); header, footer, title and the toll-free line are kept, the sample body is removed.
* The server then writes the values in the template's own positions with pdf-lib and the standard Helvetica fonts (`server/hrDocuments/render.ts`). Names that Helvetica
  cannot print (for example Devanagari) are refused with a message, never replaced by "?". The same values always give the same bytes, so a preview is exactly the stored file.

## Storage

Private bucket `hr-documents` through the same storage layer as invoices and career files (`StorageRepository.storeGenerated`: Cloudflare R2 when configured, otherwise
Supabase Storage). The row in `public.hr_documents` keeps the bucket, path, provider, size, SHA-256, the printed values, the employee (key, code, name) and who generated it.
Downloads are 120-second signed links; the file is never public. If recording the row fails, the stored object is removed.

## API (HR staff only)

| Route | |
| --- | --- |
| `GET /api/v1/hr/documents/prefill?employeeKey=&type=NDA\|EXPERIENCE` | the record, what is missing (`problems`), whether the letter can be made, today (India), the template signatory |
| `POST /api/v1/hr/documents/preview` | the PDF as base64; nothing is stored |
| `POST /api/v1/hr/documents` | generate and store; returns the document |
| `GET /api/v1/hr/documents?employeeKey=&type=` | stored documents |
| `GET /api/v1/hr/documents/:id/download` | a short-lived signed link |

## Tests

`npm run test:db` (`hr_documents_test.sql`: prefill, eligibility, no data mixing between employees, permissions incl. HR Recruiter / employee / other department, audit),
`npm run test:api` (the PDFs: pages, the values, the removed sample, the template text, refusals, storage, download = the recorded hash, 403 for everyone else),
`npm run test:unit` (`hr_documents_render.test.ts`: date styles, pronouns, duration, determinism, the font guard) and the browser test
`supabase/tests/e2e/run-hr-documents.sh` (the screens end to end, with real downloads).

## Employee Letters: Offer Letter and master templates

Migration: `supabase/migrations/20261231000600_hr_letter_templates.sql` (additive, safe to rerun; needs `20261229000200`). Until it is run, the
Offer Letter says the template is not set up, and the NDA and the Experience Letter keep working with the official wording.

HR sidebar > **Employee Letters** > *NDA Letter*, *Offer Letter*, *Experience Letter* (the dashboard's letter cards open the same page).

* **NDA Letter**: the official agreement. Its clauses are fixed. HR fills in only the date and the employee's name.
* **Offer Letter**: drawn by the server on the supplied letterhead (`server/hrDocuments/offer.ts`). The form is filled from the HR record:
  * name, designation, department and joining date;
  * the monthly salary as `₹25,000/- per month`;
  * the reporting manager, when the directory has one.

  The employment type (`Full-Time`), the probation period (`6 Months`) and the signatory (`Miss Aarti Kalange`) start with the values of the supplied
  letter. Long wording continues on further letterhead pages, up to 4.
* **Experience Letter**: as before, now with its wording from the master template.

**Generate & issue.** HR can open *Edit the letter's wording* and change the wording of **this letter only**. Then they preview the letter,
click *Generate PDF* (stored against the employee) and *Download PDF*. Each letter stores in `hr_documents.fields`:
* the exact wording (`content`);
* the template version it started from (`templateVersion`).

A letter is never re-drawn from the template, so a letter once issued never changes. The employee's history lists each letter with the following:
* the type;
* the label "Issued · template vN";
* the date it was generated;
* a download button.

**Master template** (Offer and Experience Letters):
* **Who reads it:** every HR staff member sees the current wording and the version history, and can open any old version.
* **Who saves it:** only the Super Admin and the HR Admin Head (`private.is_hr_leadership()`). Saving always makes a new version on top of the
  version being edited. If someone saved in the meantime, the save is refused with `CONFLICT`, and the screen offers to load the newest version.
* **What changes:** new letters start from the newest version. Letters already issued keep their own wording. Each save is audited
  (`HR_LETTER_TEMPLATE_SAVED`).

**Template language.**
* Write `{placeholder}` for a value. The Offer Letter uses `name`, `designation`, `department`, `joiningDate`, `employmentType`, `salary`,
  `probation`, `reportingTo` and `letterDate`. The Experience Letter uses `title`, `name`, `designation`, `from`, `to` and `letterDate`, plus the
  pronouns `he`, `him`, `his`, `He` and `His`, which follow the chosen title.
* Write `**text**` for bold.
* An unknown placeholder is refused, both in the form and on the server.
* Version 1 of each template is the supplied wording (`shared/hrLetters.ts`). The API test checks that the seeded rows equal it.

**Database:** `hr_letter_templates` has RLS on and no grants. Access goes only through these functions:
* `hr_letter_template_state(type)` (HR staff);
* `hr_letter_template_version(type, version)` (HR staff);
* `hr_letter_template_save(type, content, base_version, note)` (HR leadership).

`hr_document_prefill` and `hr_document_record` accept `OFFER`, return the salary and the current template, and check that a template version exists.

**API:**
* `GET /hr/letter-templates/:type`
* `GET /hr/letter-templates/:type/versions/:version`
* `POST /hr/letter-templates/:type` with `{ content, baseVersion, note? }`
* `type OFFER` on the existing `/hr/documents` routes

**Offer letterhead:** `node scripts/prepare-hr-offer-template.mjs <offer.pdf>`. It takes the supplied letter converted to PDF (LibreOffice), strips its
text, keeps the letterhead page, and writes `server/hrDocuments/offerTemplateAsset.ts`.

**Tests:**
* `supabase/tests/hr_letter_templates_test.sql`
* `supabase/tests/hr_letters.test.ts` (unit)
* the "hr letters" block of `api_integration.test.ts`
* `supabase/tests/e2e/hr-documents.e2e.mjs`, which covers the Offer Letter, the master template and the sidebar


## Employee files (documents vault, leave mails)

HR dashboard > an employee's profile > **Employee Documents Vault**, and the leave / cancellation mail attachments of the **Leaves & Half-Days Register**.
Before this, uploads were kept only as browser `blob:` links and were lost on refresh.

Migration: `supabase/migrations/20261231000800_hr_employee_files.sql` (additive, safe to rerun; uses `private.hr_doc_employee()` from `20261229000200`).

* **Where the file goes:** Cloudflare R2 (or Supabase Storage without R2), logical bucket `hr-employee-files`, through the same upload-intent -> direct PUT ->
  completion flow as ticket attachments: `POST /api/v1/hr/employee-file-uploads` books the file (the database checks who, the employee, kind, type and size) and
  returns a single-use presigned PUT; the browser sends the bytes straight to R2; `POST .../:id/complete` makes the server look at the stored object (exists, size,
  first bytes match the declared type) before the row becomes `READY`. **Only metadata** (employee, kind, name, type, size, R2 key / ETag, uploader) is kept in
  `public.hr_employee_files`; there is no column for file contents.
* **Kinds:** Identity / KYC, Employment papers, Education / certificates, Leave mail, Leave cancellation mail, Other. A leave mail names the leave it belongs to.
* **Types and size:** PDF, JPG, PNG, Word (.docx) and e-mail (.eml), at most **5 MB** each (checked in the screen, the API and the database).
* **Who:** HR staff (`private.is_hr_staff()`: Super Admin, HR Admin Head, HR Assistant; not HR Recruiters) upload, list, open and delete. The employee can list
  and open **their own** files (`GET /api/v1/hr/employee-files?employeeKey=<their profile id>`) but not upload or delete. Nobody else - not the team lead, not the
  department head - sees them. Row level security on the table enforces the read rule; all writes go through the database functions.
* **Opening:** `GET /api/v1/hr/employee-files/:id/url?action=view|download` returns a link valid for 120 seconds. Every opening is audited
  (`HR_EMPLOYEE_FILE_OPENED`, noting whether the employee opened their own), as are uploads and deletions.
* **Retention:** kept until HR deletes it. `DELETE /api/v1/hr/employee-files/:id` marks the row deleted (kept for the audit trail) and removes the object from R2.

Tests: `supabase/tests/hr_employee_files_test.sql` (database rules), the "HR employee files" block of `api_integration.test.ts` (API with a fake R2),
`supabase/tests/hr_employee_files.test.ts` (content checks and validation).

Not covered yet: the leave records themselves (date, type, times, reason) are still kept only in the open screen; their mails are stored and listed in the
documents vault, linked by the leave's id.


## Role-based Offer Letters (one template per designation)

Migration: `supabase/migrations/20270206000100_hr_offer_templates.sql` (additive, safe to run twice; needs `20261231000600`). Until it is run,
Offer Letter Generation shows the server's message instead of the templates; the NDA and the Experience Letter are not affected.

**Where:** HR dashboard > **HR & Operations > Offer Letter Generation** (the old static 7-page letter there is replaced), and Employee Letters >
**Offer Letter** (the same generator). Every "Generate Offer" button opens it.

**Generate & issue.** HR chooses **Select Employee Designation / Offer Letter Template** and the employee. The template of that designation loads
with **its own fields**: the values that change from person to person in its sample. Technical Support, Sales Executive and AI Developer ask for the
offer date, name, designation, department, date of joining, salary, employment type, working hours, probation, reporting to and the signatory.
Customer Support (the appointment letter with Annexure A) asks for the title (never guessed), name, designation, date of joining, salary (printed with
the amount in words) and its two signatories. Business Development Executive also asks for the reference number. Each field starts with the sample's
own value or the employee's record (name, department, joining date, monthly salary: marked "from the CRM"); HR can change all of them. The PDF on
the right is the server's rendering of exactly these values on the template's letterhead, redrawn ~0.6 s after a change. **Generate Offer Letter**
stores it on the employee's record; **Download as PDF**, **Edit Details**, **Regenerate Document** (a new stored copy, the earlier one kept).

**The five templates** are the samples HR supplied (`shared/offerTemplates.ts` `INITIAL_OFFER_TEMPLATES`): the wording copied as written (including
its own spelling), headings, bullet lists, numbering, the Annexure on a new page, the signature and acceptance blocks. Only the person-specific values
became fields; nothing was added. Each has its own **letterhead** (`server/hrDocuments/offerLetterheads.ts`, made by
`scripts/prepare-hr-offer-letterheads.mjs` from page 1 of each sample with the sample letter removed from the page content, so nothing of it can be
copied out; the Business Development Executive sample is on the **M Pillar Corporation** letterhead, as supplied). The sample files themselves are not
in the repository (one is a real issued letter).

**Templates by designation.** Every HR staff member sees the templates (designation, version, letterhead, sample, fields, letters issued). The Super
Admin and the HR Admin Head (`private.is_hr_leadership()`) can:
* upload the **sample** of a designation (PDF or Word, up to 2.5 MB; checked by its content) and open it (a 120-second private link);
* upload a **letterhead** (PDF; its first page is the background of every page, the letter is written between its header and footer);
* edit the **wording** (one line per paragraph: `= TITLE`, `# Heading`, `## plain heading`, `- bullet`, `^ centred`, `[signature] Label`, `[page]`,
  `**bold**`, `{field}`, `{amountWords}`) and the **fields** (key, label, type text / long text / date / amount / list, required, starting value,
  from the CRM), preview the template with each field shown as `[label]`, and **save as a new version** (with a note);
* **add a designation** (starting from a copy of another template).

**Versions.** A version is never changed or deleted (database trigger). Saving names the version it replaces; if someone saved in between, the save
is refused (`CONFLICT`). New letters use the newest version. An issued letter is the stored PDF plus, in `hr_documents`, the template
(`offer_template_id`), its version (`offer_template_version`), the wording and the values: replacing a template never changes it.

**Rules (database):** HR staff (not HR Recruiters) read templates and generate letters (`private.hr_doc_require_staff()`); only HR leadership saves
templates and uploads files (`private.offer_tpl_require_manager()`); the server loads the wording and letterhead from the database by template and
version, the browser sends only the values (checked against that template's fields); unknown placeholders, duplicate field keys and unclosed bold are
refused. Uploads and saves are audited (`HR_OFFER_TEMPLATE_FILE_UPLOADED`, `HR_OFFER_TEMPLATE_SAVED`); generating is audited as before.

**API:** `GET /hr/offer-templates`, `GET /hr/offer-templates/letterheads`, `GET /hr/offer-templates/:id` (versions), `GET /hr/offer-templates/:id/versions/:v`,
`POST /hr/offer-templates` (new designation), `POST /hr/offer-templates/:id` (new version), `POST /hr/offer-templates/preview`,
`POST /hr/offer-templates/files` (`{ kind, fileName, mimeType, dataBase64 }`), `GET /hr/offer-templates/files/:id/url`; letters use the existing
`/hr/documents` routes with `type OFFER` and `fields: { offerTemplateId, templateVersion, values }`.

**Tests:** `supabase/tests/hr_offer_templates_test.sql`, the "Role-based Offer Letters" block of `api_integration.test.ts` (all five designations as PDFs,
permissions, validation, uploads, replacement with issued letters unchanged, the NDA), `supabase/tests/offer_templates.test.ts` (values, words, markup,
the renderer, the letterheads) and `supabase/tests/ui_offer_letters.test.mjs` (the screens).

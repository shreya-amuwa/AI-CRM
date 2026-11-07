# HR documents: NDA and Experience Letter

HR dashboard > **Dashboard > Experience Letter Management / NDA Letter Management** (the "Automated Letter & Contract Generator", tabs *Offer Letter*, *Experience Letter*,
*NDA Letter*). The NDA and the Experience Letter are drawn **by the server on the official templates**, stored per employee and can be downloaded again.
The *Offer Letter* tab is unchanged (it is still the browser-only generator with sample values: nothing in it is stored, and it is not part of this feature).

Migration: `supabase/migrations/20261229000200_hr_generated_documents.sql` (additive, safe to rerun; needs the HR migrations `20261222000100` for `private.is_hr_staff()`).
Before it is run the screens show the "latest migrations" set-up message instead of failing.

## What HR does

1. Choose the letter (tab) and the employee. The form is filled from the HR record: employee ID, department, status, joining date, last working date,
   designation, and the employment duration (read-only, for checking).
2. Edit what may be edited (below). The PDF on the right is the server's own rendering, redrawn about 0.7 s after the last edit.
3. **Generate PDF** stores it against the employee. **Download PDF** (and the list under the preview) downloads the stored file.

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

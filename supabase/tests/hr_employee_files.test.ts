// HR employee files: the content checks the server applies to a stored object, the upload validation, and the type the browser declares.
import assert from 'node:assert/strict';
import { matchesSignature } from '../../server/storage/signature';
import { hrEmployeeFileMimeOf, hrEmployeeFileUploadSchema } from '../../shared/validation';

let n = 0;
const ok = (label: string, fn: () => void) => { fn(); n++; console.log(`ok - ${label}`); };
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

ok('a .docx (a ZIP archive) matches the Word type; other bytes do not', () => {
  assert.equal(matchesSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), DOCX), true);
  assert.equal(matchesSignature(Buffer.from('%PDF-1.4'), DOCX), false);
  assert.equal(matchesSignature(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), DOCX), false); // old binary .doc
});
ok('a saved e-mail (.eml) starts with a header line and is text', () => {
  assert.equal(matchesSignature(Buffer.from('From: A <a@example.com>\r\nSubject: Leave\r\n\r\nBody'), 'message/rfc822'), true);
  assert.equal(matchesSignature(Buffer.from('Return-Path: <a@example.com>\nReceived: from x\n'), 'message/rfc822'), true);
  assert.equal(matchesSignature(Buffer.from('﻿MIME-Version: 1.0\r\n'), 'message/rfc822'), true);
  assert.equal(matchesSignature(Buffer.from('just some text without headers'), 'message/rfc822'), false);
  assert.equal(matchesSignature(Buffer.from([0x46, 0x72, 0x6f, 0x6d, 0x3a, 0x20, 0x00, 0x01]), 'message/rfc822'), false);
  assert.equal(matchesSignature(Buffer.from('%PDF-1.4\n'), 'message/rfc822'), false);
  assert.equal(matchesSignature(Buffer.alloc(0), 'message/rfc822'), false);
});
ok('the existing types are unchanged', () => {
  assert.equal(matchesSignature(Buffer.from('%PDF-1.7'), 'application/pdf'), true);
  assert.equal(matchesSignature(Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'), true);
  assert.equal(matchesSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), true);
});

ok('the declared type comes from the browser, or from the extension when the browser gives none', () => {
  assert.equal(hrEmployeeFileMimeOf('a.pdf', 'application/pdf'), 'application/pdf');
  assert.equal(hrEmployeeFileMimeOf('Mail.EML', ''), 'message/rfc822');
  assert.equal(hrEmployeeFileMimeOf('offer.docx', 'application/octet-stream'), DOCX);
  assert.equal(hrEmployeeFileMimeOf('photo.JPG', ''), 'image/jpeg');
  assert.equal(hrEmployeeFileMimeOf('old.doc', 'application/msword'), null);
  assert.equal(hrEmployeeFileMimeOf('x.gif', 'image/gif'), null);
});

const base = { employeeKey: 'HR:EMP-1', kind: 'IDENTITY', fileName: 'id.pdf', mimeType: 'application/pdf', sizeBytes: 1000 };
ok('a valid upload passes, with empty leave reference / note turned into null', () => {
  const v = hrEmployeeFileUploadSchema.parse({ ...base, leaveRef: '', note: '  ' });
  assert.equal(v.leaveRef, null);
  assert.equal(v.note, null);
  assert.equal(hrEmployeeFileUploadSchema.safeParse({ ...base, employeeKey: '6f1f6c1e-1b1a-4c6e-9b1a-0d2f8a7e3c11' }).success, true);
});
ok('5 MB is the limit; type, kind and employee key are checked; unknown fields are refused', () => {
  assert.equal(hrEmployeeFileUploadSchema.safeParse({ ...base, sizeBytes: 5 * 1024 * 1024 }).success, true);
  assert.equal(hrEmployeeFileUploadSchema.safeParse({ ...base, sizeBytes: 5 * 1024 * 1024 + 1 }).success, false);
  assert.equal(hrEmployeeFileUploadSchema.safeParse({ ...base, mimeType: 'image/gif' }).success, false);
  assert.equal(hrEmployeeFileUploadSchema.safeParse({ ...base, kind: 'PAYSLIP' }).success, false);
  assert.equal(hrEmployeeFileUploadSchema.safeParse({ ...base, employeeKey: '../etc' }).success, false);
  assert.equal(hrEmployeeFileUploadSchema.safeParse({ ...base, storagePath: 'x/y' }).success, false);
});
ok('a leave mail must name the leave it belongs to', () => {
  assert.equal(hrEmployeeFileUploadSchema.safeParse({ ...base, kind: 'LEAVE_MAIL' }).success, false);
  assert.equal(hrEmployeeFileUploadSchema.safeParse({ ...base, kind: 'LEAVE_CANCELLATION_MAIL', leaveRef: 'LR-1' }).success, true);
});
console.log(`=== ${n} hr employee files checks passed`);

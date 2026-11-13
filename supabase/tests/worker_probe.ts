/**
 * A test-only Worker (npm run test:worker): runs the server code that leans on Node.js APIs (node:crypto, Buffer, AsyncLocalStorage,
 * pdf-lib) INSIDE the Cloudflare Workers runtime and returns what it produced. worker_e2e.test.ts computes the same in Node.js and
 * compares: equal bytes mean the CRM behaves the same on Cloudflare as it did on Vercel. Never deployed.
 */
import { createHash, randomUUID } from 'node:crypto';
import { decryptSecret, encryptSecret, temporaryPassword } from '../../server/automations/secrets.js';
import { presignUrl } from '../../server/storage/sigv4.js';
import { renderInvoicePdf } from '../../server/invoices/pdf.js';
import { renderNdaPdf } from '../../server/hrDocuments/render.js';
import { signHook, verifyHookSignature } from '../../server/automations/authEmailHook.js';
import { requestInfo } from '../../server/http/context.js';
import { sendEmail } from '../../server/automations/providers.js';
import type { AutomationSettings } from '../../server/automations/config.js';
import { sampleInvoice } from './invoice_fixtures.js';
import { PROBE_NOW } from './worker_probe_inputs.js';

const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

async function probe(): Promise<Record<string, unknown>> {
  const token = encryptSecret('Client-Pass-123', 'k'.repeat(40));
  const smtpSettings = {
    email: { provider: 'smtp', apiKey: null, smtp: { host: 'smtp.example.com', port: 465, secure: true, user: 'u', pass: 'p' }, apiBaseUrl: null, fromName: 'A', fromEmail: 'a@example.com', replyTo: 'a@example.com', cc: [], bcc: [] }
  } as unknown as AutomationSettings;
  const key = Buffer.from('0123456789abcdef0123456789abcdef');
  const sig = signHook(key, 'msg_1', '1700000000', '{"a":1}');
  return {
    aesRoundTrip: decryptSecret(token, 'k'.repeat(40)),
    aesWrongKey: decryptSecret(token, 'x'.repeat(40)),
    password: /^[A-Za-z2-9]{14}$/.test(temporaryPassword()),
    uuid: /^[0-9a-f-]{36}$/.test(randomUUID()),
    presigned: presignUrl({ method: 'GET', host: 'acc.r2.cloudflarestorage.com', path: '/bucket/customer-documents/a b.pdf', accessKeyId: 'AKID', secretAccessKey: 'SECRET', expiresSeconds: 300, now: new Date(PROBE_NOW) }),
    invoicePdf: sha((await renderInvoicePdf(sampleInvoice(7), { stage: 'PAID' })).bytes),
    ndaPdf: sha(await renderNdaPdf({ letterDate: '2026-09-11', employeeName: 'Priya Sharma' })),
    hookSignature: sig,
    hookVerifies: verifyHookSignature(key, { id: 'msg_1', timestamp: '1700000000', signature: `v1,${sig}` }, '{"a":1}', 1700000000_000),
    asyncContext: await requestInfo.run({ requestId: 'req-42', ip: '1.2.3.4' }, async () => {
      await new Promise(r => setTimeout(r, 5));
      return requestInfo.getStore()?.requestId;
    }),
    smtp: await sendEmail(smtpSettings, { email: 'b@example.com', name: 'B' }, { subject: 's', html: 'h', text: 't' })
  };
}

export default {
  async fetch(): Promise<Response> {
    try {
      return Response.json(await probe());
    } catch (e) {
      return Response.json({ error: e instanceof Error ? `${e.name}: ${e.message}\n${e.stack}` : String(e) }, { status: 500 });
    }
  }
};

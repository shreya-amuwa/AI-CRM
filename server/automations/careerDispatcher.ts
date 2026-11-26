import { StorageRepository } from '../repositories/StorageRepository.js';
import type { StorageProviderName } from '../storage/types.js';
import { getServiceClient, hasServiceClient } from '../db/supabase.js';
import { automationSettings, liveChannels, senderSettings } from './config.js';
import { sendEmail } from './providers.js';
interface CareerMail {
  id: string;
  recipient: string;
}
/** Separate opt-in from existing customer/finance automations; messages contain no candidate personal documents. */
export async function runCareerAutomation() {
  if (!hasServiceClient()) return { skipped: 'No service key.' };
  const db = getServiceClient();
  const expired = await db.rpc('career_expire_attempts');
  if (expired.error?.code === 'PGRST202')
    return { skipped: 'Candidate portal migration is not installed.' };
  if (expired.error)
    throw new Error('Candidate assessment maintenance failed.');
  const cleanup = await db.rpc('career_upload_cleanup');
  if (cleanup.error)
    throw new Error('Candidate upload cleanup is unavailable.');
  const storage = new StorageRepository();
  for (const file of cleanup.data as {
    id: string;
    storage_bucket: string;
    storage_provider: StorageProviderName;
    path: string;
  }[]) {
    if (
      await storage.remove(
        file.storage_bucket,
        [file.path],
        file.storage_provider,
      )
    ) {
      const purged = await db.rpc('career_upload_purged', {
        p_id: file.id,
        p_path: file.path,
      });
      if (purged.error)
        throw new Error(
          'Candidate upload cleanup status could not be recorded.',
        );
    }
  }
  const mode = process.env.CAREER_EMAIL_MODE ?? 'off';
  if (mode === 'off') return { mode };
  const settings = senderSettings('careers', automationSettings());
  if (mode === 'live' && !liveChannels(settings).includes('EMAIL'))
    return { mode, skipped: 'Email provider is not configured.' };
  // Respect the existing recipient safety allowlist; never consume jobs for non-test recipients.
  if (settings.testRecipients)
    return {
      mode,
      skipped:
        'Candidate email dispatch is disabled while the global test-recipient filter is enabled.',
    };
  const claimed = await db.rpc('career_mail_claim', {
    p_live: mode === 'live',
  });
  if (claimed.error)
    throw new Error('Candidate notification queue is unavailable.');
  const jobs = claimed.data as CareerMail[];
  if (mode !== 'live') return { mode, prepared: jobs.length };
  let sent = 0;
  for (const job of jobs) {
    let success = false;
    try {
      const outcome = await sendEmail(
        {
          ...settings,
          mode: 'live',
          email: { ...settings.email, cc: [], bcc: [] },
        },
        { email: job.recipient, name: 'Candidate' },
        {
          subject: 'An update to your Amuwa application',
          text: 'There is an update to your recruitment journey. Sign in to the Amuwa candidate portal to review your applications and next steps.',
          html: '<p>There is an update to your recruitment journey.</p><p>Sign in to the Amuwa candidate portal to review your applications and next steps.</p>',
        },
        undefined,
        { category: 'RECRUITMENT', application: 'CANDIDATE_PORTAL', template: 'candidate-update', idempotencyKey: `career-mail:${job.id}` },
      );
      success = outcome.ok;
      if (success) sent++;
    } catch {
      /* Ambiguous delivery outcomes require manual review, never an automatic duplicate send. */
    }
    const finished = await db.rpc('career_mail_finish', {
      p_id: job.id,
      p_sent: success,
    });
    if (finished.error)
      throw new Error('Candidate email delivery status could not be recorded.');
  }
  return { mode, sent, claimed: jobs.length };
}

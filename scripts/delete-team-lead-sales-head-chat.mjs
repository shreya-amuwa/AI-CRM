#!/usr/bin/env node
/**
 * ONE-TIME clean-up: deletes the existing direct chat between ONE Team Lead and ONE Sales Department Head, and nothing else.
 * It is a manual script (not a migration, not scheduled, not an API route), so it never runs by itself and has no recurring effect.
 *
 * It does not guess who the two people are: you name them (e-mail or profile id). The script then
 *   1. checks that the first is a Team Lead and the second a Department Head of the Sales side,
 *   2. finds the ONE direct conversation of exactly those two people (a direct chat has one fixed key made of the two ids),
 *   3. prints what would go: the conversation id, its members, the number of messages and files, and the size of the files,
 *   4. only with  --apply --confirm <that conversation id>  deletes it: the stored files first (Supabase Storage and/or Cloudflare R2,
 *      exactly the objects of that conversation), then the conversation row. Its messages, files, read marks, "deleted for me" marks and
 *      members go with it (they all belong to the conversation). Group chats, other direct chats and client chats are not touched.
 *   5. writes one audit entry (CHAT_CONVERSATION_PURGED) with ids and counts only: never any message text.
 * Without --apply it deletes nothing. It cannot be undone, so take a backup first (Supabase: Database > Backups) if in doubt.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… [R2_ACCOUNT_ID=… R2_ACCESS_KEY_ID=… R2_SECRET_ACCESS_KEY=… R2_BUCKET=…] \
 *     node scripts/delete-team-lead-sales-head-chat.mjs --team-lead <email|id> --sales-head <email|id>                  preview only
 *   … node scripts/delete-team-lead-sales-head-chat.mjs --team-lead <email|id> --sales-head <email|id> --apply --confirm <conversation id>
 *
 * Keep the service role key and R2 keys secret: do not paste them into chat or commit them.
 */
import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { r2Config, r2Url } from './sweep-orphan-customer-files.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findProfile(supabase, ref, label) {
  const q = supabase.from('profiles').select('id, full_name, email, role, head_division, status');
  const { data, error } = await (UUID.test(ref) ? q.eq('id', ref.toLowerCase()) : q.eq('email', ref.trim().toLowerCase()));
  if (error) throw new Error(`Could not look up the ${label}: ${error.message}`);
  if (!data?.length) throw new Error(`No ${label} found for "${ref}".`);
  if (data.length > 1) throw new Error(`"${ref}" matches ${data.length} profiles: use the profile id instead.`);
  return data[0];
}

/**
 * Finds the conversation and (with apply) deletes it. Returns a report; throws when anything does not match exactly.
 * `supabase` is a service-role client; `r2` is r2Config() or null.
 */
export async function purgeTeamLeadSalesHeadChat({ supabase, r2 = null, teamLead, salesHead, apply = false, confirm = '' }) {
  const tl = await findProfile(supabase, teamLead, 'Team Lead');
  const sh = await findProfile(supabase, salesHead, 'Sales Department Head');
  if (tl.role !== 'TEAM_HEAD') throw new Error(`${tl.email} is not a Team Lead (role ${tl.role}). Nothing was deleted.`);
  if (sh.role !== 'DEPARTMENT_HEAD' || sh.head_division !== 'SALES') throw new Error(`${sh.email} is not a Sales Department Head (role ${sh.role}, side ${sh.head_division ?? 'not set'}). Nothing was deleted.`);

  // a direct chat has one key made of the two profile ids, smaller first (see chat_open_direct): that is the only conversation matched
  const key = [tl.id, sh.id].sort().join(':');
  const { data: convs, error: ce } = await supabase.from('chat_conversations').select('id, kind, direct_key, created_at, last_message_at').eq('kind', 'DIRECT').eq('direct_key', key);
  if (ce) throw new Error(`Could not look up the conversation: ${ce.message}`);
  if (!convs?.length) return { found: false, teamLead: tl.email, salesHead: sh.email, message: 'These two people have no direct chat. Nothing to delete.' };
  const conv = convs[0];

  const { data: members, error: me } = await supabase.from('chat_members').select('profile_id').eq('conversation_id', conv.id);
  if (me) throw new Error(`Could not read the members: ${me.message}`);
  const ids = (members ?? []).map(m => m.profile_id).sort();
  if (ids.length !== 2 || ids[0] !== [tl.id, sh.id].sort()[0] || ids[1] !== [tl.id, sh.id].sort()[1]) {
    throw new Error(`The conversation ${conv.id} does not have exactly these two members. Nothing was deleted.`);
  }
  const { count: messages, error: ge } = await supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conv.id);
  if (ge) throw new Error(`Could not count the messages: ${ge.message}`);
  const { data: files, error: fe } = await supabase.from('chat_attachments').select('id, storage_bucket, storage_path, storage_provider, size_bytes, status, storage_removed_at').eq('conversation_id', conv.id);
  if (fe) throw new Error(`Could not read the files: ${fe.message}`);
  const report = {
    found: true, applied: false, conversationId: conv.id, teamLead: `${tl.full_name} <${tl.email}>`, salesHead: `${sh.full_name} <${sh.email}>`,
    messages: messages ?? 0, files: files.length, fileBytes: files.reduce((n, f) => n + Number(f.size_bytes || 0), 0), removedFiles: 0
  };
  if (!apply) return report;
  if (confirm !== conv.id) throw new Error(`Nothing was deleted. To delete, add:  --apply --confirm ${conv.id}`);

  // files first: if one cannot be removed the conversation stays, so the script can simply be run again
  const toRemove = files.filter(f => !f.storage_removed_at);
  const supa = toRemove.filter(f => f.storage_provider !== 'R2');
  const onR2 = toRemove.filter(f => f.storage_provider === 'R2');
  const byBucket = new Map();
  for (const f of supa) byBucket.set(f.storage_bucket, [...(byBucket.get(f.storage_bucket) ?? []), f.storage_path]);
  for (const [bucket, paths] of byBucket) {
    const { error } = await supabase.storage.from(bucket).remove(paths);
    if (error) throw new Error(`Could not remove the files from ${bucket}: ${error.message}. The conversation was not deleted.`);
    report.removedFiles += paths.length;
  }
  if (onR2.length && !r2) throw new Error('Some files are on Cloudflare R2: set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET. The conversation was not deleted.');
  for (const f of onR2) {
    const res = await fetch(r2Url(r2, 'DELETE', `${f.storage_bucket}/${f.storage_path}`), { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Could not remove ${f.storage_path} from R2 (HTTP ${res.status}). The conversation was not deleted.`);
    report.removedFiles++;
  }
  const { error: de } = await supabase.from('chat_conversations').delete().eq('id', conv.id).eq('kind', 'DIRECT').eq('direct_key', key);
  if (de) throw new Error(`The files are gone but the conversation could not be deleted: ${de.message}. Run the script again.`);
  const { data: left } = await supabase.from('chat_conversations').select('id').eq('id', conv.id);
  if (left?.length) throw new Error('The conversation is still there. Nothing more was deleted.');
  await supabase.rpc('record_security_event', {
    p_action: 'CHAT_CONVERSATION_PURGED', p_entity_type: 'chat_conversation',
    p_metadata: { conversation_id: conv.id, kind: 'DIRECT', members: [tl.id, sh.id], messages: report.messages, files: report.files, one_time_cleanup: true }
  });
  report.applied = true;
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const arg = name => (args.includes(name) ? args[args.indexOf(name) + 1] : '');
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const teamLead = arg('--team-lead'), salesHead = arg('--sales-head');
  if (!url || !serviceKey || !teamLead || !salesHead) {
    console.error('Usage: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… [R2_*=…] node scripts/delete-team-lead-sales-head-chat.mjs --team-lead <email|id> --sales-head <email|id> [--apply --confirm <conversation id>]');
    process.exit(1);
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const r = await purgeTeamLeadSalesHeadChat({ supabase, r2: r2Config(), teamLead, salesHead, apply: args.includes('--apply'), confirm: arg('--confirm') });
  if (!r.found) { console.log(r.message); return; }
  console.log(`Conversation ${r.conversationId}\n  between ${r.teamLead} (Team Lead) and ${r.salesHead} (Sales Department Head)\n  ${r.messages} message(s), ${r.files} file(s), ${r.fileBytes} bytes of files`);
  if (r.applied) console.log(`Deleted: the conversation, its messages and ${r.removedFiles} stored file(s). One audit entry (CHAT_CONVERSATION_PURGED) was written.`);
  else console.log(`Nothing was deleted. To delete exactly this conversation, run again with  --apply --confirm ${r.conversationId}`);
}

// (the file-name check keeps it from running when a bundler inlines this file into a test)
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href && /delete-team-lead-sales-head-chat/.test(process.argv[1] ?? '')) {
  main().catch(err => { console.error(err.message); process.exit(1); });
}

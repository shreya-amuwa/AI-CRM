/**
 * Every team member gets an AI-generated illustrated avatar instead of a
 * stock photo. The URL is deterministic per user, so the same person always
 * sees the same face. The database fills `profiles.avatar_url` with the same
 * URL on insert (see migration 20261007000000_generated_avatars.sql); this
 * helper is the fallback for rows that predate it.
 */
const AVATAR_BASE = 'https://api.dicebear.com/9.x/notionists/svg';

export function generatedAvatarUrl(seed: string): string {
  return `${AVATAR_BASE}?seed=${encodeURIComponent(seed)}&backgroundColor=c0aede,b6e3f4,d1d4f9,ffd5dc,ffdfbf`;
}

/** Stock photos (Unsplash) and empty values are replaced by the generated avatar. */
export function resolveAvatarUrl(avatarUrl: string | null | undefined, seed: string): string {
  if (!avatarUrl || /images\.unsplash\.com/.test(avatarUrl) || !/^https?:\/\//.test(avatarUrl)) {
    return generatedAvatarUrl(seed);
  }
  return avatarUrl;
}

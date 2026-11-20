/**
 * @mentions in group chats (migration 20270116000300): the composer's "@" suggestions and the highlighting of tagged names. Pure functions, so the
 * rules are tested without a browser. Who may be tagged is decided by the server (current members of that group only); this only helps typing.
 */
export interface MentionPerson { id: string; name: string }

/** The "@..." being typed right before the caret: where it starts and what was typed after "@" (names may contain spaces). */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, Math.max(0, caret));
  const at = before.lastIndexOf('@');
  if (at < 0) return null;
  // "@" starts a mention only at the beginning or after a space / new line (not inside an e-mail address)
  if (at > 0 && !/\s/.test(before[at - 1])) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/.test(query) || /\s{2,}/.test(query)) return null;
  return { start: at, query };
}

/** The group members that match what was typed (by any part of the name), the signed-in person and people already tagged excluded. */
export function mentionSuggestions(people: MentionPerson[], query: string, exclude: string[] = [], limit = 8): MentionPerson[] {
  const q = query.trim().toLowerCase();
  return people
    .filter(p => !exclude.includes(p.id))
    .filter(p => !q || p.name.toLowerCase().split(/\s+/).some(w => w.startsWith(q)) || p.name.toLowerCase().includes(q))
    .sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Replaces the "@query" being typed with "@Full Name " and gives the caret position after it. */
export function applyMention(text: string, start: number, caret: number, name: string): { text: string; caret: number } {
  const insert = `@${name} `;
  const next = text.slice(0, start) + insert + text.slice(caret).replace(/^ /, '');
  return { text: next, caret: start + insert.length };
}

/** The people still tagged when the message is sent: picked from the list AND their "@Name" is still in the text. */
export function activeMentions(text: string, picked: MentionPerson[]): string[] {
  return [...new Set(picked.filter(p => text.includes(`@${p.name}`)).map(p => p.id))];
}

/** The message text cut into plain parts and tagged names ("@Name"), longest names first so "Priya Shah" wins over "Priya". */
export function splitMentions(body: string, names: string[]): { text: string; mention: boolean }[] {
  const list = [...new Set(names.filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!list.length || !body) return [{ text: body, mention: false }];
  const escaped = list.map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`@(?:${escaped.join('|')})`, 'g');
  const out: { text: string; mention: boolean }[] = [];
  let last = 0;
  for (const m of body.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: body.slice(last, i), mention: false });
    out.push({ text: m[0], mention: true });
    last = i + m[0].length;
  }
  if (last < body.length) out.push({ text: body.slice(last), mention: false });
  return out;
}

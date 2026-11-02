/** Preserve the instant when an existing UTC deadline is edited through a local datetime input. */
export function careerDateTimeLocal(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

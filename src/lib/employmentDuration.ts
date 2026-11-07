/** "1 year, 2 months, 3 days" between two ISO dates (calendar months, the way HR counts a tenure; the last day counts as worked). */
export function employmentDuration(fromIso: string | null, toIso: string | null): string | null {
  if (!fromIso || !toIso || toIso < fromIso) return null;
  const [y1, m1, d1] = fromIso.split('-').map(Number);
  const [y2, m2, d2] = toIso.split('-').map(Number);
  // count the end day too: work to the day before "to", plus one day
  const end = new Date(Date.UTC(y2, m2 - 1, d2 + 1));
  let months = (end.getUTCFullYear() - y1) * 12 + (end.getUTCMonth() + 1 - m1);
  let days = end.getUTCDate() - d1;
  if (days < 0) { months -= 1; days += new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 0)).getUTCDate(); }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const parts = [
    years ? `${years} year${years === 1 ? '' : 's'}` : '',
    rest ? `${rest} month${rest === 1 ? '' : 's'}` : '',
    days ? `${days} day${days === 1 ? '' : 's'}` : ''
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

import type { Cell } from './xlsxReader';

/**
 * A small CSV reader for the browser, for lead sheets saved as .csv: the same rows of cells as the .xlsx reader gives, so the rest of the import
 * (heading row, column matching, the database's checks) is unchanged. Handles a UTF-8 byte-order mark, quoted fields with commas, quotes and line
 * breaks, Windows / Unix line ends, and files Excel saved with ";" or tab separators. Every value is text (a phone number keeps its leading 0 / +).
 */
export function decodeCsv(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  if (view.includes(0)) throw new Error('This is not a CSV text file.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(view).replace(/^﻿/, '');
  } catch {
    // an older Excel "CSV" is Windows-1252, not UTF-8
    return new TextDecoder('windows-1252').decode(view);
  }
}

/** The separator the first line uses most (outside quotes): comma, semicolon or tab. */
function separatorOf(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch]++;
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? best : ',';
}

export function parseCsv(text: string): Cell[][] {
  const sep = separatorOf(text);
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  const endField = () => { row.push(field); field = ''; };
  const endRow = () => { endField(); rows.push(row); row = []; };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === sep) { endField(); i++; continue; }
    if (ch === '\r') { endRow(); i += text[i + 1] === '\n' ? 2 : 1; continue; }
    if (ch === '\n') { endRow(); i++; continue; }
    field += ch; i++;
  }
  if (quoted) throw new Error('The CSV file has a quote (") that is never closed.');
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

export function readCsv(bytes: ArrayBuffer): { sheets: { name: string; rows: Cell[][] }[] } {
  return { sheets: [{ name: 'CSV', rows: parseCsv(decodeCsv(bytes)) }] };
}

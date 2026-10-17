import JSZip from 'jszip';

/**
 * A small .xlsx reader for the browser: sheet names and cell values (text, number or empty).
 * Enough for our import templates. Formulas give their last saved value (none when the file was
 * never opened in Excel); dates are numbers (Excel serials) unless typed as text.
 */
export type Cell = string | number | null;
export interface Workbook {
  sheets: { name: string; rows: Cell[][] }[];
}

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

function xml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('The file is damaged or is not an Excel workbook.');
  return doc;
}
const all = (el: Document | Element, tag: string) => Array.from(el.getElementsByTagNameNS(MAIN, tag));
const textOf = (el: Element) => all(el, 't').map(t => t.textContent ?? '').join('');

/** "AB12" -> 27 (0-based column index). */
function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export async function readXlsx(file: Blob): Promise<Workbook> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new Error('This is not an Excel (.xlsx) file. Save it as "Excel Workbook (.xlsx)" and try again.');
  }
  const read = async (path: string) => zip.file(path)?.async('string') ?? null;
  const wbXml = await read('xl/workbook.xml');
  if (!wbXml) throw new Error('This is not an Excel (.xlsx) file.');

  const shared: string[] = [];
  const ss = await read('xl/sharedStrings.xml');
  if (ss) for (const si of all(xml(ss), 'si')) shared.push(textOf(si));

  const rels = new Map<string, string>();
  const relXml = await read('xl/_rels/workbook.xml.rels');
  if (relXml) {
    for (const r of Array.from(xml(relXml).getElementsByTagName('Relationship'))) {
      const target = r.getAttribute('Target') ?? '';
      rels.set(r.getAttribute('Id') ?? '', target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
    }
  }

  const sheets: Workbook['sheets'] = [];
  for (const s of all(xml(wbXml), 'sheet')) {
    const rid = s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? s.getAttribute('r:id') ?? '';
    const path = rels.get(rid);
    const body = path ? await read(path) : null;
    const rows: Cell[][] = [];
    if (body) {
      for (const row of all(xml(body), 'row')) {
        const r = Number(row.getAttribute('r')) - 1;
        const out: Cell[] = [];
        for (const c of all(row, 'c')) {
          const type = c.getAttribute('t');
          const v = all(c, 'v')[0]?.textContent ?? null;
          let value: Cell = null;
          if (type === 's') value = v === null ? null : shared[Number(v)] ?? null;
          else if (type === 'inlineStr') value = textOf(c);
          else if (type === 'str' || type === 'e') value = v;
          else if (type === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
          else if (v !== null && v !== '') value = Number(v);
          if (typeof value === 'string') value = value.trim() || null;
          out[columnIndex(c.getAttribute('r') ?? '')] = value;
        }
        rows[r] = Array.from(out, x => x ?? null);
      }
    }
    sheets.push({ name: s.getAttribute('name') ?? '', rows: Array.from(rows, x => x ?? []) });
  }
  return { sheets };
}

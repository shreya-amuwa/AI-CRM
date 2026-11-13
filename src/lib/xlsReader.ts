import type { Cell, Workbook } from './xlsxReader';

/**
 * A small reader for old Excel 97-2003 workbooks (.xls, BIFF8) in the browser, for lead sheets: sheet names and cell values (text, number or
 * empty), the same shape as the .xlsx reader gives. It reads the compound-file container, the "Workbook" stream and the cell records (shared
 * strings, inline strings, numbers, RK numbers, formula results, booleans). Encrypted files and the older Excel 5 format are refused with a message
 * to save the file as .xlsx. Nothing here runs the file: it is only read.
 */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const END_OF_CHAIN = 0xfffffffe;
const FREE = 0xffffffff;
const SAVE_AS_XLSX = 'Open it in Excel and save it as "Excel Workbook (.xlsx)", then upload it again.';

export const isXlsFile = (bytes: ArrayBuffer) => bytes.byteLength >= 8 && SIGNATURE.every((b, i) => new Uint8Array(bytes, 0, 8)[i] === b);

/** The bytes of one stream of the compound file (the workbook is one). */
function compoundStream(buf: ArrayBuffer, wanted: string[]): Uint8Array | null {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  if (!isXlsFile(buf) || buf.byteLength < 512) throw new Error('This is not an Excel 97-2003 (.xls) file.');
  const sectorSize = 1 << dv.getUint16(0x1e, true);
  const miniSectorSize = 1 << dv.getUint16(0x20, true);
  if (sectorSize !== 512 && sectorSize !== 4096) throw new Error('The .xls file is damaged.');
  const firstDir = dv.getUint32(0x30, true);
  const miniCutoff = dv.getUint32(0x38, true);
  const firstMiniFat = dv.getUint32(0x3c, true);
  let difatSector = dv.getUint32(0x44, true);
  const sectorCount = Math.floor((buf.byteLength - sectorSize) / sectorSize) + 1;
  const offsetOf = (s: number) => (s + 1) * sectorSize;
  const guard = () => { throw new Error('The .xls file is damaged.'); };

  // the FAT: its sectors are listed in the header (109) and then in a chain of DIFAT sectors
  const fatSectors: number[] = [];
  for (let i = 0; i < 109; i++) { const s = dv.getUint32(0x4c + i * 4, true); if (s !== FREE && s !== END_OF_CHAIN) fatSectors.push(s); }
  for (let hops = 0; difatSector !== END_OF_CHAIN && difatSector !== FREE; hops++) {
    if (hops > sectorCount || offsetOf(difatSector) + sectorSize > buf.byteLength) guard();
    const base = offsetOf(difatSector);
    for (let i = 0; i < sectorSize / 4 - 1; i++) { const s = dv.getUint32(base + i * 4, true); if (s !== FREE && s !== END_OF_CHAIN) fatSectors.push(s); }
    difatSector = dv.getUint32(base + sectorSize - 4, true);
  }
  const fat: number[] = [];
  for (const s of fatSectors) {
    const base = offsetOf(s);
    if (base + sectorSize > buf.byteLength) guard();
    for (let i = 0; i < sectorSize / 4; i++) fat.push(dv.getUint32(base + i * 4, true));
  }
  const chain = (start: number, table: number[], limit: number) => {
    const out: number[] = [];
    for (let s = start; s !== END_OF_CHAIN; s = table[s]) {
      if (s === undefined || s === FREE || s >= table.length || out.length > limit) guard();
      out.push(s);
    }
    return out;
  };
  const readChain = (start: number) => {
    const sectors = chain(start, fat, sectorCount);
    const out = new Uint8Array(sectors.length * sectorSize);
    sectors.forEach((s, i) => { const o = offsetOf(s); if (o + sectorSize > buf.byteLength) guard(); out.set(u8.subarray(o, o + sectorSize), i * sectorSize); });
    return out;
  };

  // the directory: 128-byte entries (name in UTF-16, type, first sector, size)
  const dir = readChain(firstDir);
  const ddv = new DataView(dir.buffer);
  const entries: { name: string; type: number; start: number; size: number }[] = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nameLen = Math.min(64, ddv.getUint16(o + 64, true));
    let name = '';
    for (let i = 0; i + 2 < nameLen; i += 2) name += String.fromCharCode(ddv.getUint16(o + i, true));
    entries.push({ name, type: dir[o + 66], start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true) });
  }
  const root = entries.find(e => e.type === 5);
  const entry = entries.find(e => e.type === 2 && wanted.includes(e.name));
  if (!entry) return null;
  if (entry.size >= miniCutoff || !root) return readChain(entry.start).subarray(0, entry.size);
  // a small stream lives in the mini stream (64-byte sectors) inside the root entry's chain
  const miniStream = readChain(root.start);
  const miniFatBytes = firstMiniFat === END_OF_CHAIN ? new Uint8Array(0) : readChain(firstMiniFat);
  const mdv = new DataView(miniFatBytes.buffer);
  const miniFat = Array.from({ length: miniFatBytes.length / 4 }, (_, i) => mdv.getUint32(i * 4, true));
  const sectors = chain(entry.start, miniFat, miniStream.length / miniSectorSize);
  const out = new Uint8Array(sectors.length * miniSectorSize);
  sectors.forEach((s, i) => { const o = s * miniSectorSize; if (o + miniSectorSize > miniStream.length) guard(); out.set(miniStream.subarray(o, o + miniSectorSize), i * miniSectorSize); });
  return out.subarray(0, entry.size);
}

/** Reads across a record and the CONTINUE records after it (shared strings may be split between them). */
class Segments {
  private seg = 0;
  private pos = 0;
  constructor(private readonly parts: Uint8Array[]) {}
  private ensure() {
    while (this.seg < this.parts.length && this.pos >= this.parts[this.seg].length) { this.seg++; this.pos = 0; }
    if (this.seg >= this.parts.length) throw new Error('The .xls file is damaged.');
  }
  get atSegmentStart() { return this.pos === 0; }
  byte(): number { this.ensure(); return this.parts[this.seg][this.pos++]; }
  u16(): number { return this.byte() | (this.byte() << 8); }
  u32(): number { return (this.u16() | (this.u16() << 16)) >>> 0; }
  skip(n: number) { for (let i = 0; i < n; i++) this.byte(); }
  /** cch characters; when they continue in the next record, that record starts with a new "high byte" flag. */
  chars(cch: number, high: boolean): string {
    let s = '';
    for (let i = 0; i < cch; i++) {
      if (this.seg < this.parts.length && this.pos >= this.parts[this.seg].length) {
        this.ensure();
        high = (this.byte() & 1) === 1;
      }
      s += String.fromCharCode(high ? this.u16() : this.byte());
    }
    return s;
  }
}

/** A string with its 16-bit length and flags (XLUnicodeRichExtendedString): the shared strings. */
function richString(r: Segments): string {
  const cch = r.u16();
  const flags = r.byte();
  const runs = flags & 0x08 ? r.u16() : 0;
  const ext = flags & 0x04 ? r.u32() : 0;
  const text = r.chars(cch, (flags & 1) === 1);
  r.skip(runs * 4 + ext);
  return text;
}

/** RK: a compressed number (an integer or the top of a double, maybe times 100). */
function rkValue(rk: number): number {
  let v: number;
  if (rk & 0x02) v = rk >> 2;
  else {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(4, rk & 0xfffffffc, true);
    v = dv.getFloat64(0, true);
  }
  return rk & 0x01 ? v / 100 : v;
}

export async function readXls(file: Blob): Promise<Workbook> {
  const buf = await file.arrayBuffer();
  if (!isXlsFile(buf)) throw new Error('This is not an Excel 97-2003 (.xls) file.');
  const stream = compoundStream(buf, ['Workbook', 'Book']);
  if (!stream) throw new Error(`This .xls file has no workbook in it. ${SAVE_AS_XLSX}`);
  const dv = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const recordAt = (o: number) => ({ type: dv.getUint16(o, true), len: dv.getUint16(o + 2, true), data: stream.subarray(o + 4, o + 4 + dv.getUint16(o + 2, true)) });

  // the workbook globals: the version, the sheet list and the shared strings
  const first = recordAt(0);
  if (first.type !== 0x0809 || first.len < 2) throw new Error('This is not an Excel 97-2003 (.xls) file.');
  if ((first.data[0] | (first.data[1] << 8)) !== 0x0600) throw new Error(`This is an Excel 5 / 95 file, which cannot be read. ${SAVE_AS_XLSX}`);
  const sheets: { name: string; offset: number }[] = [];
  let sst: string[] = [];
  let o = 0;
  while (o + 4 <= stream.length) {
    const rec = recordAt(o);
    const next = o + 4 + rec.len;
    if (rec.type === 0x002f) throw new Error(`This .xls file is password-protected. ${SAVE_AS_XLSX}`);
    if (rec.type === 0x0085 && rec.len >= 8) {
      const rdv = new DataView(rec.data.buffer, rec.data.byteOffset, rec.len);
      const offset = rdv.getUint32(0, true);
      const kind = rec.data[5];
      const cch = rec.data[6];
      const high = (rec.data[7] & 1) === 1;
      let name = '';
      for (let i = 0; i < cch; i++) name += String.fromCharCode(high ? rdv.getUint16(8 + i * 2, true) : rec.data[8 + i]);
      if (kind === 0) sheets.push({ name, offset });
    } else if (rec.type === 0x00fc) {
      const parts = [rec.data];
      let p = next;
      while (p + 4 <= stream.length && dv.getUint16(p, true) === 0x003c) { const c = recordAt(p); parts.push(c.data); p += 4 + c.len; }
      const r = new Segments(parts);
      r.skip(4);
      const unique = r.u32();
      sst = [];
      for (let i = 0; i < unique; i++) sst.push(richString(r));
    } else if (rec.type === 0x000a) break; // the end of the globals
    o = next;
  }

  const out: Workbook = { sheets: [] };
  for (const sheet of sheets) {
    const rows: Cell[][] = [];
    const set = (row: number, col: number, v: Cell) => { (rows[row] ??= [])[col] = v; };
    let pendingFormula: { row: number; col: number } | null = null;
    let p = sheet.offset;
    if (p + 4 > stream.length || dv.getUint16(p, true) !== 0x0809) continue;
    while (p + 4 <= stream.length) {
      const rec = recordAt(p);
      p += 4 + rec.len;
      const rdv = new DataView(rec.data.buffer, rec.data.byteOffset, rec.len);
      const row = rec.len >= 4 ? rdv.getUint16(0, true) : 0;
      const col = rec.len >= 4 ? rdv.getUint16(2, true) : 0;
      if (rec.type === 0x000a) break;
      if (rec.type === 0x00fd && rec.len >= 10) set(row, col, sst[rdv.getUint32(6, true)] ?? '');
      else if (rec.type === 0x0203 && rec.len >= 14) set(row, col, rdv.getFloat64(6, true));
      else if (rec.type === 0x027e && rec.len >= 10) set(row, col, rkValue(rdv.getUint32(6, true)));
      else if (rec.type === 0x00bd && rec.len >= 6) {
        const last = rdv.getUint16(rec.len - 2, true);
        for (let c = col, at = 4; c <= last && at + 6 <= rec.len - 2; c++, at += 6) set(row, c, rkValue(rdv.getUint32(at + 2, true)));
      } else if (rec.type === 0x0204 && rec.len >= 9) {
        set(row, col, xlUnicode(rec.data.subarray(6)));
      } else if (rec.type === 0x0006 && rec.len >= 14) {
        if (rdv.getUint16(12, true) === 0xffff) {
          const kind = rec.data[6];
          if (kind === 0) pendingFormula = { row, col };
          else if (kind === 1) set(row, col, rec.data[8] ? 'TRUE' : 'FALSE');
        } else set(row, col, rdv.getFloat64(6, true));
      } else if (rec.type === 0x0207 && pendingFormula) {
        set(pendingFormula.row, pendingFormula.col, xlUnicode(rec.data));
        pendingFormula = null;
      } else if (rec.type === 0x0205 && rec.len >= 8 && rec.data[7] === 0) set(row, col, rec.data[6] ? 'TRUE' : 'FALSE');
    }
    out.sheets.push({ name: sheet.name, rows: Array.from(rows, r => Array.from(r ?? [], c => (c === undefined ? null : c))) });
  }
  if (!out.sheets.length) throw new Error(`No worksheet was found in this .xls file. ${SAVE_AS_XLSX}`);
  return out;
}

/** XLUnicodeString: a 16-bit length, a flags byte, the characters (an inline cell text, a formula's text result). */
function xlUnicode(data: Uint8Array): string {
  if (data.length < 3) return '';
  const cch = data[0] | (data[1] << 8);
  const high = (data[2] & 1) === 1;
  let s = '';
  for (let i = 0; i < cch && 3 + (high ? i * 2 + 1 : i) < data.length; i++) s += String.fromCharCode(high ? data[3 + i * 2] | (data[4 + i * 2] << 8) : data[3 + i]);
  return s;
}

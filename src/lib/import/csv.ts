/**
 * A small CSV reader for Import (FR-12.6, FR-12.9): RFC 4180 fields, with
 * commas, quotes ("" for a quote) and line breaks inside quoted fields,
 * CRLF or LF line ends, and the byte-order mark Excel writes. Blank lines
 * are skipped. Returns the rows as arrays of strings, header included.
 */
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // A line with nothing on it is skipped, as spreadsheets leave them at the end.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
      } else field += c;
      i++;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === ',') endField();
    else if (c === '\n') endRow();
    else if (c === '\r') {
      endRow();
      if (src[i + 1] === '\n') i++;
    } else field += c;
    i++;
  }
  if (quoted) throw new CsvError('A quoted field isn’t closed: check for a missing quote mark.');
  if (field !== '' || row.length) endRow();
  return rows;
}

/** The file isn't readable as CSV. */
export class CsvError extends Error {}

/**
 * Write rows as CSV (Archive, FR-12.11), the reverse of parseCsv: a field
 * with a comma, quote or line break is quoted, quotes doubled; CRLF line
 * ends, as spreadsheets expect.
 */
export function toCsv(rows: string[][]): string {
  const field = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return rows.map((r) => r.map(field).join(',')).join('\r\n') + '\r\n';
}

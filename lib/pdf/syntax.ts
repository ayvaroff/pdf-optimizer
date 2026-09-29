/**
 * Minimal PDF object syntax parser (PDF 32000-1:2008 §7.3).
 *
 * pdf.js only hands us decoded pixels, so to copy JPEG streams out of a PDF
 * untouched we need to read object dictionaries ourselves. This parser covers
 * exactly what that needs: dictionaries, arrays, names, numbers, references,
 * strings (skipped over, contents unused), booleans, null and bare keywords.
 */

export interface PdfName {
  readonly name: string;
}
export interface PdfRef {
  readonly num: number;
  readonly gen: number;
}
export interface PdfKeyword {
  readonly keyword: string;
}
export interface PdfString {
  readonly bytes: Uint8Array;
}
export type PdfDict = Map<string, PdfValue>;
export type PdfValue =
  | number
  | boolean
  | null
  | PdfName
  | PdfRef
  | PdfKeyword
  | PdfString
  | PdfValue[]
  | PdfDict;

export interface Parsed<T = PdfValue> {
  value: T;
  /** Offset of the first byte after the parsed value. */
  end: number;
}

export const isName = (v: PdfValue | undefined): v is PdfName =>
  typeof v === "object" && v !== null && "name" in v;
export const isRef = (v: PdfValue | undefined): v is PdfRef =>
  typeof v === "object" && v !== null && "num" in v && "gen" in v;
export const isKeyword = (v: PdfValue | undefined): v is PdfKeyword =>
  typeof v === "object" && v !== null && "keyword" in v;
export const isDict = (v: PdfValue | undefined): v is PdfDict => v instanceof Map;
export const isArray = (v: PdfValue | undefined): v is PdfValue[] => Array.isArray(v);

export function isWhitespace(c: number): boolean {
  return c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09 || c === 0x0c || c === 0x00;
}

export function isDelimiter(c: number): boolean {
  // ( ) < > [ ] { } / %
  return (
    c === 0x28 || c === 0x29 || c === 0x3c || c === 0x3e || c === 0x5b || c === 0x5d ||
    c === 0x7b || c === 0x7d || c === 0x2f || c === 0x25
  );
}

export const isRegular = (c: number): boolean => !isWhitespace(c) && !isDelimiter(c);
const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;

/** Skips whitespace and comments. */
export function skipWhitespace(b: Uint8Array, pos: number): number {
  const n = b.length;
  while (pos < n) {
    const c = b[pos];
    if (isWhitespace(c)) {
      pos++;
    } else if (c === 0x25) {
      while (pos < n && b[pos] !== 0x0a && b[pos] !== 0x0d) pos++;
    } else {
      break;
    }
  }
  return pos;
}

function readToken(b: Uint8Array, pos: number): Parsed<string> | null {
  let end = pos;
  while (end < b.length && isRegular(b[end])) end++;
  if (end === pos) return null;
  let s = "";
  for (let i = pos; i < end; i++) s += String.fromCharCode(b[i]);
  return { value: s, end };
}

function parseName(b: Uint8Array, pos: number): Parsed<PdfName> {
  // pos points at '/'
  let end = pos + 1;
  let s = "";
  while (end < b.length && isRegular(b[end])) {
    const c = b[end];
    if (c === 0x23 && end + 2 < b.length) {
      const hex = parseInt(String.fromCharCode(b[end + 1], b[end + 2]), 16);
      if (!Number.isNaN(hex)) {
        s += String.fromCharCode(hex);
        end += 3;
        continue;
      }
    }
    s += String.fromCharCode(c);
    end++;
  }
  return { value: { name: s }, end };
}

function parseLiteralString(b: Uint8Array, pos: number): Parsed<PdfString> {
  // pos points at '('
  let depth = 1;
  let i = pos + 1;
  const start = i;
  while (i < b.length && depth > 0) {
    const c = b[i];
    if (c === 0x5c) {
      i += 2;
      continue;
    }
    if (c === 0x28) depth++;
    else if (c === 0x29) depth--;
    i++;
  }
  return { value: { bytes: b.subarray(start, Math.max(start, i - 1)) }, end: i };
}

function parseHexString(b: Uint8Array, pos: number): Parsed<PdfString> {
  // pos points at '<'
  let i = pos + 1;
  const start = i;
  while (i < b.length && b[i] !== 0x3e) i++;
  return { value: { bytes: b.subarray(start, i) }, end: Math.min(b.length, i + 1) };
}

function parseNumberToken(tok: string): number | null {
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(tok)) return null;
  const n = Number.parseFloat(tok);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parses one object starting at `pos` (leading whitespace allowed).
 * Returns null at end of input or on malformed input.
 */
export function parseValue(b: Uint8Array, pos: number, depth = 0): Parsed | null {
  if (depth > 64) return null;
  pos = skipWhitespace(b, pos);
  if (pos >= b.length) return null;
  const c = b[pos];

  if (c === 0x2f) return parseName(b, pos);
  if (c === 0x28) return parseLiteralString(b, pos);
  if (c === 0x5b) return parseArray(b, pos, depth);
  if (c === 0x3c) {
    if (b[pos + 1] === 0x3c) return parseDict(b, pos, depth);
    return parseHexString(b, pos);
  }
  if (c === 0x5d || c === 0x3e || c === 0x29 || c === 0x7b || c === 0x7d) {
    // Stray closing delimiter; report it as a keyword so callers can stop.
    return { value: { keyword: String.fromCharCode(c) }, end: pos + 1 };
  }

  const tok = readToken(b, pos);
  if (!tok) return null;
  const num = parseNumberToken(tok.value);
  if (num !== null) {
    // Look ahead for "gen R" to form an indirect reference.
    if (Number.isInteger(num) && num >= 0 && isDigit(b[pos])) {
      const p2 = skipWhitespace(b, tok.end);
      const tok2 = readToken(b, p2);
      if (tok2 && /^\d+$/.test(tok2.value)) {
        const p3 = skipWhitespace(b, tok2.end);
        if (b[p3] === 0x52 /* R */ && (p3 + 1 >= b.length || !isRegular(b[p3 + 1]))) {
          return { value: { num, gen: Number.parseInt(tok2.value, 10) }, end: p3 + 1 };
        }
      }
    }
    return { value: num, end: tok.end };
  }
  if (tok.value === "true") return { value: true, end: tok.end };
  if (tok.value === "false") return { value: false, end: tok.end };
  if (tok.value === "null") return { value: null, end: tok.end };
  return { value: { keyword: tok.value }, end: tok.end };
}

function parseArray(b: Uint8Array, pos: number, depth: number): Parsed<PdfValue[]> | null {
  const items: PdfValue[] = [];
  let p = pos + 1;
  for (;;) {
    p = skipWhitespace(b, p);
    if (p >= b.length) return null;
    if (b[p] === 0x5d) return { value: items, end: p + 1 };
    const item = parseValue(b, p, depth + 1);
    if (!item) return null;
    if (isKeyword(item.value) && (item.value.keyword === ">>" || item.value.keyword === ">")) {
      return null;
    }
    items.push(item.value);
    p = item.end;
  }
}

function parseDict(b: Uint8Array, pos: number, depth: number): Parsed<PdfDict> | null {
  const dict: PdfDict = new Map();
  let p = pos + 2;
  for (;;) {
    p = skipWhitespace(b, p);
    if (p >= b.length) return null;
    if (b[p] === 0x3e && b[p + 1] === 0x3e) return { value: dict, end: p + 2 };
    if (b[p] !== 0x2f) {
      // Malformed: a key must be a name. Try to skip a value and continue.
      const junk = parseValue(b, p, depth + 1);
      if (!junk || junk.end <= p) return null;
      p = junk.end;
      continue;
    }
    const key = parseName(b, p);
    const val = parseValue(b, key.end, depth + 1);
    if (!val) return null;
    if (isKeyword(val.value) && val.value.keyword === ">>") {
      // "/Key >>" with a missing value.
      dict.set(key.value.name, null);
      return { value: dict, end: val.end };
    }
    dict.set(key.value.name, val.value);
    p = val.end;
  }
}

/** Finds the next occurrence of an ASCII needle at or after `from`. Returns -1 when absent. */
export function indexOfAscii(b: Uint8Array, needle: string, from: number, to = b.length): number {
  const first = needle.charCodeAt(0);
  const len = needle.length;
  const limit = Math.min(to, b.length) - len;
  outer: for (let i = from; i <= limit; i++) {
    if (b[i] !== first) continue;
    for (let j = 1; j < len; j++) {
      if (b[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}

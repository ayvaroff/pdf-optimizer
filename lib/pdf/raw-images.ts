/**
 * Locates image XObjects inside a PDF file by scanning its objects directly,
 * so that JPEG (DCTDecode) page images can be copied out byte-for-byte, the
 * way `pdfimages -all` does. pdf.js is used for everything else; this module
 * only needs to be right for the common "one JPEG per page" scanner output and
 * must fail safe (return a reason) for anything else, in which case the page
 * is rasterized instead.
 *
 * The scan is linear and ignores cross-reference tables, so it also works on
 * files with broken xref data. When an object number is defined more than
 * once (incremental updates), the definition later in the file wins.
 */
import {
  indexOfAscii,
  isArray,
  isDict,
  isKeyword,
  isName,
  isRef,
  isRegular,
  isWhitespace,
  parseValue,
  skipWhitespace,
  type PdfDict,
  type PdfValue,
} from "./syntax";

export interface RawObject {
  num: number;
  gen: number;
  value: PdfValue;
  /** Byte offset where the object definition (or its container) starts, for precedence. */
  offset: number;
  /** Stream data range, when the object is a stream. */
  streamStart?: number;
  streamEnd?: number;
}

export interface RawImage {
  bytes: Uint8Array;
  width: number;
  height: number;
  /** Number of colour components implied by the colour space (1, 3 or 4). */
  components: number;
}

export type RawImageLookup = RawImage | { reason: string };

const isDigit = (c: number) => c >= 0x30 && c <= 0x39;

export class RawPdf {
  readonly objects = new Map<number, RawObject>();
  /** True when the file declares an /Encrypt dictionary; stream bytes are then unusable as-is. */
  encrypted = false;

  readonly bytes: Uint8Array;

  private constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  static async scan(bytes: Uint8Array): Promise<RawPdf> {
    const pdf = new RawPdf(bytes);
    pdf.scanDirectObjects();
    pdf.encrypted = indexOfAscii(bytes, "/Encrypt", 0) !== -1;
    if (!pdf.encrypted) await pdf.expandObjectStreams();
    return pdf;
  }

  /** Follows indirect references (at most a few hops). */
  resolve(v: PdfValue | undefined): PdfValue | undefined {
    for (let hops = 0; isRef(v) && hops < 8; hops++) {
      v = this.objects.get(v.num)?.value;
    }
    return isRef(v) ? undefined : v;
  }

  dict(v: PdfValue | undefined): PdfDict | undefined {
    const r = this.resolve(v);
    return isDict(r) ? r : undefined;
  }

  number(v: PdfValue | undefined): number | undefined {
    const r = this.resolve(v);
    return typeof r === "number" ? r : undefined;
  }

  /** Reads an inheritable page attribute, walking up the /Parent chain. */
  inherited(page: PdfDict, key: string): PdfValue | undefined {
    let d: PdfDict | undefined = page;
    for (let hops = 0; d && hops < 64; hops++) {
      const v = d.get(key);
      if (v !== undefined && v !== null) return v;
      d = this.dict(d.get("Parent"));
    }
    return undefined;
  }

  /**
   * Finds the single JPEG image that a page paints, given the page object
   * number (from pdf.js `page.ref`) and the pixel size pdf.js reported for the
   * painted image (used to disambiguate when the page has several XObjects).
   */
  findPageJpeg(pageObjNum: number, painted: { width: number; height: number }): RawImageLookup {
    if (this.encrypted) return { reason: "document is encrypted" };
    const page = this.dict({ num: pageObjNum, gen: 0 });
    if (!page) return { reason: "page object not found in file scan" };
    const resources = this.dict(this.inherited(page, "Resources"));
    if (!resources) return { reason: "page has no resources" };
    const xobjects = this.dict(resources.get("XObject"));
    if (!xobjects) return { reason: "page has no image XObjects" };

    const candidates: RawObject[] = [];
    for (const ref of xobjects.values()) {
      if (!isRef(ref)) continue;
      const obj = this.objects.get(ref.num);
      if (!obj || !isDict(obj.value) || obj.streamStart === undefined) continue;
      const sub = this.resolve(obj.value.get("Subtype"));
      if (!isName(sub) || sub.name !== "Image") continue;
      const w = this.number(obj.value.get("Width"));
      const h = this.number(obj.value.get("Height"));
      if (w === painted.width && h === painted.height) candidates.push(obj);
    }
    if (candidates.length === 0) return { reason: "painted image not found among page resources" };
    if (candidates.length > 1) return { reason: "several same-sized images in page resources" };

    const obj = candidates[0];
    const dict = obj.value as PdfDict;

    const filter = this.resolve(dict.get("Filter"));
    const filterName = isName(filter)
      ? filter.name
      : isArray(filter) && filter.length === 1 && isName(filter[0])
        ? filter[0].name
        : isArray(filter) && filter.length === 0
          ? "none"
          : isArray(filter)
            ? "filter chain"
            : "none";
    if (filterName !== "DCTDecode") return { reason: `image is ${describeFilter(filterName)}, not JPEG` };

    if (dict.has("SMask") || dict.has("Mask")) return { reason: "image has a transparency mask" };
    if ((this.number(dict.get("BitsPerComponent")) ?? 8) !== 8) return { reason: "unusual bit depth" };
    const decode = this.resolve(dict.get("Decode"));
    if (isArray(decode) && !isDefaultDecode(decode)) return { reason: "image uses a custom Decode array" };

    const components = this.colorComponents(dict.get("ColorSpace"));
    if (components === undefined) return { reason: "unsupported colour space" };

    const bytes = this.bytes.subarray(obj.streamStart!, obj.streamEnd!);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return { reason: "stream does not start with a JPEG marker" };
    }
    return { bytes, width: painted.width, height: painted.height, components };
  }

  private colorComponents(cs: PdfValue | undefined): number | undefined {
    const v = this.resolve(cs);
    if (isName(v)) {
      switch (v.name) {
        case "DeviceGray":
        case "CalGray":
          return 1;
        case "DeviceRGB":
        case "CalRGB":
          return 3;
        case "DeviceCMYK":
          return 4;
        default:
          return undefined;
      }
    }
    if (isArray(v) && v.length >= 1 && isName(v[0])) {
      const family = v[0].name;
      if (family === "ICCBased" && v.length >= 2) {
        const n = this.number(this.dict(v[1])?.get("N"));
        return n === 1 || n === 3 || n === 4 ? n : undefined;
      }
      if (family === "CalRGB") return 3;
      if (family === "CalGray") return 1;
    }
    return undefined;
  }

  // ---- scanning -----------------------------------------------------------

  private scanDirectObjects(): void {
    const b = this.bytes;
    const n = b.length;
    let i = 0;
    while (i < n - 3) {
      // Look for "obj" preceded by "<num> <gen> ".
      if (b[i] !== 0x6f || b[i + 1] !== 0x62 || b[i + 2] !== 0x6a || (i + 3 < n && isRegular(b[i + 3]))) {
        i++;
        continue;
      }
      const header = this.matchObjectHeader(i);
      if (!header) {
        i += 3;
        continue;
      }
      const parsed = parseValue(b, i + 3);
      if (!parsed || isKeyword(parsed.value)) {
        i += 3;
        continue;
      }
      const obj: RawObject = { num: header.num, gen: header.gen, value: parsed.value, offset: header.start };
      let next = parsed.end;
      if (isDict(parsed.value)) {
        const kw = parseValue(b, parsed.end);
        if (kw && isKeyword(kw.value) && kw.value.keyword === "stream") {
          const range = this.locateStream(parsed.value, kw.end);
          obj.streamStart = range.start;
          obj.streamEnd = range.end;
          next = range.afterEndstream;
        }
      }
      this.put(obj);
      i = Math.max(next, i + 3);
    }
  }

  private put(obj: RawObject): void {
    const existing = this.objects.get(obj.num);
    if (!existing || existing.offset <= obj.offset) this.objects.set(obj.num, obj);
  }

  private matchObjectHeader(objPos: number): { num: number; gen: number; start: number } | null {
    const b = this.bytes;
    let p = objPos - 1;
    if (p < 0 || !isWhitespace(b[p])) return null;
    while (p >= 0 && isWhitespace(b[p])) p--;
    const genEnd = p + 1;
    while (p >= 0 && isDigit(b[p])) p--;
    if (p + 1 === genEnd) return null;
    const gen = this.readInt(p + 1, genEnd);
    if (p < 0 || !isWhitespace(b[p])) return null;
    while (p >= 0 && isWhitespace(b[p])) p--;
    const numEnd = p + 1;
    while (p >= 0 && isDigit(b[p])) p--;
    if (p + 1 === numEnd) return null;
    if (p >= 0 && isRegular(b[p])) return null;
    const num = this.readInt(p + 1, numEnd);
    return { num, gen, start: p + 1 };
  }

  private readInt(from: number, to: number): number {
    let v = 0;
    for (let i = from; i < to; i++) v = v * 10 + (this.bytes[i] - 0x30);
    return v;
  }

  /** Given the offset right after the `stream` keyword, computes the data range. */
  private locateStream(dict: PdfDict, afterKeyword: number): { start: number; end: number; afterEndstream: number } {
    const b = this.bytes;
    let start = afterKeyword;
    if (b[start] === 0x0d) start++;
    if (b[start] === 0x0a) start++;

    const length = this.number(dict.get("Length"));
    if (length !== undefined && length >= 0 && start + length <= b.length) {
      const p = skipWhitespace(b, start + length);
      if (indexOfAscii(b, "endstream", p, p + 9) === p) {
        return { start, end: start + length, afterEndstream: p + 9 };
      }
    }
    // Length missing or wrong: fall back to searching for the endstream keyword.
    const idx = indexOfAscii(b, "endstream", start);
    if (idx === -1) return { start, end: b.length, afterEndstream: b.length };
    let end = idx;
    if (b[end - 1] === 0x0a) end--;
    if (b[end - 1] === 0x0d) end--;
    return { start, end, afterEndstream: idx + 9 };
  }

  /** Parses objects stored inside compressed object streams (/Type /ObjStm). */
  private async expandObjectStreams(): Promise<void> {
    const containers = [...this.objects.values()].filter((o) => {
      if (!isDict(o.value) || o.streamStart === undefined) return false;
      const t = this.resolve(o.value.get("Type"));
      return isName(t) && t.name === "ObjStm";
    });
    for (const c of containers) {
      const dict = c.value as PdfDict;
      const filter = this.resolve(dict.get("Filter"));
      const filterName = isName(filter) ? filter.name : isArray(filter) && filter.length === 1 && isName(filter[0]) ? filter[0].name : filter == null ? "none" : "?";
      if (filterName !== "FlateDecode" && filterName !== "none") continue;
      const parms = this.dict(dict.get("DecodeParms"));
      if (parms && (this.number(parms.get("Predictor")) ?? 1) > 1) continue;
      const count = this.number(dict.get("N"));
      const first = this.number(dict.get("First"));
      if (!count || first === undefined) continue;

      let data: Uint8Array;
      try {
        const raw = this.bytes.subarray(c.streamStart!, c.streamEnd!);
        data = filterName === "none" ? raw : await inflate(raw);
      } catch {
        continue;
      }
      let p = 0;
      const entries: Array<{ num: number; off: number }> = [];
      for (let k = 0; k < count; k++) {
        const a = parseValue(data, p);
        if (!a || typeof a.value !== "number") break;
        const o = parseValue(data, a.end);
        if (!o || typeof o.value !== "number") break;
        entries.push({ num: a.value, off: o.value });
        p = o.end;
      }
      for (const e of entries) {
        const parsed = parseValue(data, first + e.off);
        if (!parsed || isKeyword(parsed.value)) continue;
        this.put({ num: e.num, gen: 0, value: parsed.value, offset: c.offset });
      }
    }
  }
}

function describeFilter(name: string): string {
  switch (name) {
    case "JPXDecode":
      return "JPEG 2000";
    case "CCITTFaxDecode":
      return "CCITT fax (bilevel)";
    case "JBIG2Decode":
      return "JBIG2 (bilevel)";
    case "FlateDecode":
      return "Flate (lossless)";
    case "LZWDecode":
      return "LZW";
    case "RunLengthDecode":
      return "run-length";
    case "none":
      return "uncompressed";
    default:
      return name;
  }
}

function isDefaultDecode(arr: PdfValue[]): boolean {
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] !== (i % 2)) return false;
  }
  return true;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

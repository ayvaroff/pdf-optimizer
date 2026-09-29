/** Output image encoding. PDF can only embed JPEG (DCTDecode) or PNG-like raster data. */
export type OutputFormat = "jpeg" | "png";

/** Parameters sent to the optimizer. Global settings and per-page overrides share this shape. */
export interface OptimizeParams {
  /** Target resolution in dots per inch. 0 keeps the source resolution. */
  dpi: number;
  /** Convert to single-channel grayscale before encoding. */
  grayscale: boolean;
  /** Encoding for the optimized image. */
  format: OutputFormat;
  /** JPEG quality 1-100. Ignored for PNG. */
  quality: number;
  /** Baseline (false) or progressive (true) JPEG. Ignored for PNG. */
  progressive: boolean;
  /** Palette size for PNG, 2-256. Ignored for JPEG and when threshold is set. */
  colors: number;
  /** 0 disables. 1-255 converts to pure black and white using this cutoff (implies grayscale). */
  threshold: number;
}

/** How the page image was obtained from the PDF. */
export type SourceKind =
  /** Raw JPEG bytes copied out of the PDF without re-encoding (like `pdfimages`). */
  | "raw-jpeg"
  /** Page rasterized with pdf.js because it was not a single full-page JPEG. */
  | "rendered";

export interface PageSource {
  kind: SourceKind;
  blob: Blob;
  mime: string;
  /** Pixel dimensions of the source image. */
  width: number;
  height: number;
  /** Effective resolution relative to the page width, in dots per inch. */
  dpi: number;
  /** Why the page had to be rendered instead of extracted, when applicable. */
  note?: string;
}

export interface OptimizeResult {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  /** Hash of the parameters this result was produced with. */
  paramsKey: string;
}

export type PageStatus = "loading" | "ready" | "queued" | "optimizing" | "done" | "error";

export interface PageState {
  /**
   * Zero-based index of the page in the original document. Stable identity:
   * pages may be reordered, so never use array position to identify a page.
   */
  index: number;
  /** Whether the page goes into the rebuilt PDF. */
  included: boolean;
  /** Output page size in PDF points, after applying the page's /Rotate. */
  widthPt: number;
  heightPt: number;
  thumbUrl?: string;
  source?: PageSource;
  sourceError?: string;
  override: Partial<OptimizeParams> | null;
  result?: OptimizeResult;
  status: PageStatus;
  error?: string;
}

export interface DocumentState {
  fileName: string;
  fileSize: number;
  pageCount: number;
  pages: PageState[];
}

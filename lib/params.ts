import type { OptimizeParams } from "./types";

export const DEFAULT_PARAMS: OptimizeParams = {
  dpi: 200,
  grayscale: false,
  format: "jpeg",
  quality: 70,
  progressive: false,
  colors: 64,
  threshold: 0,
};

export const DPI_CHOICES = [0, 400, 300, 240, 200, 150, 120, 100, 72] as const;

export function mergeParams(
  global: OptimizeParams,
  override: Partial<OptimizeParams> | null | undefined,
): OptimizeParams {
  return override ? { ...global, ...override } : global;
}

/** Stable key used to detect whether a result is still valid for the current parameters. */
export function paramsKey(p: OptimizeParams): string {
  if (p.format === "jpeg") {
    return `jpeg|${p.dpi}|${p.grayscale ? 1 : 0}|${p.threshold}|q${p.quality}|${p.progressive ? "p" : "b"}`;
  }
  return `png|${p.dpi}|${p.grayscale ? 1 : 0}|${p.threshold}|c${p.colors}`;
}

export function paramsToQuery(p: OptimizeParams, pageWidthPt: number, pageHeightPt: number): string {
  const q = new URLSearchParams({
    format: p.format,
    dpi: String(p.dpi),
    gray: p.grayscale ? "1" : "0",
    quality: String(p.quality),
    progressive: p.progressive ? "1" : "0",
    colors: String(p.colors),
    threshold: String(p.threshold),
    pw: pageWidthPt.toFixed(3),
    ph: pageHeightPt.toFixed(3),
  });
  return q.toString();
}

const clampInt = (v: string | null, min: number, max: number, fallback: number) => {
  const n = v == null ? NaN : Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const clampFloat = (v: string | null, min: number, max: number, fallback: number) => {
  const n = v == null ? NaN : Number.parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** Parses and validates the query string produced by paramsToQuery. Used server-side. */
export function paramsFromQuery(q: URLSearchParams): {
  params: OptimizeParams;
  pageWidthPt: number;
  pageHeightPt: number;
} {
  const format = q.get("format") === "png" ? "png" : "jpeg";
  return {
    params: {
      format,
      dpi: clampInt(q.get("dpi"), 0, 1200, DEFAULT_PARAMS.dpi),
      grayscale: q.get("gray") === "1",
      quality: clampInt(q.get("quality"), 1, 100, DEFAULT_PARAMS.quality),
      progressive: q.get("progressive") === "1",
      colors: clampInt(q.get("colors"), 2, 256, DEFAULT_PARAMS.colors),
      threshold: clampInt(q.get("threshold"), 0, 255, 0),
    },
    pageWidthPt: clampFloat(q.get("pw"), 1, 14400, 595.276),
    pageHeightPt: clampFloat(q.get("ph"), 1, 14400, 841.89),
  };
}

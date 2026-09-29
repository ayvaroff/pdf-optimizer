import { paramsToQuery } from "../params";
import type { OptimizeParams, OptimizeResult, PageSource } from "../types";

/** Sends one page image to the optimizer route and returns the optimized image. */
export async function optimizeImage(
  source: PageSource,
  params: OptimizeParams,
  pageWidthPt: number,
  pageHeightPt: number,
  key: string,
  signal: AbortSignal,
): Promise<OptimizeResult> {
  const res = await fetch(`/api/optimize?${paramsToQuery(params, pageWidthPt, pageHeightPt)}`, {
    method: "POST",
    body: source.blob,
    headers: { "content-type": source.mime },
    signal,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    throw new Error(text || `Optimizer responded with HTTP ${res.status}`);
  }
  const blob = await res.blob();
  return {
    blob,
    mime: res.headers.get("content-type") ?? blob.type,
    width: Number(res.headers.get("x-image-width")) || 0,
    height: Number(res.headers.get("x-image-height")) || 0,
    paramsKey: key,
  };
}

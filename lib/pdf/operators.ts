import type { PDFPageProxy } from "pdfjs-dist";
import type { PdfJsModule } from "./pdfjs";

/** Full-page image paint found in a page's operator list, with its placement in user space. */
export interface PaintedImage {
  width: number;
  height: number;
  /** Concatenated CTM at the time of painting: [a, b, c, d, e, f]. */
  ctm: number[];
}

export type OpAnalysis = { image: PaintedImage } | { image: null; reason: string };

/**
 * Walks the page's operator list. Accepts only pages that paint exactly one
 * image XObject, filling the page, with nothing else drawn. Everything else
 * is rasterized by the caller.
 */
export async function analyzePageOperators(OPS: PdfJsModule["OPS"], page: PDFPageProxy): Promise<OpAnalysis> {
  const ops = await page.getOperatorList();
  const passthrough = new Set<number>([
    OPS.dependency,
    OPS.beginMarkedContent,
    OPS.beginMarkedContentProps,
    OPS.endMarkedContent,
    OPS.setGState,
  ]);

  let ctm = [1, 0, 0, 1, 0, 0];
  const stack: number[][] = [];
  const images: PaintedImage[] = [];

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];
    const args = ops.argsArray[i];
    if (passthrough.has(fn)) continue;
    if (fn === OPS.save) {
      stack.push(ctm);
    } else if (fn === OPS.restore) {
      ctm = stack.pop() ?? [1, 0, 0, 1, 0, 0];
    } else if (fn === OPS.transform) {
      ctm = multiply(args as number[], ctm);
    } else if (fn === OPS.paintImageXObject) {
      const [, width, height] = args as [string, number, number];
      images.push({ width, height, ctm });
    } else if (fn === OPS.paintImageXObjectRepeat || fn === OPS.paintInlineImageXObject) {
      return { image: null, reason: "page paints images in an unsupported way" };
    } else if (fn === OPS.beginAnnotation) {
      return { image: null, reason: "page has annotations" };
    } else {
      return { image: null, reason: "page has text or vector content" };
    }
  }

  if (images.length === 0) return { image: null, reason: "page paints no image" };
  if (images.length > 1) return { image: null, reason: `page is composed of ${images.length} images` };

  const img = images[0];
  const [a, b, c, d, e, f] = img.ctm;
  const [x0, y0, x1, y1] = page.view;
  const pw = x1 - x0;
  const ph = y1 - y0;
  const tol = Math.max(4, 0.02 * Math.min(pw, ph));
  const skewTol = 1e-3 * Math.max(Math.abs(a), Math.abs(d));
  if (Math.abs(b) > skewTol || Math.abs(c) > skewTol) {
    return { image: null, reason: "image is rotated or skewed on the page" };
  }
  if (a <= 0 || d <= 0) return { image: null, reason: "image is mirrored on the page" };
  if (Math.abs(a - pw) > tol || Math.abs(d - ph) > tol || Math.abs(e - x0) > tol || Math.abs(f - y0) > tol) {
    return { image: null, reason: "image does not fill the page" };
  }
  return { image: img };
}

/** Returns m1 × m2 for PDF-style [a b c d e f] matrices. */
function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

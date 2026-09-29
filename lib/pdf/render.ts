import type { PDFPageProxy } from "pdfjs-dist";

/**
 * Largest canvas area we rasterize to. Safari caps canvases well below
 * Chromium, and a 600 dpi A4 page alone is 35 megapixels.
 */
export const MAX_RENDER_PIXELS = 16_000_000;

export function clampRenderDpi(dpi: number, widthPt: number, heightPt: number): number {
  const areaAtOneDpi = (widthPt / 72) * (heightPt / 72);
  const maxDpi = Math.floor(Math.sqrt(MAX_RENDER_PIXELS / areaAtOneDpi));
  return Math.max(36, Math.min(dpi, maxDpi));
}

/** Rasterizes a page (honouring its /Rotate) onto a fresh canvas with a white background. */
export async function renderPageToCanvas(page: PDFPageProxy, dpi: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: dpi / 72 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(viewport.width));
  canvas.height = Math.max(1, Math.round(viewport.height));
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Could not create a 2D canvas context");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport, background: "#ffffff" }).promise;
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(`Canvas encoding to ${type} failed`))),
      type,
      quality,
    );
  });
}

export interface EncodedCanvas {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
}

/** Encodes a rendered page losslessly; the server does all lossy work. */
export async function encodeCanvas(canvas: HTMLCanvasElement): Promise<EncodedCanvas> {
  const blob = await canvasToBlob(canvas, "image/png");
  return { blob, mime: "image/png", width: canvas.width, height: canvas.height };
}

/** Produces a small JPEG thumbnail from an encoded image or a canvas. */
export async function makeThumbnail(
  source: Blob | HTMLCanvasElement,
  targetWidth: number,
  aspect: number,
): Promise<Blob> {
  const w = targetWidth;
  const h = Math.max(1, Math.round(targetWidth / aspect));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { alpha: false })!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  let bitmap: ImageBitmap | null = null;
  try {
    // Browsers decode and downscale in one step here, which keeps memory low for big scans.
    bitmap = await createImageBitmap(source, { resizeWidth: w, resizeHeight: h, resizeQuality: "high" });
    ctx.drawImage(bitmap, 0, 0, w, h);
  } catch {
    // Fallback for browsers without resize support in createImageBitmap.
    if (source instanceof Blob) {
      bitmap = await createImageBitmap(source);
      ctx.drawImage(bitmap, 0, 0, w, h);
    } else {
      ctx.drawImage(source, 0, 0, w, h);
    }
  } finally {
    bitmap?.close();
  }
  return canvasToBlob(canvas, "image/jpeg", 0.82);
}

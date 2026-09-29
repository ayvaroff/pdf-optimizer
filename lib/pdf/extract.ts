import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
import type { PageSource } from "../types";
import { analyzePageOperators } from "./operators";
import { loadPdfJs, PDFJS_ASSET_OPTIONS } from "./pdfjs";
import { RawPdf } from "./raw-images";
import { clampRenderDpi, encodeCanvas, makeThumbnail, renderPageToCanvas } from "./render";

export interface OpenedDocument {
  pdf: PDFDocumentProxy;
  /** Owns the worker connection; call `destroy()` when done with the document. */
  task: PDFDocumentLoadingTask;
  /** Null when the raw scan failed; every page is then rendered. */
  raw: RawPdf | null;
  pageCount: number;
}

export async function openDocument(file: File): Promise<OpenedDocument> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const pdfjs = await loadPdfJs();
  // pdf.js transfers the buffer it receives to its worker, so give it a copy and keep ours.
  const task = pdfjs.getDocument({ data: bytes.slice(), ...PDFJS_ASSET_OPTIONS });
  const pdf = await task.promise;
  let raw: RawPdf | null = null;
  try {
    raw = await RawPdf.scan(bytes);
  } catch {
    raw = null;
  }
  return { pdf, task, raw, pageCount: pdf.numPages };
}

export interface ExtractedPage {
  widthPt: number;
  heightPt: number;
  source: PageSource;
  thumbnail: Blob;
}

export interface ExtractOptions {
  thumbnailWidth: number;
  /** Upper bound for rasterizing pages that cannot be extracted. */
  maxRenderDpi: number;
}

/**
 * Obtains the image for one page. Tries to copy the original JPEG out of the
 * file; when the page is anything other than a single full-page JPEG, it is
 * rasterized with pdf.js instead.
 */
export async function extractPage(
  doc: OpenedDocument,
  index: number,
  options: ExtractOptions,
): Promise<ExtractedPage> {
  const pdfjs = await loadPdfJs();
  const page = await doc.pdf.getPage(index + 1);
  try {
    const viewport = page.getViewport({ scale: 1 });
    const widthPt = viewport.width;
    const heightPt = viewport.height;
    const aspect = widthPt / heightPt;

    const analysis = await analyzePageOperators(pdfjs.OPS, page);
    let note: string | undefined;
    let source: PageSource | null = null;

    if (!analysis.image) {
      note = analysis.reason;
    } else if (page.rotate % 360 !== 0) {
      note = `page is rotated ${page.rotate}°`;
    } else if (!doc.raw) {
      note = "file structure could not be scanned";
    } else if (!page.ref) {
      note = "page has no object reference";
    } else {
      const found = doc.raw.findPageJpeg(page.ref.num, analysis.image);
      if ("reason" in found) {
        note = found.reason;
      } else {
        source = {
          kind: "raw-jpeg",
          blob: new Blob([found.bytes as BlobPart], { type: "image/jpeg" }),
          mime: "image/jpeg",
          width: found.width,
          height: found.height,
          dpi: found.width / (widthPt / 72),
        };
      }
    }

    if (source) {
      const thumbnail = await makeThumbnail(source.blob, options.thumbnailWidth, aspect);
      return { widthPt, heightPt, source, thumbnail };
    }

    // Rasterize. Match the embedded image's resolution when there is one, otherwise 300 dpi.
    const nativeDpi = analysis.image ? analysis.image.width / (widthPt / 72) : 300;
    const dpi = clampRenderDpi(Math.min(options.maxRenderDpi, Math.round(nativeDpi)), widthPt, heightPt);
    const canvas = await renderPageToCanvas(page, dpi);
    const thumbnail = await makeThumbnail(canvas, options.thumbnailWidth, aspect);
    const encoded = await encodeCanvas(canvas);
    canvas.width = canvas.height = 0; // release the bitmap eagerly
    source = {
      kind: "rendered",
      blob: encoded.blob,
      mime: encoded.mime,
      width: encoded.width,
      height: encoded.height,
      dpi: encoded.width / (widthPt / 72),
      note,
    };
    return { widthPt, heightPt, source, thumbnail };
  } finally {
    page.cleanup();
  }
}

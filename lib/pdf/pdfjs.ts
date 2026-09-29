/**
 * Lazily loads pdf.js in the browser and points it at the worker and runtime
 * assets copied into public/pdfjs by scripts/copy-pdfjs-assets.mjs.
 */
export type PdfJsModule = typeof import("pdfjs-dist");

let modulePromise: Promise<PdfJsModule> | null = null;

export function loadPdfJs(): Promise<PdfJsModule> {
  if (!modulePromise) {
    modulePromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
      return m;
    });
  }
  return modulePromise;
}

export const PDFJS_ASSET_OPTIONS = {
  wasmUrl: "/pdfjs/wasm/",
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  cMapUrl: "/pdfjs/cmaps/",
  iccUrl: "/pdfjs/iccs/",
} as const;

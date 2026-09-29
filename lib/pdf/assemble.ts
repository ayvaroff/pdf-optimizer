import { jsPDF } from "jspdf";

export interface AssemblePage {
  widthPt: number;
  heightPt: number;
  blob: Blob;
  mime: string;
}

/**
 * Builds a PDF where each page is exactly its original size and contains one
 * full-page image. JPEG bytes are embedded as-is (DCTDecode); PNGs are
 * re-packed by jsPDF into Flate streams with the same palette and bit depth.
 */
export async function assemblePdf(
  pages: AssemblePage[],
  onProgress?: (done: number, total: number) => void,
): Promise<Blob> {
  if (pages.length === 0) throw new Error("No pages to assemble");
  const orientation = (p: AssemblePage) => (p.widthPt > p.heightPt ? "landscape" : "portrait");

  const doc = new jsPDF({
    unit: "pt",
    format: [pages[0].widthPt, pages[0].heightPt],
    orientation: orientation(pages[0]),
    compress: true,
    putOnlyUsedFonts: true,
  });

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    if (i > 0) doc.addPage([p.widthPt, p.heightPt], orientation(p));
    const bytes = new Uint8Array(await p.blob.arrayBuffer());
    const isPng = p.mime === "image/png";
    doc.addImage({
      imageData: bytes,
      format: isPng ? "PNG" : "JPEG",
      x: 0,
      y: 0,
      width: p.widthPt,
      height: p.heightPt,
      // A unique alias skips jsPDF's expensive content hash used for de-duplication.
      alias: `page-${i + 1}`,
      compression: isPng ? "SLOW" : "NONE",
    });
    onProgress?.(i + 1, pages.length);
    // Let the UI repaint between pages.
    await new Promise((r) => setTimeout(r, 0));
  }
  return doc.output("blob");
}

import sharp from "sharp";
import type { OptimizeParams } from "../types";

export interface OptimizedImage {
  data: Buffer;
  mime: string;
  width: number;
  height: number;
}

/**
 * Builds and runs the sharp pipeline for one page image. Stateless: nothing
 * about the input is logged or retained, and all metadata (EXIF, ICC, XMP) is
 * dropped from the output because sharp strips it unless asked to keep it.
 */
export async function optimizeBuffer(
  input: Buffer,
  params: OptimizeParams,
  pageWidthPt: number,
  pageHeightPt: number,
): Promise<OptimizedImage> {
  let img = sharp(input, {
    failOn: "none",
    limitInputPixels: 120_000_000,
    sequentialRead: true,
    unlimited: false,
  });
  const meta = await img.metadata();

  if (params.dpi > 0) {
    img = img.resize({
      width: Math.max(1, Math.round((pageWidthPt / 72) * params.dpi)),
      height: Math.max(1, Math.round((pageHeightPt / 72) * params.dpi)),
      fit: "inside",
      withoutEnlargement: true,
      kernel: "lanczos3",
    });
  }
  if (meta.hasAlpha) img = img.flatten({ background: "#ffffff" });

  const bilevel = params.threshold > 0;
  if (bilevel) img = img.threshold(params.threshold, { grayscale: true });
  // `grayscale()` alone still writes a 3-component JPEG with this sharp version; forcing the
  // output colourspace is what makes the encoder emit a single channel.
  if (params.grayscale || bilevel) img = img.toColourspace("b-w");

  if (params.format === "jpeg") {
    img = img.jpeg({
      quality: params.quality,
      progressive: params.progressive,
      chromaSubsampling: params.quality >= 90 || params.grayscale || bilevel ? "4:4:4" : "4:2:0",
      // The mozjpeg encoder features that shrink scans without changing their look.
      // Not using `mozjpeg: true` because that also forces progressive output.
      trellisQuantisation: true,
      overshootDeringing: true,
      optimiseCoding: true,
      quantisationTable: 3,
    });
  } else {
    img = img.png({
      palette: true,
      // 2 colours yields a 1-bit PNG; sharp derives the bit depth from the palette size.
      colours: bilevel ? 2 : params.colors,
      dither: bilevel ? 0 : 1.0,
      effort: 8,
      compressionLevel: 9,
    });
  }

  const { data, info } = await img.toBuffer({ resolveWithObject: true });
  return {
    data,
    mime: params.format === "jpeg" ? "image/jpeg" : "image/png",
    width: info.width,
    height: info.height,
  };
}

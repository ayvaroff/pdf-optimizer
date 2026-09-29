import { paramsFromQuery } from "@/lib/params";
import { optimizeBuffer } from "@/lib/server/pipeline";

export const runtime = "nodejs";

/**
 * POST /api/optimize?format=jpeg&dpi=200&gray=0&quality=70&progressive=0&colors=64&threshold=0&pw=595.3&ph=841.9
 * Body: the encoded page image (image/jpeg or image/png).
 * Response: the optimized image, with X-Image-Width / X-Image-Height headers.
 *
 * Stateless and privacy-preserving: the image lives only in memory for the
 * duration of the call, and neither the payload nor its properties are logged.
 */
export async function POST(request: Request): Promise<Response> {
  const { params, pageWidthPt, pageHeightPt } = paramsFromQuery(new URL(request.url).searchParams);

  const input = Buffer.from(await request.arrayBuffer());
  if (input.byteLength === 0) return text(400, "Empty request body");

  let result;
  try {
    result = await optimizeBuffer(input, params, pageWidthPt, pageHeightPt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return text(422, `Could not process image: ${message}`);
  }

  return new Response(new Uint8Array(result.data), {
    status: 200,
    headers: {
      "content-type": result.mime,
      "content-length": String(result.data.byteLength),
      "x-image-width": String(result.width),
      "x-image-height": String(result.height),
      "cache-control": "no-store",
    },
  });
}

function text(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

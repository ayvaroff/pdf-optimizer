# PDF Optimizer

A single-page web app for shrinking scanned PDFs by hand: open a PDF, see every page,
choose compression settings globally or per page, watch the resulting size, and download a
rebuilt PDF. Built with Next.js (App Router), React, TypeScript and Tailwind.

It replaces the manual `pdfimages` → image optimizer → jsPDF workflow with one UI.

## How it works

Everything about the PDF happens in the browser. The server only compresses one image at a
time and keeps nothing.

1. **Unpack (browser, `pdfjs-dist`).** For each page the operator list is inspected. If the
   page paints exactly one image XObject that fills the page and that image is a baseline
   JPEG (`DCTDecode`), its bytes are copied straight out of the file without re-encoding,
   using a small object scanner in `lib/pdf/raw-images.ts` (pdf.js only exposes decoded
   pixels). Anything else (multi-strip scans, JBIG2/CCITT bilevel scans, JPEG 2000, pages
   with text or vector content, rotated pages) is rasterized with pdf.js at the embedded
   image's resolution, or 300 dpi when there is none.
2. **Optimize (server, `sharp`).** `POST /api/optimize` receives one image plus query
   parameters and returns one image. Parameters: target DPI, grayscale, JPEG/PNG, JPEG
   quality, progressive, PNG palette size, black-and-white threshold. Nothing is logged or
   stored. Each change to a page's effective settings triggers a debounced request for that
   page, so the sizes shown are real, not estimates.
3. **Rebuild (browser, `jspdf`).** Each page is created with its original size in points and
   the optimized image placed full-page. JPEGs are embedded as-is; PNGs are repacked by jsPDF
   into Flate streams with the same palette and bit depth.

Rebuilding from images drops any text layer, bookmarks and metadata by design.

### Limits worth knowing

- Memory is bounded by keeping encoded bytes (Blobs) rather than pixels and processing pages
  one at a time. Thumbnails are built once at 320 px wide.
- Canvas area for rasterized pages is capped at 16 megapixels (Safari's limit), which is
  about 400 dpi for A4.

## Project layout

```
app/
  page.tsx                 Home page (server component shell)
  api/optimize/route.ts    The only server endpoint (sharp)
components/
  PdfOptimizer.tsx         State, extraction loop, request scheduling, download
  DropZone.tsx  SettingsForm.tsx  PageCard.tsx  SummaryBar.tsx  PreviewDialog.tsx
lib/
  types.ts  params.ts  format.ts
  pdf/
    syntax.ts              Minimal PDF object parser
    raw-images.ts          Linear object scan; finds a page's JPEG XObject
    operators.ts           "Single full-page image?" check on pdf.js operator lists
    extract.ts             Per-page source: raw JPEG or rendered fallback, plus thumbnail
    render.ts              Canvas rendering, PNG encoding, thumbnails
    assemble.ts            jsPDF assembly
    pdfjs.ts               Lazy pdf.js loader pointing at /public/pdfjs assets
  optimize/
    client.ts              fetch wrapper for /api/optimize
    scheduler.ts           Concurrency-limited, abortable queue keyed by page
  server/
    pipeline.ts            sharp pipeline built from OptimizeParams
scripts/
  copy-pdfjs-assets.mjs    Copies the pdf.js worker, wasm decoders, fonts and CMaps
                           into public/pdfjs before dev/build (gitignored output)
```

## Development

```bash
yarn install
yarn dev        # copies pdf.js assets, then starts Next on http://localhost:3000
yarn typecheck
yarn lint
yarn build
```

The package manager is Yarn 4 (`.yarnrc.yml`, `yarn.lock`). `sharp` is pinned to the
version Next.js itself depends on; Next keeps it out of the server bundle automatically.

## License

[MIT](LICENSE)

// Copies the pdf.js worker and its runtime assets (wasm decoders, standard
// fonts, CMaps, ICC profiles) from node_modules into public/pdfjs so the
// browser can fetch them from the same origin. Runs before `dev` and `build`,
// so the copied files always match the installed pdfjs-dist version.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgDir = dirname(require.resolve("pdfjs-dist/package.json"));
const { version } = require("pdfjs-dist/package.json");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dest = join(root, "public", "pdfjs");

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });

cpSync(join(pkgDir, "build", "pdf.worker.min.mjs"), join(dest, "pdf.worker.min.mjs"));
for (const dir of ["wasm", "standard_fonts", "cmaps", "iccs"]) {
  cpSync(join(pkgDir, dir), join(dest, dir), { recursive: true });
}
writeFileSync(join(dest, "VERSION"), `${version}\n`);
console.log(`pdfjs-dist ${version} assets copied to public/pdfjs`);

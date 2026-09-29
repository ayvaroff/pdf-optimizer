import { PdfOptimizer } from "@/components/PdfOptimizer";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col bg-zinc-50 font-sans dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-baseline gap-x-4 gap-y-1 px-6 py-4">
          <h1 className="text-xl font-semibold tracking-tight">PDF Optimizer</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Shrink scanned PDFs page by page. Nothing is stored; only page images are sent to the server for compression.
          </p>
        </div>
      </header>
      <main className="mx-auto w-full max-w-screen-2xl flex-1 px-6 py-6">
        <PdfOptimizer />
      </main>
    </div>
  );
}

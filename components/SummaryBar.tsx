"use client";

import { formatBytes } from "@/lib/format";

interface Props {
  fileName: string;
  fileSize: number;
  pageCount: number;
  includedCount: number;
  readyPages: number;
  onSetAllIncluded: (included: boolean) => void;
  optimizedTotal: number;
  building: { done: number; total: number } | null;
  onDownload: () => void;
  onReset: () => void;
}

export function SummaryBar(props: Props) {
  const { fileName, fileSize, pageCount, includedCount, readyPages, optimizedTotal, building, onDownload, onReset, onSetAllIncluded } = props;
  const complete = readyPages === includedCount && includedCount > 0;
  // Each page costs roughly 200 bytes of structure on top of its image stream.
  const estimate = optimizedTotal + includedCount * 200 + 2048;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={fileName}>
          {fileName}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm text-zinc-500 dark:text-zinc-400">
          <span>
            {includedCount === pageCount ? pageCount : `${includedCount} of ${pageCount}`} {pageCount === 1 ? "page" : "pages"} ·{" "}
            {formatBytes(fileSize)}
          </span>
          <span className="text-xs">
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => onSetAllIncluded(true)}>
              all
            </button>
            {" / "}
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => onSetAllIncluded(false)}>
              none
            </button>
          </span>
        </div>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-sm text-zinc-500 dark:text-zinc-400">Optimized</span>
        <span className="text-xl font-semibold tabular-nums">{complete ? "≈" : "…"} {formatBytes(estimate)}</span>
        {complete && fileSize > 0 && (
          <span className={["text-sm tabular-nums", estimate < fileSize ? "text-emerald-600 dark:text-emerald-400" : "text-red-600"].join(" ")}>
            {estimate < fileSize ? "−" : "+"}
            {Math.abs(Math.round((1 - estimate / fileSize) * 100))}%
          </span>
        )}
      </div>
      {!complete && includedCount > 0 && (
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {readyPages}/{includedCount} pages ready
        </span>
      )}
      {includedCount === 0 && <span className="text-sm text-amber-600 dark:text-amber-400">No pages selected</span>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onReset}
          className="rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          Open another
        </button>
        <button
          type="button"
          onClick={onDownload}
          disabled={!complete || !!building}
          className="rounded-md bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-50 disabled:hover:bg-sky-600"
        >
          {building ? `Building ${building.done}/${building.total}…` : "Download PDF"}
        </button>
      </div>
    </div>
  );
}

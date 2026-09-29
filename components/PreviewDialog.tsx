"use client";

import { formatBytes } from "@/lib/format";
import type { PageState } from "@/lib/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { useObjectUrl } from "./useObjectUrl";

interface Props {
  page: PageState;
  onClose: () => void;
}

type Zoom = "fit" | 1 | 2;

/**
 * Side-by-side comparison of the page's source image and its optimized
 * version. Both are displayed at the same size (the optimized one is
 * stretched to the original's pixel size) so resolution loss and compression
 * artefacts are visible, and the two panes scroll together.
 */
export function PreviewDialog({ page, onClose }: Props) {
  const [zoom, setZoom] = useState<Zoom>(1);
  const sourceUrl = useObjectUrl(page.source?.blob);
  const resultUrl = useObjectUrl(page.result?.blob);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const syncScroll = useCallback((from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollTop = from.scrollTop;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  }, []);

  const source = page.source;
  const result = page.result;
  const imgStyle = zoom === "fit" || !source ? undefined : { width: source.width * zoom, maxWidth: "none" };
  const imgClass = zoom === "fit" ? "block h-auto w-full" : "block h-auto";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Page ${page.index + 1} comparison`}
      className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-zinc-100"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-2 text-sm">
        <span className="font-medium">Page {page.index + 1}</span>
        <div className="inline-flex overflow-hidden rounded-md border border-zinc-600">
          {(["fit", 1, 2] as const).map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZoom(z)}
              className={["px-3 py-1", zoom === z ? "bg-zinc-100 text-zinc-900" : "hover:bg-zinc-800"].join(" ")}
            >
              {z === "fit" ? "Fit" : `${z * 100}%`}
            </button>
          ))}
        </div>
        <span className="text-zinc-400">Zoom is relative to the original image; the optimized one is shown at the same size.</span>
        <span className="ml-auto text-zinc-500">Esc closes</span>
        <button type="button" onClick={onClose} className="rounded px-2 py-1 hover:bg-zinc-800" aria-label="Close">
          ✕
        </button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-2 divide-x divide-zinc-800">
        <Pane
          ref={leftRef}
          title="Original"
          detail={source && `${source.width}×${source.height} px · ${formatBytes(source.blob.size)} · ${source.kind === "raw-jpeg" ? "JPEG copied from PDF" : "rendered"}`}
          onScroll={() => syncScroll(leftRef.current, rightRef.current)}
        >
          {sourceUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={sourceUrl} alt={`Page ${page.index + 1} original`} className={imgClass} style={imgStyle} draggable={false} />
          )}
        </Pane>
        <Pane
          ref={rightRef}
          title="Optimized"
          detail={result && `${result.width}×${result.height} px · ${formatBytes(result.blob.size)} · ${result.mime.replace("image/", "").toUpperCase()}`}
          onScroll={() => syncScroll(rightRef.current, leftRef.current)}
        >
          {resultUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={resultUrl} alt={`Page ${page.index + 1} optimized`} className={imgClass} style={imgStyle} draggable={false} />
          )}
        </Pane>
      </div>
    </div>
  );
}

interface PaneProps {
  ref: React.Ref<HTMLDivElement>;
  title: string;
  detail: string | undefined | false;
  onScroll: () => void;
  children: React.ReactNode;
}

function Pane({ ref, title, detail, onScroll, children }: PaneProps) {
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex items-baseline gap-2 px-4 py-1.5 text-xs">
        <span className="font-medium">{title}</span>
        <span className="text-zinc-400">{detail}</span>
      </div>
      <div ref={ref} onScroll={onScroll} className="min-h-0 flex-1 overflow-auto bg-zinc-900">
        {children}
      </div>
    </div>
  );
}

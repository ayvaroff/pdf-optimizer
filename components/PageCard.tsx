"use client";

import { formatBytes, ptToMm } from "@/lib/format";
import { mergeParams, paramsKey } from "@/lib/params";
import type { OptimizeParams, PageState } from "@/lib/types";
import { useState, type DragEvent } from "react";
import { SettingsForm } from "./SettingsForm";

interface Props {
  page: PageState;
  /** Current position in the output order, zero-based. */
  position: number;
  global: OptimizeParams;
  dragging: boolean;
  dropTarget: boolean;
  onOverride: (index: number, override: OptimizeParams | null) => void;
  onIncluded: (index: number, included: boolean) => void;
  onCompare: (index: number) => void;
  onDragStart: (index: number) => void;
  onDragEnd: () => void;
  onDragEnter: (index: number) => void;
  onDrop: (index: number) => void;
}

const DRAG_MIME = "application/x-pdf-optimizer-page";

export function PageCard(props: Props) {
  const { page, position, global, dragging, dropTarget } = props;
  const [editing, setEditing] = useState(false);
  const effective = mergeParams(global, page.override);
  const fresh = page.result?.paramsKey === paramsKey(effective);
  const src = page.source;
  const busy =
    page.included &&
    (page.status === "queued" || page.status === "optimizing" || (src && !fresh && page.status !== "error"));

  const handleDragStart = (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_MIME, String(page.index));
    e.dataTransfer.effectAllowed = "move";
    props.onDragStart(page.index);
  };
  const handleDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault(); // required for the drop event to fire
    e.dataTransfer.dropEffect = "move";
  };
  const handleDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME)) return;
    e.preventDefault();
    props.onDrop(page.index);
  };

  return (
    <li
      onDragOver={handleDragOver}
      onDragEnter={(e) => {
        if (e.dataTransfer.types.includes(DRAG_MIME)) props.onDragEnter(page.index);
      }}
      onDrop={handleDrop}
      className={[
        "flex flex-col overflow-hidden rounded-xl border bg-white shadow-sm transition-[opacity,box-shadow] dark:bg-zinc-900",
        dropTarget ? "border-sky-500 ring-2 ring-sky-500/50" : "border-zinc-200 dark:border-zinc-800",
        dragging ? "opacity-40" : "",
        !page.included && !dragging ? "opacity-60" : "",
      ].join(" ")}
    >
      <div
        draggable={!!src}
        onDragStart={handleDragStart}
        onDragEnd={props.onDragEnd}
        title={src ? "Drag to reorder" : undefined}
        className={[
          "relative flex aspect-[1/1.3] items-center justify-center bg-zinc-100 dark:bg-zinc-800",
          src ? "cursor-grab active:cursor-grabbing" : "",
        ].join(" ")}
      >
        {page.thumbUrl ? (
          // Object URLs are not served through next/image; plain img is the right tool here.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={page.thumbUrl}
            alt={`Page ${page.index + 1}`}
            className={["max-h-full max-w-full object-contain", page.included ? "" : "grayscale"].join(" ")}
            draggable={false}
          />
        ) : page.sourceError ? (
          <span className="px-4 text-center text-xs text-red-600 dark:text-red-400">{page.sourceError}</span>
        ) : (
          <span className="text-xs text-zinc-500">Extracting…</span>
        )}
        <span
          className="absolute left-2 top-2 rounded bg-black/70 px-1.5 py-0.5 text-xs font-medium text-white"
          title={position !== page.index ? `Originally page ${page.index + 1}` : undefined}
        >
          {position + 1}
          {position !== page.index && <span className="ml-1 font-normal text-white/70">(was {page.index + 1})</span>}
        </span>
        {src && (
          <span
            title={src.note}
            className={[
              "absolute right-2 top-2 rounded px-1.5 py-0.5 text-[11px] font-medium",
              src.kind === "raw-jpeg" ? "bg-emerald-600/90 text-white" : "bg-amber-500/90 text-black",
            ].join(" ")}
          >
            {src.kind === "raw-jpeg" ? "JPEG copied" : "rendered"}
          </span>
        )}
        {page.override && (
          <span className="absolute bottom-2 left-2 rounded bg-sky-600/90 px-1.5 py-0.5 text-[11px] font-medium text-white">
            custom
          </span>
        )}
        {!page.included && (
          <span className="absolute bottom-2 right-2 rounded bg-zinc-700/90 px-1.5 py-0.5 text-[11px] font-medium text-white">
            excluded
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1 p-3 text-xs">
        <label className="inline-flex items-center gap-1.5">
          <input
            type="checkbox"
            className="size-3.5"
            checked={page.included}
            onChange={(e) => props.onIncluded(page.index, e.target.checked)}
          />
          Include in PDF
        </label>
        {src ? (
          <>
            <div className="text-zinc-500 dark:text-zinc-400">
              {src.width}×{src.height} px · {Math.round(src.dpi)} dpi · {ptToMm(page.widthPt)}×{ptToMm(page.heightPt)} mm
            </div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-zinc-600 dark:text-zinc-300">{formatBytes(src.blob.size)}</span>
              <span className="text-zinc-400">→</span>
              <span className={["font-semibold tabular-nums", fresh ? "" : "opacity-50"].join(" ")}>
                {page.result ? formatBytes(page.result.blob.size) : "…"}
              </span>
              {page.result && (
                <span className={["tabular-nums text-zinc-500", fresh ? "" : "opacity-50"].join(" ")}>
                  {Math.round((1 - page.result.blob.size / src.blob.size) * 100)}% smaller
                </span>
              )}
            </div>
            {src.note && src.kind === "rendered" && (
              <div className="text-[11px] text-amber-700 dark:text-amber-400">{src.note}</div>
            )}
          </>
        ) : (
          <div className="text-zinc-500">{page.sourceError ? "Failed" : "Reading page…"}</div>
        )}
        <div className="flex h-4 items-center gap-2">
          {busy && (
            <span className="inline-flex items-center gap-1 text-sky-600 dark:text-sky-400">
              <span className="size-2 animate-pulse rounded-full bg-current" />
              {page.status === "optimizing" ? "Optimizing…" : "Waiting…"}
            </span>
          )}
          {page.status === "error" && page.error && (
            <span className="truncate text-red-600 dark:text-red-400" title={page.error}>
              {page.error}
            </span>
          )}
        </div>
        <div className="mt-1 flex gap-2">
          <button type="button" className={btnCls} disabled={!src} onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : page.override ? "Edit settings" : "Override"}
          </button>
          <button type="button" className={btnCls} disabled={!src || !page.result} onClick={() => props.onCompare(page.index)}>
            Compare
          </button>
        </div>
      </div>

      {editing && src && (
        <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
          <SettingsForm
            compact
            idPrefix={`page-${page.index}`}
            value={effective}
            onChange={(next) => props.onOverride(page.index, next)}
          />
          {page.override && (
            <button
              type="button"
              className="mt-3 text-xs text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
              onClick={() => {
                props.onOverride(page.index, null);
                setEditing(false);
              }}
            >
              Reset to global settings
            </button>
          )}
        </div>
      )}
    </li>
  );
}

const btnCls =
  "rounded-md border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 disabled:opacity-40 disabled:hover:bg-transparent dark:border-zinc-600 dark:hover:bg-zinc-800";

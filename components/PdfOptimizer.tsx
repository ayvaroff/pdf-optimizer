"use client";

import { assemblePdf } from "@/lib/pdf/assemble";
import { extractPage, openDocument } from "@/lib/pdf/extract";
import { OptimizeQueue, type QueueUpdate } from "@/lib/optimize/scheduler";
import { DEFAULT_PARAMS, mergeParams, paramsKey } from "@/lib/params";
import type { DocumentState, OptimizeParams, PageSource, PageState } from "@/lib/types";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { DropZone } from "./DropZone";
import { PageCard } from "./PageCard";
import { PreviewDialog } from "./PreviewDialog";
import { SettingsForm } from "./SettingsForm";
import { SummaryBar } from "./SummaryBar";

interface State {
  doc: DocumentState | null;
  global: OptimizeParams;
  loading: boolean;
  loadError: string | null;
  building: { done: number; total: number } | null;
}

type Action =
  | { type: "loading" }
  | { type: "open"; fileName: string; fileSize: number; pageCount: number }
  | { type: "load-error"; error: string }
  | { type: "page-extracted"; index: number; widthPt: number; heightPt: number; source: PageSource; thumbUrl: string }
  | { type: "page-failed"; index: number; error: string }
  | { type: "queue"; update: QueueUpdate }
  | { type: "set-global"; params: OptimizeParams }
  | { type: "set-override"; index: number; override: OptimizeParams | null }
  | { type: "building"; value: { done: number; total: number } | null }
  | { type: "reset" };

const initialState: State = { doc: null, global: DEFAULT_PARAMS, loading: false, loadError: null, building: null };

function updatePage(state: State, index: number, patch: Partial<PageState>): State {
  if (!state.doc) return state;
  const pages = state.doc.pages.map((p) => (p.index === index ? { ...p, ...patch } : p));
  return { ...state, doc: { ...state.doc, pages } };
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "loading":
      return { ...state, loading: true, loadError: null, doc: null, building: null };
    case "open": {
      const pages: PageState[] = Array.from({ length: action.pageCount }, (_, index) => ({
        index,
        widthPt: 0,
        heightPt: 0,
        override: null,
        status: "loading",
      }));
      return {
        ...state,
        doc: { fileName: action.fileName, fileSize: action.fileSize, pageCount: action.pageCount, pages },
      };
    }
    case "load-error":
      return { ...state, loading: false, loadError: action.error, doc: null };
    case "page-extracted":
      return updatePage(state, action.index, {
        widthPt: action.widthPt,
        heightPt: action.heightPt,
        source: action.source,
        thumbUrl: action.thumbUrl,
        status: "ready",
        result: undefined,
        error: undefined,
      });
    case "page-failed":
      return updatePage(state, action.index, { sourceError: action.error, status: "error", error: action.error });
    case "queue": {
      const u = action.update;
      const page = state.doc?.pages[u.index];
      if (!page?.source) return state;
      switch (u.type) {
        case "queued":
          return updatePage(state, u.index, { status: "queued" });
        case "optimizing":
          return updatePage(state, u.index, { status: "optimizing" });
        case "done":
          return updatePage(state, u.index, { status: "done", result: u.result, error: undefined });
        case "error":
          return updatePage(state, u.index, { status: "error", error: u.error });
      }
      return state;
    }
    case "set-global":
      return { ...state, global: action.params };
    case "set-override":
      return updatePage(state, action.index, { override: action.override });
    case "building":
      return { ...state, building: action.value };
    case "reset":
      return { ...initialState, global: state.global };
  }
}

const THUMBNAIL_WIDTH = 320;
const MAX_RENDER_DPI = 600;
const CONCURRENT_UPLOADS = 3;

export function PdfOptimizer() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [compareIndex, setCompareIndex] = useState<number | null>(null);
  const queueRef = useRef<OptimizeQueue | null>(null);
  const loadToken = useRef(0);
  const objectUrls = useRef<string[]>([]);

  // One queue for the component's lifetime.
  useEffect(() => {
    const queue = new OptimizeQueue(CONCURRENT_UPLOADS, (update) => dispatch({ type: "queue", update }));
    queueRef.current = queue;
    return () => {
      queue.dispose();
      for (const u of objectUrls.current) URL.revokeObjectURL(u);
    };
  }, []);

  // Keep results in sync with settings. Debounced so slider drags don't fire a request per pixel.
  const pages = state.doc?.pages;
  useEffect(() => {
    if (!pages) return;
    const t = setTimeout(() => queueRef.current?.sync(pages, state.global), 250);
    return () => clearTimeout(t);
  }, [pages, state.global]);

  const reset = useCallback(() => {
    loadToken.current++;
    queueRef.current?.sync([], DEFAULT_PARAMS);
    for (const u of objectUrls.current) URL.revokeObjectURL(u);
    objectUrls.current = [];
    setCompareIndex(null);
    dispatch({ type: "reset" });
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      reset();
      const token = loadToken.current;
      dispatch({ type: "loading" });
      let doc;
      try {
        doc = await openDocument(file);
      } catch (err) {
        dispatch({ type: "load-error", error: err instanceof Error ? err.message : "Could not open the PDF" });
        return;
      }
      if (token !== loadToken.current) {
        await doc.task.destroy();
        return;
      }
      dispatch({ type: "open", fileName: file.name, fileSize: file.size, pageCount: doc.pageCount });
      try {
        for (let i = 0; i < doc.pageCount; i++) {
          if (token !== loadToken.current) break;
          try {
            const extracted = await extractPage(doc, i, { thumbnailWidth: THUMBNAIL_WIDTH, maxRenderDpi: MAX_RENDER_DPI });
            if (token !== loadToken.current) break;
            const thumbUrl = URL.createObjectURL(extracted.thumbnail);
            objectUrls.current.push(thumbUrl);
            dispatch({ type: "page-extracted", index: i, ...extracted, thumbUrl });
          } catch (err) {
            dispatch({ type: "page-failed", index: i, error: err instanceof Error ? err.message : "Extraction failed" });
          }
        }
      } finally {
        await doc.task.destroy();
      }
    },
    [reset],
  );

  const handleDownload = useCallback(async () => {
    const doc = state.doc;
    if (!doc) return;
    const items = doc.pages.map((p) => {
      if (!p.result) throw new Error(`Page ${p.index + 1} is not ready`);
      return { widthPt: p.widthPt, heightPt: p.heightPt, blob: p.result.blob, mime: p.result.mime };
    });
    dispatch({ type: "building", value: { done: 0, total: items.length } });
    try {
      const blob = await assemblePdf(items, (done, total) => dispatch({ type: "building", value: { done, total } }));
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = doc.fileName.replace(/\.pdf$/i, "") + "-optimized.pdf";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Could not build the PDF");
    } finally {
      dispatch({ type: "building", value: null });
    }
  }, [state.doc]);

  const doc = state.doc;
  const readyPages = doc
    ? doc.pages.filter((p) => p.result && p.result.paramsKey === paramsKey(mergeParams(state.global, p.override))).length
    : 0;
  const optimizedTotal = doc ? doc.pages.reduce((sum, p) => sum + (p.result?.blob.size ?? 0), 0) : 0;
  const comparePage = compareIndex !== null ? doc?.pages[compareIndex] : undefined;

  return (
    <div className="flex flex-col gap-6">
      {!doc && (
        <>
          <DropZone onFile={handleFile} disabled={state.loading} />
          {state.loading && <p className="text-center text-sm text-zinc-500">Opening PDF…</p>}
          {state.loadError && <p className="text-center text-sm text-red-600 dark:text-red-400">{state.loadError}</p>}
        </>
      )}

      {doc && (
        <>
          <SummaryBar
            fileName={doc.fileName}
            fileSize={doc.fileSize}
            pageCount={doc.pageCount}
            readyPages={readyPages}
            optimizedTotal={optimizedTotal}
            building={state.building}
            onDownload={handleDownload}
            onReset={reset}
          />

          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="mb-3 text-sm font-semibold">Settings for all pages</h2>
            <SettingsForm idPrefix="global" value={state.global} onChange={(params) => dispatch({ type: "set-global", params })} />
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
              Pages with custom settings keep them when these change. Use “Override” on a page to set its own values.
            </p>
          </section>

          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {doc.pages.map((page) => (
              <PageCard
                key={page.index}
                page={page}
                global={state.global}
                onOverride={(index, override) => dispatch({ type: "set-override", index, override })}
                onCompare={setCompareIndex}
              />
            ))}
          </ul>
        </>
      )}

      {comparePage && <PreviewDialog page={comparePage} onClose={() => setCompareIndex(null)} />}
    </div>
  );
}

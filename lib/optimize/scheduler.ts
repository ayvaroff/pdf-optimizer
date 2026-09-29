import { mergeParams, paramsKey } from "../params";
import type { OptimizeParams, OptimizeResult, PageState } from "../types";
import { optimizeImage } from "./client";

export type QueueUpdate =
  | { type: "queued"; index: number }
  | { type: "optimizing"; index: number }
  | { type: "done"; index: number; result: OptimizeResult }
  | { type: "error"; index: number; error: string };

interface Job {
  index: number;
  key: string;
  page: PageState;
  params: OptimizeParams;
}

/**
 * Keeps every page's optimized result in sync with its effective parameters.
 * `sync` is idempotent: call it whenever pages or settings change and it will
 * start, keep, or abort requests as needed, running at most `concurrency`
 * uploads at a time.
 */
export class OptimizeQueue {
  private pending = new Map<number, Job>();
  private active = new Map<number, { key: string; controller: AbortController }>();
  private disposed = false;

  constructor(
    private readonly concurrency: number,
    private readonly onUpdate: (u: QueueUpdate) => void,
  ) {}

  sync(pages: PageState[], global: OptimizeParams): void {
    if (this.disposed) return;
    const wanted = new Set<number>();
    for (const page of pages) {
      // Excluded pages are not optimized; any in-flight request for them is aborted below.
      if (!page.source || !page.included) continue;
      const params = mergeParams(global, page.override);
      const key = paramsKey(params);
      wanted.add(page.index);

      const running = this.active.get(page.index);
      if (running && running.key !== key) {
        running.controller.abort();
        this.active.delete(page.index);
      } else if (running) {
        this.pending.delete(page.index);
        continue;
      }

      if (page.result?.paramsKey === key) {
        this.pending.delete(page.index);
        continue;
      }
      const queued = this.pending.get(page.index);
      if (queued?.key === key) continue;
      this.pending.set(page.index, { index: page.index, key, page, params });
      this.onUpdate({ type: "queued", index: page.index });
    }
    // Drop jobs for pages that disappeared (new document loaded).
    for (const idx of [...this.pending.keys()]) if (!wanted.has(idx)) this.pending.delete(idx);
    for (const [idx, run] of this.active) {
      if (!wanted.has(idx)) {
        run.controller.abort();
        this.active.delete(idx);
      }
    }
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    this.pending.clear();
    for (const run of this.active.values()) run.controller.abort();
    this.active.clear();
  }

  private pump(): void {
    while (!this.disposed && this.active.size < this.concurrency && this.pending.size > 0) {
      const [index, job] = this.pending.entries().next().value as [number, Job];
      this.pending.delete(index);
      void this.run(job);
    }
  }

  private async run(job: Job): Promise<void> {
    const controller = new AbortController();
    this.active.set(job.index, { key: job.key, controller });
    this.onUpdate({ type: "optimizing", index: job.index });
    try {
      const result = await optimizeImage(
        job.page.source!,
        job.params,
        job.page.widthPt,
        job.page.heightPt,
        job.key,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      this.onUpdate({ type: "done", index: job.index, result });
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      this.onUpdate({ type: "error", index: job.index, error: message });
    } finally {
      if (this.active.get(job.index)?.controller === controller) this.active.delete(job.index);
      this.pump();
    }
  }
}

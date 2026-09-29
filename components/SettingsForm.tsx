"use client";

import { DPI_CHOICES } from "@/lib/params";
import type { OptimizeParams } from "@/lib/types";

interface Props {
  value: OptimizeParams;
  onChange: (next: OptimizeParams) => void;
  /** Tighter layout for use inside a page card. */
  compact?: boolean;
  idPrefix: string;
}

const COLOR_CHOICES = [256, 128, 64, 32, 16, 8, 4, 2];

export function SettingsForm({ value, onChange, compact, idPrefix }: Props) {
  const set = <K extends keyof OptimizeParams>(key: K, v: OptimizeParams[K]) => onChange({ ...value, [key]: v });
  const id = (s: string) => `${idPrefix}-${s}`;
  const isJpeg = value.format === "jpeg";
  const bilevel = value.threshold > 0;

  return (
    <div className={compact ? "grid grid-cols-2 gap-x-4 gap-y-3 text-sm" : "grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3 lg:grid-cols-6"}>
      <Field label="Resolution" htmlFor={id("dpi")}>
        <select id={id("dpi")} className={selectCls} value={value.dpi} onChange={(e) => set("dpi", Number(e.target.value))}>
          {DPI_CHOICES.map((d) => (
            <option key={d} value={d}>
              {d === 0 ? "Keep source" : `${d} dpi`}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Format" htmlFor={id("format")}>
        <div className="flex w-full overflow-hidden rounded-md border border-zinc-300 dark:border-zinc-600" role="radiogroup" id={id("format")}>
          {(["jpeg", "png"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={value.format === f}
              onClick={() => set("format", f)}
              className={[
                "flex-1 px-2 py-1.5 text-sm uppercase",
                value.format === f
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "bg-white text-zinc-700 hover:bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700",
              ].join(" ")}
            >
              {f}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Colour" htmlFor={id("gray")}>
        <label className="inline-flex items-center gap-2 py-1.5">
          <input
            id={id("gray")}
            type="checkbox"
            className="size-4"
            checked={value.grayscale || bilevel}
            disabled={bilevel}
            onChange={(e) => set("grayscale", e.target.checked)}
          />
          Grayscale
        </label>
      </Field>

      {isJpeg ? (
        <Field label={`JPEG quality: ${value.quality}`} htmlFor={id("quality")}>
          <input
            id={id("quality")}
            type="range"
            min={1}
            max={100}
            value={value.quality}
            className="w-full"
            onChange={(e) => set("quality", Number(e.target.value))}
          />
        </Field>
      ) : (
        <Field label="Palette" htmlFor={id("colors")}>
          <select
            id={id("colors")}
            className={selectCls}
            value={bilevel ? 2 : value.colors}
            disabled={bilevel}
            onChange={(e) => set("colors", Number(e.target.value))}
          >
            {COLOR_CHOICES.map((c) => (
              <option key={c} value={c}>
                {c} colours
              </option>
            ))}
          </select>
        </Field>
      )}

      {isJpeg ? (
        <Field label="Encoding" htmlFor={id("progressive")}>
          <label className="inline-flex items-center gap-2 py-1.5">
            <input
              id={id("progressive")}
              type="checkbox"
              className="size-4"
              checked={value.progressive}
              onChange={(e) => set("progressive", e.target.checked)}
            />
            Progressive
          </label>
        </Field>
      ) : (
        <div />
      )}

      <Field label={bilevel ? `Black & white: ${value.threshold}` : "Black & white"} htmlFor={id("threshold")}>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            className="size-4"
            aria-label="Convert to black and white"
            checked={bilevel}
            onChange={(e) => set("threshold", e.target.checked ? 160 : 0)}
          />
          <input
            id={id("threshold")}
            type="range"
            min={1}
            max={255}
            value={bilevel ? value.threshold : 160}
            disabled={!bilevel}
            className="w-full disabled:opacity-40"
            onChange={(e) => set("threshold", Number(e.target.value))}
          />
        </div>
      </Field>
    </div>
  );
}

const selectCls =
  "w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm dark:border-zinc-600 dark:bg-zinc-800";

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={htmlFor} className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {label}
      </label>
      {children}
    </div>
  );
}

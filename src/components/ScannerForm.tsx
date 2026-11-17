"use client";

import { ArrowRight, FileText, LoaderCircle, TriangleAlert } from "lucide-react";
import type { FormEvent } from "react";
import { ScanProgress } from "./ScanProgress";

interface ScannerFormProps {
  url: string;
  onUrlChange: (value: string) => void;
  onScan: () => void;
  onDemo: () => void;
  scanning: boolean;
  activeStep: number;
  error: string | null;
}

export function ScannerForm({ url, onUrlChange, onScan, onDemo, scanning, activeStep, error }: ScannerFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onScan();
  };

  return (
    <div className="space-y-3">
      <form onSubmit={handleSubmit} className="flex flex-col gap-2 sm:flex-row" noValidate>
        <label htmlFor="scan-url" className="sr-only">
          Website URL
        </label>
        <input
          id="scan-url"
          type="url"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://your-app.com"
          value={url}
          onChange={(event) => onUrlChange(event.target.value)}
          disabled={scanning}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "scan-error" : "scan-disclaimer"}
          className="h-11 min-w-0 flex-1 rounded-md border border-line bg-card px-3.5 font-mono text-sm text-fg placeholder:text-zinc-600 transition-colors focus:border-zinc-500 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={scanning}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-fg px-5 text-sm font-semibold text-ink transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {scanning ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              Scanning…
            </>
          ) : (
            <>
              Run Security Check
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </>
          )}
        </button>
      </form>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={onDemo}
          disabled={scanning}
          className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-card px-3.5 text-sm font-medium text-zinc-200 transition-colors hover:border-zinc-600 hover:text-fg disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          Load Demo Report
        </button>
        <p id="scan-disclaimer" className="text-xs leading-relaxed text-zinc-500">
          Only scan domains you own or have permission to check. Passive configuration check only.
        </p>
      </div>

      {error && (
        <div
          id="scan-error"
          role="alert"
          className="animate-fade-in flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {scanning && <ScanProgress activeStep={activeStep} />}
    </div>
  );
}

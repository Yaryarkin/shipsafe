"use client";

import { ArrowRight, FileArchive, Globe, LoaderCircle, Lock, Package, Radio, TriangleAlert } from "lucide-react";
import { useRef, useState, type DragEvent, type FormEvent } from "react";
import { ScanProgress } from "./ScanProgress";

export type ScanMode = "url" | "build";

interface ScannerFormProps {
  mode: ScanMode;
  onModeChange: (mode: ScanMode) => void;
  url: string;
  onUrlChange: (value: string) => void;
  onScan: () => void;
  onFileScan: (file: File) => void;
  onDemo: () => void;
  scanning: boolean;
  activeStep: number;
  /** Name of the build being analyzed (build mode). */
  scanningFile: string | null;
  error: string | null;
}

const MODES: Array<{ id: ScanMode; label: string; short: string; icon: typeof Globe }> = [
  { id: "url", label: "Website / API", short: "Website", icon: Globe },
  { id: "build", label: "App / Game build", short: "Build", icon: Package },
];

const PRIMARY_BUTTON =
  "inline-flex h-11 items-center justify-center gap-2 rounded-md bg-fg px-5 text-sm font-medium text-ink transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60";

function BuildDropZone({ onFile, disabled }: { onFile: (file: File) => void; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      onDragOver={(event) => {
        event.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      className={`flex flex-col items-center gap-4 rounded-lg border border-dashed px-4 py-8 text-center transition-colors sm:flex-row sm:px-6 sm:py-6 sm:text-left ${
        dragging ? "border-focus bg-raised" : "border-line bg-raised/60"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-card">
        <FileArchive className="h-5 w-5 text-muted" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg">
          Drop an Android <span className="font-mono text-soft">.apk</span> or a build <span className="font-mono text-soft">.zip</span>
        </p>
        <p className="mt-1 text-xs text-muted">WebGL, HTML5, Electron, Unity or Godot exports · up to 150 MB</p>
      </div>
      <button type="button" disabled={disabled} onClick={() => inputRef.current?.click()} className={PRIMARY_BUTTON}>
        Choose file
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".apk,.zip,application/zip,application/vnd.android.package-archive"
        className="sr-only"
        aria-label="Choose an .apk or .zip build"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) onFile(file);
        }}
      />
    </div>
  );
}

export function ScannerForm({
  mode,
  onModeChange,
  url,
  onUrlChange,
  onScan,
  onFileScan,
  onDemo,
  scanning,
  activeStep,
  scanningFile,
  error,
}: ScannerFormProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onScan();
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-line bg-card">
        {/* Mode switch + what this mode does */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5 sm:px-4">
          <div role="tablist" aria-label="What to scan" className="inline-flex rounded-md border border-line bg-raised p-0.5">
            {MODES.map(({ id, label, short, icon: Icon }) => {
              const active = id === mode;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`mode-tab-${id}`}
                  aria-selected={active}
                  aria-controls="scan-panel"
                  disabled={scanning}
                  onClick={() => onModeChange(id)}
                  className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 text-[13px] transition-colors ${
                    active ? "bg-card text-fg shadow-[0_0_0_1px_var(--color-line)]" : "text-muted hover:text-fg"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="sm:hidden">{short}</span>
                  <span className="hidden sm:inline">{label}</span>
                </button>
              );
            })}
          </div>
          <p className="inline-flex items-center gap-1.5 text-xs text-muted">
            {mode === "url" ? (
              <>
                <Radio className="h-3.5 w-3.5" aria-hidden="true" />
                Passive · GET / HEAD only
              </>
            ) : (
              <>
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                Local analysis · nothing is uploaded
              </>
            )}
          </p>
        </div>

        <div id="scan-panel" role="tabpanel" aria-labelledby={`mode-tab-${mode}`} className="p-3 sm:p-4">
          {mode === "url" ? (
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
                className="h-11 w-full min-w-0 shrink-0 rounded-md sm:flex-1 sm:shrink border border-line bg-raised px-3.5 font-mono text-sm text-fg placeholder:text-faint transition-colors focus:border-focus focus:outline-none disabled:opacity-60"
              />
              <button type="submit" disabled={scanning} className={PRIMARY_BUTTON}>
                {scanning ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Scanning…
                  </>
                ) : (
                  <>
                    Run security check
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <BuildDropZone onFile={onFileScan} disabled={scanning} />
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-line px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-4">
          <p id="scan-disclaimer" className="text-xs leading-relaxed text-faint">
            {mode === "url"
              ? "Only scan domains you own or have permission to check."
              : "Only scan builds you own. The archive is unpacked in this tab and never leaves your device."}
          </p>
          <button
            type="button"
            onClick={onDemo}
            disabled={scanning}
            className="inline-flex shrink-0 items-center gap-1 self-start text-xs text-muted underline-offset-4 transition-colors hover:text-fg hover:underline disabled:cursor-not-allowed disabled:opacity-60 sm:self-auto"
          >
            View demo report
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {error && (
        <div
          id="scan-error"
          role="alert"
          className="animate-fade-in flex items-start gap-2 rounded-lg border border-critical/25 bg-critical/10 px-3.5 py-2.5 text-sm text-red-300"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {scanning && mode === "url" && <ScanProgress activeStep={activeStep} />}
      {scanning && mode === "build" && (
        <div className="animate-fade-in flex items-center gap-2 rounded-lg border border-line bg-card px-4 py-3.5 text-sm text-soft" role="status" aria-live="polite">
          <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          <span className="min-w-0 truncate">
            Unpacking and analyzing <span className="font-mono">{scanningFile ?? "build"}</span> locally…
          </span>
        </div>
      )}
    </div>
  );
}

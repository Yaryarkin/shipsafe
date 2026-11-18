"use client";

import { ArrowRight, FileArchive, FileText, Globe, LoaderCircle, Package, ShieldCheck, TriangleAlert } from "lucide-react";
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

const MODES: Array<{ id: ScanMode; label: string; icon: typeof Globe }> = [
  { id: "url", label: "Website / API URL", icon: Globe },
  { id: "build", label: "App / Game Build (.apk / .zip)", icon: Package },
];

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
      className={`rounded-lg border border-dashed px-4 py-7 text-center transition-colors ${
        dragging ? "border-zinc-400 bg-line" : "border-line bg-card"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <FileArchive className="mx-auto h-7 w-7 text-zinc-500" aria-hidden="true" />
      <p className="mt-2 text-sm text-zinc-200">
        Drop an Android <span className="font-mono">.apk</span> or a game / app build <span className="font-mono">.zip</span> here
      </p>
      <p className="mt-1 text-xs text-zinc-500">WebGL, HTML5, Electron, Unity or Godot exports · up to 150 MB</p>
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-md bg-fg px-5 text-sm font-semibold text-ink transition-colors hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-70"
      >
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
      <p className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-line bg-ink px-3 py-1 text-xs text-zinc-400">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
        Runs locally in browser · 0 server upload
      </p>
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
      <div role="tablist" aria-label="What to scan" className="grid grid-cols-2 gap-1 rounded-lg border border-line bg-card p-1">
        {MODES.map(({ id, label, icon: Icon }) => {
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
              className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium transition-colors sm:text-sm ${
                active ? "bg-line text-fg" : "text-zinc-400 hover:text-fg"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div id="scan-panel" role="tabpanel" aria-labelledby={`mode-tab-${mode}`}>
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
        ) : (
          <BuildDropZone onFile={onFileScan} disabled={scanning} />
        )}
      </div>

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
          {mode === "url"
            ? "Only scan domains you own or have permission to check. Passive configuration check only."
            : "Only scan builds you own. The file is unpacked in this tab and never leaves your device."}
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

      {scanning && mode === "url" && <ScanProgress activeStep={activeStep} />}
      {scanning && mode === "build" && (
        <div className="animate-fade-in flex items-center gap-2 rounded-lg border border-line bg-card p-4 text-sm text-zinc-300" role="status" aria-live="polite">
          <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          <span className="min-w-0 truncate">
            Unpacking and analyzing <span className="font-mono">{scanningFile ?? "build"}</span> locally…
          </span>
        </div>
      )}
    </div>
  );
}

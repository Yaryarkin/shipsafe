"use client";

import { ArrowRight, FileArchive, Globe, LoaderCircle, Lock, Package, Radio, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ScanProgress } from "./ScanProgress";
import { useDeviceType } from "@/hooks/useDeviceType";
import { Reveal } from "./Reveal";
import { DEMO_TARGETS, createDemoTarget, type DemoKind } from "@/lib/demo-targets";
import type { ScanMode } from "./ScanProvider";
import { GRADE_TONE } from "./grade-tone";

export type { ScanMode };

interface ScannerFormProps {
  mode: ScanMode;
  onModeChange: (mode: ScanMode) => void;
  url: string;
  onUrlChange: (value: string) => void;
  onScan: () => void;
  onFileScan: (file: File) => void;
  onDemo: (kind: DemoKind) => void;
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
  "btn-primary inline-flex h-11 items-center justify-center gap-2 rounded-lg px-5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60";

function BuildDropZone({ onFile, disabled }: { onFile: (file: File) => void; disabled: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  // Touch devices have no drag and drop: lead with the button instead.
  const { isTouch } = useDeviceType();

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
      className={`flex flex-col items-center gap-4 field rounded-lg border border-dashed px-4 py-8 text-center transition-colors sm:flex-row sm:px-6 sm:py-6 sm:text-left ${
        dragging ? "border-line-strong bg-raised" : "border-line bg-raised"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-line bg-card">
        <FileArchive className="h-5 w-5 text-muted" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-fg">
          {isTouch ? "Pick" : "Drop"} an Android <span className="font-mono text-soft">.apk</span> or a build <span className="font-mono text-soft">.zip</span>
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

const DEMO_GRADES = new Map<DemoKind, ReturnType<typeof createDemoTarget>["grade"]>();

/** One preset: shows the grade the demo scores, so the three buttons read as bad, worse and good at a glance. */
function DemoButton({
  id,
  label,
  host,
  blurb,
  disabled,
  onPick,
}: {
  id: DemoKind;
  label: string;
  host: string;
  blurb: string;
  disabled: boolean;
  onPick: (kind: DemoKind) => void;
}) {
  let grade = DEMO_GRADES.get(id);
  if (!grade) {
    grade = createDemoTarget(id).grade;
    DEMO_GRADES.set(id, grade);
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onPick(id)}
      className="chip flex min-w-0 flex-col items-start gap-1 rounded-md px-3 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="text-sm text-fg">{label}</span>
        <span className={`inline-flex h-5 w-6 shrink-0 items-center justify-center rounded border font-mono text-[11px] font-semibold ${GRADE_TONE[grade].badge}`} aria-label={`Grade ${grade}`}>
          {grade}
        </span>
      </span>
      <span className="max-w-full truncate font-mono text-[11px] text-faint">{host}</span>
      <span className="text-xs leading-relaxed text-muted">{blurb}</span>
    </button>
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
  // A failed scan should be visible without scrolling, especially on a phone where the form fills the screen.
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [error]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onScan();
  };

  return (
    <div className="space-y-3">
      <Reveal index={3} className="surface overflow-hidden rounded-lg">
        {/* Mode switch + what this mode does */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-3 py-2.5 sm:px-4">
          <div role="tablist" aria-label="What to scan" className="chip inline-flex rounded-md p-0.5">
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
                  className={`inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-[13px] transition-colors ${
                    active ? "chip-active" : "text-muted hover:text-fg"
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
                className="h-11 w-full min-w-0 shrink-0 field rounded-lg sm:flex-1 sm:shrink border border-line px-3.5 font-mono text-sm text-fg placeholder:text-faint transition-colors focus:outline-none disabled:opacity-60"
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
        </div>

        <div className="border-t border-line px-3 py-3 sm:px-4" role="group" aria-label="Try a demo target">
          <p className="font-mono text-[11px] uppercase tracking-[0.12em] text-faint">No site handy? Open a full demo report</p>
          <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
            {DEMO_TARGETS.map((target) => (
              <DemoButton key={target.id} id={target.id} label={target.label} host={target.host} blurb={target.blurb} disabled={scanning} onPick={onDemo} />
            ))}
          </div>
        </div>
      </Reveal>

      {error && (
        <div
          id="scan-error"
          role="alert"
          ref={errorRef}
          className="animate-fade-in flex items-start gap-2 rounded-lg border border-critical/25 bg-critical/10 px-3.5 py-2.5 text-sm text-red-300"
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-critical" aria-hidden="true" />
          <span className="min-w-0 break-words">
            {error}
            <span className="mt-1 block text-xs text-muted">Check the address, or open one of the demo reports below.</span>
          </span>
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

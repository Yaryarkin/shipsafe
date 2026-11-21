export const DEFAULT_API_URL: string;
export const FAIL_ON_VALUES: string[];

export interface ActionInputs {
  url: string;
  failOn: "critical" | "warning" | "none";
  minScore: number;
  apiUrl: string;
}

export interface ScanFinding {
  severity: string;
  title: string;
  category: string;
}

export interface ScanResultLike {
  target?: string;
  overallScore: number;
  grade: string;
  summary: { critical?: number; warning?: number; info?: number; passed?: number };
  findings?: ScanFinding[];
}

export interface Evaluation {
  passed: boolean;
  reasons: string[];
}

export function oneLine(value: unknown, max?: number): string;
export function escapeCommandData(value: unknown): string;
export function escapeMarkdownCell(value: unknown): string;
export function parseInputs(
  env: Record<string, string | undefined>,
): { ok: true; value: ActionInputs } | { ok: false; error: string };
export function evaluate(result: ScanResultLike, options: { failOn: string; minScore: number }): Evaluation;
export function renderSummary(result: ScanResultLike, evaluation: Evaluation, inputs: { url: string; apiUrl: string }): string;
export function runScan(
  inputs: { url: string; apiUrl: string },
  options?: {
    fetchImpl?: typeof fetch;
    sleep?: (ms: number) => Promise<void>;
    attempts?: number;
    log?: (line: string) => void;
  },
): Promise<{ ok: true; result: ScanResultLike } | { ok: false; error: string; retryable: boolean }>;
export function main(
  env?: Record<string, string | undefined>,
  io?: {
    log?: (line: string) => void;
    appendFile?: (file: string, data: string) => void;
    runScan?: (
      inputs: ActionInputs,
      options: { log: (line: string) => void },
    ) => Promise<{ ok: true; result: ScanResultLike } | { ok: false; error: string; retryable: boolean }>;
  },
): Promise<number>;

export type ScanErrorCode =
  | "INVALID_URL"
  | "BLOCKED_TARGET"
  | "DNS_FAILURE"
  | "UNREACHABLE"
  | "TIMEOUT"
  | "INTERNAL";

const STATUS_BY_CODE: Record<ScanErrorCode, number> = {
  INVALID_URL: 400,
  BLOCKED_TARGET: 400,
  DNS_FAILURE: 422,
  UNREACHABLE: 422,
  TIMEOUT: 504,
  INTERNAL: 500,
};

export class ScanError extends Error {
  readonly code: ScanErrorCode;
  readonly status: number;

  constructor(code: ScanErrorCode, message: string) {
    super(message);
    this.name = "ScanError";
    this.code = code;
    this.status = STATUS_BY_CODE[code];
  }
}

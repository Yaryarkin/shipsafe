import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import type { TLSSocket } from "node:tls";
import { ScanError } from "./errors";
import { assertSafeUrl, safeLookup, stripBrackets } from "./ssrf";

export const USER_AGENT = "ShipSafe/1.0 (+passive pre-launch configuration check; GET/HEAD only)";

export interface FetchOptions {
  method?: "GET" | "HEAD";
  /** Hard cap on decoded body bytes. Reading stops (without error) once reached. */
  maxBytes: number;
  /** Total budget for the request including redirects. */
  timeoutMs: number;
  followRedirects?: boolean;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

export interface TlsInfo {
  validFrom: string | null;
  validTo: string | null;
  issuer: string | null;
  protocol: string | null;
}

export interface RedirectHop {
  from: string;
  to: string;
  status: number;
}

export interface SafeResponse {
  url: string;
  status: number;
  headers: Record<string, string>;
  setCookies: string[];
  body: Buffer;
  truncated: boolean;
  redirects: RedirectHop[];
  tls: TlsInfo | null;
}

type RawResponse = Omit<SafeResponse, "url" | "redirects">;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export const TLS_ERROR_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "CERT_UNTRUSTED",
  "CERT_REVOKED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

export function errorCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function timeoutError(): NodeJS.ErrnoException {
  const err: NodeJS.ErrnoException = new Error("Request timed out");
  err.code = "ETIMEDOUT";
  return err;
}

function decodeStream(res: http.IncomingMessage): Readable {
  const encoding = (res.headers["content-encoding"] ?? "").toLowerCase().trim();
  if (encoding === "gzip" || encoding === "x-gzip") return res.pipe(zlib.createGunzip());
  if (encoding === "deflate") return res.pipe(zlib.createInflate());
  if (encoding === "br") return res.pipe(zlib.createBrotliDecompress());
  return res;
}

function readTls(res: http.IncomingMessage, isHttps: boolean): TlsInfo | null {
  if (!isHttps) return null;
  const socket = res.socket as TLSSocket | null;
  if (!socket || typeof socket.getPeerCertificate !== "function") return null;
  const cert = socket.getPeerCertificate();
  if (!cert || Object.keys(cert).length === 0) return null;
  const issuer = cert.issuer as { O?: string; CN?: string } | undefined;
  return {
    validFrom: cert.valid_from ?? null,
    validTo: cert.valid_to ?? null,
    issuer: issuer?.O ?? issuer?.CN ?? null,
    protocol: typeof socket.getProtocol === "function" ? socket.getProtocol() : null,
  };
}

function singleRequest(url: URL, options: FetchOptions, timeoutMs: number): Promise<RawResponse> {
  return new Promise<RawResponse>((resolve, reject) => {
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;
    const method = options.method ?? "GET";
    let settled = false;

    const req = transport.request({
      protocol: url.protocol,
      hostname: stripBrackets(url.hostname),
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname || "/"}${url.search}`,
      method,
      agent: false,
      lookup: safeLookup,
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/javascript,*/*;q=0.8",
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "en-US,en;q=0.9",
        ...options.headers,
      },
    });

    const timer = setTimeout(() => req.destroy(timeoutError()), timeoutMs);

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    req.on("error", fail);

    req.on("response", (res) => {
      const headers: Record<string, string> = {};
      let setCookies: string[] = [];
      for (const [key, value] of Object.entries(res.headers)) {
        if (value === undefined) continue;
        if (key === "set-cookie") setCookies = Array.isArray(value) ? value : [value];
        else headers[key] = Array.isArray(value) ? value.join(", ") : value;
      }
      const status = res.statusCode ?? 0;
      const tls = readTls(res, isHttps);
      const chunks: Buffer[] = [];
      let total = 0;
      let truncated = false;

      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status, headers, setCookies, body: Buffer.concat(chunks), truncated, tls });
        res.destroy();
      };

      const skipBody = method === "HEAD" || (options.followRedirects !== false && REDIRECT_STATUSES.has(status));
      if (skipBody) {
        res.resume();
        finish();
        return;
      }

      const stream = decodeStream(res);
      stream.on("data", (chunk: Buffer) => {
        if (settled) return;
        const remaining = options.maxBytes - total;
        if (chunk.length >= remaining) {
          chunks.push(chunk.subarray(0, Math.max(remaining, 0)));
          total = options.maxBytes;
          truncated = true;
          finish();
          return;
        }
        chunks.push(chunk);
        total += chunk.length;
      });
      stream.on("end", finish);
      stream.on("error", (error) => {
        // A broken compression stream after we already have data is not worth failing the check.
        if (chunks.length > 0) finish();
        else fail(error);
      });
      res.on("error", (error) => {
        if (chunks.length > 0) finish();
        else fail(error);
      });
    });

    req.end();
  });
}

/**
 * SSRF-safe fetch. Validates every hop, pins DNS validation to the actual socket, enforces a total
 * time budget and a decoded body-size cap.
 */
export async function safeFetch(input: URL | string, options: FetchOptions): Promise<SafeResponse> {
  const startedAt = Date.now();
  const maxRedirects = options.maxRedirects ?? 5;
  let current = new URL(input.toString());
  const redirects: RedirectHop[] = [];

  for (let hop = 0; ; hop += 1) {
    assertSafeUrl(current);
    const remaining = options.timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) throw timeoutError();

    const response = await singleRequest(current, options, remaining);
    const location = response.headers.location;

    if (options.followRedirects !== false && REDIRECT_STATUSES.has(response.status) && location && hop < maxRedirects) {
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        return { ...response, url: current.href, redirects };
      }
      next.hash = "";
      redirects.push({ from: current.href, to: next.href, status: response.status });
      current = next;
      continue;
    }

    return { ...response, url: current.href, redirects };
  }
}

export interface ScanContext {
  target: URL;
  deadline: number;
  fetch(input: URL | string, options: Omit<FetchOptions, "timeoutMs"> & { timeoutMs?: number }): Promise<SafeResponse>;
}

export const PER_FETCH_TIMEOUT_MS = 4_000;

export function createScanContext(target: URL, deadline: number): ScanContext {
  return {
    target,
    deadline,
    fetch(input, options) {
      const budget = Math.min(options.timeoutMs ?? PER_FETCH_TIMEOUT_MS, deadline - Date.now() - 100);
      if (budget <= 0) return Promise.reject(new ScanError("TIMEOUT", "Scan time budget exhausted."));
      return safeFetch(input, { ...options, timeoutMs: budget });
    },
  };
}

export function isHtmlResponse(response: SafeResponse): boolean {
  const type = (response.headers["content-type"] ?? "").toLowerCase();
  if (type.includes("text/html") || type.includes("application/xhtml")) return true;
  const head = response.body.subarray(0, 512).toString("utf8").trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<head") || head.startsWith("<");
}

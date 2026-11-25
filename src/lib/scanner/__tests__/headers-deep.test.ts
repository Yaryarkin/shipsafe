import { describe, expect, it } from "vitest";
import {
  checkCoop,
  checkCspHardening,
  checkHeadersDeep,
  checkHstsPreload,
  checkPermissionsPolicyQuality,
  cspHardeningIssues,
  parseCspDirectives,
  permissionsPolicyWildcards,
} from "../checks/headers-deep";
import type { SafeResponse } from "../http";

const SITE = "https://example.com";

function main(headers: Record<string, string>, url = "https://example.com/"): SafeResponse {
  return { url, status: 200, headers, setCookies: [], body: Buffer.from("<html></html>"), truncated: false, redirects: [], tls: null };
}

const STRICT = "default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

describe("cspHardeningIssues", () => {
  it("accepts a strict policy", () => {
    expect(cspHardeningIssues(STRICT)).toEqual([]);
  });

  it("flags missing object-src and base-uri", () => {
    const issues = cspHardeningIssues("script-src 'self'; form-action 'self'");
    expect(issues.some((issue) => issue.startsWith("object-src"))).toBe(true);
    expect(issues.some((issue) => issue.startsWith("no base-uri"))).toBe(true);
  });

  it("lets default-src 'none' cover object-src", () => {
    const issues = cspHardeningIssues("default-src 'none'; base-uri 'none'; form-action 'none'");
    expect(issues.some((issue) => issue.startsWith("object-src"))).toBe(false);
  });

  it("flags wildcard and plain-http sources", () => {
    const issues = cspHardeningIssues(`${STRICT}; connect-src * http://api.example.com; frame-src https://*.example.com http:`);
    expect(issues).toContain("connect-src allows any origin (*)");
    expect(issues).toContain("frame-src allows plain http:");
  });

  it("does not treat https://*.example.com as a global wildcard", () => {
    const issues = cspHardeningIssues(`${STRICT}; connect-src https://*.example.com`);
    expect(issues.some((issue) => issue.startsWith("connect-src"))).toBe(false);
  });

  it("is case-insensitive, ignores duplicate directives and tolerates junk", () => {
    expect(parseCspDirectives("Script-Src 'self'; script-src *").get("script-src")).toEqual(["'self'"]);
    expect(() => cspHardeningIssues(";;; ; =")).not.toThrow();
    expect(() => cspHardeningIssues("")).not.toThrow();
  });
});

describe("checkCspHardening", () => {
  it("emits nothing when there is no CSP (the main header check already covers it)", () => {
    expect(checkCspHardening(SITE, {})).toEqual([]);
  });

  it("passes a hardened policy and reports gaps as info", () => {
    expect(checkCspHardening(SITE, { "content-security-policy": STRICT })[0]).toMatchObject({ id: "headers.csp-hardening", severity: "passed" });
    const weak = checkCspHardening(SITE, { "content-security-policy": "script-src 'self'" })[0];
    expect(weak).toMatchObject({ id: "headers.csp-hardening", severity: "info" });
    expect(weak?.fixPrompt).toContain("object-src");
  });
});

describe("checkCoop", () => {
  it("passes same-origin variants", () => {
    expect(checkCoop(SITE, { "cross-origin-opener-policy": "same-origin" }).severity).toBe("passed");
    expect(checkCoop(SITE, { "cross-origin-opener-policy": "Same-Origin-Allow-Popups" }).severity).toBe("passed");
  });

  it("reports a missing or non-isolating header as info", () => {
    expect(checkCoop(SITE, {})).toMatchObject({ severity: "info", title: "Cross-Origin-Opener-Policy is not set" });
    expect(checkCoop(SITE, { "cross-origin-opener-policy": "unsafe-none" }).title).toContain("does not isolate");
  });
});

describe("Permissions-Policy quality", () => {
  it("finds sensitive features granted to everyone", () => {
    expect(permissionsPolicyWildcards("camera=*, microphone=(self), geolocation=(*), fullscreen=*")).toEqual(["camera"]);
    expect(permissionsPolicyWildcards("camera=(), microphone=()")).toEqual([]);
  });

  it("emits a finding only when a wildcard exists", () => {
    expect(checkPermissionsPolicyQuality(SITE, {})).toEqual([]);
    expect(checkPermissionsPolicyQuality(SITE, { "permissions-policy": "camera=()" })).toEqual([]);
    expect(checkPermissionsPolicyQuality(SITE, { "permissions-policy": "camera=*" })[0]).toMatchObject({
      id: "headers.permissions-policy-wildcard",
      severity: "info",
    });
  });
});

describe("HSTS preload readiness", () => {
  const hsts = (value?: string, url?: string) => checkHstsPreload(SITE, main(value ? { "strict-transport-security": value } : {}, url));

  it("does nothing without HSTS, on http pages, or when max-age is short (transport check owns those)", () => {
    expect(hsts()).toEqual([]);
    expect(hsts("max-age=63072000; includeSubDomains; preload", "http://example.com/")).toEqual([]);
    expect(hsts("max-age=300")).toEqual([]);
  });

  it("passes a preload-ready header and flags a strong header that lacks the extras", () => {
    expect(hsts("max-age=63072000; includeSubDomains; preload")[0]).toMatchObject({ id: "transport.hsts-preload", severity: "passed" });
    const missing = hsts("max-age=31536000")[0];
    expect(missing).toMatchObject({ severity: "info" });
    expect(missing?.description).toContain("includeSubDomains and preload");
    expect(hsts("max-age=31536000; includeSubDomains")[0]?.description).toContain("lacks preload");
  });
});

describe("checkHeadersDeep", () => {
  it("never throws on an empty response and keeps ids unique", () => {
    const findings = checkHeadersDeep(SITE, main({}));
    const ids = findings.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("headers.coop");
  });
});

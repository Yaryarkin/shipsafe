import { describe, expect, it } from "vitest";
import {
  checkSensitiveFiles,
  checkSitemapPaths,
  SENSITIVE_FILE_PROBES,
  sensitiveSitemapPaths,
  sitemapLocations,
} from "../checks/exposure-files";
import type { SafeResponse, ScanContext } from "../http";

const SITE = "https://example.com";
const HTML = "<!doctype html><html><body>Not found</body></html>";

function response(path: string, body: Buffer | string, init: { status?: number; type?: string } = {}): SafeResponse {
  return {
    url: `${SITE}${path}`,
    status: init.status ?? 200,
    headers: { "content-type": init.type ?? "application/octet-stream" },
    setCookies: [],
    body: Buffer.isBuffer(body) ? body : Buffer.from(body),
    truncated: false,
    redirects: [],
    tls: null,
  };
}

type Handler = (path: string) => SafeResponse | Error | undefined;

/** A fake scan context: unknown paths 404, thrown errors simulate network failures. */
function contextFor(handler: Handler): ScanContext {
  return {
    target: new URL(SITE),
    deadline: Date.now() + 10_000,
    async fetch(input) {
      const path = new URL(String(input)).pathname;
      const result = handler(path);
      if (result instanceof Error) throw result;
      return result ?? response(path, "Not Found", { status: 404, type: "text/plain" });
    },
  };
}

const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
const dsStoreBytes = Buffer.concat([Buffer.from([0, 0, 0, 1]), Buffer.from("Bud1"), Buffer.alloc(32)]);

describe("checkSensitiveFiles", () => {
  it("reports one passed finding when nothing is exposed", async () => {
    const findings = await checkSensitiveFiles(contextFor(() => undefined), SITE, SITE);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ id: "exposure.sensitive-files", severity: "passed" });
    expect(findings[0]?.evidence).toContain(`${SENSITIVE_FILE_PROBES.length} common paths`);
  });

  it("never flags a single-page app that answers every path with its HTML shell", async () => {
    const findings = await checkSensitiveFiles(contextFor((path) => response(path, HTML, { type: "text/html; charset=utf-8" })), SITE, SITE);
    expect(findings.map((item) => item.id)).toEqual(["exposure.sensitive-files"]);
  });

  it("flags a downloadable .env.production without printing its contents", async () => {
    const secret = "supersecretvalue123";
    const findings = await checkSensitiveFiles(
      contextFor((path) => (path === "/.env.production" ? response(path, `DATABASE_URL=postgres://x\nSTRIPE_KEY=${secret}\n`, { type: "text/plain" }) : undefined)),
      SITE,
      SITE,
    );
    const hit = findings.find((item) => item.id === "exposure.file.env-production");
    expect(hit?.severity).toBe("critical");
    expect(hit?.evidence).toContain("2 KEY=VALUE line(s)");
    expect(JSON.stringify(findings)).not.toContain(secret);
  });

  it("recognises ZIP backups, .DS_Store files, git config and SQL dumps by their content", async () => {
    const files: Record<string, Buffer | string> = {
      "/backup.zip": zipBytes,
      "/.DS_Store": dsStoreBytes,
      "/.git/config": '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/acme/app.git\n',
      "/db.sql": "-- MySQL dump 10.13\nCREATE TABLE users (id int);\nINSERT INTO users VALUES (1);",
    };
    const findings = await checkSensitiveFiles(contextFor((path) => (files[path] ? response(path, files[path]) : undefined)), SITE, SITE);
    expect(findings.map((item) => item.id).sort()).toEqual([
      "exposure.file.backup-zip",
      "exposure.file.db-sql",
      "exposure.file.ds-store",
      "exposure.file.git-config",
    ]);
    expect(findings.every((item) => item.severity === "critical" && item.fixPrompt.length > 0)).toBe(true);
  });

  it("ignores a file with the right name but the wrong content", async () => {
    const findings = await checkSensitiveFiles(
      contextFor((path) => (path === "/backup.zip" || path === "/db.sql" || path === "/.DS_Store" ? response(path, "just some text, nothing to see", { type: "text/plain" }) : undefined)),
      SITE,
      SITE,
    );
    expect(findings.map((item) => item.id)).toEqual(["exposure.sensitive-files"]);
  });

  it("only treats config.json as a leak when it holds credential-style values", async () => {
    const harmless = await checkSensitiveFiles(contextFor((path) => (path === "/config.json" ? response(path, '{"theme":"dark","apiUrl":"/api"}', { type: "application/json" }) : undefined)), SITE, SITE);
    expect(harmless.map((item) => item.id)).toEqual(["exposure.sensitive-files"]);

    const leaky = await checkSensitiveFiles(
      contextFor((path) => (path === "/config.json" ? response(path, '{"db_password":"hunter2hunter2"}', { type: "application/json" }) : undefined)),
      SITE,
      SITE,
    );
    expect(leaky.map((item) => item.id)).toEqual(["exposure.file.config-json"]);
  });

  it("survives network errors and server errors without throwing", async () => {
    const findings = await checkSensitiveFiles(
      contextFor((path) => (path.endsWith(".zip") ? new Error("socket hang up") : path.endsWith(".sql") ? response(path, "boom", { status: 500 }) : undefined)),
      SITE,
      SITE,
    );
    expect(findings.map((item) => item.id)).toEqual(["exposure.sensitive-files"]);
  });

  it("does not follow redirects to other hosts or treat a 301 as exposure", async () => {
    const findings = await checkSensitiveFiles(
      contextFor((path) => (path === "/.env.local" ? response(path, "KEY=value", { status: 301, type: "text/plain" }) : undefined)),
      SITE,
      SITE,
    );
    expect(findings.map((item) => item.id)).toEqual(["exposure.sensitive-files"]);
  });
});

describe("sitemap sensitive paths", () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://example.com/</loc></url>
    <url><loc>https://example.com/admin/users</loc></url>
    <url><loc>https://example.com/staging/preview</loc></url>
    <url><loc> https://example.com/blog/administrator-guide </loc></url>
    <url><loc>notaurl</loc></url>
  </urlset>`;

  it("extracts <loc> entries and picks out sensitive-looking paths only", () => {
    const urls = sitemapLocations(xml);
    expect(urls).toHaveLength(5);
    expect(sensitiveSitemapPaths(urls)).toEqual(["/admin/users", "/staging/preview"]);
  });

  it("caps how many entries it reads", () => {
    const big = Array.from({ length: 5000 }, (_, index) => `<loc>https://example.com/p${index}</loc>`).join("");
    expect(sitemapLocations(big, 100)).toHaveLength(100);
  });

  it("emits an info finding for a leaky sitemap and nothing for a clean or missing one", async () => {
    const leaky = await checkSitemapPaths(contextFor((path) => (path === "/sitemap.xml" ? response(path, xml, { type: "application/xml" }) : undefined)), SITE, SITE);
    expect(leaky).toHaveLength(1);
    expect(leaky[0]).toMatchObject({ id: "exposure.sitemap-sensitive", severity: "info" });
    expect(leaky[0]?.evidence).toContain("/admin/users");

    const clean = await checkSitemapPaths(contextFor((path) => (path === "/sitemap.xml" ? response(path, "<urlset><url><loc>https://example.com/pricing</loc></url></urlset>") : undefined)), SITE, SITE);
    expect(clean).toEqual([]);
    expect(await checkSitemapPaths(contextFor(() => undefined), SITE, SITE)).toEqual([]);
    expect(await checkSitemapPaths(contextFor(() => new Error("ECONNRESET")), SITE, SITE)).toEqual([]);
  });
});

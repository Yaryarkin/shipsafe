import { describe, expect, it } from "vitest";
import { checkSecurityTxt } from "../checks/exposure";
import { checkMixedContentAndSri, checkSourceMaps, looksLikeSourceMap, sourceMapCandidate } from "../checks/frontend";
import type { SafeResponse, ScanContext } from "../http";

const SITE = "https://example.com";

function response(url: string, body: string, init: Partial<Pick<SafeResponse, "status" | "headers">> = {}): SafeResponse {
  return {
    url,
    status: init.status ?? 200,
    headers: init.headers ?? { "content-type": "text/html; charset=utf-8" },
    setCookies: [],
    body: Buffer.from(body),
    truncated: false,
    redirects: [],
    tls: null,
  };
}

describe("checkMixedContentAndSri", () => {
  it("flags http:// scripts, stylesheets and images on an https page", () => {
    const html = `<!doctype html><html><head>
      <link rel="stylesheet" href="http://cdn.example.net/site.css">
      <link rel="canonical" href="http://example.com/">
      <script src="http://cdn.example.net/lib.js"></script>
    </head><body><img src="http://images.example.net/a.png"><img src="/local.png"></body></html>`;
    const findings = checkMixedContentAndSri(SITE, response("https://example.com/", html));
    const mixed = findings.find((item) => item.id === "frontend.mixed-content");
    expect(mixed?.severity).toBe("warning");
    expect(mixed?.evidence).toContain("<script> http://cdn.example.net/lib.js");
    expect(mixed?.evidence).toContain("<link> http://cdn.example.net/site.css");
    expect(mixed?.evidence).toContain("<img> http://images.example.net/a.png");
    expect(mixed?.evidence).not.toContain("canonical");
    expect(mixed?.evidence).not.toContain("local.png");
  });

  it("passes mixed content when everything is https or same-origin", () => {
    const html = `<html><head><script src="/app.js"></script></head><body><img src="https://cdn.example.net/a.png"></body></html>`;
    const findings = checkMixedContentAndSri(SITE, response("https://example.com/", html));
    expect(findings.find((item) => item.id === "frontend.mixed-content")?.severity).toBe("passed");
  });

  it("skips the mixed content check on plain-http pages (already a transport finding)", () => {
    const findings = checkMixedContentAndSri(SITE, response("http://example.com/", `<script src="http://x.example.net/a.js"></script>`));
    expect(findings.find((item) => item.id === "frontend.mixed-content")).toBeUndefined();
  });

  it("reports third-party scripts without integrity as info, ignoring same-origin and SRI-pinned ones", () => {
    const html = `<html><head>
      <script src="/_next/static/app.js"></script>
      <script src="https://cdn.example.net/lib@1.2.3/lib.min.js" integrity="sha384-abc" crossorigin="anonymous"></script>
      <script src="https://widgets.example.org/widget.js"></script>
    </head></html>`;
    const sri = checkMixedContentAndSri(SITE, response("https://example.com/", html)).find((item) => item.id === "frontend.sri");
    expect(sri?.severity).toBe("info");
    expect(sri?.evidence).toBe("widgets.example.org/widget.js");
  });

  it("passes SRI when there are no third-party scripts", () => {
    const sri = checkMixedContentAndSri(SITE, response("https://example.com/", `<script src="/a.js"></script>`)).find(
      (item) => item.id === "frontend.sri",
    );
    expect(sri?.severity).toBe("passed");
  });
});

describe("source map helpers", () => {
  it("uses the sourceMappingURL comment when present", () => {
    const candidate = sourceMapCandidate("https://example.com/static/app.js", "console.log(1);\n//# sourceMappingURL=app.js.map");
    expect(candidate.mapUrl).toBe("https://example.com/static/app.js.map");
  });

  it("falls back to <script>.map when there is no comment", () => {
    expect(sourceMapCandidate("https://example.com/static/app.js?v=2", "x").mapUrl).toBe("https://example.com/static/app.js.map");
  });

  it("detects inline data: source maps without probing", () => {
    const candidate = sourceMapCandidate("https://example.com/a.js", "x\n//# sourceMappingURL=data:application/json;base64,eyJ2IjozfQ==");
    expect(candidate.mapUrl).toBeNull();
    expect(candidate.inlineBytes).toBeGreaterThan(0);
  });

  it("never probes cross-origin source map URLs", () => {
    expect(sourceMapCandidate("https://example.com/a.js", "//# sourceMappingURL=https://other.example.net/a.js.map").mapUrl).toBeNull();
  });

  it("recognizes source map JSON (including the XSSI prefix) and rejects HTML", () => {
    expect(looksLikeSourceMap('{"version":3,"sources":["src/app.ts"],"mappings":"AAAA"}')).toBe(true);
    expect(looksLikeSourceMap(")]}'\n{\"version\":3,\"mappings\":\"AAAA\"}")).toBe(true);
    expect(looksLikeSourceMap("<!doctype html><html>Not found</html>")).toBe(false);
    expect(looksLikeSourceMap('{"error":"not found"}')).toBe(false);
  });
});

describe("checkSourceMaps", () => {
  function stubContext(routes: Record<string, SafeResponse>) {
    const requested: string[] = [];
    const ctx: ScanContext = {
      target: new URL(SITE),
      deadline: Date.now() + 10_000,
      fetch: async (input, options) => {
        requested.push(input.toString());
        expect(options.maxBytes).toBeLessThanOrEqual(4 * 1024);
        return routes[input.toString()] ?? response(input.toString(), "<html>404</html>", { status: 404 });
      },
    };
    return { ctx, requested };
  }

  const script = (name: string, text = "console.log(1);") => ({
    url: `https://example.com/static/${name}`,
    label: `/static/${name}`,
    text,
  });

  it("warns when a probed .map returns source map JSON, without echoing its contents", async () => {
    const mapUrl = "https://example.com/static/a.js.map";
    const secretSource = "const internalAdminRoute = '/super-secret-admin';";
    const { ctx } = stubContext({
      [mapUrl]: response(mapUrl, JSON.stringify({ version: 3, sources: ["src/a.ts"], sourcesContent: [secretSource], mappings: "AAAA" }), {
        headers: { "content-type": "application/json" },
      }),
    });
    const [result] = await checkSourceMaps(ctx, SITE, { scriptUrls: [], scripts: [script("a.js")], failed: 0 });
    expect(result?.severity).toBe("warning");
    expect(result?.id).toBe("frontend.source-maps");
    expect(result?.evidence).toContain("/static/a.js.map");
    expect(JSON.stringify(result)).not.toContain("super-secret-admin");
    expect(result?.fixPrompt).toContain("productionBrowserSourceMaps");
  });

  it("passes when maps 404 or an HTML catch-all is served, and probes at most 3 maps", async () => {
    const htmlUrl = "https://example.com/static/b.js.map";
    const { ctx, requested } = stubContext({ [htmlUrl]: response(htmlUrl, "<!doctype html><html></html>") });
    const scripts = ["a.js", "b.js", "c.js", "d.js", "e.js"].map((name) => script(name));
    const [result] = await checkSourceMaps(ctx, SITE, { scriptUrls: [], scripts, failed: 0 });
    expect(result?.severity).toBe("passed");
    expect(requested).toHaveLength(3);
    expect(result?.evidence).toContain("HTML fallback page");
  });

  it("flags inline data: source maps without any request", async () => {
    const { ctx, requested } = stubContext({});
    const inline = script("i.js", "x\n//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozfQ==");
    const [result] = await checkSourceMaps(ctx, SITE, { scriptUrls: [], scripts: [inline], failed: 0 });
    expect(result?.severity).toBe("warning");
    expect(result?.evidence).toContain("inline data: source map");
    expect(requested).toHaveLength(0);
  });
});

describe("checkSecurityTxt", () => {
  const url = "https://example.com/.well-known/security.txt";
  const text = { "content-type": "text/plain" };

  it("passes when the file has a Contact field and a future Expires date", () => {
    const body = "Contact: mailto:security@example.com\nExpires: 2999-01-01T00:00:00.000Z\n";
    const result = checkSecurityTxt(SITE, response(url, body, { headers: text }));
    expect(result.severity).toBe("passed");
    expect(result.evidence).toContain("mailto:security@example.com");
  });

  it("is info when missing", () => {
    const result = checkSecurityTxt(SITE, response(url, "<html>404</html>", { status: 404 }));
    expect(result.severity).toBe("info");
    expect(result.title).toBe("No security.txt found");
  });

  it("is info when an HTML catch-all page is served instead of the file", () => {
    expect(checkSecurityTxt(SITE, response(url, "<!doctype html><html></html>")).severity).toBe("info");
  });

  it("is info when the Contact field is missing or the file expired", () => {
    expect(checkSecurityTxt(SITE, response(url, "Policy: https://example.com/p\n", { headers: text })).title).toContain("Contact");
    const expired = checkSecurityTxt(SITE, response(url, "Contact: mailto:a@example.com\nExpires: 2000-01-01T00:00:00Z\n", { headers: text }));
    expect(expired.title).toBe("security.txt has expired");
  });

  it("is info when the probe failed", () => {
    expect(checkSecurityTxt(SITE, new Error("ETIMEDOUT")).severity).toBe("info");
  });
});

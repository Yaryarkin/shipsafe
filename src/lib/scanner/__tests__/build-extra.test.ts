import { describe, expect, it } from "vitest";
import { analyzeBuildArchive, type BuildFiles } from "../build-analyzer";
import {
  collectEndpoints,
  debugFlagFindings,
  describeTokenEncoding,
  endpointFindings,
  extraBuildFindings,
  permissionFindings,
  readManifestPermissions,
  shannonEntropy,
  tokenFindings,
} from "../build-extra";
import type { Finding } from "../types";
import { encodeAxml } from "./fixtures/axml";

const SITE = "https://example.com";
const NAME_ATTR = 0x01010003;
const j = (...parts: string[]) => parts.join("");

const binaryManifest = (permissions: string[]) =>
  encodeAxml([
    { name: "manifest", attributes: [{ name: "package", value: "com.example.game" }] },
    ...permissions.map((permission) => ({ name: "uses-permission", attributes: [{ name: "name", resourceId: NAME_ATTR, value: permission }] })),
    { name: "application", attributes: [] },
  ]);

const textManifest = (permissions: string[]) =>
  `<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">${permissions
    .map((permission) => `<uses-permission android:name="${permission}"/>`)
    .join("")}<application/></manifest>`;

const byId = (findings: Finding[], id: string) => findings.find((item) => item.id === id);
const texts = (entries: Record<string, string>) => new Map(Object.entries(entries));

describe("Android permissions", () => {
  it("reads names from compiled and plain manifests", () => {
    expect(readManifestPermissions(binaryManifest(["android.permission.INTERNET", "android.permission.READ_SMS"]))).toEqual([
      "android.permission.INTERNET",
      "android.permission.READ_SMS",
    ]);
    expect(readManifestPermissions(textManifest(["android.permission.CAMERA"]))).toEqual(["android.permission.CAMERA"]);
    expect(readManifestPermissions(new Uint8Array([1, 2, 3, 4]))).toEqual([]);
  });

  it("warns on high-risk permissions and lists why", () => {
    const finding = byId(permissionFindings(SITE, binaryManifest(["android.permission.INTERNET", "android.permission.READ_SMS", "android.permission.SYSTEM_ALERT_WINDOW"])), "build.android-permissions");
    expect(finding?.severity).toBe("warning");
    expect(finding?.evidence).toContain("READ_SMS — reads text messages");
    expect(finding?.evidence).toContain("SYSTEM_ALERT_WINDOW");
    expect(finding?.evidence).not.toContain("INTERNET");
  });

  it("downgrades sensitive-only permissions to info and passes clean manifests", () => {
    expect(permissionFindings(SITE, textManifest(["android.permission.CAMERA", "android.permission.INTERNET"]))[0]?.severity).toBe("info");
    expect(permissionFindings(SITE, textManifest(["android.permission.INTERNET", "android.permission.VIBRATE"]))[0]?.severity).toBe("passed");
  });

  it("emits nothing without a manifest or without permissions", () => {
    expect(permissionFindings(SITE, undefined)).toEqual([]);
    expect(permissionFindings(SITE, textManifest([]))).toEqual([]);
  });
});

describe("hard-coded endpoints", () => {
  const files = texts({
    "assets/config.js": j(
      'const a = "http://api.shop.example-store.io/v1/orders?token=abc123";',
      'const b = "https://api.shop.example-store.io/v2/users";',
      'const c = "http://10.0.0.5:8080/debug";',
      'const d = "https://staging.shop.example-store.io/health";',
      'const e = "http://schemas.android.com/apk/res/android";',
      'const f = "https://www.w3.org/2000/svg";',
    ),
    "node_modules/lib/readme.js": 'const x = "http://ignored.example-vendor.io/api/";',
  });

  it("collects endpoints, strips query strings and skips XML namespaces and vendored folders", () => {
    const found = collectEndpoints(files).map((endpoint) => endpoint.display);
    expect(found).toContain("http://api.shop.example-store.io/v1/orders");
    expect(found.join(" ")).not.toContain("token=");
    expect(found.join(" ")).not.toContain("schemas.android.com");
    expect(found.join(" ")).not.toContain("w3.org");
    expect(found.join(" ")).not.toContain("ignored.example-vendor.io");
  });

  it("splits findings into cleartext, internal and API endpoints", () => {
    const findings = endpointFindings(SITE, files);
    expect(byId(findings, "build.cleartext-endpoints")?.severity).toBe("warning");
    expect(byId(findings, "build.cleartext-endpoints")?.evidence).toContain("http://api.shop.example-store.io/v1/orders");
    expect(byId(findings, "build.internal-endpoints")?.evidence).toContain("10.0.0.5");
    expect(byId(findings, "build.internal-endpoints")?.evidence).toContain("staging.shop.example-store.io");
    expect(byId(findings, "build.api-endpoints")?.severity).toBe("info");
  });

  it("does not call a private-network http URL 'cleartext' (it is reported as internal instead)", () => {
    const findings = endpointFindings(SITE, texts({ "a.js": 'fetch("http://192.168.1.20/api/x")' }));
    expect(byId(findings, "build.cleartext-endpoints")).toBeUndefined();
    expect(byId(findings, "build.internal-endpoints")).toBeDefined();
  });

  it("returns nothing when there are no endpoints and tolerates malformed URLs", () => {
    expect(endpointFindings(SITE, texts({ "a.js": "const x = 1" }))).toEqual([]);
    expect(() => endpointFindings(SITE, texts({ "a.js": "http://[::bad url https://%zz.example.com/" }))).not.toThrow();
  });
});

describe("hard-coded tokens", () => {
  const random40 = j("a1B2c3D4", "e5F6g7H8", "i9J0k1L2", "m3N4o5P6", "q7R8s9T0");
  const hex32 = j("9f86d081", "884c7d65", "9a2feaa0", "c55ad015");

  it("computes entropy and classifies encodings", () => {
    expect(shannonEntropy("aaaaaaaa")).toBe(0);
    expect(shannonEntropy(random40)).toBeGreaterThan(4);
    expect(describeTokenEncoding(hex32)).toBe("hex");
    expect(describeTokenEncoding("QUJDREVGR0hJSktMTU5PUFFSU1RVVldY")).toBe("base64");
    expect(describeTokenEncoding("abc.def-ghi_jkl.mno")).toBe("token");
    expect(shannonEntropy("")).toBe(0);
  });

  it("flags secret-named assignments with random values and masks the value", () => {
    const findings = tokenFindings(SITE, texts({ "assets/app.js": `const apiKey = "${random40}"; const client_secret: "${hex32}"` }));
    const hit = byId(findings, "build.hardcoded-tokens");
    expect(hit?.severity).toBe("warning");
    expect(hit?.title).toContain("2 hard-coded");
    expect(JSON.stringify(findings)).not.toContain(random40);
    expect(JSON.stringify(findings)).not.toContain(hex32);
  });

  it("ignores placeholders, plain words, numbers and low-entropy values", () => {
    const quiet = texts({
      "a.js": j(
        'const apiKey = "YOUR_API_KEY_HERE_REPLACE_ME";',
        'const token = "${process.env.TOKEN_VALUE_X}";',
        'const password = "aaaaaaaaaaaaaaaaaaaaaaaa";',
        'const secret = "abcdefghijklmnopqrstuvwxyz";',
        'const apiKey = "12345678901234567890";',
        'const description = "a long sentence that is not a secret at all";',
      ),
    });
    expect(tokenFindings(SITE, quiet)).toEqual([]);
  });
});

describe("debug flags in config files", () => {
  it("reports debug=true in config-style files only", () => {
    const findings = debugFlagFindings(
      SITE,
      texts({ "assets/config.json": '{"debug": true, "api": "x"}', "app.properties": "debug=true", "src/main.js": "const debug = true;", "notes.md": "debug: true" }),
    );
    const hit = byId(findings, "build.debug-flags");
    expect(hit?.severity).toBe("info");
    expect(hit?.evidence).toContain("assets/config.json");
    expect(hit?.evidence).toContain("app.properties");
    expect(hit?.evidence).not.toContain("main.js");
    expect(hit?.evidence).not.toContain("notes.md");
  });

  it("is quiet when debug is false", () => {
    expect(debugFlagFindings(SITE, texts({ "config.json": '{"debug": false}' }))).toEqual([]);
  });
});

describe("integration with analyzeBuildArchive", () => {
  it("adds the new findings, enrichment and score breakdown to an APK scan", () => {
    const files: BuildFiles = {
      "AndroidManifest.xml": binaryManifest(["android.permission.READ_SMS"]),
      "assets/config.json": '{"debug": true, "base": "http://api.demo-game.example-cdn.io/v1/"}',
    };
    const result = analyzeBuildArchive(files, "game.apk", { now: new Date("2026-11-18T10:00:00.000Z"), durationMs: 5 });
    const ids = result.findings.map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["build.android-permissions", "build.cleartext-endpoints", "build.debug-flags"]));
    expect(byId(result.findings, "build.android-permissions")?.impact).toBeTruthy();
    expect(byId(result.findings, "build.android-permissions")?.snippets?.[0]?.stack).toBe("android");
    expect(result.scoreBreakdown?.total).toBe(result.overallScore);
  });

  it("extraBuildFindings never throws on empty input", () => {
    expect(extraBuildFindings(SITE, { texts: new Map() })).toEqual([]);
  });
});

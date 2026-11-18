import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractBuildArchive } from "@/lib/build-extract";
import { displayTarget, isBuildTarget } from "@/lib/scan-target";
import { booleanValue, findAttribute, isBinaryXml, parseBinaryXml } from "../axml";
import {
  analyzeBuildArchive,
  assertArchiveSize,
  BUILD_LIMITS,
  BuildArchiveError,
  isSupportedBuildFile,
  readManifestFlags,
  type BuildFiles,
} from "../build-analyzer";
import { scanResultSchema, type Finding, type ScanResult } from "../types";
import { compiledManifest } from "./fixtures/axml";

// Synthetic secrets are assembled at runtime so no secret-shaped literal exists in the source.
const j = (...parts: string[]) => parts.join("");
const STRIPE_LIVE = j("sk", "_live_", "A".repeat(24), "1234");

const NOW = new Date("2026-11-18T10:00:00.000Z");
const scan = (files: BuildFiles, name: string) => analyzeBuildArchive(files, name, { now: NOW, durationMs: 420 });
const byId = (result: ScanResult, id: string): Finding | undefined => result.findings.find((item) => item.id === id);

const textManifest = (applicationAttributes: string) =>
  `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.example.app">\n  <application ${applicationAttributes} android:label="Demo">\n  </application>\n</manifest>`;

describe("binary AndroidManifest parser (AXML)", () => {
  it("recognizes and parses a compiled manifest with typed boolean attributes", () => {
    const bytes = compiledManifest({ debuggable: true, usesCleartextTraffic: false });
    expect(isBinaryXml(bytes)).toBe(true);
    const doc = parseBinaryXml(bytes);
    const application = doc?.elements.find((element) => element.name === "application");
    expect(application).toBeDefined();
    if (!application) return;
    expect(booleanValue(findAttribute(application, "debuggable"))).toBe(true);
    expect(booleanValue(findAttribute(application, "usesCleartextTraffic"))).toBe(false);
    expect(findAttribute(application, "allowBackup")).toBeUndefined();
  });

  it("finds attributes by Android resource id even when names are obfuscated", () => {
    const flags = readManifestFlags(compiledManifest({ debuggable: true }, { obfuscateAttributeNames: true }));
    expect(flags).toMatchObject({ debuggable: true, format: "binary" });
  });

  it("never throws on garbage or truncated input", () => {
    const valid = compiledManifest({ debuggable: true });
    for (const bytes of [new Uint8Array(0), Uint8Array.from([3, 0, 8, 0, 255, 255, 255, 127]), valid.subarray(0, 40), Uint8Array.from({ length: 64 }, (_, i) => (i * 37) % 256)]) {
      expect(() => parseBinaryXml(bytes)).not.toThrow();
    }
    expect(parseBinaryXml(new TextEncoder().encode("<manifest/>"))).toBeNull();
  });
});

describe("Android APK checks", () => {
  it("flags debuggable (critical), cleartext (warning) and backup (info) in a compiled manifest", () => {
    const result = scan({ "AndroidManifest.xml": compiledManifest({ debuggable: true, usesCleartextTraffic: true, allowBackup: true }), "classes.dex": new Uint8Array(0) }, "game-release.apk");
    expect(byId(result, "build.android-debuggable")?.severity).toBe("critical");
    expect(byId(result, "build.android-debuggable")?.title).toBe("Release APK has debuggable enabled");
    expect(byId(result, "build.android-cleartext")).toMatchObject({ severity: "warning", title: "Cleartext HTTP traffic allowed" });
    expect(byId(result, "build.android-backup")).toMatchObject({ severity: "info", title: "App data backup enabled (allowBackup)" });
    expect(byId(result, "build.android-debuggable")?.fixPrompt).toContain("build.gradle");
    expect(result.grade).toBe("D"); // critical caps at 69, minus the warning
  });

  it("does NOT flag debuggable when the compiled value is false (the word is still in the string pool)", () => {
    const bytes = compiledManifest({ debuggable: false, usesCleartextTraffic: false, allowBackup: false });
    expect(new TextDecoder("utf-16le").decode(bytes)).toContain("debuggable");
    const result = scan({ "AndroidManifest.xml": bytes }, "app.apk");
    expect(byId(result, "build.android-debuggable")?.severity).toBe("passed");
    expect(byId(result, "build.android-cleartext")?.severity).toBe("passed");
    expect(byId(result, "build.android-backup")?.severity).toBe("passed");
  });

  it("treats a missing allowBackup as enabled (Android's default) and missing debuggable as safe", () => {
    const result = scan({ "AndroidManifest.xml": compiledManifest({}) }, "app.apk");
    expect(byId(result, "build.android-debuggable")?.severity).toBe("passed");
    expect(byId(result, "build.android-backup")?.severity).toBe("info");
    expect(byId(result, "build.android-backup")?.evidence).toContain("defaults to true");
  });

  it("reads plain-text manifests too (e.g. from a source zip)", () => {
    const result = scan({ "AndroidManifest.xml": textManifest('android:debuggable="true" android:usesCleartextTraffic="true" android:allowBackup="false"') }, "source.zip");
    expect(byId(result, "build.android-debuggable")?.severity).toBe("critical");
    expect(byId(result, "build.android-cleartext")?.severity).toBe("warning");
    expect(byId(result, "build.android-backup")?.severity).toBe("passed");
  });

  it("only reads flags on <application>, not on other elements", () => {
    const manifest = `<manifest><activity android:debuggable="true"/><application android:label="x"></application></manifest>`;
    expect(byId(scan({ "AndroidManifest.xml": manifest }, "app.apk"), "build.android-debuggable")?.severity).toBe("passed");
  });

  it("reports an unreadable / missing manifest in an .apk as info", () => {
    expect(byId(scan({ "classes.dex": new Uint8Array([1, 2, 3]) }, "broken.apk"), "build.android-manifest")?.severity).toBe("info");
  });

  it("skips Android checks entirely for non-Android zips", () => {
    const result = scan({ "index.html": "<html></html>" }, "webgl.zip");
    expect(result.findings.some((item) => item.id.startsWith("build.android"))).toBe(false);
  });
});

describe("credential and config files inside builds", () => {
  it("flags bundled signing keystores as critical without reading them", () => {
    const result = scan({ "assets/release.keystore": new Uint8Array(0), "keys/upload.jks": new Uint8Array(0), "index.html": "" }, "app.apk");
    const signing = byId(result, "build.signing-keys");
    expect(signing?.severity).toBe("critical");
    expect(signing?.evidence).toContain("assets/release.keystore");
    expect(signing?.evidence).toContain("keys/upload.jks");
  });

  it("flags bundled .env files (critical) without showing values, but ignores .env.example", () => {
    const result = scan({ "game/.env": `API_URL=https://x\nSECRET_TOKEN=${"z".repeat(20)}\n`, ".env.example": "API_URL=" }, "game.zip");
    const env = byId(result, "build.env-file");
    expect(env?.severity).toBe("critical");
    expect(env?.evidence).toContain("game/.env (2 KEY=VALUE line(s)");
    expect(env?.evidence).not.toContain(".env.example");
    expect(JSON.stringify(result)).not.toContain("z".repeat(20));
  });

  it("flags service-account keys and OAuth client secrets as critical", () => {
    const serviceAccount = JSON.stringify({ type: "service_account", client_email: "x@y.iam.gserviceaccount.com", private_key: j("-----BEGIN ", "PRIVATE KEY-----\\nabc") });
    const result = scan({ "assets/firebase-admin.json": serviceAccount }, "app.apk");
    expect(byId(result, "build.credentials-file")?.severity).toBe("critical");
    const oauth = scan({ "config/google-services.json": JSON.stringify({ client: [{ oauth_client: [{ client_secret: "x".repeat(24) }] }] }) }, "app.apk");
    expect(byId(oauth, "build.credentials-file")?.severity).toBe("critical");
  });

  it("treats a normal google-services.json as public config (info), not a leak", () => {
    const googleServices = JSON.stringify({ project_info: { project_id: "demo" }, client: [{ api_key: [{ current_key: j("AI", "za", "B".repeat(35)) }] }] });
    const result = scan({ "google-services.json": googleServices }, "app.apk");
    expect(byId(result, "build.credentials-file")?.severity).toBe("passed");
    expect(byId(result, "build.google-services")?.severity).toBe("info");
  });

  it("runs every text/config file through analyzeSecrets and masks matches", () => {
    const result = scan({ "assets/www/main.js": `const stripe = "${STRIPE_LIVE}";`, "res/values/strings.xml": "<resources/>" }, "app.apk");
    const leak = byId(result, "secrets.stripe-live");
    expect(leak?.severity).toBe("critical");
    expect(leak?.evidence).toContain("assets/www/main.js");
    expect(JSON.stringify(result)).not.toContain(STRIPE_LIVE);
  });

  it("also scans strings inside compiled binary XML", () => {
    const bytes = compiledManifest({});
    const withSecret = Uint8Array.from([...bytes]);
    const result = scan({ "AndroidManifest.xml": withSecret, "res/raw/config.properties": `stripe.key=${STRIPE_LIVE}` }, "app.apk");
    expect(byId(result, "secrets.stripe-live")?.evidence).toContain("res/raw/config.properties");
  });
});

describe("WebGL / HTML5 / Electron game builds", () => {
  it("warns about source maps shipped in a production build", () => {
    const result = scan({ "Build/game.js": "x", "Build/game.js.map": "", "index.html": "" }, "webgl.zip");
    expect(byId(result, "frontend.source-maps")).toMatchObject({ severity: "warning", title: "Source maps exposed in production game/app build" });
    expect(byId(result, "frontend.source-maps")?.fixPrompt).toContain("Unity WebGL");
  });

  it.each([
    ["nodeIntegration: true", "new BrowserWindow({ webPreferences: { nodeIntegration: true } })"],
    ["contextIsolation: false", "new BrowserWindow({ webPreferences: { contextIsolation: false } })"],
    ["webSecurity: false", '{ "webPreferences": { "webSecurity": false } }'],
  ])("flags insecure Electron setting %s as critical", (label, code) => {
    const result = scan({ "resources/app/main.js": code, "resources/app/package.json": '{ "devDependencies": { "electron": "33.0.0" } }' }, "game-win.zip");
    const electron = byId(result, "build.electron-insecure");
    expect(electron?.severity).toBe("critical");
    expect(electron?.evidence).toContain(label);
  });

  it("passes safe Electron settings and stays silent for non-Electron builds", () => {
    const safe = scan({ "main.js": "const { BrowserWindow } = require('electron'); new BrowserWindow({ webPreferences: { nodeIntegration: false, contextIsolation: true } })" }, "app.zip");
    expect(byId(safe, "build.electron-insecure")?.severity).toBe("passed");
    expect(byId(scan({ "index.html": "<canvas></canvas>" }, "html5.zip"), "build.electron-insecure")).toBeUndefined();
  });

  it("gives a clean HTML5 build grade A with honest passed findings", () => {
    const result = scan(
      { "index.html": "<!doctype html><canvas id=game></canvas><script src=game.js></script>", "game.js": "console.log('play')", "assets/sprite.png": new Uint8Array(0), "assets/music.ogg": new Uint8Array(0) },
      "my-game.zip",
    );
    expect(result.overallScore).toBe(100);
    expect(result.grade).toBe("A");
    expect(result.summary.critical + result.summary.warning).toBe(0);
    expect(result.findings.map((item) => item.id).sort()).toEqual(["build.credentials-file", "build.env-file", "build.signing-keys", "frontend.source-maps", "secrets.none"]);
    expect(byId(result, "secrets.none")?.title).toBe("No private keys found in build files");
  });

  it("returns a ScanResult the existing UI accepts, with a build: target", () => {
    const result = scan({ "AndroidManifest.xml": compiledManifest({ debuggable: true }) }, "My Game v1.2.apk");
    expect(scanResultSchema.safeParse(result).success).toBe(true);
    expect(isBuildTarget(result.target)).toBe(true);
    expect(displayTarget(result.target)).toBe("My Game v1.2.apk");
    expect(result.scannedAt).toBe(NOW.toISOString());
    expect(result.scanDurationMs).toBe(420);
    expect(result.findings[0]?.severity).toBe("critical");
    for (const item of result.findings) if (item.severity !== "passed") expect(item.fixPrompt.length).toBeGreaterThan(50);
  });
});

describe("browser limits", () => {
  it("rejects archives over 150 MB with a friendly error", () => {
    expect(BUILD_LIMITS.maxArchiveBytes).toBe(150 * 1024 * 1024);
    expect(() => assertArchiveSize(150 * 1024 * 1024)).not.toThrow();
    expect(() => assertArchiveSize(150 * 1024 * 1024 + 1)).toThrow(BuildArchiveError);
    expect(() => assertArchiveSize(200 * 1024 * 1024)).toThrow(/up to 150\.00 MB/);
  });

  it("only accepts .apk and .zip files", () => {
    expect(isSupportedBuildFile("game.APK")).toBe(true);
    expect(isSupportedBuildFile("build.zip")).toBe(true);
    expect(isSupportedBuildFile("app.aab")).toBe(false);
    expect(isSupportedBuildFile("notes.txt")).toBe(false);
  });

  it("analyzes at most 80 text files even if more are passed in", () => {
    const files: BuildFiles = {};
    for (let index = 0; index < 100; index += 1) files[`js/file-${String(index).padStart(3, "0")}.js`] = "ok";
    files["js/zz-last.js"] = `const k = "${STRIPE_LIVE}";`;
    const result = scan(files, "big.zip");
    expect(byId(result, "secrets.stripe-live")).toBeUndefined();
    expect(byId(result, "secrets.none")?.evidence).toContain("Scanned 80 text/config file(s)");
  });
});

describe("extractBuildArchive (JSZip, runs in the browser)", () => {
  async function zipOf(entries: Record<string, string | Uint8Array>): Promise<Uint8Array> {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(entries)) zip.file(name, content);
    return zip.generateAsync({ type: "uint8array" });
  }

  it("keeps every entry name, reads text/config files, and never reads media or binaries", async () => {
    const archive = await zipOf({
      "AndroidManifest.xml": compiledManifest({ debuggable: true }),
      "classes.dex": Uint8Array.from([0x64, 0x65, 0x78]),
      "res/raw/release.keystore": Uint8Array.from([1, 2, 3]),
      "assets/www/app.js": "console.log(1)",
      "assets/sprite.png": Uint8Array.from([137, 80, 78, 71]),
    });
    const { files, meta } = await extractBuildArchive(archive, "game.apk");
    expect(Object.keys(files).sort()).toEqual(["AndroidManifest.xml", "assets/sprite.png", "assets/www/app.js", "classes.dex", "res/raw/release.keystore"]);
    expect(files["assets/www/app.js"]).toBe("console.log(1)");
    expect(files["AndroidManifest.xml"]).toBeInstanceOf(Uint8Array);
    expect((files["assets/sprite.png"] as Uint8Array).byteLength).toBe(0);
    expect((files["res/raw/release.keystore"] as Uint8Array).byteLength).toBe(0);
    expect(meta.totalEntries).toBe(5);

    const result = analyzeBuildArchive(files, "game.apk", { meta });
    expect(byId(result, "build.android-debuggable")?.severity).toBe("critical");
    expect(byId(result, "build.signing-keys")?.severity).toBe("critical");
  });

  it("refuses archives larger than the limit before unpacking", async () => {
    const archive = await zipOf({ "a.txt": "x".repeat(2000) });
    await expect(extractBuildArchive(archive, "big.zip", { maxArchiveBytes: 100 })).rejects.toBeInstanceOf(BuildArchiveError);
  });

  it("enforces the file-count and per-file size limits", async () => {
    const archive = await zipOf({ "a.js": "1", "b.js": "2", "c.js": "3", "huge.json": "x".repeat(5000) });
    const { files, meta } = await extractBuildArchive(archive, "game.zip", { maxFiles: 2, maxFileBytes: 1000 });
    const read = Object.values(files).filter((content) => typeof content === "string");
    expect(read).toHaveLength(2);
    expect(meta.skippedLarge).toBe(1);
    expect(meta.skippedOverLimit).toBe(1);
  });

  it("prioritizes the manifest and .env files over JS when the limit is tight", async () => {
    const archive = await zipOf({ "a.js": "1", ".env": "KEY=1", "AndroidManifest.xml": "<manifest><application/></manifest>" });
    const { files } = await extractBuildArchive(archive, "app.apk", { maxFiles: 2 });
    expect(files[".env"]).toBe("KEY=1");
    expect(files["AndroidManifest.xml"]).toBeInstanceOf(Uint8Array);
    expect((files["a.js"] as Uint8Array).byteLength).toBe(0);
  });

  it("rejects files that are not zip archives", async () => {
    await expect(extractBuildArchive(new TextEncoder().encode("not a zip"), "fake.apk")).rejects.toThrow(/isn't a readable/);
  });
});

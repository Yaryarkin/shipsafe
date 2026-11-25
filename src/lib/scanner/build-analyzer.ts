import { buildTarget, displayTarget } from "@/lib/scan-target";
import { booleanValue, findAttribute, isBinaryXml, parseBinaryXml } from "./axml";
import { analyzeSecrets, type SecretSource } from "./checks/secret-patterns";
import { extraBuildFindings } from "./build-extra";
import { enrichFindings } from "./fixes";
import { detectBuildStack, snippetStacksFor } from "./stack";
import { buildScoreBreakdown, scoreFindings, sortFindings } from "./scoring";
import type { Finding, ScanResult } from "./types";
import { buildFixPrompt, finding, formatBytes } from "./utils";

/**
 * Pure, DOM-free analysis of an app / game build archive (Android .apk, or a .zip of a WebGL /
 * HTML5 / Electron / Unity / Godot build). Runs in the browser (nothing is uploaded) and in Vitest.
 * Input: files already extracted from the archive (see src/lib/build-extract.ts).
 */

export const BUILD_LIMITS = {
  /** Largest archive accepted by the browser scanner. */
  maxArchiveBytes: 150 * 1024 * 1024,
  /** Text/config files whose contents are analyzed (others are listed by name only). */
  maxFiles: 80,
  /** Per-file content cap. */
  maxFileBytes: 1024 * 1024,
} as const;

/** Text/config files whose contents are read. */
export const TEXT_EXTENSIONS: readonly string[] = [
  ".xml", ".json", ".js", ".mjs", ".cjs", ".html", ".htm", ".plist", ".properties", ".env", ".yaml", ".yml", ".txt", ".cfg", ".ini",
];

/** Media / binary files that are never read (only their names are seen). */
export const IGNORED_EXTENSIONS: readonly string[] = [
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".mp3", ".ogg", ".wav", ".m4a", ".mp4", ".webm",
  ".so", ".dll", ".dylib", ".exe", ".wasm", ".ttf", ".otf", ".woff", ".woff2", ".asset", ".bundle", ".pck", ".dex", ".arsc", ".data", ".unityweb",
];

/** Signing material that must never ship inside a build. */
export const KEYSTORE_EXTENSIONS: readonly string[] = [".jks", ".keystore", ".p12", ".pfx", ".bks"];

export type BuildFiles = Record<string, string | Uint8Array>;

export interface BuildArchiveMeta {
  /** All entries in the archive (including ignored media). */
  totalEntries?: number;
  /** Text files skipped because they exceeded the per-file limit. */
  skippedLarge?: number;
  /** Text files skipped because the file-count limit was reached. */
  skippedOverLimit?: number;
  archiveBytes?: number;
}

export interface AnalyzeBuildOptions {
  meta?: BuildArchiveMeta;
  now?: Date;
  durationMs?: number;
}

export class BuildArchiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildArchiveError";
  }
}

/** Throws a friendly BuildArchiveError when an archive is too large to scan in the browser. */
export function assertArchiveSize(bytes: number, maxBytes: number = BUILD_LIMITS.maxArchiveBytes): void {
  if (bytes > maxBytes) {
    throw new BuildArchiveError(
      `This archive is ${formatBytes(bytes)}. The in-browser scanner accepts builds up to ${formatBytes(maxBytes)} — remove media or upload just the code/config part of the build.`,
    );
  }
}

export function isSupportedBuildFile(fileName: string): boolean {
  return /\.(apk|zip)$/i.test(fileName);
}

// ---------------------------------------------------------------------------------------------- helpers

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.?\/+/, "");
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

export function extensionOf(path: string): string {
  const base = basename(path).toLowerCase();
  if (base.startsWith(".env")) return ".env";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot) : "";
}

function looksBinary(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  let zeros = 0;
  for (const byte of sample) if (byte === 0) zeros += 1;
  return sample.length > 0 && zeros / sample.length > 0.01;
}

/** Text content for secret scanning: AXML string pools are flattened, other binaries skipped. */
function decodeText(content: string | Uint8Array): string | null {
  if (typeof content === "string") return content.slice(0, BUILD_LIMITS.maxFileBytes);
  const bytes = content.subarray(0, BUILD_LIMITS.maxFileBytes);
  if (bytes.length === 0) return null;
  if (isBinaryXml(bytes)) return parseBinaryXml(bytes)?.strings.join("\n") ?? null;
  if (looksBinary(bytes)) return null;
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function listWithMore(items: string[], max = 6): string {
  const shown = items.slice(0, max).join("\n");
  return items.length > max ? `${shown}\n+${items.length - max} more` : shown;
}

interface Entry {
  path: string;
  lower: string;
  base: string;
  ext: string;
  content: string | Uint8Array;
}

// ---------------------------------------------------------------------------------------------- Android

interface ManifestFlags {
  debuggable: boolean | null;
  usesCleartextTraffic: boolean | null;
  allowBackup: boolean | null;
  format: "binary" | "text";
}

function textAttribute(applicationTag: string, name: string): boolean | null {
  const match = new RegExp(`android:${name}\\s*=\\s*["']\\s*(true|false)\\s*["']`, "i").exec(applicationTag);
  return match?.[1] ? match[1].toLowerCase() === "true" : null;
}

export function readManifestFlags(content: string | Uint8Array): ManifestFlags | null {
  if (typeof content !== "string" && isBinaryXml(content)) {
    const doc = parseBinaryXml(content);
    const application = doc?.elements.find((element) => element.name === "application");
    if (!doc || !application) return null;
    return {
      debuggable: booleanValue(findAttribute(application, "debuggable")),
      usesCleartextTraffic: booleanValue(findAttribute(application, "usesCleartextTraffic")),
      allowBackup: booleanValue(findAttribute(application, "allowBackup")),
      format: "binary",
    };
  }
  const text = typeof content === "string" ? content : new TextDecoder().decode(content);
  const applicationTag = /<application\b[^>]*>/is.exec(text)?.[0];
  if (!applicationTag) return null;
  return {
    debuggable: textAttribute(applicationTag, "debuggable"),
    usesCleartextTraffic: textAttribute(applicationTag, "usesCleartextTraffic"),
    allowBackup: textAttribute(applicationTag, "allowBackup"),
    format: "text",
  };
}

function androidFindings(site: string, manifest: Entry | undefined): Finding[] {
  const flags = manifest ? readManifestFlags(manifest.content) : null;
  if (!manifest || !flags) {
    return [
      finding({
        id: "build.android-manifest",
        category: "build",
        severity: "info",
        title: "AndroidManifest.xml could not be read",
        description:
          "The archive looks like an Android build, but its manifest is missing or not in a recognized format, so debuggable / cleartext / backup flags were not checked.",
        evidence: manifest ? `${manifest.path}: unrecognized format` : "No AndroidManifest.xml at the archive root",
      }),
    ];
  }

  const where = `AndroidManifest.xml (${flags.format === "binary" ? "compiled binary XML" : "plain XML"}) · <application>`;
  const results: Finding[] = [];

  results.push(
    flags.debuggable === true
      ? finding({
          id: "build.android-debuggable",
          category: "build",
          severity: "critical",
          title: "Release APK has debuggable enabled",
          description:
            "A debuggable release lets anyone attach a debugger over USB: step through your code, read and change memory (in a game: coins, health, unlocks), bypass license and purchase checks, and dump in-memory tokens. Google Play also rejects debuggable builds.",
          evidence: `${where} android:debuggable="true"`,
          fixPrompt: buildFixPrompt({
            site,
            issue: "My release APK is built with android:debuggable=\"true\".",
            goal: "Release builds are never debuggable; only the debug build type is.",
            steps: [
              "Remove any hard-coded `android:debuggable` attribute from AndroidManifest.xml — let the build type decide.",
              "In app/build.gradle(.kts) make sure `buildTypes { release { debuggable false; minifyEnabled true; shrinkResources true } }` (Kotlin DSL: `isDebuggable = false`, `isMinifyEnabled = true`).",
              "Unity: untick Build Settings → Development Build and Script Debugging. Godot: export with 'Export With Debug' unchecked. React Native / Expo / Capacitor: build the release variant (`./gradlew assembleRelease` / `bundleRelease`).",
              "Sign with the release keystore and rebuild.",
            ],
            verify: "Run `aapt dump badging app-release.apk | grep -i debuggable` (no output means not debuggable) and re-scan the APK in ShipSafe.",
          }),
        })
      : finding({
          id: "build.android-debuggable",
          category: "build",
          severity: "passed",
          title: "Release APK is not debuggable",
          description: "android:debuggable is not enabled, so a debugger can't be attached to the installed app.",
          evidence: `${where} android:debuggable=${flags.debuggable === false ? '"false"' : "(not set → false for release builds)"}`,
        }),
  );

  results.push(
    flags.usesCleartextTraffic === true
      ? finding({
          id: "build.android-cleartext",
          category: "build",
          severity: "warning",
          title: "Cleartext HTTP traffic allowed",
          description:
            "The app may talk to servers over plain http://. Anyone on the same Wi-Fi can read or change that traffic — session tokens, API responses, in-game purchases and leaderboards.",
          evidence: `${where} android:usesCleartextTraffic="true"`,
          fixPrompt: buildFixPrompt({
            site,
            issue: "My Android app sets android:usesCleartextTraffic=\"true\".",
            goal: "All network traffic uses HTTPS; cleartext is only allowed (if ever) for specific debug hosts.",
            steps: [
              "Switch every API / CDN / analytics URL in the app and its config to https://.",
              "Remove android:usesCleartextTraffic from <application> (it defaults to false on API 28+), or add res/xml/network_security_config.xml with `<base-config cleartextTrafficPermitted=\"false\"/>` and reference it via android:networkSecurityConfig.",
              "If a local dev server needs http, allow it only in a debug-only network security config.",
            ],
            verify: "Rebuild, re-scan the APK in ShipSafe, and check with a proxy (e.g. mitmproxy) that no http:// requests remain.",
          }),
        })
      : finding({
          id: "build.android-cleartext",
          category: "build",
          severity: "passed",
          title: "Cleartext traffic is not explicitly enabled",
          description: "android:usesCleartextTraffic is not set to true (Android blocks cleartext by default on API 28+). A network security config could still allow it for specific hosts.",
          evidence: `${where} android:usesCleartextTraffic=${flags.usesCleartextTraffic === false ? '"false"' : "(not set)"}`,
        }),
  );

  results.push(
    flags.allowBackup === false
      ? finding({
          id: "build.android-backup",
          category: "build",
          severity: "passed",
          title: "App data backup is disabled",
          description: "android:allowBackup=\"false\", so app data (tokens, saves, settings) can't be pulled with adb backup.",
          evidence: `${where} android:allowBackup="false"`,
        })
      : finding({
          id: "build.android-backup",
          category: "build",
          severity: "info",
          title: "App data backup enabled (allowBackup)",
          description:
            "With backup enabled (the default when the attribute is missing), app data can be copied off the device via adb backup or cloud backup — including auth tokens and game saves players could edit and restore. Fine for many apps; turn it off or exclude sensitive files if that matters for you.",
          evidence: `${where} android:allowBackup=${flags.allowBackup === true ? '"true"' : "(not set → defaults to true)"}`,
          fixPrompt: buildFixPrompt({
            site,
            issue: "My Android app allows data backup (android:allowBackup is true or missing).",
            goal: "Sensitive app data (tokens, saves, keys) is not included in device or cloud backups.",
            steps: [
              "Either set android:allowBackup=\"false\" on <application>, or keep backup but add android:fullBackupContent / android:dataExtractionRules (API 31+) that exclude shared_prefs with tokens, databases and save files.",
              "Store auth tokens in EncryptedSharedPreferences / Android Keystore, not plain SharedPreferences.",
            ],
            verify: "Rebuild and re-scan the APK in ShipSafe; on a test device run `adb backup` and confirm sensitive files are not included.",
          }),
        }),
  );
  return results;
}

// ---------------------------------------------------------------------------------------------- shared checks

function credentialFileFindings(site: string, entries: Entry[], texts: Map<string, string>): Finding[] {
  const results: Finding[] = [];

  const keystores = entries.filter((entry) => KEYSTORE_EXTENSIONS.includes(entry.ext)).map((entry) => entry.path);
  results.push(
    keystores.length > 0
      ? finding({
          id: "build.signing-keys",
          category: "build",
          severity: "critical",
          title: "Signing keystore bundled inside the build",
          description:
            "A keystore holds the private key that proves updates come from you. Anyone who downloads the build can extract it, try to crack its password offline, and sign malicious 'updates' of your app or game.",
          evidence: `${listWithMore(keystores)}\n(file contents not read)`,
          fixPrompt: buildFixPrompt({
            site,
            issue: `My release build contains signing keystore file(s): ${keystores.slice(0, 3).join(", ")}.`,
            goal: "Keystores never ship inside builds and live only in a secret store / CI secrets.",
            steps: [
              "Remove the keystore from every folder that gets packaged (assets/, res/raw/, StreamingAssets/, the web build output) and add *.jks / *.keystore / *.p12 to .gitignore.",
              "Load signing config from environment variables or a local keystore.properties file that is git-ignored, or use Play App Signing.",
              "Treat the exposed key as compromised: if you use Play App Signing, request an upload-key reset; otherwise plan a key rotation.",
              "Purge the keystore from git history if it was committed.",
            ],
            verify: "Rebuild and re-scan the archive in ShipSafe; `unzip -l app.apk | grep -Ei 'jks|keystore|p12'` must print nothing.",
          }),
        })
      : finding({
          id: "build.signing-keys",
          category: "build",
          severity: "passed",
          title: "No signing keystores in the build",
          description: "No .jks / .keystore / .p12 / .pfx files are packaged inside the archive.",
          evidence: `${entries.length} archive entries checked by name`,
        }),
  );

  const envFiles = entries
    .filter((entry) => entry.ext === ".env" && !/\.(example|sample|template|dist)$/i.test(entry.base))
    .map((entry) => {
      const text = texts.get(entry.path) ?? "";
      const keys = text.split(/\r?\n/).filter((line) => /^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)).length;
      return `${entry.path}${keys ? ` (${keys} KEY=VALUE line(s) — values not shown)` : ""}`;
    });
  results.push(
    envFiles.length > 0
      ? finding({
          id: "build.env-file",
          category: "build",
          severity: "critical",
          title: "Environment file (.env) bundled inside the build",
          description:
            "The build ships a .env file. Anyone who downloads your app or game can unzip it and read every value — API keys, database URLs, service tokens. Assume they are compromised.",
          evidence: listWithMore(envFiles),
          fixPrompt: buildFixPrompt({
            site,
            issue: `My build archive contains .env file(s): ${envFiles.slice(0, 3).join(", ")}.`,
            goal: "No .env file is ever packaged; real secrets live only on a server I control.",
            steps: [
              "Rotate every secret that was in the file (list each key and the provider steps).",
              "Exclude .env* from the build: check the bundler / Unity StreamingAssets / Electron `files` / Capacitor `webDir` config and add an explicit ignore.",
              "Anything the client truly needs must be a public, restricted value; everything secret moves behind your own backend endpoint.",
            ],
            verify: "Rebuild and re-scan the archive in ShipSafe; listing the archive must show no .env files.",
          }),
        })
      : finding({
          id: "build.env-file",
          category: "build",
          severity: "passed",
          title: "No .env files in the build",
          description: "No environment files are packaged inside the archive.",
          evidence: `${entries.length} archive entries checked by name`,
        }),
  );

  const credentialFiles: string[] = [];
  let googleServices: string | null = null;
  for (const entry of entries) {
    if (entry.ext !== ".json") continue;
    const text = texts.get(entry.path);
    if (!text) continue;
    const serviceAccount = /"type"\s*:\s*"service_account"/.test(text) || (/"private_key"\s*:/.test(text) && /"client_email"\s*:/.test(text));
    const oauthSecret = /"client_secret"\s*:\s*"[^"]{8,}"/.test(text);
    if (serviceAccount) credentialFiles.push(`${entry.path} — service account private key`);
    else if (oauthSecret) credentialFiles.push(`${entry.path} — OAuth client_secret`);
    else if (entry.base.toLowerCase() === "google-services.json") googleServices = entry.path;
  }
  if (credentialFiles.length > 0) {
    results.push(
      finding({
        id: "build.credentials-file",
        category: "build",
        severity: "critical",
        title: "Server credentials bundled inside the build",
        description:
          "The build contains a Google service-account key or an OAuth client secret. These grant server-level access (Firestore admin, Cloud APIs, sending mail as your app) to anyone who unzips the build.",
        evidence: `${listWithMore(credentialFiles)}\n(values not shown)`,
        fixPrompt: buildFixPrompt({
          site,
          issue: `My build archive contains server credentials: ${credentialFiles.slice(0, 3).join(", ")}.`,
          goal: "Service-account keys and client secrets exist only on the server; the leaked ones are revoked.",
          steps: [
            "Delete the leaked service-account key in Google Cloud Console → IAM → Service Accounts → Keys (or reset the OAuth client secret) and create a new one stored only server-side.",
            "Remove the file from the packaged folders and add it to .gitignore; move every privileged call (Admin SDK, server APIs) to a backend / Cloud Function.",
            "The client should only ever contain the public google-services.json / Firebase config, protected by Security Rules and App Check.",
          ],
          verify: "Rebuild and re-scan the archive in ShipSafe; check Cloud Audit Logs for use of the old key.",
        }),
      }),
    );
  } else {
    results.push(
      finding({
        id: "build.credentials-file",
        category: "build",
        severity: "passed",
        title: "No server credential files in the build",
        description: "No Google service-account keys or OAuth client secrets were found in the build's JSON files.",
        evidence: `${entries.filter((entry) => entry.ext === ".json").length} JSON file(s) checked`,
      }),
    );
  }
  if (googleServices) {
    results.push(
      finding({
        id: "build.google-services",
        category: "build",
        severity: "info",
        title: "google-services.json found — verify Firebase rules and key restrictions",
        description:
          "This file is meant to be public (its API key only identifies your project). Your data is protected only by Firestore / Realtime Database / Storage Security Rules and API-key restrictions — test-mode rules leave everything open to anyone who extracts this file.",
        evidence: `${googleServices} (contains only public client config)`,
        fixPrompt: buildFixPrompt({
          site,
          issue: "My app ships google-services.json (public Firebase config). I need to make sure the backend is locked down.",
          goal: "Security Rules deny by default, the Android API key is restricted to my app, and App Check is enforced.",
          steps: [
            "Rewrite firestore.rules / database.rules.json / storage.rules to require `request.auth != null` and owner-scoped access; remove any `if true` rules.",
            "In Google Cloud Console → Credentials, restrict the Android API key to my package name + SHA-1 and to only the needed APIs.",
            "Enable Firebase App Check (Play Integrity) and enforce it for Firestore, Storage and Functions.",
          ],
          verify: "Run the Firebase Emulator rules tests and confirm a logged-out client cannot read other users' data.",
        }),
      }),
    );
  }
  return results;
}

function sourceMapFindings(site: string, entries: Entry[]): Finding[] {
  const maps = entries.filter((entry) => /\.(c|m)?js\.map$/i.test(entry.path)).map((entry) => entry.path);
  if (maps.length > 0) {
    return [
      finding({
        id: "frontend.source-maps",
        category: "frontend",
        severity: "warning",
        title: "Source maps exposed in production game/app build",
        description:
          "Source maps let anyone rebuild your original, readable source code from the shipped build — game logic, anti-cheat checks, API endpoints and comments included. That makes cheats, clones and exploits much easier.",
        evidence: listWithMore(maps),
        fixPrompt: buildFixPrompt({
          site,
          issue: `My production build ships ${maps.length} JavaScript source map file(s) (e.g. ${maps[0] ?? ""}).`,
          goal: "Release builds contain no .map files and no sourceMappingURL comments; error tracking gets maps privately.",
          steps: [
            "Vite: `build.sourcemap: false` (or 'hidden' + upload to Sentry). Webpack: `devtool: false` or 'hidden-source-map'. esbuild/Electron Forge: disable sourcemap for production. Next.js: keep productionBrowserSourceMaps off.",
            "Unity WebGL: disable 'Development Build' and keep 'Debug Symbols' off (Player Settings → Publishing Settings). Godot HTML5: export without debug.",
            "If you use Sentry or similar, upload maps in CI and delete them from the output before packaging.",
          ],
          verify: "Rebuild, then `unzip -l build.zip | grep '\\.map$'` must print nothing; re-scan in ShipSafe.",
        }),
      }),
    ];
  }
  return [
    finding({
      id: "frontend.source-maps",
      category: "frontend",
      severity: "passed",
      title: "No source maps in the build",
      description: "No *.js.map files are packaged, so your original source isn't trivially recoverable.",
      evidence: `${entries.length} archive entries checked by name`,
    }),
  ];
}

const ELECTRON_RULES: Array<{ label: string; regex: RegExp }> = [
  { label: "nodeIntegration: true", regex: /["']?nodeIntegration["']?\s*:\s*true\b/ },
  { label: "contextIsolation: false", regex: /["']?contextIsolation["']?\s*:\s*false\b/ },
  { label: "webSecurity: false", regex: /["']?webSecurity["']?\s*:\s*false\b/ },
];

function isElectronBuild(entries: Entry[], texts: Map<string, string>): boolean {
  for (const entry of entries) {
    const text = texts.get(entry.path);
    if (!text) continue;
    if (entry.base.toLowerCase() === "package.json" && /"electron"\s*:/.test(text)) return true;
    if ((entry.ext === ".js" || entry.ext === ".mjs" || entry.ext === ".cjs") && /require\(\s*["']electron["']\s*\)|from\s+["']electron["']|\bBrowserWindow\b/.test(text)) {
      return true;
    }
  }
  return false;
}

function electronFindings(site: string, entries: Entry[], texts: Map<string, string>): Finding[] {
  const hits: string[] = [];
  for (const entry of entries) {
    if (![".js", ".mjs", ".cjs", ".json"].includes(entry.ext)) continue;
    const text = texts.get(entry.path);
    if (!text) continue;
    for (const rule of ELECTRON_RULES) if (rule.regex.test(text)) hits.push(`${entry.path}: ${rule.label}`);
  }
  if (hits.length > 0) {
    return [
      finding({
        id: "build.electron-insecure",
        category: "build",
        severity: "critical",
        title: "Insecure Electron webPreferences",
        description:
          "With nodeIntegration on, contextIsolation off or webSecurity off, any injected script or loaded remote page gets full Node.js access — it can read files, run programs and steal credentials on the player's or user's machine. A single XSS becomes remote code execution.",
        evidence: listWithMore(hits),
        fixPrompt: buildFixPrompt({
          site,
          issue: `My Electron app uses insecure webPreferences (${hits.slice(0, 3).join("; ")}).`,
          goal: "Every BrowserWindow uses nodeIntegration: false, contextIsolation: true, sandbox: true and webSecurity: true, with a minimal preload bridge.",
          steps: [
            "Set `webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true }` on every BrowserWindow / webview.",
            "Move any Node functionality the renderer needs into a preload script that exposes a few narrow functions via `contextBridge.exposeInMainWorld`.",
            "Add a strict Content-Security-Policy to the loaded HTML and block navigation to remote URLs (`will-navigate`, `setWindowOpenHandler`).",
          ],
          verify: "Rebuild, run Electronegativity (`npx @doyensec/electronegativity -i .`) and re-scan the build in ShipSafe.",
        }),
      }),
    ];
  }
  if (!isElectronBuild(entries, texts)) return [];
  return [
    finding({
      id: "build.electron-insecure",
      category: "build",
      severity: "passed",
      title: "Electron webPreferences look safe",
      description: "No nodeIntegration: true, contextIsolation: false or webSecurity: false settings were found in the packaged JS/JSON.",
      evidence: `${entries.filter((entry) => [".js", ".mjs", ".cjs", ".json"].includes(entry.ext)).length} JS/JSON file(s) checked`,
    }),
  ];
}

// ---------------------------------------------------------------------------------------------- main

export function analyzeBuildArchive(files: BuildFiles, fileName: string, options: AnalyzeBuildOptions = {}): ScanResult {
  const target = buildTarget(fileName);
  const site = `${displayTarget(target)} (app/game build)`;

  const entries: Entry[] = Object.entries(files).map(([rawPath, content]) => {
    const path = normalizePath(rawPath);
    return { path, lower: path.toLowerCase(), base: basename(path), ext: extensionOf(path), content };
  });

  // Decode text/config files (within the content limits) once; used by every check.
  const texts = new Map<string, string>();
  for (const entry of entries) {
    if (texts.size >= BUILD_LIMITS.maxFiles) break;
    const isManifest = entry.lower === "androidmanifest.xml";
    if (!isManifest && !TEXT_EXTENSIONS.includes(entry.ext)) continue;
    const text = decodeText(entry.content);
    if (text) texts.set(entry.path, text);
  }

  const isAndroid = /\.apk$/i.test(fileName) || entries.some((entry) => entry.lower === "androidmanifest.xml");
  const findings: Finding[] = [];
  if (isAndroid) findings.push(...androidFindings(site, entries.find((entry) => entry.lower === "androidmanifest.xml")));
  findings.push(...credentialFileFindings(site, entries, texts));
  findings.push(...sourceMapFindings(site, entries));
  findings.push(...electronFindings(site, entries, texts));
  findings.push(...extraBuildFindings(site, { texts, manifest: isAndroid ? entries.find((entry) => entry.lower === "androidmanifest.xml")?.content : undefined }));

  const sources: SecretSource[] = [...texts.entries()].map(([path, text]) => ({ label: path, text }));
  const meta = options.meta ?? {};
  const scannedBytes = sources.reduce((sum, source) => sum + new TextEncoder().encode(source.text).length, 0);
  for (const secret of analyzeSecrets(site, sources)) {
    if (secret.id !== "secrets.none") {
      findings.push(secret);
      continue;
    }
    const skipped = (meta.skippedLarge ?? 0) + (meta.skippedOverLimit ?? 0);
    findings.push({
      ...secret,
      title: "No private keys found in build files",
      description:
        "The build's text and config files don't contain known secret-key formats (Stripe, AWS, OpenAI, Anthropic, GitHub, Supabase service_role, private keys).",
      evidence:
        `Scanned ${sources.length} text/config file(s), ${formatBytes(scannedBytes)}` +
        (meta.totalEntries ? ` of ${meta.totalEntries} archive entries` : "") +
        (skipped ? ` · ${skipped} large or extra file(s) not read` : ""),
    });
  }

  const sorted = sortFindings(findings);
  const { score, grade, summary } = scoreFindings(sorted);
  const detectedStack = detectBuildStack(entries.map((entry) => entry.path), fileName);
  return {
    target,
    finalUrl: target,
    scannedAt: (options.now ?? new Date()).toISOString(),
    overallScore: score,
    grade,
    scanDurationMs: Math.max(0, Math.round(options.durationMs ?? 0)),
    summary,
    findings: enrichFindings(sorted, site, snippetStacksFor(detectedStack)),
    scoreBreakdown: buildScoreBreakdown(sorted),
    detectedStack,
  };
}

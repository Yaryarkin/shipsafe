/**
 * Extra, browser-safe checks for .apk / .zip builds: risky Android permissions, hard-coded
 * endpoints, high-entropy tokens assigned to secret-looking names, and debug flags in config files.
 * Pure functions over already-decoded text, so they run in the browser and in Vitest.
 */
import { findAttribute, isBinaryXml, parseBinaryXml } from "./axml";
import type { Finding } from "./types";
import { buildFixPrompt, finding, maskSecret, truncate } from "./utils";

export interface ExtraBuildInput {
  /** Decoded text of every text/config file, keyed by archive path. */
  texts: Map<string, string>;
  /** Raw AndroidManifest.xml (binary or plain), when the build is an Android app. */
  manifest?: string | Uint8Array;
}

const MAX_LIST = 8;
const MAX_MATCHES_PER_FILE = 40;
const SKIPPED_PATH = /(?:^|\/)(?:node_modules|\.git|third[-_]?party|licenses?)(?:\/|$)|\.(?:md|markdown|txt)$/i;

// ------------------------------------------------------------------------------------ permissions

export const HIGH_RISK_PERMISSIONS: Readonly<Record<string, string>> = {
  READ_SMS: "reads text messages (one-time codes, private chats)",
  SEND_SMS: "sends text messages (premium-rate fraud)",
  RECEIVE_SMS: "intercepts incoming text messages",
  RECEIVE_MMS: "intercepts incoming multimedia messages",
  READ_CALL_LOG: "reads the call history",
  WRITE_CALL_LOG: "changes the call history",
  PROCESS_OUTGOING_CALLS: "monitors and redirects outgoing calls",
  BIND_ACCESSIBILITY_SERVICE: "reads and controls other apps' screens",
  BIND_DEVICE_ADMIN: "device administrator rights",
  REQUEST_INSTALL_PACKAGES: "installs other apps",
  INSTALL_PACKAGES: "installs apps silently",
  MANAGE_EXTERNAL_STORAGE: "access to all files on the device",
  SYSTEM_ALERT_WINDOW: "draws over other apps (overlay attacks)",
  QUERY_ALL_PACKAGES: "lists every installed app",
  WRITE_SECURE_SETTINGS: "changes protected system settings",
};

export const SENSITIVE_PERMISSIONS: Readonly<Record<string, string>> = {
  ACCESS_BACKGROUND_LOCATION: "location while the app is closed",
  READ_CONTACTS: "contacts",
  WRITE_CONTACTS: "contacts (write)",
  RECORD_AUDIO: "microphone",
  CAMERA: "camera",
  READ_PHONE_STATE: "phone identity and call state",
  GET_ACCOUNTS: "accounts on the device",
  READ_CALENDAR: "calendar",
  BODY_SENSORS: "body sensors",
  READ_EXTERNAL_STORAGE: "shared storage",
  WRITE_EXTERNAL_STORAGE: "shared storage (write)",
};

function shortPermission(name: string): string {
  return name.replace(/^android\.permission\./, "");
}

/** Reads <uses-permission> names from a binary or plain-text manifest. Never throws. */
export function readManifestPermissions(content: string | Uint8Array): string[] {
  const names = new Set<string>();
  try {
    if (typeof content !== "string" && isBinaryXml(content)) {
      const doc = parseBinaryXml(content);
      for (const element of doc?.elements ?? []) {
        if (element.name !== "uses-permission" && element.name !== "uses-permission-sdk-23") continue;
        const value = findAttribute(element, "name")?.rawValue;
        if (value) names.add(value);
      }
    } else {
      const text = typeof content === "string" ? content : new TextDecoder().decode(content);
      for (const match of text.matchAll(/<uses-permission(?:-sdk-23)?\b[^>]*android:name\s*=\s*["']([^"']+)["']/gi)) {
        if (match[1]) names.add(match[1]);
      }
    }
  } catch {
    return [];
  }
  return [...names];
}

export function permissionFindings(site: string, manifest: string | Uint8Array | undefined): Finding[] {
  if (!manifest) return [];
  const permissions = readManifestPermissions(manifest);
  if (permissions.length === 0) return [];
  const short = permissions.map(shortPermission);
  const high = short.filter((name) => name in HIGH_RISK_PERMISSIONS);
  const sensitive = short.filter((name) => name in SENSITIVE_PERMISSIONS);

  if (high.length === 0 && sensitive.length === 0) {
    return [
      finding({
        id: "build.android-permissions",
        category: "build",
        severity: "passed",
        title: "No high-risk Android permissions",
        description: "The manifest requests no SMS, call-log, accessibility, install or all-files permissions.",
        evidence: `${permissions.length} permission(s) declared`,
      }),
    ];
  }

  const lines = [
    ...high.slice(0, MAX_LIST).map((name) => `${name} — ${HIGH_RISK_PERMISSIONS[name] ?? "high risk"}`),
    ...sensitive.slice(0, Math.max(0, MAX_LIST - high.length)).map((name) => `${name} — ${SENSITIVE_PERMISSIONS[name] ?? "sensitive"}`),
  ];
  return [
    finding({
      id: "build.android-permissions",
      category: "build",
      severity: high.length > 0 ? "warning" : "info",
      title: high.length > 0 ? "App requests high-risk Android permissions" : "App requests sensitive Android permissions",
      description:
        high.length > 0
          ? "These permissions are rarely justified. Google Play restricts them, users distrust them, and malware abuses the same set. Remove every permission the app does not strictly need."
          : "Each permission widens what a compromised or reverse-engineered app can read. Keep only the ones a feature really needs, and request them at the moment of use.",
      evidence: lines.join("\n"),
      fixPrompt: buildFixPrompt({
        site,
        issue: `My Android app declares these risky permissions: ${[...high, ...sensitive].join(", ")}.`,
        goal: "Request only the permissions the app genuinely needs and drop the rest.",
        steps: [
          "For each permission, tell me which feature uses it. Remove it from AndroidManifest.xml (and from library manifests via `tools:node=\"remove\"`) if no feature does.",
          "Use narrower alternatives: the photo picker instead of storage permissions, `ACCESS_COARSE_LOCATION` instead of fine or background location, an SMS User Consent API instead of READ_SMS.",
          "Request runtime permissions in context, right before the feature that needs them, with a short explanation.",
        ],
        verify: "Rebuild, then run `aapt dump permissions app-release.apk` and re-scan the build in ShipSafe.",
      }),
    }),
  ];
}

// -------------------------------------------------------------------------------------- endpoints

const IGNORED_HOSTS =
  /^(?:schemas\.android\.com|www\.w3\.org|schemas\.xmlsoap\.org|schemas\.microsoft\.com|ns\.adobe\.com|xmlpull\.org|www\.apache\.org|apache\.org|json-schema\.org|purl\.org|www\.example\.com|example\.(?:com|org|net)|android\.com|developer\.android\.com|maven\.google\.com|dl\.google\.com)$/i;
const LOCAL_HOST = /^(?:localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.(?:local|lan|internal|localhost))$/i;
const STAGING_HOST = /(?:^|\.)(?:staging|stage|dev|test|qa|uat|preprod|sandbox)[.-]/i;
const URL_REGEX = /\bhttps?:\/\/[^\s"'<>\\)\]}`]{3,200}/gi;

export interface FoundEndpoint {
  scheme: "http" | "https";
  host: string;
  /** Origin + path, with the query string and fragment removed so tokens in URLs never reach a finding. */
  display: string;
  file: string;
}

export function collectEndpoints(texts: Map<string, string>): FoundEndpoint[] {
  const seen = new Map<string, FoundEndpoint>();
  for (const [file, content] of texts) {
    if (SKIPPED_PATH.test(file)) continue;
    let count = 0;
    for (const match of content.matchAll(URL_REGEX)) {
      if (++count > MAX_MATCHES_PER_FILE) break;
      let parsed: URL;
      try {
        parsed = new URL(match[0]);
      } catch {
        continue;
      }
      const host = parsed.hostname.toLowerCase();
      if (!host.includes(".") && !LOCAL_HOST.test(host)) continue;
      if (IGNORED_HOSTS.test(host)) continue;
      const display = `${parsed.protocol}//${parsed.host}${parsed.pathname === "/" ? "" : parsed.pathname}`;
      if (!seen.has(display)) {
        seen.set(display, { scheme: parsed.protocol === "http:" ? "http" : "https", host, display, file });
      }
    }
  }
  return [...seen.values()];
}

export function endpointFindings(site: string, texts: Map<string, string>): Finding[] {
  const endpoints = collectEndpoints(texts);
  if (endpoints.length === 0) return [];
  const findings: Finding[] = [];

  const internal = endpoints.filter((endpoint) => LOCAL_HOST.test(endpoint.host) || STAGING_HOST.test(endpoint.host));
  const cleartext = endpoints.filter((endpoint) => endpoint.scheme === "http" && !LOCAL_HOST.test(endpoint.host));
  const api = endpoints.filter((endpoint) => endpoint.scheme === "https" && /(?:^|\.)api\.|\/api(?:\/|$)|\/v\d+(?:\/|$)/i.test(endpoint.display));

  const line = (endpoint: FoundEndpoint) => `${truncate(endpoint.display, 90)}  in ${truncate(endpoint.file, 50)}`;
  const list = (items: FoundEndpoint[]) => items.slice(0, MAX_LIST).map(line).join("\n") + (items.length > MAX_LIST ? `\n+${items.length - MAX_LIST} more` : "");

  if (cleartext.length > 0) {
    findings.push(
      finding({
        id: "build.cleartext-endpoints",
        category: "build",
        severity: "warning",
        title: "App talks to servers over plain http://",
        description:
          "Traffic to these endpoints is not encrypted, so anyone on the same Wi-Fi can read or change it (tokens, user data, game state). Android 9+ blocks cleartext by default, so these calls either fail or the manifest was loosened to allow them.",
        evidence: list(cleartext),
        fixPrompt: buildFixPrompt({
          site,
          issue: `My app hard-codes plain http:// endpoints: ${cleartext.slice(0, 5).map((endpoint) => endpoint.display).join(", ")}.`,
          goal: "Every endpoint uses https:// with a valid certificate.",
          steps: [
            "Switch each endpoint to https:// and enable TLS on the server if it is missing.",
            "Move endpoint base URLs into build-type config so release builds can never point at an http:// or test server.",
            "Keep `usesCleartextTraffic` off and add a network_security_config.xml that pins the production domain.",
          ],
          verify: "Rebuild and re-scan the archive in ShipSafe; the endpoint list should have no http:// entries.",
        }),
      }),
    );
  }

  if (internal.length > 0) {
    findings.push(
      finding({
        id: "build.internal-endpoints",
        category: "build",
        severity: "info",
        title: "Build points at local, staging or test servers",
        description:
          "Local, private-network and staging hosts in a release build reveal your infrastructure and usually mean a development config shipped by mistake. Staging servers are often less protected than production.",
        evidence: list(internal),
        fixPrompt: buildFixPrompt({
          site,
          issue: `My release build contains local or staging endpoints: ${internal.slice(0, 5).map((endpoint) => endpoint.display).join(", ")}.`,
          goal: "Release builds contain only production endpoints.",
          steps: [
            "Find where each URL is defined and move it to per-environment config (build flavors, .env files that are not bundled).",
            "Add a CI check that fails the release build when a localhost, 10.x, 192.168.x or staging URL is present.",
          ],
          verify: "Rebuild the release and re-scan it in ShipSafe.",
        }),
      }),
    );
  }

  if (api.length > 0) {
    findings.push(
      finding({
        id: "build.api-endpoints",
        category: "build",
        severity: "info",
        title: `${api.length} hard-coded API endpoint${api.length === 1 ? "" : "s"} found`,
        description:
          "Anyone can unpack the build and read these URLs, then call them directly without your app. Make sure each one enforces authentication, authorization and rate limits on the server, because the app itself is not a trust boundary.",
        evidence: list(api),
        fixPrompt: buildFixPrompt({
          site,
          issue: `My app hard-codes these API endpoints: ${api.slice(0, 5).map((endpoint) => endpoint.display).join(", ")}.`,
          goal: "Every endpoint is safe to call by anyone who has the URL.",
          steps: [
            "For each endpoint, confirm the server checks the user's token and permissions on every request.",
            "Add rate limiting and input validation, and remove any admin or debug routes from the public API.",
            "Never rely on the app to hide a route or enforce a rule: client checks can be bypassed.",
          ],
          verify: "Call each endpoint with curl and no token; it must return 401 or 403.",
        }),
      }),
    );
  }
  return findings;
}

// ---------------------------------------------------------------------------------------- tokens

const SECRET_NAME_ASSIGNMENT =
  /(?:api[_-]?key|apikey|secret|token|passwd|password|client[_-]?secret|auth[_-]?token|access[_-]?key|private[_-]?key)["']?\s*[:=]\s*["']([A-Za-z0-9+/=_.-]{20,120})["']/gi;
const PLACEHOLDER_VALUE = /^(?:your|xxx|example|changeme|change[-_]?me|replace|insert|placeholder|dummy|sample|test[-_]?token|todo|null|undefined|true|false)|^[<{$%]|\*{4,}|\.{4,}/i;

/** Shannon entropy in bits per character. Random tokens score above ~3.5; words and paths score lower. */
export function shannonEntropy(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function describeTokenEncoding(value: string): "hex" | "base64" | "token" {
  if (/^[0-9a-f]+$/i.test(value) && [32, 40, 48, 64, 128].includes(value.length)) return "hex";
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(value) && value.length % 4 === 0) return "base64";
  return "token";
}

export function tokenFindings(site: string, texts: Map<string, string>): Finding[] {
  const hits = new Map<string, string>(); // masked value -> "name in file"
  for (const [file, content] of texts) {
    if (SKIPPED_PATH.test(file)) continue;
    let count = 0;
    for (const match of content.matchAll(SECRET_NAME_ASSIGNMENT)) {
      if (++count > MAX_MATCHES_PER_FILE) break;
      const value = match[1];
      if (!value || PLACEHOLDER_VALUE.test(value) || /^[A-Za-z]+$/.test(value) || /^\d+$/.test(value)) continue;
      const encoding = describeTokenEncoding(value);
      const entropy = shannonEntropy(value);
      if (entropy < (encoding === "hex" ? 3.2 : 3.6)) continue;
      const name = /^([a-z_-]+)/i.exec(match[0])?.[1] ?? "value";
      const masked = maskSecret(value);
      if (!hits.has(masked)) hits.set(masked, `${name} = ${masked} (${encoding}) in ${truncate(file, 60)}`);
    }
  }
  if (hits.size === 0) return [];
  const lines = [...hits.values()];
  return [
    finding({
      id: "build.hardcoded-tokens",
      category: "build",
      severity: "warning",
      title: `${hits.size} hard-coded token${hits.size === 1 ? "" : "s"} or secret${hits.size === 1 ? "" : "s"} in build files`,
      description:
        "High-entropy values assigned to names like apiKey, secret or token are stored in the build. Anyone can unpack it and copy them. Treat them as public: restrict or rotate each one, and keep real secrets on your server.",
      evidence: lines.slice(0, MAX_LIST).join("\n") + (lines.length > MAX_LIST ? `\n+${lines.length - MAX_LIST} more` : ""),
      fixPrompt: buildFixPrompt({
        site,
        issue: `My build contains hard-coded secrets or tokens (${lines.length} found, values masked).`,
        goal: "No private token ships inside the app; anything that must be in the client is restricted to the minimum.",
        steps: [
          "For each value, decide whether it is public by design (restricted client key) or private. Rotate every private one at its provider.",
          "Move private keys to a server you control and call that server from the app with the user's own session token.",
          "Restrict public keys by package name and signing certificate (Android), bundle ID (iOS) or domain (web) in the provider's console.",
          "Keep build-time secrets in CI secrets or a gitignored .env that is not bundled.",
        ],
        verify: "Rebuild, re-scan the archive in ShipSafe, and confirm the finding is gone.",
      }),
    }),
  ];
}

// ----------------------------------------------------------------------------------------- debug

const DEBUG_CONFIG_EXTENSIONS = new Set([".json", ".properties", ".cfg", ".ini", ".yml", ".yaml", ".env", ".toml", ".plist", ".conf"]);
const DEBUG_FLAG = /["']?\b(?:debug|debug_?mode|is_?debug|enable_?debug|debuggable|verbose_?logging|development_?mode|dev_?mode)["']?\s*[:=]\s*["']?(?:true|1|on|yes)\b/gi;

function extensionOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot).toLowerCase() : base.startsWith(".") ? base.toLowerCase() : "";
}

export function debugFlagFindings(site: string, texts: Map<string, string>): Finding[] {
  const hits: string[] = [];
  for (const [file, content] of texts) {
    if (SKIPPED_PATH.test(file) || !DEBUG_CONFIG_EXTENSIONS.has(extensionOf(file))) continue;
    const match = new RegExp(DEBUG_FLAG.source, "i").exec(content);
    if (match) hits.push(`${truncate(match[0].replace(/\s+/g, " "), 50)}  in ${truncate(file, 60)}`);
    if (hits.length >= 25) break;
  }
  if (hits.length === 0) return [];
  return [
    finding({
      id: "build.debug-flags",
      category: "build",
      severity: "info",
      title: "Debug flags are enabled in config files",
      description:
        "Config files in the build switch on debug or development mode. That usually exposes verbose logs, test endpoints, skipped checks or cheat menus to anyone who unpacks the app.",
      evidence: hits.slice(0, MAX_LIST).join("\n") + (hits.length > MAX_LIST ? `\n+${hits.length - MAX_LIST} more` : ""),
      fixPrompt: buildFixPrompt({
        site,
        issue: `My release build ships config files with debug flags enabled (${hits.slice(0, 3).join("; ")}).`,
        goal: "Release builds run with every debug and development flag turned off.",
        steps: [
          "Set each flag to false for the release configuration (build flavors, per-environment config files).",
          "Make the build fail when a debug flag is true in release mode.",
          "Strip debug-only files from the release package.",
        ],
        verify: "Rebuild the release and re-scan it in ShipSafe.",
      }),
    }),
  ];
}

export function extraBuildFindings(site: string, input: ExtraBuildInput): Finding[] {
  return [
    ...permissionFindings(site, input.manifest),
    ...endpointFindings(site, input.texts),
    ...tokenFindings(site, input.texts),
    ...debugFlagFindings(site, input.texts),
  ];
}


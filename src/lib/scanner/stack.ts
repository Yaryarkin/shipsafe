/**
 * Target stack detection. Reads clues that a passive scan already has (response headers, the HTML
 * shell, script URLs) or that an archive already shows (its file paths), and names the likely
 * stack so fixes can be shown for that stack first. Pure and browser-safe.
 *
 * Detection is a hint, never a verdict: every result carries the signals that produced it, so the
 * UI can show why, and a wrong guess only changes the order of the fix tabs.
 */
import type { Stack } from "./types";

export type DetectedStackId =
  | "nextjs"
  | "vercel"
  | "netlify"
  | "cloudflare"
  | "nginx"
  | "apache"
  | "express"
  | "wordpress"
  | "android"
  | "react-native"
  | "flutter"
  | "unity"
  | "godot"
  | "electron"
  | "static-web";

export type Confidence = "high" | "medium";

export interface StackDetection {
  id: DetectedStackId;
  label: string;
  confidence: Confidence;
  /** Short, human-readable clues, e.g. "x-vercel-id header". */
  signals: string[];
}

const LABELS: Record<DetectedStackId, string> = {
  nextjs: "Next.js",
  vercel: "Vercel",
  netlify: "Netlify",
  cloudflare: "Cloudflare",
  nginx: "Nginx",
  apache: "Apache",
  express: "Node / Express",
  wordpress: "WordPress",
  android: "Android app",
  "react-native": "React Native",
  flutter: "Flutter",
  unity: "Unity WebGL",
  godot: "Godot",
  electron: "Electron",
  "static-web": "Static web build",
};

/** Which fix-snippet tabs each detected stack maps to (see `fixes.ts`). Stacks without snippets map to nothing. */
const SNIPPET_STACKS: Record<string, Stack[] | undefined> = {
  nextjs: ["nextjs"],
  vercel: ["vercel"],
  nginx: ["nginx"],
  express: ["express"],
  android: ["android"],
  "react-native": ["android"],
  flutter: ["android"],
};

/** Detections are listed most specific first. */
const ORDER: DetectedStackId[] = [
  "nextjs",
  "vercel",
  "express",
  "wordpress",
  "netlify",
  "cloudflare",
  "nginx",
  "apache",
  "android",
  "react-native",
  "flutter",
  "unity",
  "godot",
  "electron",
  "static-web",
];

function make(id: DetectedStackId, signals: string[]): StackDetection | null {
  if (signals.length === 0) return null;
  return { id, label: LABELS[id], confidence: signals.length >= 2 ? "high" : "medium", signals };
}

function sortDetections(items: Array<StackDetection | null>): StackDetection[] {
  return items.filter((item): item is StackDetection => item !== null).sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}

export interface WebStackInput {
  /** Response headers with lower-case names. */
  headers: Record<string, string>;
  html: string;
  scriptUrls?: string[];
}

export function detectWebStack(input: WebStackInput): StackDetection[] {
  const header = (name: string) => (input.headers[name] ?? "").toLowerCase();
  const server = header("server");
  const poweredBy = header("x-powered-by");
  const html = input.html.slice(0, 200_000);
  const scripts = input.scriptUrls ?? [];

  const next: string[] = [];
  if (poweredBy.includes("next.js")) next.push("x-powered-by: Next.js");
  if (/__NEXT_DATA__|id="__next"|self\.__next_f/.test(html)) next.push("Next.js markup in the HTML");
  if (/\/_next\/static\//.test(html) || scripts.some((url) => url.includes("/_next/"))) next.push("/_next/ assets");

  const vercel: string[] = [];
  if (input.headers["x-vercel-id"]) vercel.push("x-vercel-id header");
  if (server.includes("vercel")) vercel.push("server: Vercel");

  const netlify: string[] = [];
  if (input.headers["x-nf-request-id"]) netlify.push("x-nf-request-id header");
  if (server.includes("netlify")) netlify.push("server: Netlify");

  const cloudflare: string[] = [];
  if (input.headers["cf-ray"]) cloudflare.push("cf-ray header");
  if (server.includes("cloudflare")) cloudflare.push("server: cloudflare");

  const nginx: string[] = [];
  if (server.includes("nginx")) nginx.push("server: nginx");

  const apache: string[] = [];
  if (server.includes("apache")) apache.push("server: Apache");

  const express: string[] = [];
  if (poweredBy.includes("express")) express.push("x-powered-by: Express");

  const wordpress: string[] = [];
  if (/\/wp-content\/|\/wp-includes\//.test(html)) wordpress.push("wp-content assets");
  if (/api\.w\.org/.test(header("link"))) wordpress.push("WordPress REST link header");

  return sortDetections([
    make("nextjs", next),
    make("vercel", vercel),
    make("netlify", netlify),
    make("cloudflare", cloudflare),
    make("nginx", nginx),
    make("apache", apache),
    make("express", express),
    make("wordpress", wordpress),
  ]).slice(0, 5);
}

/** Looks at an archive's file paths (and its name) to tell an Android app from a game export or a web build. */
export function detectBuildStack(paths: string[], fileName = ""): StackDetection[] {
  const lower = paths.map((path) => path.toLowerCase().replace(/\\/g, "/"));
  const has = (test: (path: string) => boolean) => lower.some(test);
  const isApk = /\.apk$/i.test(fileName);

  const android: string[] = [];
  if (isApk) android.push(".apk package");
  if (has((path) => path === "androidmanifest.xml")) android.push("AndroidManifest.xml");
  if (has((path) => /^classes\d*\.dex$/.test(path))) android.push("classes.dex");

  const reactNative: string[] = [];
  if (has((path) => path.endsWith("index.android.bundle") || path.includes("libreactnativejni"))) reactNative.push("React Native bundle");

  const flutter: string[] = [];
  if (has((path) => path.includes("libflutter.so") || path.includes("flutter_assets/"))) flutter.push("Flutter engine or assets");

  const unity: string[] = [];
  if (has((path) => /\.unityweb$|\.framework\.js(\.|$)|unityloader\.js$/.test(path))) unity.push("Unity WebGL loader files");
  if (has((path) => path.includes("streamingassets/") || path.includes("libunity.so") || path.endsWith("unity default resources"))) unity.push("Unity assets");

  const godot: string[] = [];
  if (has((path) => path.endsWith(".pck"))) godot.push(".pck data file");
  if (has((path) => /godot/.test(path))) godot.push("Godot files");

  const electron: string[] = [];
  if (has((path) => path.endsWith("resources/app.asar") || path === "app.asar")) electron.push("app.asar");
  if (has((path) => /(^|\/)electron(\.exe)?$|electron\.asar$/.test(path))) electron.push("Electron runtime");

  const staticWeb: string[] = [];
  const hasIndex = has((path) => path === "index.html" || /^[^/]+\/index\.html$/.test(path));
  const isOtherRuntime = android.length + reactNative.length + flutter.length + unity.length + godot.length + electron.length > 0;
  if (hasIndex && !isOtherRuntime) staticWeb.push("index.html at the root");
  if (hasIndex && !isOtherRuntime && has((path) => /\.(js|css)$/.test(path))) staticWeb.push("bundled JS / CSS");

  return sortDetections([
    make("android", android),
    make("react-native", reactNative),
    make("flutter", flutter),
    make("unity", unity),
    make("godot", godot),
    make("electron", electron),
    make("static-web", staticWeb),
  ]);
}

/** Snippet tabs to show first, in order, without duplicates. */
export function snippetStacksFor(detections: ReadonlyArray<{ id: string }> | undefined): Stack[] {
  const result: Stack[] = [];
  for (const detection of detections ?? []) {
    for (const stack of SNIPPET_STACKS[detection.id] ?? []) {
      if (!result.includes(stack)) result.push(stack);
    }
  }
  return result;
}

export function describeDetections(detections: ReadonlyArray<{ label: string }> | undefined): string {
  return (detections ?? []).map((item) => item.label).join(", ");
}

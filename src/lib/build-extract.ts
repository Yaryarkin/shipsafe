import JSZip from "jszip";
import {
  assertArchiveSize,
  BUILD_LIMITS,
  BuildArchiveError,
  extensionOf,
  TEXT_EXTENSIONS,
  type BuildArchiveMeta,
  type BuildFiles,
} from "@/lib/scanner/build-analyzer";

/**
 * Unpacks an .apk / .zip in the browser (nothing is uploaded). Every entry name is kept (name-based
 * checks need them), but contents are read only for a limited number of small text/config files —
 * media and binaries are never decompressed, so a scan takes ~0.5–2 s even for big game builds.
 * Loaded lazily from the UI so JSZip never weighs on the landing page.
 */

export interface ExtractOptions {
  maxArchiveBytes?: number;
  maxFiles?: number;
  maxFileBytes?: number;
  /** Cap on how many entry names are kept (huge archives). */
  maxEntries?: number;
}

export interface ExtractedBuild {
  files: BuildFiles;
  meta: BuildArchiveMeta;
}

const EMPTY = new Uint8Array(0);
const MAX_ENTRIES = 20_000;

/** Lower number = read first. */
function priority(path: string): number {
  const lower = path.toLowerCase();
  if (lower === "androidmanifest.xml") return 0;
  const ext = extensionOf(path);
  if (ext === ".env") return 1;
  if ([".json", ".properties", ".plist", ".yaml", ".yml", ".cfg", ".ini", ".xml"].includes(ext)) return 2;
  if ([".js", ".mjs", ".cjs"].includes(ext)) return 3;
  return 4;
}

/** JSZip keeps the uncompressed size in a private field; use it when available to skip big files cheaply. */
function knownSize(entry: JSZip.JSZipObject): number | null {
  const size = (entry as unknown as { _data?: { uncompressedSize?: unknown } })._data?.uncompressedSize;
  return typeof size === "number" && Number.isFinite(size) ? size : null;
}

export async function extractBuildArchive(
  input: Blob | ArrayBuffer | Uint8Array,
  fileName: string,
  options: ExtractOptions = {},
): Promise<ExtractedBuild> {
  const maxArchiveBytes = options.maxArchiveBytes ?? BUILD_LIMITS.maxArchiveBytes;
  const maxFiles = options.maxFiles ?? BUILD_LIMITS.maxFiles;
  const maxFileBytes = options.maxFileBytes ?? BUILD_LIMITS.maxFileBytes;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;

  const archiveBytes = input instanceof Blob ? input.size : input.byteLength;
  assertArchiveSize(archiveBytes, maxArchiveBytes);

  let zip: JSZip;
  try {
    const data = input instanceof Blob ? await input.arrayBuffer() : input;
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new BuildArchiveError(`"${fileName}" isn't a readable .apk or .zip archive.`);
  }

  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  const files: BuildFiles = {};
  for (const entry of entries.slice(0, maxEntries)) files[entry.name] = EMPTY;

  const candidates = entries
    .filter((entry) => entry.name.toLowerCase() === "androidmanifest.xml" || TEXT_EXTENSIONS.includes(extensionOf(entry.name)))
    .sort((a, b) => priority(a.name) - priority(b.name) || a.name.split("/").length - b.name.split("/").length || a.name.localeCompare(b.name));

  let read = 0;
  let skippedLarge = 0;
  let skippedOverLimit = 0;
  for (const entry of candidates) {
    if (read >= maxFiles) {
      skippedOverLimit += 1;
      continue;
    }
    const size = knownSize(entry);
    if (size !== null && size > maxFileBytes) {
      skippedLarge += 1;
      continue;
    }
    // XML may be compiled binary (AXML) inside APKs, so it is read as bytes; everything else as text.
    const asBytes = extensionOf(entry.name) === ".xml";
    try {
      const content = asBytes ? await entry.async("uint8array") : await entry.async("string");
      const length = typeof content === "string" ? content.length : content.byteLength;
      if (length > maxFileBytes) {
        skippedLarge += 1;
        continue;
      }
      files[entry.name] = content;
      read += 1;
    } catch {
      // A corrupt entry shouldn't abort the whole scan.
    }
  }

  return {
    files,
    meta: { totalEntries: entries.length, skippedLarge, skippedOverLimit, archiveBytes },
  };
}

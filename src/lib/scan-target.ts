/**
 * Scan targets are either website URLs (https://…) or local build archives scanned in the browser,
 * encoded as `build:<url-encoded file name>` — a valid URL for `scanResultSchema` (z.string().url())
 * that can never be confused with a real website.
 */

export const BUILD_TARGET_PREFIX = "build:";

export function buildTarget(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop()?.trim() || "build";
  return `${BUILD_TARGET_PREFIX}${encodeURIComponent(name.slice(0, 120))}`;
}

export function isBuildTarget(target: string): boolean {
  return target.startsWith(BUILD_TARGET_PREFIX);
}

/** Human-readable name: the host for websites, the file name for builds. */
export function displayTarget(target: string): string {
  if (isBuildTarget(target)) {
    const raw = target.slice(BUILD_TARGET_PREFIX.length);
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  try {
    return new URL(target).host || target;
  } catch {
    return target;
  }
}

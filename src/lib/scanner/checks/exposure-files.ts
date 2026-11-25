import { isHtmlResponse, type SafeResponse, type ScanContext } from "../http";
import type { Finding } from "../types";
import { buildFixPrompt, finding, formatBytes, truncate } from "../utils";

/** Only the first bytes are read: enough to recognise a file type, never enough to dump it. */
const PROBE_MAX_BYTES = 4 * 1024;
const SITEMAP_MAX_BYTES = 128 * 1024;

export interface SensitiveFileProbe {
  slug: string;
  path: string;
  title: string;
  /** What an attacker gets from this file. */
  impact: string;
  /** Returns a short, non-sensitive description when the bytes really are this kind of file. */
  confirm(body: Buffer): string | null;
}

const text = (body: Buffer) => body.toString("utf8");

/** KEY=VALUE lines, as found in .env files. */
function envLines(body: Buffer): number {
  return text(body)
    .split(/\r?\n/)
    .filter((line) => /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=\s*\S/.test(line)).length;
}

function envProbe(slug: string, path: string): SensitiveFileProbe {
  return {
    slug,
    path,
    title: `${path} is publicly downloadable`,
    impact: "Environment files hold database passwords and secret API keys. Bots request these paths constantly, so assume the secrets are already stolen.",
    confirm: (body) => {
      const lines = envLines(body);
      return lines > 0 ? `${lines} KEY=VALUE line(s)` : null;
    },
  };
}

function archiveProbe(slug: string, path: string, kind: "zip" | "gzip" | "sql" | "tar"): SensitiveFileProbe {
  return {
    slug,
    path,
    title: `Backup file ${path} is publicly downloadable`,
    impact: "A downloadable backup contains your source code or database, including user data and secrets, and needs no hacking skill to steal.",
    confirm: (body) => {
      if (kind === "zip" && body.length >= 4 && body[0] === 0x50 && body[1] === 0x4b && (body[2] === 0x03 || body[2] === 0x05)) return "ZIP archive signature";
      if (kind === "gzip" && body.length >= 3 && body[0] === 0x1f && body[1] === 0x8b) return "gzip archive signature";
      if (kind === "tar" && body.length > 262 && body.subarray(257, 262).toString("latin1") === "ustar") return "tar archive signature";
      if (kind === "sql" && /(?:CREATE TABLE|INSERT INTO|DROP TABLE|-- MySQL dump|-- PostgreSQL database dump|PRAGMA foreign_keys)/i.test(text(body))) return "SQL dump statements";
      return null;
    },
  };
}

export const SENSITIVE_FILE_PROBES: readonly SensitiveFileProbe[] = [
  envProbe("env-local", "/.env.local"),
  envProbe("env-production", "/.env.production"),
  envProbe("env-backup", "/.env.backup"),
  {
    slug: "git-config",
    path: "/.git/config",
    title: "/.git/config is publicly downloadable",
    impact: "The git config shows the repository location and sometimes embeds an access token in the remote URL. It also proves the whole .git folder can be downloaded.",
    confirm: (body) => (/^\s*\[(?:core|remote ["'][^"']+["']|branch ["'][^"']+["'])\]/m.test(text(body)) ? "git config sections" : null),
  },
  {
    slug: "ds-store",
    path: "/.DS_Store",
    title: "macOS /.DS_Store file is publicly downloadable",
    impact: "A .DS_Store file lists the names of every file and folder in that directory, which reveals hidden admin pages, backups and unreleased features.",
    confirm: (body) => (body.length >= 8 && body.subarray(4, 8).toString("latin1") === "Bud1" ? "Finder metadata signature" : null),
  },
  {
    slug: "htpasswd",
    path: "/.htpasswd",
    title: "/.htpasswd is publicly downloadable",
    impact: "The file contains usernames and password hashes that can be cracked offline.",
    confirm: (body) => (/^[^\s:]+:(?:\$apr1\$|\$2[aby]\$|\{SHA\}|\$5\$|\$6\$)/m.test(text(body)) ? "user:hash entries" : null),
  },
  archiveProbe("backup-zip", "/backup.zip", "zip"),
  archiveProbe("site-zip", "/site.zip", "zip"),
  archiveProbe("www-zip", "/www.zip", "zip"),
  archiveProbe("backup-tar-gz", "/backup.tar.gz", "gzip"),
  archiveProbe("backup-sql", "/backup.sql", "sql"),
  archiveProbe("db-sql", "/db.sql", "sql"),
  archiveProbe("dump-sql", "/dump.sql", "sql"),
  archiveProbe("database-sql", "/database.sql", "sql"),
  {
    slug: "config-json",
    path: "/config.json",
    title: "/config.json exposes credentials",
    impact: "A public config file that contains credentials gives attackers direct access to the services it names.",
    confirm: (body) => {
      const raw = text(body);
      if (!/^\s*[{[]/.test(raw)) return null;
      return /"(?:password|passwd|secret|client_secret|private_key|api[_-]?key|access[_-]?token|db_?pass(?:word)?)"\s*:\s*"[^"]{6,}"/i.test(raw) ? "credential-style keys with values" : null;
    },
  },
];

async function probeFile(ctx: ScanContext, origin: string, path: string): Promise<SafeResponse | null> {
  try {
    return await ctx.fetch(new URL(path, origin), { maxBytes: PROBE_MAX_BYTES, followRedirects: false });
  } catch {
    return null;
  }
}

/** A real file: HTTP 200, not an HTML fallback page, with a body. */
function isRealFile(response: SafeResponse | null): response is SafeResponse {
  return response !== null && response.status === 200 && response.body.length > 0 && !isHtmlResponse(response);
}

export function sensitiveFileFinding(site: string, probe: SensitiveFileProbe, response: SafeResponse, detail: string): Finding {
  return finding({
    id: `exposure.file.${probe.slug}`,
    category: "exposure",
    severity: "critical",
    title: probe.title,
    description: probe.impact,
    evidence: `GET ${probe.path} → HTTP ${response.status} (${response.headers["content-type"] ?? "no content-type"}) · ${detail} · ${formatBytes(response.body.length)} read — contents intentionally not shown`,
    fixPrompt: buildFixPrompt({
      site,
      issue: `The file ${probe.path} is publicly downloadable at ${site}${probe.path}.`,
      goal: "Remove the file from the public web root and block this kind of file at the server.",
      steps: [
        "Delete the file from the deployed folder, then find out why it was deployed (a static server rooted at the project folder, a Docker COPY . ., a manual upload).",
        "Block dotfiles and backup extensions (.env*, .git, .DS_Store, .sql, .zip, .tar.gz, .bak) at the server or CDN, except /.well-known/.",
        "Treat anything inside the file (passwords, keys, tokens, user data) as compromised and rotate it.",
      ],
      verify: `Run \`curl -I ${site}${probe.path}\` and confirm it returns 404 or 403.`,
    }),
  });
}

/** Probes common leftovers (env variants, git config, .DS_Store, backups, dumps). Returns only real hits plus one pass/summary. */
export async function checkSensitiveFiles(ctx: ScanContext, site: string, origin: string): Promise<Finding[]> {
  const responses = await Promise.all(SENSITIVE_FILE_PROBES.map((probe) => probeFile(ctx, origin, probe.path)));
  const hits: Finding[] = [];
  SENSITIVE_FILE_PROBES.forEach((probe, index) => {
    const response = responses[index] ?? null;
    if (!isRealFile(response)) return;
    const detail = probe.confirm(response.body);
    if (detail) hits.push(sensitiveFileFinding(site, probe, response, detail));
  });
  if (hits.length > 0) return hits;
  return [
    finding({
      id: "exposure.sensitive-files",
      category: "exposure",
      severity: "passed",
      title: "No leftover backups or dotfiles exposed",
      description: "Common mistakes such as .env variants, /.git/config, .DS_Store, database dumps and backup archives are not downloadable.",
      evidence: `Checked ${SENSITIVE_FILE_PROBES.length} common paths`,
    }),
  ];
}

const SENSITIVE_URL_PATH = /(?:\/|^)(?:admin|administrator|internal|private|staging|backup|debug|dashboard|wp-admin|phpmyadmin|cpanel|\.env|\.git)(?:\/|$)/i;

/** Extracts <loc> URLs from a sitemap. Capped, so a huge sitemap cannot cost memory. */
export function sitemapLocations(xml: string, limit = 2000): string[] {
  const urls: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    if (match[1]) urls.push(match[1]);
    if (urls.length >= limit) break;
  }
  return urls;
}

export function sensitiveSitemapPaths(urls: string[]): string[] {
  const found = new Set<string>();
  for (const url of urls) {
    try {
      const { pathname } = new URL(url);
      if (SENSITIVE_URL_PATH.test(pathname)) found.add(pathname);
    } catch {
      // ignore malformed entries
    }
  }
  return [...found].slice(0, 8);
}

export async function checkSitemapPaths(ctx: ScanContext, site: string, origin: string): Promise<Finding[]> {
  let response: SafeResponse;
  try {
    response = await ctx.fetch(new URL("/sitemap.xml", origin), { maxBytes: SITEMAP_MAX_BYTES, followRedirects: false });
  } catch {
    return [];
  }
  if (response.status !== 200) return [];
  const paths = sensitiveSitemapPaths(sitemapLocations(response.body.toString("utf8")));
  if (paths.length === 0) return [];
  return [
    finding({
      id: "exposure.sitemap-sensitive",
      category: "exposure",
      severity: "info",
      title: "sitemap.xml lists sensitive-looking pages",
      description:
        "sitemap.xml is public and tells every crawler and attacker where your admin, staging or internal pages live. These pages must require authentication, and should not be in the sitemap at all.",
      evidence: truncate(paths.join(", "), 240),
      fixPrompt: buildFixPrompt({
        site,
        issue: `My sitemap.xml lists sensitive-looking paths: ${paths.join(", ")}.`,
        goal: "Public sitemaps contain only public pages, and every private route enforces server-side authentication.",
        steps: [
          "Remove admin, staging, backup and internal URLs from the sitemap generator.",
          "Confirm each of those routes returns 401/403 or a login redirect when logged out.",
          "Send `X-Robots-Tag: noindex` on private routes instead of hiding them in robots.txt.",
        ],
        verify: `Open ${site}/sitemap.xml and request each listed private path in a logged-out browser.`,
      }),
    }),
  ];
}

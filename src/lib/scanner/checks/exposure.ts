import { errorCode, isHtmlResponse, type SafeResponse, type ScanContext } from "../http";
import type { Finding } from "../types";
import { buildFixPrompt, finding, formatBytes, truncate } from "../utils";

/** Only the first few KB are read: enough to classify the file, never enough to dump it. */
const PROBE_MAX_BYTES = 4 * 1024;

const SENSITIVE_ROBOTS_PATH = /(admin|internal|private|staging|backup|debug|config|secret|dashboard|\.env|\.git|wp-admin|phpmyadmin|api\/)/i;

async function probe(ctx: ScanContext, origin: string, path: string): Promise<SafeResponse | Error> {
  try {
    return await ctx.fetch(new URL(path, origin), { maxBytes: PROBE_MAX_BYTES, followRedirects: false });
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  }
}

function describeProbe(path: string, result: SafeResponse | Error): string {
  if (result instanceof Error) return `GET ${path} → request failed (${errorCode(result) ?? result.message})`;
  const type = result.headers["content-type"] ?? "no content-type";
  return `GET ${path} → HTTP ${result.status} (${type})`;
}

/** Returns the response only when it is a real (non-HTML) file served with HTTP 200. */
function realFile(result: SafeResponse | Error): SafeResponse | null {
  if (result instanceof Error) return null;
  return result.status === 200 && result.body.length > 0 && !isHtmlResponse(result) ? result : null;
}

function checkEnv(site: string, result: SafeResponse | Error): Finding {
  const id = "exposure.env";
  const file = realFile(result);
  if (!file) {
    const servedHtml = !(result instanceof Error) && result.status === 200;
    return finding({
      id,
      category: "exposure",
      severity: "passed",
      title: ".env file is not publicly accessible",
      description: "Your environment file (database URLs, API secrets) cannot be downloaded from the web root.",
      evidence: `${describeProbe("/.env", result)}${servedHtml ? " — HTML fallback page, not the real file" : ""}`,
    });
  }

  const text = file.body.toString("utf8");
  const keyLines = text.split(/\r?\n/).filter((line) => /^\s*(export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/.test(line)).length;
  const fixPrompt = buildFixPrompt({
    site,
    issue: `My .env file is publicly downloadable at ${site}/.env.`,
    goal: "Remove the file from the public web root, block dotfiles at the server, and rotate every secret it contained.",
    steps: [
      "Treat every value in the file as compromised: list each key and give me the exact rotation steps for each provider (database password, Stripe, OpenAI, Supabase service role, etc.).",
      "Find why it is served (e.g. .env committed inside /public, a static-file server rooted at the project folder, a Docker image that copies the whole repo) and fix it.",
      "Add a server/CDN rule that returns 404 for any path starting with /. (dotfiles), except /.well-known/.",
      "Make sure .env* is in .gitignore and .dockerignore, and purge it from git history if it was committed.",
    ],
    verify: `Run \`curl -I ${site}/.env\` and confirm it returns 404/403.`,
  });

  if (keyLines > 0) {
    return finding({
      id,
      category: "exposure",
      severity: "critical",
      title: ".env file is publicly downloadable",
      description:
        "Anyone can download your environment file. It typically contains database credentials and secret API keys, which bots scan for constantly. Assume these secrets are already compromised and rotate them.",
      evidence: `${describeProbe("/.env", result)} · ${keyLines} KEY=VALUE line(s) detected in the first ${formatBytes(file.body.length)} — contents intentionally not shown`,
      fixPrompt,
    });
  }

  return finding({
    id,
    category: "exposure",
    severity: "warning",
    title: "/.env returns a non-HTML file",
    description:
      "The path /.env returns a file instead of a 404. It does not look like KEY=VALUE pairs, but you should confirm nothing sensitive is served there.",
    evidence: `${describeProbe("/.env", result)} · ${formatBytes(file.body.length)} read — contents intentionally not shown`,
    fixPrompt,
  });
}

function checkGit(site: string, result: SafeResponse | Error): Finding {
  const id = "exposure.git";
  const file = realFile(result);
  if (!file) {
    return finding({
      id,
      category: "exposure",
      severity: "passed",
      title: ".git directory is not exposed",
      description: "Your repository metadata cannot be downloaded, so source code and commit history stay private.",
      evidence: describeProbe("/.git/HEAD", result),
    });
  }

  const head = file.body.toString("utf8").trim();
  const looksLikeGit = /^ref:\s*refs\//.test(head) || /^[0-9a-f]{40}$/i.test(head);
  const fixPrompt = buildFixPrompt({
    site,
    issue: `The .git directory is publicly accessible at ${site}/.git/.`,
    goal: "Stop serving the .git folder and assume the full source code and history are public.",
    steps: [
      "Change the deployment so only the build output is uploaded (not the repository folder).",
      "Add a server rule returning 404 for /.git and all dotfiles (except /.well-known/).",
      "Scan the full git history for secrets (e.g. with gitleaks) and rotate anything found, since attackers can reconstruct the repo from /.git.",
    ],
    verify: `Run \`curl -I ${site}/.git/HEAD\` and confirm 404/403.`,
  });

  return finding({
    id,
    category: "exposure",
    severity: looksLikeGit ? "critical" : "warning",
    title: looksLikeGit ? "Git repository is publicly exposed" : "/.git/HEAD returns a non-HTML file",
    description: looksLikeGit
      ? "Attackers can reconstruct your entire source code and commit history from /.git, including any secret that was ever committed, even if it was later deleted."
      : "The path /.git/HEAD returns a file instead of a 404. Confirm your repository metadata is not being served.",
    evidence: `${describeProbe("/.git/HEAD", result)} · ${looksLikeGit ? "valid git HEAD reference detected" : "unrecognized content"} — contents intentionally not shown`,
    fixPrompt,
  });
}

function checkRobots(site: string, result: SafeResponse | Error): Finding {
  const id = "exposure.robots";
  const file = realFile(result);
  if (!file) {
    return finding({
      id,
      category: "exposure",
      severity: "info",
      title: "No robots.txt found",
      description: "Not a security risk, but a robots.txt helps search engines crawl the right pages. Don't use it to hide sensitive URLs — it is public.",
      evidence: describeProbe("/robots.txt", result),
      fixPrompt: buildFixPrompt({
        site,
        issue: "My site has no robots.txt.",
        goal: "Serve a simple robots.txt that allows crawling of public pages and references the sitemap.",
        steps: ["Next.js: add app/robots.ts; other frameworks: add public/robots.txt.", "Do not list secret or admin URLs in it."],
        verify: `Open ${site}/robots.txt.`,
      }),
    });
  }

  const disallowed = file.body
    .toString("utf8")
    .split(/\r?\n/)
    .map((line) => /^\s*disallow:\s*(\S+)/i.exec(line)?.[1])
    .filter((path): path is string => Boolean(path) && SENSITIVE_ROBOTS_PATH.test(path ?? ""));
  const unique = [...new Set(disallowed)].slice(0, 6);

  if (unique.length > 0) {
    return finding({
      id,
      category: "exposure",
      severity: "info",
      title: "robots.txt advertises sensitive-looking paths",
      description:
        "robots.txt is public and is often the first file attackers read. Listing admin or internal paths there acts as a map. Protect those routes with authentication instead.",
      evidence: `Disallow: ${unique.join(", ")}`,
      fixPrompt: buildFixPrompt({
        site,
        issue: `My robots.txt lists sensitive paths: ${unique.join(", ")}.`,
        goal: "Make sure those routes require authentication and remove them from robots.txt (use noindex headers/meta instead).",
        steps: [
          "Verify each listed route enforces server-side authentication and authorization.",
          "Replace the Disallow lines with `X-Robots-Tag: noindex` headers on those routes.",
        ],
        verify: `Open ${site}/robots.txt and try each path in a logged-out browser.`,
      }),
    });
  }

  return finding({
    id,
    category: "exposure",
    severity: "passed",
    title: "robots.txt is present",
    description: "Search engines get crawl instructions, and no sensitive-looking paths are advertised.",
    evidence: describeProbe("/robots.txt", result),
  });
}

function checkSitemap(site: string, result: SafeResponse | Error): Finding {
  const body = result instanceof Error ? "" : result.body.toString("utf8");
  const ok = !(result instanceof Error) && result.status === 200 && /<(urlset|sitemapindex)\b/i.test(body);
  if (ok) {
    return finding({
      id: "exposure.sitemap",
      category: "exposure",
      severity: "passed",
      title: "sitemap.xml is present",
      description: "Search engines can discover your public pages. Make sure it lists only pages meant to be public.",
      evidence: describeProbe("/sitemap.xml", result),
    });
  }
  return finding({
    id: "exposure.sitemap",
    category: "exposure",
    severity: "info",
    title: "No sitemap.xml found",
    description: "Not a security issue, but a sitemap speeds up indexing after launch.",
    evidence: describeProbe("/sitemap.xml", result),
    fixPrompt: buildFixPrompt({
      site,
      issue: "My site has no sitemap.xml.",
      goal: "Generate a sitemap.xml listing only public, indexable pages.",
      steps: ["Next.js: add app/sitemap.ts; Astro/Nuxt/SvelteKit: use the official sitemap integration.", "Exclude authenticated routes, admin pages and API routes."],
      verify: `Open ${site}/sitemap.xml.`,
    }),
  });
}

function checkTechDisclosure(site: string, main: SafeResponse): Finding {
  const id = "exposure.tech-disclosure";
  const candidates: Array<[string, string | undefined]> = [
    ["Server", main.headers["server"]],
    ["X-Powered-By", main.headers["x-powered-by"]],
    ["X-AspNet-Version", main.headers["x-aspnet-version"]],
    ["X-AspNetMvc-Version", main.headers["x-aspnetmvc-version"]],
    ["X-Generator", main.headers["x-generator"]],
  ];
  const present = candidates.filter((entry): entry is [string, string] => Boolean(entry[1]));
  const versioned = present.filter(([, value]) => /\d+\.\d+/.test(value));
  const poweredBy = present.filter(([name]) => name !== "Server");
  const evidence = present.map(([name, value]) => `${name}: ${truncate(value, 80)}`).join(" · ");
  const fixPrompt = buildFixPrompt({
    site,
    issue: `My responses disclose server technology/versions (${evidence}).`,
    goal: "Remove version numbers and framework fingerprints from response headers.",
    steps: [
      "Next.js: set `poweredByHeader: false` in next.config. Express: `app.disable('x-powered-by')` or helmet. PHP: `expose_php = Off`. Nginx: `server_tokens off;`. Apache: `ServerTokens Prod` + `ServerSignature Off`. ASP.NET: remove X-AspNet-Version in web.config.",
      "Also check that the disclosed software versions are fully patched.",
    ],
    verify: `Run \`curl -sI ${site}\` and confirm no version numbers appear in Server/X-Powered-By.`,
  });

  if (versioned.length > 0) {
    return finding({
      id,
      category: "exposure",
      severity: "warning",
      title: "Server software version is disclosed",
      description:
        "Exact version numbers let attackers instantly look up known vulnerabilities (CVEs) for your stack. Hiding them costs nothing.",
      evidence,
      fixPrompt,
    });
  }
  if (poweredBy.length > 0) {
    return finding({
      id,
      category: "exposure",
      severity: "info",
      title: "X-Powered-By header reveals your framework",
      description: "No version is shown, but the header fingerprints your stack for automated scanners. It serves no purpose for users.",
      evidence,
      fixPrompt,
    });
  }
  return finding({
    id,
    category: "exposure",
    severity: "passed",
    title: "No server version disclosure",
    description: "Response headers don't reveal software versions that attackers could match against known vulnerabilities.",
    evidence: evidence || "Server / X-Powered-By: (not set)",
  });
}

export function checkSecurityTxt(site: string, result: SafeResponse | Error): Finding {
  const id = "exposure.security-txt";
  const path = "/.well-known/security.txt";
  const fixPrompt = buildFixPrompt({
    site,
    issue: "My site has no valid /.well-known/security.txt file.",
    goal: "Publish an RFC 9116 security.txt so security researchers know how to report vulnerabilities privately.",
    steps: [
      "Create `/.well-known/security.txt` (Next.js: `public/.well-known/security.txt`; most hosts serve files from `public/` or `static/`).",
      "Include at least `Contact: mailto:security@<my-domain>` and `Expires: <ISO date within the next 12 months>`; optionally `Preferred-Languages: en` and `Policy:` linking to a disclosure policy.",
      "Make sure it is served as `text/plain` and that the dotfile-blocking rule (if any) still allows `/.well-known/`.",
    ],
    verify: `Run \`curl -s ${site}${path}\` and confirm it shows the Contact line.`,
  });

  const file = realFile(result);
  if (!file) {
    return finding({
      id,
      category: "exposure",
      severity: "info",
      title: "No security.txt found",
      description:
        "security.txt (RFC 9116) tells researchers who find a vulnerability how to reach you privately, instead of posting it publicly or giving up. It takes two minutes to add.",
      evidence: describeProbe(path, result),
      fixPrompt,
    });
  }

  const text = file.body.toString("utf8");
  const contact = /^\s*contact\s*:\s*(\S+)/im.exec(text)?.[1];
  const expiresRaw = /^\s*expires\s*:\s*(.+)$/im.exec(text)?.[1]?.trim();
  const expiresAt = expiresRaw ? Date.parse(expiresRaw) : Number.NaN;

  if (!contact) {
    return finding({
      id,
      category: "exposure",
      severity: "info",
      title: "security.txt is missing a Contact field",
      description: "The file exists, but without a `Contact:` line researchers still have no way to report issues to you.",
      evidence: `${describeProbe(path, result)} · no Contact: line`,
      fixPrompt,
    });
  }
  if (!Number.isNaN(expiresAt) && expiresAt < Date.now()) {
    return finding({
      id,
      category: "exposure",
      severity: "info",
      title: "security.txt has expired",
      description: "The `Expires:` date is in the past, so researchers may treat the contact details as stale. Update the date.",
      evidence: `${describeProbe(path, result)} · Expires: ${expiresRaw ?? ""}`,
      fixPrompt,
    });
  }

  return finding({
    id,
    category: "exposure",
    severity: "passed",
    title: "security.txt is published",
    description: "Security researchers have a documented way to report vulnerabilities to you privately.",
    evidence: `${describeProbe(path, result)} · Contact: ${truncate(contact, 80)}`,
  });
}

export async function checkExposure(ctx: ScanContext, site: string, main: SafeResponse): Promise<Finding[]> {
  const origin = new URL(main.url).origin;
  const [env, git, robots, sitemap, securityTxt] = await Promise.all([
    probe(ctx, origin, "/.env"),
    probe(ctx, origin, "/.git/HEAD"),
    probe(ctx, origin, "/robots.txt"),
    probe(ctx, origin, "/sitemap.xml"),
    probe(ctx, origin, "/.well-known/security.txt"),
  ]);

  return [
    checkEnv(site, env),
    checkGit(site, git),
    checkTechDisclosure(site, main),
    checkRobots(site, robots),
    checkSitemap(site, sitemap),
    checkSecurityTxt(site, securityTxt),
  ];
}

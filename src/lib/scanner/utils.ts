import type { Category, Finding, Severity } from "./types";

/** Masks the middle of a secret so it can be shown as evidence without leaking it. */
export function maskSecret(value: string): string {
  if (value.length <= 10) return `${value.slice(0, 2)}****`;
  const underscorePrefix = /^[a-z]+_(?:live|test)_/i.exec(value)?.[0];
  const prefixLength = underscorePrefix ? underscorePrefix.length : Math.min(8, Math.floor(value.length / 4));
  return `${value.slice(0, prefixLength)}****${value.slice(-4)}`;
}

export function finding(input: {
  id: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  evidence?: string;
  fixPrompt?: string;
}): Finding {
  return {
    id: input.id,
    category: input.category,
    severity: input.severity,
    title: input.title,
    description: input.description,
    evidence: input.evidence ?? "",
    fixPrompt: input.fixPrompt ?? "",
  };
}

/** Builds a copy-paste prompt for Cursor / Claude Code / Copilot that fixes one specific issue. */
export function buildFixPrompt(input: {
  site: string;
  issue: string;
  goal: string;
  steps: string[];
  verify: string;
}): string {
  const steps = [
    "First, detect how this project is built and hosted (e.g. Next.js, Vite/React, SvelteKit, Nuxt, Astro, Express, Django, Rails; Vercel, Netlify, Cloudflare, Nginx, a Docker image) and apply the fix in the correct place for that stack.",
    ...input.steps,
    "Keep the change minimal, do not break existing functionality, and explain every file you changed.",
  ];
  return [
    `I'm preparing to launch my web app (${input.site}). A passive pre-launch security scan flagged this issue:`,
    "",
    `Issue: ${input.issue}`,
    "",
    `Goal: ${input.goal}`,
    "",
    "Please:",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    `How I'll verify: ${input.verify}`,
  ].join("\n");
}

export function truncate(value: string, max = 160): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

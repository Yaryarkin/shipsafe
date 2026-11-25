import { z } from "zod";

export const SEVERITIES = ["critical", "warning", "info", "passed"] as const;
export const CATEGORIES = ["transport", "headers", "exposure", "cors-cookies", "secrets", "frontend", "build"] as const;
export const GRADES = ["A", "B", "C", "D", "F"] as const;

export const severitySchema = z.enum(SEVERITIES);
export const categorySchema = z.enum(CATEGORIES);
export const gradeSchema = z.enum(GRADES);

export const scanRequestSchema = z.object({
  url: z
    .string({ required_error: "A URL is required.", invalid_type_error: "URL must be a string." })
    .trim()
    .min(1, "A URL is required.")
    .max(2048, "URL is too long."),
});

export const STACKS = ["nextjs", "vercel", "nginx", "express", "android", "generic"] as const;
export const stackSchema = z.enum(STACKS);

/** A copy-paste fix for one hosting stack. */
export const fixSnippetSchema = z.object({
  stack: stackSchema,
  label: z.string().min(1),
  language: z.string().min(1),
  code: z.string().min(1),
  /** True for the snippets that match the detected stack; they are listed first. */
  recommended: z.boolean().optional(),
});

export const findingSchema = z.object({
  id: z.string().min(1),
  category: categorySchema,
  severity: severitySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  evidence: z.string(),
  fixPrompt: z.string(),
  /** Plain-language business / security impact. Added after scanning by `enrichFindings`. */
  impact: z.string().optional(),
  /** Stack-specific, copy-paste remediation snippets. Added after scanning by `enrichFindings`. */
  snippets: z.array(fixSnippetSchema).optional(),
});

export const summarySchema = z.object({
  critical: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
});

/** A stack the scan believes the target runs on, with the clues behind that belief. */
export const detectedStackSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(60),
  confidence: z.enum(["high", "medium"]),
  signals: z.array(z.string().max(120)).max(8),
});

export const scoreBreakdownSchema = z.object({
  base: z.number().int(),
  items: z.array(
    z.object({
      severity: severitySchema,
      count: z.number().int().nonnegative(),
      pointsEach: z.number().int().nonnegative(),
      points: z.number().int().nonnegative(),
    }),
  ),
  /** Set when a critical finding capped the score below what the penalties alone would give. */
  criticalCap: z.number().int().nullable(),
  total: z.number().int().min(0).max(100),
});

export const scanResultSchema = z.object({
  target: z.string().url(),
  finalUrl: z.string().url(),
  scannedAt: z.string().datetime(),
  overallScore: z.number().int().min(0).max(100),
  grade: gradeSchema,
  scanDurationMs: z.number().int().nonnegative(),
  summary: summarySchema,
  findings: z.array(findingSchema),
  scoreBreakdown: scoreBreakdownSchema.optional(),
  detectedStack: z.array(detectedStackSchema).max(8).optional(),
});

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export type Severity = z.infer<typeof severitySchema>;
export type Category = z.infer<typeof categorySchema>;
export type Grade = z.infer<typeof gradeSchema>;
export type Finding = z.infer<typeof findingSchema>;
export type Stack = z.infer<typeof stackSchema>;
export type FixSnippet = z.infer<typeof fixSnippetSchema>;
export type ScoreBreakdown = z.infer<typeof scoreBreakdownSchema>;
export type ScanSummary = z.infer<typeof summarySchema>;
export type ScanResult = z.infer<typeof scanResultSchema>;
export type ApiError = z.infer<typeof apiErrorSchema>;

export const CATEGORY_LABELS: Record<Category, string> = {
  transport: "Transport & TLS",
  headers: "Security Headers",
  exposure: "Public Exposure",
  "cors-cookies": "CORS & Cookies",
  secrets: "Client Bundle Secrets",
  frontend: "Frontend Integrity",
  build: "App / Game Build",
};

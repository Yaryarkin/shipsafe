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

export const findingSchema = z.object({
  id: z.string().min(1),
  category: categorySchema,
  severity: severitySchema,
  title: z.string().min(1),
  description: z.string().min(1),
  evidence: z.string(),
  fixPrompt: z.string(),
});

export const summarySchema = z.object({
  critical: z.number().int().nonnegative(),
  warning: z.number().int().nonnegative(),
  info: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
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
